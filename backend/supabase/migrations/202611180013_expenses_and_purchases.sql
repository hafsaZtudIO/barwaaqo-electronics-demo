begin;

create table shop.expenses (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references shop.employee_profiles,
  category text not null check (category in ('Rent','Electricity','Transport','Internet','Salaries','Maintenance','Other')),
  description text not null check (length(btrim(description)) between 1 and 180),
  amount_minor bigint not null check (amount_minor between 1 and 999999999),
  payment text not null check (payment in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other')),
  occurred_on date not null,
  reference text not null default '' check (length(reference) <= 180),
  notes text not null default '' check (length(notes) <= 2000),
  void_reason text check (length(btrim(void_reason)) between 1 and 180),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on shop.expenses (occurred_on desc, id);

create table shop.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references shop.suppliers,
  employee_id uuid not null references shop.employee_profiles,
  reference text not null default '' check (length(reference) <= 180),
  notes text not null default '' check (length(notes) <= 2000),
  status text not null default 'ordered' check (status in ('ordered','received','cancelled')),
  total_minor bigint not null check (total_minor between 0 and 9007199254740991),
  ordered_on date not null,
  due_on date,
  received_on date,
  created_at timestamptz not null default now(),
  check (due_on is null or due_on >= ordered_on),
  check ((status = 'received') = (received_on is not null))
);
create index purchases_supplier_idx on shop.purchases (supplier_id, ordered_on desc, id);
create table shop.purchase_items (
  purchase_id uuid not null references shop.purchases,
  product_id uuid not null references shop.products,
  product_name text not null,
  sku text not null,
  unit text not null,
  quantity integer not null check (quantity between 1 and 1000000),
  cost_minor integer not null check (cost_minor between 0 and 999999999),
  primary key (purchase_id, product_id)
);
create table shop.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references shop.purchases,
  employee_id uuid not null references shop.employee_profiles,
  amount_minor bigint not null check (amount_minor between 1 and 999999999),
  payment text not null check (payment in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other')),
  occurred_on date not null,
  reference text not null default '' check (length(reference) <= 180),
  created_at timestamptz not null default now()
);
create index supplier_payments_purchase_idx on shop.supplier_payments (purchase_id);
create index supplier_payments_date_idx on shop.supplier_payments (occurred_on);
alter table shop.stock_movements add column purchase_id uuid,
  add foreign key (purchase_id, product_id) references shop.purchase_items (purchase_id, product_id),
  add unique (purchase_id, product_id),
  add check (purchase_id is null or type = 'in');

alter table shop.expenses enable row level security;
alter table shop.purchases enable row level security;
alter table shop.purchase_items enable row level security;
alter table shop.supplier_payments enable row level security;
revoke all on shop.expenses, shop.purchases, shop.purchase_items, shop.supplier_payments
  from public, anon, authenticated, service_role;

create view shop.purchase_details as
select p.*, s.name as supplier_name,
  coalesce((select sum(amount_minor) from shop.supplier_payments where purchase_id = p.id), 0)::bigint as paid_minor,
  p.total_minor - coalesce((select sum(amount_minor) from shop.supplier_payments where purchase_id = p.id), 0)::bigint as balance_minor
from shop.purchases p join shop.suppliers s on s.id = p.supplier_id;

create function public.be_finance_write(p_provider text, p_subject text, p_command text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  previous shop.command_requests;
  selected uuid := (p_data->>'id')::uuid;
  order_record shop.purchases;
  line record;
  outcome jsonb;
  business_day date;
  transaction_day date := (p_data->>'occurred_on')::date;
  paid bigint;
  total bigint;
begin
  select e.id into actor from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin' for share of e;
  if actor is null then raise exception 'Access denied.' using errcode = '42501'; end if;
  select (now() at time zone timezone)::date into strict business_day from shop.shop_settings where singleton;

  insert into shop.command_requests(employee_id, request_id, command, payload)
    values (actor, p_request, p_command, p_data) on conflict do nothing;
  if not found then
    select * into strict previous from shop.command_requests where employee_id = actor and request_id = p_request;
    if previous.command <> p_command or previous.payload <> p_data then
      raise exception 'This submission ID was already used for different details.';
    end if;
    return previous.result;
  end if;

  if p_command in ('record_expense','record_supplier_payment','receive_purchase') and
    (transaction_day is null or transaction_day > business_day) then
    raise exception 'Choose a date on or before today.';
  end if;
  case p_command
    when 'record_expense' then
      insert into shop.expenses(employee_id, category, description, amount_minor, payment, occurred_on, reference, notes)
      values (actor, p_data->>'category', btrim(p_data->>'description'), (p_data->>'amount_minor')::bigint,
        p_data->>'payment', transaction_day, coalesce(p_data->>'reference',''), coalesce(p_data->>'notes',''))
      returning id into selected;
    when 'void_expense' then
      if length(btrim(coalesce(p_data->>'reason',''))) not between 1 and 180 then raise exception 'Enter a reason for voiding this expense.'; end if;
      update shop.expenses set void_reason = btrim(p_data->>'reason') where id = selected and void_reason is null;
      if not found then raise exception 'The expense was already voided or was not found.'; end if;
    when 'create_purchase' then
      if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Add products to the order.'; end if;
      if jsonb_array_length(p_data->'items') not between 1 and 50 or
        (select count(distinct product_id) from jsonb_to_recordset(p_data->'items') as q(product_id uuid)) <> jsonb_array_length(p_data->'items') then
        raise exception 'Include between 1 and 50 products, each once.';
      end if;
      if (p_data->>'ordered_on')::date is null or (p_data->>'ordered_on')::date > business_day then
        raise exception 'Choose an order date on or before today.';
      end if;
      if exists (select 1 from jsonb_to_recordset(p_data->'items') as q(product_id uuid, quantity integer, cost_minor integer)
        left join shop.products p on p.id = q.product_id where p.id is null or p.archived
          or q.quantity is null or q.quantity not between 1 and 1000000 or q.cost_minor is null or q.cost_minor not between 0 and 999999999) then
        raise exception 'Choose active products with valid quantities and costs.';
      end if;
      select sum(quantity * cost_minor::bigint) into total
        from jsonb_to_recordset(p_data->'items') as q(quantity integer, cost_minor integer);
      insert into shop.purchases(supplier_id, employee_id, reference, notes, total_minor, ordered_on, due_on)
        values ((p_data->>'supplier_id')::uuid, actor, coalesce(p_data->>'reference',''), coalesce(p_data->>'notes',''),
          total, (p_data->>'ordered_on')::date, (p_data->>'due_on')::date) returning id into selected;
      insert into shop.purchase_items(purchase_id, product_id, product_name, sku, unit, quantity, cost_minor)
        select selected, p.id, p.name, p.sku, p.unit, q.quantity, q.cost_minor
        from jsonb_to_recordset(p_data->'items') as q(product_id uuid, quantity integer, cost_minor integer)
        join shop.products p on p.id = q.product_id;
    when 'receive_purchase', 'cancel_purchase', 'record_supplier_payment' then
      select * into order_record from shop.purchases where id = selected for update;
      if not found then raise exception 'Purchase order was not found.'; end if;
      if order_record.status = 'cancelled' then raise exception 'This purchase order was cancelled.'; end if;
      select coalesce(sum(amount_minor), 0) into paid from shop.supplier_payments where purchase_id = selected;
      if p_command = 'record_supplier_payment' then
        if transaction_day < order_record.ordered_on then raise exception 'Payment date must be on or after the order date.'; end if;
        if (p_data->>'amount_minor')::bigint is null or (p_data->>'amount_minor')::bigint < 1 or
          (p_data->>'amount_minor')::bigint > order_record.total_minor - paid then
          raise exception 'Enter a payment within the outstanding purchase balance.';
        end if;
        insert into shop.supplier_payments(purchase_id, employee_id, amount_minor, payment, occurred_on, reference)
          values (selected, actor, (p_data->>'amount_minor')::bigint, p_data->>'payment', transaction_day, coalesce(p_data->>'reference',''));
      elsif p_command = 'cancel_purchase' then
        if order_record.status <> 'ordered' or paid > 0 then raise exception 'Only an unpaid, unreceived order can be cancelled.'; end if;
        update shop.purchases set status = 'cancelled' where id = selected;
      else
        if order_record.status <> 'ordered' then raise exception 'This purchase was already received.'; end if;
        if transaction_day < order_record.ordered_on then raise exception 'Receipt date must be on or after the order date.'; end if;
        for line in select i.*, p.archived, p.unit as current_unit from shop.purchase_items i join shop.products p on p.id = i.product_id
          where i.purchase_id = selected order by p.id for update of p
        loop
          if line.archived then raise exception 'An ordered product was archived. Restore it before receiving the purchase.'; end if;
          if line.current_unit <> line.unit then raise exception 'An ordered product unit changed. Restore its original unit before receiving this order.'; end if;
          update shop.products set quantity = quantity + line.quantity where id = line.product_id;
          insert into shop.stock_movements(product_id, employee_id, type, delta, supplier_id, cost_minor,
            reason, reference, notes, occurred_on, purchase_id)
            values (line.product_id, actor, 'in', line.quantity, order_record.supplier_id, line.cost_minor,
              'Supplier purchase', order_record.reference, order_record.notes, transaction_day, selected);
        end loop;
        update shop.purchases set status = 'received', received_on = transaction_day where id = selected;
      end if;
    else raise exception 'Unknown finance operation.';
  end case;
  outcome := jsonb_build_object('id', selected);
  insert into shop.audit_logs(employee_id, action, target_id, details) values (actor, p_command, selected, p_data);
  update shop.command_requests set result = outcome where employee_id = actor and request_id = p_request;
  return outcome;
end;
$$;

create function shop.protect_purchase_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.reverses_id is not null and exists (
    select 1 from shop.stock_movements where id = new.reverses_id and purchase_id is not null
  ) then raise exception 'A received purchase cannot be reversed through stock corrections.'; end if;
  return new;
end;
$$;
create trigger protect_purchase_receipt before insert on shop.stock_movements
for each row execute function shop.protect_purchase_receipt();

create function public.be_finance_read(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
  date_from date := (p_options->>'from')::date;
  date_to date := (p_options->>'to')::date;
  selected uuid := (p_options->>'id')::uuid;
  page_offset integer := 25 * greatest(0, coalesce((p_options->>'page')::integer, 1) - 1);
begin
  if not exists (select 1 from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
    where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin') then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if date_to < date_from then raise exception 'Choose dates in order.'; end if;
  case p_query
    when 'expenses' then
      with filtered as (
        select e.*, p.full_name as employee_name from shop.expenses e join shop.employee_profiles p on p.id = e.employee_id
        where (date_from is null or e.occurred_on >= date_from) and (date_to is null or e.occurred_on <= date_to)
          and (coalesce(p_options->>'q','') = '' or strpos(lower(e.description || ' ' || e.category || ' ' || e.reference), lower(p_options->>'q')) > 0)
      ) select jsonb_build_object('total', (select count(*) from filtered),
        'amount_minor', (select coalesce(sum(amount_minor),0) from filtered where void_reason is null),
        'rows', coalesce((select jsonb_agg(to_jsonb(e) order by occurred_on desc, created_at desc, id) from (
          select * from filtered order by occurred_on desc, created_at desc, id limit 25 offset page_offset
        ) e), '[]')) into result;
    when 'purchases' then
      with filtered as (
        select * from shop.purchase_details p
        where (date_from is null or ordered_on >= date_from) and (date_to is null or ordered_on <= date_to)
          and ((p_options->>'supplier') is null or supplier_id = (p_options->>'supplier')::uuid)
          and (coalesce(p_options->>'q','') = '' or strpos(lower(supplier_name || ' ' || reference), lower(p_options->>'q')) > 0)
      ) select jsonb_build_object('total', (select count(*) from filtered),
        'rows', coalesce((select jsonb_agg(to_jsonb(p) order by ordered_on desc, created_at desc, id) from (
          select * from filtered order by ordered_on desc, created_at desc, id limit 25 offset page_offset
        ) p), '[]'),
        'suppliers', (select coalesce(jsonb_agg(to_jsonb(s) order by s.name, s.id), '[]') from (
          select s.id, s.name,
            coalesce(sum(p.balance_minor) filter (where p.status <> 'cancelled'),0) as balance_minor
          from shop.suppliers s left join shop.purchase_details p on p.supplier_id = s.id group by s.id
        ) s)) into result;
    when 'purchase' then
      select to_jsonb(p) || jsonb_build_object('items', (
        select jsonb_agg(to_jsonb(i) order by sku, product_id) from shop.purchase_items i where purchase_id = p.id),
        'payments', (select coalesce(jsonb_agg(to_jsonb(v) order by occurred_on desc, created_at desc, id), '[]')
          from shop.supplier_payments v where purchase_id = p.id)
      ) into result from shop.purchase_details p where id = selected;
    when 'finance_summary' then
      select jsonb_build_object(
        'expenses_minor', (select coalesce(sum(amount_minor),0) from shop.expenses
          where void_reason is null and (date_from is null or occurred_on >= date_from) and (date_to is null or occurred_on <= date_to)),
        'supplier_payments_minor', (select coalesce(sum(amount_minor),0) from shop.supplier_payments
          where (date_from is null or occurred_on >= date_from) and (date_to is null or occurred_on <= date_to)),
        'supplier_balance_minor', (select coalesce(sum(balance_minor),0) from shop.purchase_details where status <> 'cancelled'),
        'outgoing', (select coalesce(jsonb_agg(to_jsonb(o) order by payment), '[]') from (
          select payment, sum(expenses_minor) as expenses_minor, sum(supplier_minor) as supplier_minor from (
            select payment, amount_minor as expenses_minor, 0::bigint as supplier_minor from shop.expenses
              where void_reason is null and (date_from is null or occurred_on >= date_from) and (date_to is null or occurred_on <= date_to)
            union all
            select payment, 0, amount_minor from shop.supplier_payments
              where (date_from is null or occurred_on >= date_from) and (date_to is null or occurred_on <= date_to)
          ) amounts group by payment
        ) o)) into result;
    else raise exception 'Unknown finance query.';
  end case;
  return result;
end;
$$;

revoke all on function shop.protect_purchase_receipt() from public, anon, authenticated, service_role;
revoke all on function public.be_finance_write(text,text,text,jsonb,uuid), public.be_finance_read(text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.be_finance_write(text,text,text,jsonb,uuid), public.be_finance_read(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
