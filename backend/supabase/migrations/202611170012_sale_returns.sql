begin;

create table shop.sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references shop.sales,
  employee_id uuid not null references shop.employee_profiles,
  reason text not null check (length(btrim(reason)) between 1 and 180),
  refund_method text not null check (refund_method in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other')),
  refund_minor bigint not null default 0 check (refund_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, sale_id)
);
create index sale_returns_sale_idx on shop.sale_returns (sale_id);
create index sale_returns_created_idx on shop.sale_returns (created_at);

create table shop.sale_return_items (
  return_id uuid not null,
  sale_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity between 1 and 1000000),
  restocked boolean not null,
  amount_minor bigint not null check (amount_minor >= 0),
  primary key (return_id, product_id),
  foreign key (return_id, sale_id) references shop.sale_returns (id, sale_id),
  foreign key (sale_id, product_id) references shop.sale_items (sale_id, product_id)
);
create index sale_return_items_source_idx on shop.sale_return_items (sale_id, product_id);
alter table shop.sale_returns enable row level security;
alter table shop.sale_return_items enable row level security;
revoke all on shop.sale_returns, shop.sale_return_items from public, anon, authenticated, service_role;

alter table shop.stock_movements
  drop constraint stock_movements_type_check,
  drop constraint stock_movements_check,
  add column return_id uuid,
  add check (type in ('in','out','sale','reversal','return')),
  add check ((type = 'in' and delta > 0 and cost_minor is not null) or
    (type in ('out','sale') and delta < 0 and cost_minor is null) or type = 'reversal' or
    (type = 'return' and delta > 0 and cost_minor is null)),
  add check ((type = 'return') = (return_id is not null)),
  add foreign key (return_id, product_id) references shop.sale_return_items (return_id, product_id),
  add unique (return_id, product_id);

create function shop.customer_credit_balance(buyer uuid)
returns bigint language sql stable set search_path = '' as $$
  select coalesce((select sum(total_minor) from shop.sales where customer_id = buyer and payment = 'Credit'), 0)
    - coalesce((select sum(r.credit_minor) from shop.sale_returns r join shop.sales s on s.id = r.sale_id
                where s.customer_id = buyer), 0)
    - coalesce((select sum(amount_minor) from shop.customer_payments where customer_id = buyer), 0)
$$;

create function shop.sale_return_lines(sale_key uuid)
returns table (product_id uuid, quantity integer, net_minor bigint) language sql stable set search_path = '' as $$
  -- Allocate any legacy sale-wide discount across the original lines in product ID order.
  -- Cumulative integer rounding preserves the exact total and makes repeated partial returns additive.
  with lines as (
    select i.product_id, i.quantity, i.quantity * i.unit_minor::bigint - i.discount_minor as line_net,
      sum(i.discount_minor) over () as item_discounts
    from shop.sale_items i where i.sale_id = sale_key
  ), bounds as (
    select *, sum(line_net) over (order by product_id) as upper_net, sum(line_net) over () as total_net
    from lines
  )
  select b.product_id, b.quantity, (b.line_net - coalesce(
    div(b.upper_net * (s.discount_minor - b.item_discounts), nullif(b.total_net, 0))
      - div((b.upper_net - b.line_net) * (s.discount_minor - b.item_discounts), nullif(b.total_net, 0)), 0
  ))::bigint
  from bounds b join shop.sales s on s.id = sale_key
$$;

