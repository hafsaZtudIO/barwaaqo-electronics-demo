begin;

create table shop.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 180),
  phone text not null default '' check (length(phone) <= 180),
  created_at timestamptz not null default now()
);
create table shop.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references shop.customers,
  employee_id uuid not null references shop.employee_profiles,
  amount_minor integer not null check (amount_minor between 1 and 999999999),
  note text not null default '' check (length(note) <= 180),
  created_at timestamptz not null default now()
);
alter table shop.customers enable row level security;
alter table shop.customer_payments enable row level security;
alter table shop.sales drop constraint sales_payment_check,
  add constraint sales_payment_check check (payment in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other','Credit')),
  add column customer_id uuid references shop.customers;
create index sales_customer_idx on shop.sales (customer_id) where customer_id is not null;
create index customer_payments_customer_idx on shop.customer_payments (customer_id);

create or replace view shop.sale_details as
select s.id, s.employee_id, s.payment, s.total_minor, s.created_at, e.full_name as employee_name,
       s.discount_minor, s.cash_received_minor, s.payment_note, s.customer_id, c.name as customer_name
from shop.sales s join shop.employee_profiles e on e.id = s.employee_id
left join shop.customers c on c.id = s.customer_id;

create function shop.require_credit_customer() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from shop.sales where id = new.id and payment = 'Credit' and customer_id is null) then
    raise exception 'Select a customer for this credit sale.';
  end if;
  return null;
end;
$$;
create constraint trigger sales_require_credit_customer after insert or update on shop.sales
deferrable initially deferred for each row
when (new.payment = 'Credit' and new.customer_id is null)
execute function shop.require_credit_customer();

create function public.be_customer_write(p_provider text, p_subject text, p_command text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  selected_customer uuid := (p_data->>'customer_id')::uuid;
  amount integer := (p_data->>'amount_minor')::integer;
  balance bigint;
  outcome jsonb;
  previous shop.command_requests;
begin
  select e.id into actor_id from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active for share of e;
  if actor_id is null then raise exception 'Access denied.' using errcode = '42501'; end if;
  if p_command = 'sale' and (p_data->>'payment' is null or p_data->>'payment' not in ('ZAAD','Credit')) then
    raise exception 'Choose ZAAD or Credit.';
  end if;
  insert into shop.command_requests (employee_id, request_id, command, payload)
    values (actor_id, p_request, 'customer:' || p_command, p_data) on conflict do nothing;
  if not found then
    select * into strict previous from shop.command_requests where employee_id = actor_id and request_id = p_request;
    if previous.command <> 'customer:' || p_command or previous.payload <> p_data then
      raise exception 'This submission ID was already used for different details.';
    end if;
    return previous.result;
  end if;

  if selected_customer is not null then
    perform 1 from shop.customers c where c.id = selected_customer for update;
    if not found then raise exception 'Customer was not found.'; end if;
  end if;

  case p_command
    when 'save_customer' then
      if selected_customer is null then
        insert into shop.customers (name, phone) values (btrim(p_data->>'name'), coalesce(p_data->>'phone',''))
          returning id into selected_customer;
      else
        update shop.customers c set name = btrim(p_data->>'name'), phone = coalesce(p_data->>'phone','') where c.id = selected_customer;
      end if;
      outcome := jsonb_build_object('id', selected_customer);
    when 'sale' then
      if p_data->>'payment' = 'Credit' and selected_customer is null then raise exception 'Select a customer for this credit sale.'; end if;
      -- Use a separate idempotency key for the existing inventory transaction.
      outcome := public.be_checkout_sale(p_provider, p_subject, p_data, gen_random_uuid());
      update shop.sales set customer_id = selected_customer where id = (outcome->>'id')::uuid;
    when 'record_customer_payment' then
      if selected_customer is null then raise exception 'Select a customer.'; end if;
      balance := coalesce((select sum(s.total_minor) from shop.sales s where s.customer_id = selected_customer and s.payment = 'Credit'), 0)
        - coalesce((select sum(p.amount_minor) from shop.customer_payments p where p.customer_id = selected_customer), 0);
      if amount is null or amount < 1 or amount > balance then raise exception 'Enter a payment between $0.01 and the outstanding balance.'; end if;
      with recorded as (
        insert into shop.customer_payments (customer_id, employee_id, amount_minor, note)
        values (selected_customer, actor_id, amount, coalesce(p_data->>'note','')) returning id
      ) select jsonb_build_object('id', id) into outcome from recorded;
    else raise exception 'Unknown customer operation.';
  end case;
  update shop.command_requests set result = outcome where employee_id = actor_id and request_id = p_request;
  return outcome;
end;
$$;

create function public.be_customers(p_provider text, p_subject text, p_query text, p_options jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected uuid := (p_options->>'id')::uuid;
  term text := coalesce(p_options->>'q','');
begin
  if not exists (select 1 from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
    where i.provider = p_provider and i.subject = p_subject and e.active) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;
  if p_query = 'customer_options' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone) order by name, id), '[]') from shop.customers);
  end if;
  if p_query = 'customer' then
    return (select to_jsonb(c) || jsonb_build_object(
      'balance_minor', coalesce((select sum(s.total_minor) from shop.sales s where s.customer_id = c.id and s.payment = 'Credit'), 0)
        - coalesce((select sum(p.amount_minor) from shop.customer_payments p where p.customer_id = c.id), 0),
      'activity', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id) from (
        select s.id, s.created_at, s.total_minor as amount_minor, s.payment as kind, s.payment_note as note
          from shop.sales s where s.customer_id = c.id
        union all
        select p.id, p.created_at, p.amount_minor, 'ZAAD repayment', p.note from shop.customer_payments p where p.customer_id = c.id
        order by created_at desc, id limit 50
      ) a), '[]')
    ) from shop.customers c where c.id = selected);
  end if;
  if p_query <> 'customers' then raise exception 'Unknown customer query.'; end if;
  return (with filtered as (
    select * from shop.customers where strpos(lower(name), lower(term)) > 0 or strpos(phone, term) > 0 or term = ''
  ), page as (
    select * from filtered order by name, id limit 25 offset 25 * greatest(0, coalesce((p_options->>'page')::integer,1)-1)
  ) select jsonb_build_object('total', (select count(*) from filtered), 'rows',
    coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('balance_minor',
      coalesce((select sum(s.total_minor) from shop.sales s where s.customer_id = c.id and s.payment = 'Credit'), 0)
      - coalesce((select sum(p.amount_minor) from shop.customer_payments p where p.customer_id = c.id), 0)
    ) order by c.name, c.id) from page c), '[]')));
end;
$$;

revoke all on function public.be_customer_write(text,text,text,jsonb,uuid), public.be_customers(text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.be_customer_write(text,text,text,jsonb,uuid), public.be_customers(text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
