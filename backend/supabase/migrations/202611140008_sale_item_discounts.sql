begin;

-- Also allow this upgrade on shops that have not yet applied the credit fix.
alter function shop.require_credit_customer() security definer;
revoke execute on function shop.require_credit_customer() from public, anon, authenticated, service_role;

alter table shop.sale_items add column discount_minor bigint not null default 0
  check (discount_minor between 0 and quantity * unit_minor::bigint);

create function public.be_item_checkout(p_provider text, p_subject text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  discount_total bigint;
  outcome jsonb;
  sale_key uuid;
begin
  select coalesce(sum(i.discount_minor), 0) into discount_total
  from jsonb_to_recordset(p_data->'items') as i(discount_minor integer);
  if discount_total not between 0 and 999999999 then
    raise exception 'The combined product discounts exceed the supported limit.';
  end if;

  outcome := public.be_customer_write(p_provider, p_subject, 'sale',
    p_data || jsonb_build_object('discount_minor', discount_total), p_request);
  sale_key := (outcome->>'id')::uuid;

  if exists (
    select 1 from shop.sale_items s
    join jsonb_to_recordset(p_data->'items') as i(product_id uuid, discount_minor integer) using (product_id)
    where s.sale_id = sale_key and coalesce(i.discount_minor, 0) not between 0 and s.quantity * s.unit_minor::bigint
  ) then
    raise exception 'A product discount exceeds its line amount.';
  end if;

  update shop.sale_items s set discount_minor = coalesce(i.discount_minor, 0)
  from jsonb_to_recordset(p_data->'items') as i(product_id uuid, discount_minor integer)
  where s.sale_id = sale_key and s.product_id = i.product_id
    and s.discount_minor is distinct from coalesce(i.discount_minor, 0);
  return outcome;
end;
$$;

create function public.be_item_receipt(p_provider text, p_subject text, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  receipt jsonb := public.be_read(p_provider, p_subject, 'receipt', p_options);
begin
  if receipt is null then return null; end if;
  return jsonb_set(receipt, '{items}', (
    select jsonb_agg(jsonb_build_object('product_name', product_name, 'sku', sku,
      'quantity', quantity, 'unit_minor', unit_minor, 'discount_minor', discount_minor)
      order by product_name, product_id)
    from shop.sale_items where sale_id = (p_options->>'id')::uuid
  ));
end;
$$;

revoke all on function public.be_item_checkout(text,text,jsonb,uuid), public.be_item_receipt(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_item_checkout(text,text,jsonb,uuid), public.be_item_receipt(text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