create function public.be_return_sale(p_provider text, p_subject text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  original shop.sales;
  previous shop.command_requests;
  sale_key uuid := (p_data->>'id')::uuid;
  reason_text text := btrim(coalesce(p_data->>'reason', ''));
  line record;
  return_key uuid;
  line_amount bigint;
  total bigint := 0;
  applied_credit bigint := 0;
  outcome jsonb;
  business_day date;
  recorded_at timestamptz;
begin
  select e.* into actor from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active for share of e;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;
  if length(reason_text) not between 1 and 180 then raise exception 'Enter a return reason.'; end if;
  if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Select items to return.'; end if;
  if jsonb_array_length(p_data->'items') not between 1 and 50 or
    (select count(distinct product_id) from jsonb_to_recordset(p_data->'items') as q(product_id uuid))
      <> jsonb_array_length(p_data->'items') then
    raise exception 'Select at least one item and include each item only once.';
  end if;

  insert into shop.command_requests(employee_id, request_id, command, payload)
    values (actor.id, p_request, 'return_sale', p_data) on conflict do nothing;
  if not found then
    select * into strict previous from shop.command_requests where employee_id = actor.id and request_id = p_request;
    if previous.command <> 'return_sale' or previous.payload <> p_data then
      raise exception 'This submission ID was already used for different details.';
    end if;
    return previous.result;
  end if;

  select * into original from shop.sales where id = sale_key for update;
  if not found or (actor.role <> 'admin' and original.employee_id <> actor.id) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if coalesce(p_data->>'revision', '') <> coalesce((
    select id::text from shop.audit_logs where action = 'correct_sale' and target_id = sale_key
    order by created_at desc, id desc limit 1
  ), '') then raise exception 'The sale was edited. Reopen the receipt and review the return.'; end if;

  if original.payment = 'Credit' then
    perform 1 from shop.customers where id = original.customer_id for update;
  end if;
  recorded_at := clock_timestamp();
  select (recorded_at at time zone timezone)::date into strict business_day from shop.shop_settings where singleton;
  insert into shop.sale_returns(sale_id, employee_id, reason, refund_method, created_at)
    values (sale_key, actor.id, reason_text, case when original.payment = 'Credit' then 'ZAAD' else original.payment end, recorded_at)
    returning id into return_key;

  for line in
    select q.*, p.archived, s.quantity as sold, s.net_minor,
      coalesce((select sum(i.quantity) from shop.sale_return_items i
                where i.sale_id = sale_key and i.product_id = q.product_id), 0) as already_returned
    from jsonb_to_recordset(p_data->'items') as q(product_id uuid, quantity integer, restock boolean)
    join shop.products p on p.id = q.product_id
    left join shop.sale_return_lines(sale_key) s on s.product_id = q.product_id
    order by p.id for update of p
  loop
    if line.sold is null or line.quantity is null or line.quantity < 1
      or line.already_returned + line.quantity > line.sold or line.restock is null then
      raise exception 'A return quantity exceeds the remaining quantity on the receipt. Reopen the receipt and try again.';
    end if;
    if line.restock and line.archived then
      raise exception 'An archived product cannot be restocked. Clear its restock checkbox to record the return.';
    end if;
    line_amount := div(line.net_minor::numeric * (line.already_returned + line.quantity), line.sold)
      - div(line.net_minor::numeric * line.already_returned, line.sold);
    total := total + line_amount;
    insert into shop.sale_return_items(return_id, sale_id, product_id, quantity, restocked, amount_minor)
      values (return_key, sale_key, line.product_id, line.quantity, line.restock, line_amount);
    if line.restock then
      update shop.products set quantity = quantity + line.quantity where id = line.product_id;
      insert into shop.stock_movements(product_id, employee_id, type, delta, reason, reference, notes, occurred_on, return_id)
        values (line.product_id, actor.id, 'return', line.quantity, 'Customer return', sale_key::text, reason_text, business_day, return_key);
    end if;
  end loop;
  if (select count(*) from shop.sale_return_items where return_id = return_key) <> jsonb_array_length(p_data->'items') then
    raise exception 'Include only products from this receipt.';
  end if;

  if original.payment = 'Credit' then
    applied_credit := least(total, greatest(0, shop.customer_credit_balance(original.customer_id)));
  end if;
  if total is distinct from (p_data->>'quoted_total_minor')::bigint
    or applied_credit is distinct from (p_data->>'quoted_credit_minor')::bigint then
    raise exception 'The refund or credit amount changed. Reopen the receipt and review the return.';
  end if;
  update shop.sale_returns set credit_minor = applied_credit, refund_minor = total - applied_credit where id = return_key;
  insert into shop.audit_logs(employee_id, action, target_id, details)
    values (actor.id, 'return_sale', return_key, jsonb_build_object(
      'sale_id', sale_key, 'credit_minor', applied_credit, 'refund_minor', total - applied_credit, 'return', p_data));
  outcome := jsonb_build_object('id', sale_key, 'return_id', return_key);
  update shop.command_requests set result = outcome where employee_id = actor.id and request_id = p_request;
  return outcome;
end;
$$;

-- The existing correction workflow locks the sale before editing it. Guard changes at the table
-- under that same lock so a return and a correction cannot invalidate one another.
create function shop.guard_returned_sale() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from shop.sale_returns where sale_id = old.id) then
    raise exception 'This sale has a recorded return and cannot be edited.';
  end if;
  return new;
end;
$$;
create trigger guard_returned_sale before update on shop.sales
for each row execute function shop.guard_returned_sale();

-- Serialize repayments and credit returns using the existing customer row lock.
create function shop.check_return_adjusted_credit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'customer_payments' then
    if shop.customer_credit_balance(new.customer_id) < 0 then
      raise exception 'Enter a payment between $0.01 and the outstanding balance.';
    end if;
  elsif old.payment = 'Credit' and shop.customer_credit_balance(old.customer_id) < 0 then
    raise exception 'This correction would leave a customer with more repayments than credit.';
  end if;
  return null;
end;
$$;
create trigger check_repayment_after_returns after insert on shop.customer_payments
for each row execute function shop.check_return_adjusted_credit();
create trigger check_correction_after_returns after update on shop.sales
for each row execute function shop.check_return_adjusted_credit();

