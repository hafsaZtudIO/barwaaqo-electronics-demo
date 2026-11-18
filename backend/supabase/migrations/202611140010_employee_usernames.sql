begin;

alter table shop.employee_profiles
  add column employee_number text unique check (employee_number ~ '^[A-Z0-9][A-Z0-9-]{0,29}$'),
  add column username text unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,39}$');

create function public.be_employee_login(p_username text) returns text
language sql stable security definer set search_path = '' as $$
  select email from shop.employee_profiles where username = lower(p_username) and active
$$;

create function public.be_set_employee_login(
  p_provider text, p_subject text, p_employee_id uuid, p_username text, p_number text,
  p_email text, p_name text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid;
  target_id uuid := p_employee_id;
  account_email text;
begin
  select e.id into actor_id from shop.employee_profiles e join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject and e.active and e.role = 'admin' for share of e;
  if actor_id is null then raise exception 'Access denied.' using errcode = '42501'; end if;
  if p_username is null or p_number is null then raise exception 'Enter a username and employee number.'; end if;
  if target_id is null then
    if p_email is null or p_email !~ '^staff-[0-9a-f-]{36}@barwaaqo\.invalid$' then
      raise exception 'Invalid employee account setup.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('barwaaqo:employee-account-setup', 0));
    select e.email into account_email from shop.employee_profiles e
    where e.username = p_username and e.employee_number = p_number and e.active and e.role = 'employee'
      and (e.email = p_email or (e.full_name = p_name and e.email like 'staff-%@barwaaqo.invalid'
        and not exists (select 1 from shop.employee_identities i where i.employee_id = e.id)));
    if found then return account_email; end if;
    insert into shop.employee_profiles(full_name, email, username, employee_number)
    values (p_name, p_email, p_username, p_number)
    on conflict (email) do nothing returning id into target_id;
    if target_id is null then
      select id into target_id from shop.employee_profiles
      where email = p_email and username = p_username and employee_number = p_number;
      if target_id is null then raise exception 'This account setup already uses different details.'; end if;
    end if;
    return p_email;
  else
    update shop.employee_profiles set username = p_username, employee_number = p_number
    where id = target_id and (username, employee_number) is distinct from (p_username, p_number);
    if found then
      insert into shop.audit_logs(employee_id, action, target_id)
      values (actor_id, 'set_employee_login', target_id);
    elsif not exists(select 1 from shop.employee_profiles where id = target_id) then
      raise exception 'Employee was not found.';
    end if;
  end if;
  return target_id::text;
exception when unique_violation then
  if exists (select 1 from shop.employee_profiles where username = p_username and id is distinct from p_employee_id) then
    raise exception 'This username is already in use.';
  end if;
  raise exception 'This employee number is already in use.';
end;
$$;

revoke all on function public.be_employee_login(text), public.be_set_employee_login(text,text,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.be_employee_login(text), public.be_set_employee_login(text,text,uuid,text,text,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
