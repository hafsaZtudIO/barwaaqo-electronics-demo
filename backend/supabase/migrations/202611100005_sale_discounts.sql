begin;

alter table shop.sales
  add column discount_minor integer not null default 0 check (discount_minor between 0 and 999999999),
  add column payment_note text not null default '' check (length(payment_note) <= 180),
  add column cash_received_minor bigint,
  add constraint sales_cash_received_check check (
    cash_received_minor is null or (payment = 'Cash' and cash_received_minor between total_minor and 999999999)
  );

create or replace view shop.sale_details as
select s.id, s.employee_id, s.payment, s.total_minor, s.created_at, e.full_name as employee_name,
       s.discount_minor, s.cash_received_minor, s.payment_note
from shop.sales s join shop.employee_profiles e on e.id = s.employee_id;

create function public.be_checkout_sale(p_provider text, p_subject text, p_data jsonb, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  discount integer := coalesce((p_data->>'discount_minor')::integer, 0);
  cash_received bigint := (p_data->>'cash_received_minor')::bigint;
  payment_description text := coalesce(p_data->>'payment_note', '');
  quoted_subtotal bigint := (p_data->>'quoted_subtotal_minor')::bigint;
  outcome jsonb;
  sale_id uuid;
  subtotal bigint;
begin
  if discount not between 0 and 999999999 then
    raise exception 'Enter a valid discount amount.';
  end if;

  -- The sale, stock changes, request record, and discount commit or roll back together.
  outcome := public.be_write(p_provider, p_subject, 'sale', p_data, p_request);
  sale_id := (outcome->>'id')::uuid;
  select s.total_minor + s.discount_minor into strict subtotal from shop.sales s where s.id = sale_id;
  if quoted_subtotal is not null and quoted_subtotal <> subtotal then
    raise exception 'Prices changed. Review the updated subtotal before paying.';
  end if;
  if discount > subtotal then raise exception 'Discount cannot exceed the sale subtotal.'; end if;
  if p_data->>'payment' = 'Cash' and quoted_subtotal is not null
    and (cash_received is null or cash_received < subtotal - discount) then
    raise exception 'Cash received must cover the amount due.';
  end if;
  if cash_received is not null and p_data->>'payment' <> 'Cash' then
    raise exception 'Cash received is only available for cash payments.';
  end if;

  update shop.sales
    set total_minor = subtotal - discount, discount_minor = discount,
        cash_received_minor = cash_received, payment_note = payment_description
    where id = sale_id and (
      discount_minor is distinct from discount or cash_received_minor is distinct from cash_received
      or payment_note is distinct from payment_description
    );
  return outcome;
end;
$$;

revoke all on function public.be_checkout_sale(text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.be_checkout_sale(text,text,jsonb,uuid) to service_role;
commit;
