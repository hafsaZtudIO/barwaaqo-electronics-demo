begin;

create function public.be_register_employee(p_provider text, p_subject text, p_email text, p_name text, p_new_subject text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  profile shop.employee_profiles;
  bound_subject text;
begin
  select e.* into actor from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin'
  for share of e;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;

  -- Reserve the email and bind the provider identity in the same database transaction.
  insert into shop.employee_profiles (full_name, email)
  values (p_name, p_email) on conflict (email) do nothing;
  select * into strict profile from shop.employee_profiles where email = p_email for update;
  select subject into bound_subject from shop.employee_identities
  where employee_id = profile.id and provider = p_provider;
  if bound_subject = p_new_subject then return profile.id; end if;

  if not profile.active or profile.role <> 'employee'
    or exists (select 1 from shop.employee_identities where employee_id = profile.id) then
    raise exception 'This email already belongs to a shop profile. Review its access in Employees.';
  end if;

  update shop.employee_profiles set full_name = p_name where id = profile.id;
  insert into shop.employee_identities (provider, subject, employee_id)
  values (p_provider, p_new_subject, profile.id);
  insert into shop.audit_logs (employee_id, action, target_id)
  values (actor.id, 'create_employee_account', profile.id);
  return profile.id;
end;
$$;

create function public.be_counter_read(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  business_timezone text;
  business_day date;
  result jsonb;
begin
  select e.* into actor from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;

  case p_query
    when 'pos_catalog' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'sku', sku, 'barcode', barcode, 'category_name', category_name,
        'sale_minor', sale_minor, 'quantity', quantity
      ) order by name, id), '[]') into result
      from shop.product_details where not archived;

    when 'closeout' then
      select timezone into strict business_timezone from shop.shop_settings where singleton;
      business_day := coalesce((p_options->>'from')::date, (now() at time zone business_timezone)::date);
      select jsonb_build_object('day', business_day, 'methods',
        coalesce(jsonb_agg(to_jsonb(method) order by payment), '[]')) into result
      from (
        select payment, count(*) as sales, sum(total_minor) as total_minor
        from shop.sales
        where (actor.role = 'admin' or employee_id = actor.id)
          and created_at >= business_day::timestamp at time zone business_timezone
          and created_at < (business_day + 1)::timestamp at time zone business_timezone
        group by payment
      ) method;

    else raise exception 'Unknown query.';
  end case;
  return result;
end;
$$;

revoke all on function public.be_register_employee(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.be_register_employee(text,text,text,text,text) to service_role;
revoke all on function public.be_counter_read(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_counter_read(text,text,text,jsonb) to service_role;
commit;