create function public.be_receipt_with_returns(p_provider text, p_subject text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  receipt jsonb := public.be_read_product_units(p_provider, p_subject, 'receipt', p_options);
  sale_key uuid := (p_options->>'id')::uuid;
begin
  if receipt is null then return null; end if;
  return receipt || jsonb_build_object(
    'revision', coalesce((select id::text from shop.audit_logs where action = 'correct_sale' and target_id = sale_key
      order by created_at desc, id desc limit 1), ''),
    'credit_balance_minor', case when receipt->'sale'->>'payment' = 'Credit'
      then shop.customer_credit_balance((receipt->'sale'->>'customer_id')::uuid) end,
    'items', (select jsonb_agg(j.item || jsonb_build_object('product_id', i.product_id, 'archived', p.archived, 'net_minor', n.net_minor,
      'returned_quantity', coalesce((select sum(l.quantity) from shop.sale_return_items l
        where l.sale_id = sale_key and l.product_id = i.product_id), 0)) order by j.position)
      from jsonb_array_elements(receipt->'items') with ordinality j(item, position)
      join shop.sale_items i on i.sale_id = sale_key and i.sku = j.item->>'sku'
      join shop.sale_return_lines(sale_key) n on n.product_id = i.product_id
      join shop.products p on p.id = i.product_id),
    'returns', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id), '[]') from (
      select r.id, r.created_at, r.reason, r.refund_method, r.refund_minor, r.credit_minor,
        e.full_name as employee_name,
        (select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'sku', i.sku,
          'quantity', l.quantity, 'restocked', l.restocked) order by i.product_name, i.sku)
          from shop.sale_return_items l join shop.sale_items i using (sale_id, product_id)
          where l.return_id = r.id) as items
      from shop.sale_returns r join shop.employee_profiles e on e.id = r.employee_id
      where r.sale_id = sale_key
    ) r)
  );
end;
$$;

create function public.be_closeout_with_returns(p_provider text, p_subject text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  closeout jsonb := public.be_counter_read(p_provider, p_subject, 'closeout', p_options);
  business_day date := (closeout->>'day')::date;
  business_timezone text;
  actor shop.employee_profiles;
begin
  select e.* into strict actor from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
    where i.provider = p_provider and i.subject = p_subject and e.active;
  select timezone into strict business_timezone from shop.shop_settings where singleton;
  return closeout || jsonb_build_object('zaad_repayments_minor', (
    select coalesce(sum(amount_minor), 0) from shop.customer_payments
    where (actor.role = 'admin' or employee_id = actor.id)
      and created_at >= business_day::timestamp at time zone business_timezone
      and created_at < (business_day + 1)::timestamp at time zone business_timezone
  ), 'returns', (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.payment), '[]')
    from (
      select refund_method as payment, sum(refund_minor) as refund_minor, sum(credit_minor) as credit_minor, count(*) as returns
      from shop.sale_returns
      where (actor.role = 'admin' or employee_id = actor.id)
        and created_at >= business_day::timestamp at time zone business_timezone
        and created_at < (business_day + 1)::timestamp at time zone business_timezone
      group by refund_method
    ) r
  ));
end;
$$;

create function public.be_customers_with_returns(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb := public.be_customers(p_provider, p_subject, p_query, p_options);
  buyer uuid := (p_options->>'id')::uuid;
begin
  if result is null then return null; end if;
  if p_query = 'customer' then
    return result || jsonb_build_object('balance_minor', shop.customer_credit_balance(buyer), 'activity', (
      select coalesce(jsonb_agg(a.item order by a.item->>'created_at' desc, a.item->>'id'), '[]') from (
        select item from (
          select item from jsonb_array_elements(result->'activity') j(item)
          union all
          select jsonb_build_object('id', r.id, 'created_at', r.created_at, 'amount_minor', r.credit_minor,
            'kind', 'Credit return', 'note', r.reason)
          from shop.sale_returns r join shop.sales s on s.id = r.sale_id
          where s.customer_id = buyer and r.credit_minor > 0
        ) activity order by item->>'created_at' desc, item->>'id' limit 50
      ) a
    ));
  end if;
  if p_query = 'customers' then
    return jsonb_set(result, '{rows}', (
      select coalesce(jsonb_agg(j.item || jsonb_build_object(
        'balance_minor', shop.customer_credit_balance((j.item->>'id')::uuid)) order by j.position), '[]')
      from jsonb_array_elements(result->'rows') with ordinality j(item, position)
    ));
  end if;
  return result;
end;
$$;

revoke all on function shop.customer_credit_balance(uuid), shop.sale_return_lines(uuid),
  shop.guard_returned_sale(), shop.check_return_adjusted_credit()
  from public, anon, authenticated, service_role;
revoke all on function public.be_return_sale(text,text,jsonb,uuid),
  public.be_receipt_with_returns(text,text,jsonb), public.be_closeout_with_returns(text,text,jsonb),
  public.be_customers_with_returns(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_return_sale(text,text,jsonb,uuid),
  public.be_receipt_with_returns(text,text,jsonb), public.be_closeout_with_returns(text,text,jsonb),
  public.be_customers_with_returns(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
