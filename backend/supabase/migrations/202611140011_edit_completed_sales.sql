begin;

alter function shop.require_credit_customer() security definer;
revoke execute on function shop.require_credit_customer() from public, anon, authenticated, service_role;

create function public.be_correct_sale(p_provider text, p_subject text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  sale_key uuid := (p_data->>'id')::uuid;
  buyer uuid := (p_data->>'customer_id')::uuid;
  method text := p_data->>'payment';
  original shop.sales;
  prior shop.command_requests;
  original_items jsonb;
  outcome jsonb;
  line record;
  gross bigint := 0;
  change_in_stock integer;
begin
  select e.id into actor from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin' for share of e;
  if actor is null then raise exception 'Access denied.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_data->>'reason', ''))) not between 1 and 180 then
    raise exception 'Enter a reason for correcting this sale.';
  end if;

  insert into shop.command_requests(employee_id, request_id, command, payload)
    values (actor, p_request, 'correct_sale', p_data) on conflict do nothing;
  if not found then
    select * into strict prior from shop.command_requests where employee_id = actor and request_id = p_request;
    if prior.command <> 'correct_sale' or prior.payload <> p_data then raise exception 'This submission ID was already used for different details.'; end if;
    return prior.result;
  end if;

  select * into original from shop.sales where id = sale_key for update;
  if not found then raise exception 'Sale was not found.'; end if;
  if method is null or (method not in ('ZAAD', 'Credit') and method <> original.payment) then
    raise exception 'Choose a valid payment method.';
  end if;
  if method = 'Credit' and buyer is null then raise exception 'Select a customer for this credit sale.'; end if;
  perform 1 from shop.customers where id in (buyer, original.customer_id) order by id for update;

  select jsonb_agg(to_jsonb(i) order by i.sku) into original_items from shop.sale_items i where i.sale_id = sale_key;
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') <> jsonb_array_length(original_items)
    or (select count(distinct sku) from jsonb_to_recordset(p_data->'items') as q(sku text)) <> jsonb_array_length(original_items) then
    raise exception 'Include each original product once.';
  end if;
  if coalesce(p_data->>'revision', '') <> coalesce((
      select id::text from shop.audit_logs where action = 'correct_sale' and target_id = sale_key
      order by created_at desc, id desc limit 1
  ), '') then raise exception 'This sale was already edited. Reload the receipt and try again.'; end if;

  for line in
    select i.*, q.quantity as new_quantity, p.quantity as stock, p.archived
    from shop.sale_items i join shop.products p on p.id = i.product_id
    left join jsonb_to_recordset(p_data->'items') as q(sku text, quantity integer) on q.sku = i.sku
    where i.sale_id = sale_key order by p.id for update of p
  loop
    if line.new_quantity is null or line.new_quantity not between 1 and 1000000 then raise exception 'Enter a valid quantity for each product.'; end if;
    change_in_stock := line.quantity - line.new_quantity;
    if change_in_stock <> 0 and line.archived then raise exception 'An archived product quantity cannot be edited.'; end if;
    if line.stock + change_in_stock < 0 then raise exception 'There is insufficient stock for %.', line.product_name; end if;
    if coalesce((to_jsonb(line)->>'discount_minor')::bigint, 0) > line.new_quantity * line.unit_minor::bigint then
      raise exception 'The quantity would put a product below its recorded discount.';
    end if;
    gross := gross + line.new_quantity * line.unit_minor::bigint;
    if change_in_stock <> 0 then
      update shop.products set quantity = quantity + change_in_stock where id = line.product_id;
      update shop.sale_items set quantity = line.new_quantity where sale_id = sale_key and product_id = line.product_id;
      update shop.stock_movements set delta = -line.new_quantity where sale_id = sale_key and product_id = line.product_id;
    end if;
  end loop;
  if gross < original.discount_minor then raise exception 'The corrected subtotal must cover the recorded discount.'; end if;
  if method = 'Cash' and original.cash_received_minor < gross - original.discount_minor then
    raise exception 'The corrected total exceeds the original cash received.';
  end if;

  update shop.sales set customer_id = buyer, payment = method,
    payment_note = coalesce(p_data->>'payment_note',''), total_minor = gross - original.discount_minor,
    cash_received_minor = case when method = 'Cash' then original.cash_received_minor else null end
    where id = sale_key;
  if exists (
    select 1 from shop.customers c where c.id in (buyer, original.customer_id)
      and coalesce((select sum(p.amount_minor) from shop.customer_payments p where p.customer_id = c.id), 0)
        > coalesce((select sum(s.total_minor) from shop.sales s where s.customer_id = c.id and s.payment = 'Credit'), 0)
  ) then raise exception 'This correction would leave a customer with more repayments than credit.'; end if;

  insert into shop.audit_logs(employee_id, action, target_id, details, created_at)
    values (actor, 'correct_sale', sale_key, jsonb_build_object(
      'original_sale', to_jsonb(original), 'original_items', original_items, 'correction', p_data), clock_timestamp());
  outcome := jsonb_build_object('id', sale_key);
  update shop.command_requests set result = outcome where employee_id = actor and request_id = p_request;
  return outcome;
end;
$$;

create function public.be_sale_revision(p_provider text, p_subject text, p_sale uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select id::text from shop.audit_logs where action = 'correct_sale' and target_id = p_sale
    order by created_at desc, id desc limit 1
  ), '') where exists (
    select 1 from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
    where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin'
  )
$$;

revoke all on function public.be_correct_sale(text,text,jsonb,uuid), public.be_sale_revision(text,text,uuid) from public, anon, authenticated;
grant execute on function public.be_correct_sale(text,text,jsonb,uuid), public.be_sale_revision(text,text,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
