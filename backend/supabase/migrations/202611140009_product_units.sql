begin;

alter table shop.products add column unit text not null default 'Pcs' check (unit in ('Pcs', 'Doz'));

create function public.be_save_product_unit(p_provider text, p_subject text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  outcome jsonb;
  product_key uuid;
  requested_unit text := p_data->>'unit';
  current_unit text;
begin
  if requested_unit is null or requested_unit not in ('Pcs', 'Doz') then
    raise exception 'Choose Pcs or Doz.';
  end if;
  outcome := public.be_write(p_provider, p_subject, 'save_product', p_data, p_request);
  if outcome ? 'unit' then return outcome; end if;
  product_key := (outcome->>'id')::uuid;
  select unit into strict current_unit from shop.products where id = product_key for update;
  if requested_unit is distinct from current_unit then
    if exists (select 1 from shop.stock_movements where product_id = product_key) then
      raise exception 'This product already has stock history. Create a separate SKU for the other unit.';
    end if;
    update shop.products set unit = requested_unit where id = product_key;
  end if;
  outcome := outcome || jsonb_build_object('unit', requested_unit);
  update shop.command_requests r set result = outcome
    from shop.employee_identities i
    where i.provider = p_provider and i.subject = p_subject
      and r.employee_id = i.employee_id and r.request_id = p_request;
  return outcome;
end;
$$;

create function public.be_read_product_units(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result jsonb;
  products jsonb;
  enriched jsonb;
begin
  if p_query not in ('pos_catalog', 'products', 'product', 'lookups', 'movements', 'receipt') then
    raise exception 'Unknown product unit query.';
  end if;
  if p_query = 'pos_catalog' then
    result := public.be_counter_read(p_provider, p_subject, p_query, p_options);
  else
    result := public.be_read(p_provider, p_subject, p_query, p_options);
  end if;

  if p_query = 'receipt' then
    if result is null then return null; end if;
    return jsonb_set(result, '{items}', (
      select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'sku', i.sku,
        'quantity', i.quantity, 'unit_minor', i.unit_minor, 'unit', p.unit,
        'discount_minor', coalesce((to_jsonb(i)->>'discount_minor')::bigint, 0))
        order by i.product_name, i.product_id)
      from shop.sale_items i join shop.products p on p.id = i.product_id
      where i.sale_id = (p_options->>'id')::uuid
    ));
  end if;
  if p_query = 'product' then
    return result || jsonb_build_object('unit', (select unit from shop.products where id = (p_options->>'id')::uuid));
  end if;
  products := case p_query when 'pos_catalog' then result when 'lookups' then result->'products' else result->'rows' end;
  select coalesce(jsonb_agg(j.item || jsonb_build_object('unit', p.unit) order by j.position), '[]') into enriched
    from jsonb_array_elements(products) with ordinality as j(item, position)
    join shop.products p on p.id = ((case when p_query = 'movements' then j.item->>'product_id' else j.item->>'id' end)::uuid);
  return case p_query when 'pos_catalog' then enriched
    when 'lookups' then jsonb_set(result, '{products}', enriched)
    else jsonb_set(result, '{rows}', enriched) end;
end;
$$;

revoke all on function public.be_save_product_unit(text,text,jsonb,uuid), public.be_read_product_units(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_save_product_unit(text,text,jsonb,uuid), public.be_read_product_units(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
