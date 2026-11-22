begin;

-- This read-only entry point keeps employee receipt access scoped in PostgreSQL.
-- Receipt value is the recorded sale total; returns are shown as a separate status.
create function public.be_sales_history(p_provider text, p_subject text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  filters jsonb := coalesce(p_options, '{}'::jsonb);
  business_timezone text;
  search_term text;
  customer_filter uuid;
  employee_filter uuid;
  product_filter uuid;
  payment_filter text;
  status_filter text;
  sort_order text;
  date_from date;
  date_to date;
  requested_page integer := 1;
  rows_per_page integer := 25;
  result jsonb;
begin
  select e.* into actor from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active;
  if not found then raise exception 'Access denied.' using errcode = '42501'; end if;
  if jsonb_typeof(filters) is distinct from 'object' then
    raise exception 'Choose valid sales filters.';
  end if;

  select timezone into strict business_timezone from shop.shop_settings where singleton;
  search_term := lower(btrim(coalesce(filters->>'q', '')));
  if length(search_term) > 150 then raise exception 'Search must be 150 characters or fewer.'; end if;
  begin
    customer_filter := nullif(filters->>'customer', '')::uuid;
    product_filter := nullif(filters->>'product', '')::uuid;
    if actor.role = 'admin' then
      employee_filter := nullif(filters->>'employee', '')::uuid;
    else
      employee_filter := actor.id;
    end if;
  exception when invalid_text_representation then
    raise exception 'Choose a valid customer, employee, or product filter.';
  end;
  payment_filter := nullif(filters->>'payment', '');
  if payment_filter is not null and payment_filter not in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other','Credit') then
    raise exception 'Choose a valid payment method.';
  end if;
  status_filter := coalesce(nullif(filters->>'sale_status', ''), 'all');
  if status_filter not in ('all','completed','part-returned','returned') then
    raise exception 'Choose a valid sales return status.';
  end if;
  sort_order := coalesce(filters->>'sales_sort', 'newest');
  if sort_order not in ('newest','oldest','total-high','total-low','customer') then sort_order := 'newest'; end if;
  rows_per_page := case filters->>'page_size' when '50' then 50 when '100' then 100 else 25 end;
  if coalesce(filters->>'page', '') ~ '^[0-9]{1,9}$' then
    requested_page := greatest(1, (filters->>'page')::integer);
  end if;
  begin
    if nullif(filters->>'from', '') is not null then
      if (filters->>'from') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format; end if;
      date_from := (filters->>'from')::date;
    end if;
    if nullif(filters->>'to', '') is not null then
      if (filters->>'to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_datetime_format; end if;
      date_to := (filters->>'to')::date;
    end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Choose valid sales dates in YYYY-MM-DD format.';
  end;
  if date_from > date_to then raise exception 'Choose sales dates in order: From must be on or before To.'; end if;

  with scoped as (
    select s.*, case
      when quantities.returned = 0 then 'completed'
      when quantities.returned >= quantities.sold then 'returned'
      else 'part-returned' end as sale_status
    from shop.sale_details s
    cross join lateral (
      select coalesce((select sum(i.quantity) from shop.sale_items i where i.sale_id = s.id), 0) as sold,
        coalesce((select sum(r.quantity) from shop.sale_return_items r where r.sale_id = s.id), 0) as returned
    ) quantities
    where (actor.role = 'admin' or s.employee_id = actor.id)
      and (employee_filter is null or s.employee_id = employee_filter)
      and (customer_filter is null or s.customer_id = customer_filter)
      and (payment_filter is null or s.payment = payment_filter)
      and (product_filter is null or exists (
        select 1 from shop.sale_items i where i.sale_id = s.id and i.product_id = product_filter))
      and (date_from is null or s.created_at >= date_from::timestamp at time zone business_timezone)
      and (date_to is null or s.created_at < (date_to + 1)::timestamp at time zone business_timezone)
      and (search_term = '' or strpos(lower(s.id::text), search_term) > 0
        or strpos(lower(coalesce(s.customer_name, 'Walk-in customer')), search_term) > 0
        or strpos(lower(s.payment_note), search_term) > 0)
  ), filtered as materialized (
    select * from scoped where status_filter = 'all' or sale_status = status_filter
  ), totals as (
    select count(*) as count, coalesce(sum(total_minor), 0) as receipt_value from filtered
  ), bounds as (
    select greatest(1::bigint, least(requested_page::bigint, (count + rows_per_page - 1) / rows_per_page)) as page
    from totals
  ), page_rows as (
    select f.*, row_number() over (order by
      case when sort_order = 'newest' then created_at end desc,
      case when sort_order = 'oldest' then created_at end asc,
      case when sort_order = 'total-high' then total_minor end desc,
      case when sort_order = 'total-low' then total_minor end asc,
      case when sort_order = 'customer' then lower(coalesce(customer_name, 'Walk-in')) end asc,
      id) as position
    from filtered f order by position
    limit rows_per_page offset ((select page from bounds) - 1) * rows_per_page
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(p) - 'position' order by position) from page_rows p), '[]'::jsonb),
    'total', t.count, 'page', b.page, 'page_size', rows_per_page,
    'summary', jsonb_build_object('total_minor', t.receipt_value, 'sales_count', t.count),
    'employee_options', case when actor.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'full_name', full_name) order by full_name, id)
      from shop.employee_profiles
    ), '[]'::jsonb) else '[]'::jsonb end
  ) into result from totals t cross join bounds b;
  return result;
end;
$$;

revoke all on function public.be_sales_history(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_sales_history(text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
