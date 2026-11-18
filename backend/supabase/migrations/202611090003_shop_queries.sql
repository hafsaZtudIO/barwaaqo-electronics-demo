begin;
create function public.be_read(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor shop.employee_profiles;
  settings shop.shop_settings;
  manager boolean;
  result jsonb;
  business_day date;
  date_from date;
  date_to date;
  page_offset integer := (least(100000, greatest(1, coalesce((p_options->>'page')::integer, 1))) - 1) * 25;
  q text := lower(coalesce(p_options->>'q', ''));
  category_filter uuid := (p_options->>'category')::uuid;
  product_filter uuid := (p_options->>'product')::uuid;
  supplier_filter uuid := (p_options->>'supplier')::uuid;
  employee_filter uuid := (p_options->>'employee')::uuid;
  object_id uuid := (p_options->>'id')::uuid;
  stock_status text := p_options->>'status';
  sort_order text := p_options->>'sort';
  movement_filter text := p_options->>'type';
begin
  select e.* into actor from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active;
  manager := actor.role = 'admin';
  if actor.id is null or (not manager and p_query in ('reports','employees','settings','suppliers','export')) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  select * into strict settings from shop.shop_settings where singleton;
  business_day := (now() at time zone settings.timezone)::date;
  date_from := coalesce((p_options->>'from')::date, case when p_query = 'reports' then business_day - 29 else '-infinity'::date end);
  date_to := coalesce((p_options->>'to')::date, case when p_query = 'reports' then business_day else 'infinity'::date end);

  case p_query
    when 'lookups' then
      result := jsonb_build_object(
        'categories', coalesce((select jsonb_agg(to_jsonb(c) order by name) from shop.categories c), '[]'),
        'suppliers', coalesce((select jsonb_agg(
          case when manager then to_jsonb(s) else jsonb_build_object('id', s.id, 'name', s.name) end order by name
        ) from shop.suppliers s), '[]'),
        'products', coalesce((select jsonb_agg(jsonb_build_object(
          'id', id, 'name', name, 'sku', sku, 'sale_minor', sale_minor, 'quantity', quantity
        ) order by name, id) from shop.products where not archived), '[]'),
        'timezone', settings.timezone);

    when 'products' then
      with filtered as (
        select p.* from shop.product_details p
        where (case when stock_status = 'archived' then archived else not archived end)
          and (category_filter is null or category_id = category_filter)
          and (q = '' or strpos(lower(concat_ws(' ', name, sku, barcode, brand, model)), q) > 0)
          and (case stock_status
            when 'low' then quantity <= minimum_stock
            when 'out' then quantity = 0 when 'in-stock' then quantity > minimum_stock else true end)
      )
      select jsonb_build_object('total', (select count(*) from filtered), 'rows', coalesce((
        select jsonb_agg(case when manager then to_jsonb(f) else to_jsonb(f) - 'cost_minor' end)
        from (select * from filtered order by case when sort_order = 'sku' then sku end,
          case when sort_order = 'quantity' then quantity end desc,
          case when sort_order = 'newest' then created_at end desc, name, id
          limit 25 offset page_offset) f
      ), '[]')) into result;

    when 'product' then
      select case when manager then to_jsonb(p) else to_jsonb(p) - 'cost_minor' end into result
      from shop.product_details p where id = object_id;

    when 'movements' then
      with filtered as (
        select m.* from shop.movement_details m
        where (manager or employee_id = actor.id)
          and (product_filter is null or product_id = product_filter)
          and (supplier_filter is null or supplier_id = supplier_filter)
          and (employee_filter is null or employee_id = employee_filter)
          and (movement_filter is null or type = movement_filter or (movement_filter = 'outgoing' and delta < 0))
          and occurred_on between date_from and date_to
      )
      select jsonb_build_object('total', (select count(*) from filtered), 'rows', coalesce((
        select jsonb_agg(case when manager then to_jsonb(f) else to_jsonb(f) - 'cost_minor' end)
        from (select * from filtered order by occurred_on desc, created_at desc, id limit 25 offset page_offset) f
      ), '[]')) into result;

    when 'sales' then
      with filtered as (
        select s.* from shop.sale_details s
        where (manager or employee_id = actor.id)
          and (employee_filter is null or employee_id = employee_filter)
          and (product_filter is null or exists(select 1 from shop.sale_items where sale_id = s.id and product_id = product_filter))
          and created_at >= date_from::timestamp at time zone settings.timezone
          and created_at < (date_to + 1)::timestamp at time zone settings.timezone
      )
      select jsonb_build_object('total', (select count(*) from filtered), 'rows', coalesce((
        select jsonb_agg(to_jsonb(f)) from
        (select * from filtered order by created_at desc, id limit 25 offset page_offset) f
      ), '[]')) into result;

    when 'receipt' then
      select jsonb_build_object('sale', to_jsonb(s),
        'settings', to_jsonb(settings) - 'singleton',
        'items', (select jsonb_agg(jsonb_build_object(
          'product_name', product_name, 'sku', sku, 'quantity', quantity, 'unit_minor', unit_minor
        ) order by product_name, product_id) from shop.sale_items where sale_id = s.id))
      into result from shop.sale_details s where id = object_id and (manager or employee_id = actor.id);

    when 'export' then
      case p_options->>'kind'
        when 'sales' then
          select coalesce(jsonb_agg(jsonb_build_array(
            id, created_at, employee_id, employee_name, payment, total_minor
          ) order by created_at desc, id), '[]') into result
          from shop.sale_details
          where created_at >= date_from::timestamp at time zone settings.timezone
            and created_at < (date_to + 1)::timestamp at time zone settings.timezone;

        when 'movements' then
          select coalesce(jsonb_agg(jsonb_build_array(
            id, product_id, product_name, employee_id, employee_name, type, delta, occurred_on, created_at, supplier_name,
            cost_minor, sale_id, reference, reason, notes, reversed_by
          ) order by occurred_on desc, created_at desc, id), '[]') into result
          from shop.movement_details
          where occurred_on between date_from and date_to
            and (movement_filter is null or type = movement_filter or (movement_filter = 'outgoing' and delta < 0));

        when 'inventory' then
          select coalesce(jsonb_agg(jsonb_build_array(
            id, sku, name, category_name, quantity, minimum_stock, cost_minor, sale_minor,
            case when archived then 'archived' else 'active' end
          ) order by archived, name, id), '[]') into result
          from shop.product_details;

        else raise exception 'Choose sales, inventory, or movements.';
      end case;

    when 'suppliers' then
      select jsonb_build_object('total', (select count(*) from shop.suppliers), 'rows', coalesce((
        select jsonb_agg(to_jsonb(s))
        from (select * from shop.suppliers order by name, id limit 25 offset page_offset) s
      ), '[]')) into result;

    when 'employees' then
      select jsonb_build_object('total', (select count(*) from shop.employee_profiles), 'rows', coalesce((
        select jsonb_agg(to_jsonb(e)) from (select * from shop.employee_profiles order by full_name, id limit 25 offset page_offset) e
      ), '[]')) into result;

    when 'settings' then
      select jsonb_build_object('settings', to_jsonb(settings) - 'singleton', 'audit', jsonb_build_object(
        'total', (select count(*) from shop.audit_logs), 'rows', coalesce((
          select jsonb_agg(to_jsonb(a)) from (
            select a.id, e.full_name as employee_name, a.action, a.target_id, a.created_at
            from shop.audit_logs a join shop.employee_profiles e on e.id = a.employee_id
            order by a.created_at desc, a.id limit 25 offset page_offset
          ) a
        ), '[]'))) into result;

    when 'dashboard' then
      with day_sales as (
        select s.* from shop.sale_details s
        where (manager or employee_id = actor.id)
          and created_at >= (business_day - 6)::timestamp at time zone settings.timezone
      ), day_stock as (
        select delta from shop.stock_movements where occurred_on = business_day and (manager or employee_id = actor.id)
      ), inventory as (
        select count(*) as types, coalesce(sum(quantity),0) as units,
          count(*) filter (where quantity <= minimum_stock) as low_count,
          count(*) filter (where quantity = 0) as out_count from shop.products where not archived
      )
      select jsonb_build_object(
        'product_types', types, 'available', units, 'low_count', low_count, 'out_count', out_count,
        'received', (select coalesce(sum(delta) filter (where delta > 0),0) from day_stock),
        'issued', (select coalesce(-sum(delta) filter (where delta < 0),0) from day_stock),
        'revenue_minor', (select coalesce(sum(total_minor),0) from day_sales
          where (created_at at time zone settings.timezone)::date = business_day),
        'low', coalesce((select jsonb_agg(to_jsonb(p) - 'cost_minor') from (
          select * from shop.product_details where not archived and quantity <= minimum_stock
          order by quantity, name, id limit 5) p), '[]'),
        'sales', coalesce((select jsonb_agg(to_jsonb(s)) from (
          select * from shop.sale_details where (manager or employee_id = actor.id) order by created_at desc, id limit 5) s), '[]'),
        'movements', coalesce((select jsonb_agg(to_jsonb(m) - 'cost_minor') from (
          select * from shop.movement_details where (manager or employee_id = actor.id) order by created_at desc, id limit 5) m), '[]'),
        'chart', (select jsonb_agg(jsonb_build_object('day', day, 'revenue_minor', revenue) order by day) from (
          select business_day - d.n as day, coalesce(sum(s.total_minor),0) as revenue
          from generate_series(0, 6) d(n) left join day_sales s on (s.created_at at time zone settings.timezone)::date = business_day - d.n
          group by d.n) chart),
        'settings', to_jsonb(settings) - 'singleton') into result from inventory;

    when 'reports' then
      if date_to < date_from or date_to - date_from > 366 then raise exception 'Select a date range of up to 367 days.'; end if;
      with sales as (
        select s.*, (created_at at time zone settings.timezone)::date as day from shop.sale_details s
        where created_at >= date_from::timestamp at time zone settings.timezone
          and created_at < (date_to + 1)::timestamp at time zone settings.timezone
      ), items as (
        select i.* from shop.sale_items i join sales s on i.sale_id = s.id
      ), movements as (
        select * from shop.stock_movements where occurred_on between date_from and date_to
      )
      select jsonb_build_object(
        'revenue_minor', (select coalesce(sum(total_minor),0) from sales),
        'cost_of_goods_minor', (select coalesce(sum(cost_minor::bigint * quantity),0) from items),
        'received_cost_minor', (select coalesce(sum(cost_minor::bigint * delta),0) from movements),
        'received', (select coalesce(sum(delta) filter (where delta > 0),0) from movements),
        'issued', (select coalesce(-sum(delta) filter (where delta < 0),0) from movements),
        'daily', coalesce((select jsonb_agg(to_jsonb(d) order by period desc) from (
          select day as period, count(*) as sales, sum(total_minor) as revenue_minor from sales group by day) d), '[]'),
        'weekly', coalesce((select jsonb_agg(to_jsonb(w) order by period desc) from (
          select date_trunc('week', day::timestamp)::date as period, count(*) as sales, sum(total_minor) as revenue_minor
          from sales group by 1) w), '[]'),
        'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by period desc) from (
          select date_trunc('month', day::timestamp)::date as period, count(*) as sales, sum(total_minor) as revenue_minor
          from sales group by 1) m), '[]'),
        'products', coalesce((select jsonb_agg(to_jsonb(p) order by units desc, name) from (
          select p.name, sum(i.quantity) as units, sum(i.unit_minor::bigint * i.quantity) as revenue_minor
          from items i join shop.products p on p.id = i.product_id group by p.id) p), '[]'),
        'employees', coalesce((select jsonb_agg(to_jsonb(e) order by sales desc, name) from (
          select employee_name as name, count(*) as sales, sum(total_minor) as revenue_minor
          from sales group by employee_id, employee_name) e), '[]')) into result;

    else raise exception 'Unknown query.';
  end case;
  return result;
end;
$$;
revoke all on function public.be_read(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_read(text,text,text,jsonb) to service_role;
commit;
