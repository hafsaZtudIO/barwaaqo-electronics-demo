begin;
create function public.be_write(p_provider text, p_subject text, p_command text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  old_request shop.command_requests;
  settings shop.shop_settings;
  product shop.products;
  previous shop.stock_movements;
  line record;
  operation_id uuid;
  item_quantity integer;
  delta integer;
  movement_type text;
  sale_total bigint := 0;
  business_day date;
  outcome jsonb;
begin
  -- Serialize role changes before taking an actor lock.
  if p_command = 'update_employee' then perform pg_advisory_xact_lock(819943); end if;
  select e.* into actor from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active
  for share of e;
  if actor.id is null or (actor.role <> 'admin' and p_command not in ('stock_in','stock_out','sale')) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  insert into shop.command_requests (employee_id, request_id, command, payload)
  values (actor.id, p_request, p_command, p_data)
  on conflict (employee_id, request_id) do nothing;
  if not found then
    select * into strict old_request from shop.command_requests
    where employee_id = actor.id and request_id = p_request;
    if old_request.command <> p_command or old_request.payload <> p_data then
      raise exception 'This submission ID was already used for different details.' using errcode = 'P0001';
    end if;
    return old_request.result;
  end if;

  select * into strict settings from shop.shop_settings where singleton;
  business_day := (now() at time zone settings.timezone)::date;
  operation_id := (p_data->>'id')::uuid;

  case p_command
    when 'save_product' then
      if operation_id is null then
        insert into shop.products
          (sku, barcode, name, category_id, brand, model, description, supplier_id, image_url, cost_minor, sale_minor, minimum_stock)
        values
          (p_data->>'sku', p_data->>'barcode', p_data->>'name', (p_data->>'category_id')::uuid,
          p_data->>'brand', p_data->>'model', p_data->>'description', (p_data->>'supplier_id')::uuid, p_data->>'image_url',
          (p_data->>'cost_minor')::integer, (p_data->>'sale_minor')::integer, (p_data->>'minimum_stock')::integer)
        returning id into operation_id;
      else
        update shop.products set sku = p_data->>'sku', barcode = p_data->>'barcode', name = p_data->>'name',
          category_id = (p_data->>'category_id')::uuid, brand = p_data->>'brand', model = p_data->>'model',
          description = p_data->>'description', supplier_id = (p_data->>'supplier_id')::uuid, image_url = p_data->>'image_url',
          cost_minor = (p_data->>'cost_minor')::integer, sale_minor = (p_data->>'sale_minor')::integer,
          minimum_stock = (p_data->>'minimum_stock')::integer
        where id = operation_id and not archived;
        if not found then raise exception 'Choose an active product.'; end if;
      end if;

    when 'archive_product' then
      update shop.products set archived = true where id = operation_id and not archived and quantity = 0;
      if not found then raise exception 'Only an active product with zero stock can be archived.'; end if;

    when 'stock_in', 'stock_out', 'reverse_movement' then
      if p_command = 'reverse_movement' then
        select * into previous from shop.stock_movements where id = operation_id and type in ('in','out') for update;
        if not found then raise exception 'Choose a stock receipt or issue to reverse.'; end if;
        if exists(select 1 from shop.stock_movements where reverses_id = previous.id) then
          raise exception 'This movement has already been reversed.';
        end if;
        delta := -previous.delta;
        movement_type := 'reversal';
      else
        item_quantity := (p_data->>'quantity')::integer;
        if item_quantity is null or item_quantity not between 1 and 1000000 then
          raise exception 'Enter a quantity between 1 and 1,000,000.';
        end if;
        movement_type := case when p_command = 'stock_in' then 'in' else 'out' end;
        if movement_type = 'in' and ((p_data->>'occurred_on')::date > business_day) then
          raise exception 'The received date cannot be in the future.';
        end if;
        if movement_type = 'out' and coalesce(p_data->>'reason','') not in
          ('Damaged Product','Supplier Return','Authorized Adjustment','Other') then
          raise exception 'Choose a stock-out reason.';
        end if;
        delta := case when movement_type = 'in' then item_quantity else -item_quantity end;
      end if;
      select * into product from shop.products
      where id = coalesce(previous.product_id, (p_data->>'product_id')::uuid) and not archived for update;
      if not found then raise exception 'Choose an active product.'; end if;
      if product.quantity + delta < 0 then raise exception 'There is insufficient stock for this operation.'; end if;
      update shop.products set quantity = quantity + delta where id = product.id;
      insert into shop.stock_movements
        (product_id, employee_id, type, delta, reason, notes, supplier_id, cost_minor, occurred_on, reference, reverses_id)
      values
        (product.id, actor.id, movement_type, delta,
         case movement_type when 'in' then 'Stock received' when 'reversal' then 'Movement reversed' else p_data->>'reason' end,
         p_data->>'notes', coalesce(previous.supplier_id, (p_data->>'supplier_id')::uuid),
         case when movement_type = 'reversal' then previous.cost_minor else (p_data->>'cost_minor')::integer end,
         case when movement_type = 'in' then (p_data->>'occurred_on')::date else business_day end,
         coalesce(p_data->>'reference', ''), previous.id)
      returning id into operation_id;

    when 'sale' then
      if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Add products to the sale.'; end if;
      if jsonb_array_length(p_data->'items') not between 1 and 50 then
        raise exception 'Add between 1 and 50 products to the sale.';
      end if;
      if exists(select 1 from jsonb_to_recordset(p_data->'items') as i(product_id uuid, quantity integer)
        group by i.product_id having count(*) > 1) then raise exception 'Include each product only once.'; end if;
      insert into shop.sales (employee_id, payment, total_minor)
      values (actor.id, p_data->>'payment', 0) returning id into operation_id;
      for line in select * from jsonb_to_recordset(p_data->'items') as i(product_id uuid, quantity integer)
        order by i.product_id
      loop
        if line.quantity is null or line.quantity not between 1 and 1000000 then raise exception 'Enter a valid quantity.'; end if;
        select * into product from shop.products where id = line.product_id and not archived for update;
        if not found then raise exception 'A product in this sale is unavailable.'; end if;
        if product.quantity < line.quantity then raise exception 'There is insufficient stock for %.', product.name; end if;
        insert into shop.sale_items (sale_id, product_id, product_name, sku, quantity, unit_minor, cost_minor)
        values (operation_id, product.id, product.name, product.sku, line.quantity, product.sale_minor, product.cost_minor);
        update shop.products set quantity = quantity - line.quantity where id = product.id;
        insert into shop.stock_movements (product_id, employee_id, type, delta, sale_id, reason, occurred_on)
        values (product.id, actor.id, 'sale', -line.quantity, operation_id, 'Sale', business_day);
        sale_total := sale_total + product.sale_minor::bigint * line.quantity;
      end loop;
      if sale_total > 9007199254740991 then raise exception 'The sale total exceeds the supported limit.'; end if;
      update shop.sales set total_minor = sale_total where id = operation_id;

    when 'save_supplier' then
      if operation_id is null then
        insert into shop.suppliers (name, phone, email, address, notes)
        values (p_data->>'name', p_data->>'phone', p_data->>'email', p_data->>'address', p_data->>'notes')
        returning id into operation_id;
      else
        update shop.suppliers set name = p_data->>'name', phone = p_data->>'phone', email = p_data->>'email',
          address = p_data->>'address', notes = p_data->>'notes' where id = operation_id;
        if not found then raise exception 'Supplier was not found.'; end if;
      end if;

    when 'save_category' then
      if operation_id is null then
        insert into shop.categories (name) values (p_data->>'name') returning id into operation_id;
      else
        update shop.categories set name = p_data->>'name' where id = operation_id;
        if not found then raise exception 'Category was not found.'; end if;
      end if;

    when 'invite_employee' then
      insert into shop.employee_profiles (full_name, email)
      values (p_data->>'full_name', p_data->>'email')
      on conflict (email) do nothing returning id into operation_id;
      if not found then
        select id into operation_id from shop.employee_profiles where email = p_data->>'email' and active
          and not exists (select 1 from shop.employee_identities where employee_id = employee_profiles.id);
        if not found then raise exception 'An employee record already uses this email.'; end if;
      end if;

    when 'update_employee' then
      if operation_id = actor.id then raise exception 'Ask another administrator to change your access.'; end if;
      update shop.employee_profiles set role = p_data->>'role', active = (p_data->>'active')::boolean where id = operation_id;
      if not found then raise exception 'Employee was not found.'; end if;

    when 'save_settings' then
      if not exists(select 1 from pg_timezone_names where name = p_data->>'timezone') then
        raise exception 'Enter a valid IANA timezone.';
      end if;
      update shop.shop_settings set name = p_data->>'name', timezone = p_data->>'timezone' where singleton;

    else raise exception 'Unknown operation.';
  end case;

  if p_command not in ('stock_in','stock_out','sale') then
    insert into shop.audit_logs (employee_id, action, target_id, details)
    values (actor.id, p_command, operation_id, p_data);
  end if;
  outcome := jsonb_strip_nulls(jsonb_build_object('id', operation_id));
  update shop.command_requests set result = outcome
  where employee_id = actor.id and request_id = p_request;
  return outcome;
end;
$$;

revoke all on function public.be_write(text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.be_write(text,text,text,jsonb,uuid) to service_role;
commit;
