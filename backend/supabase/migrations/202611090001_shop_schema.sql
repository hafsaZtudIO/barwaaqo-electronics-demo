begin;
create schema shop;
revoke all on schema shop from public, anon, authenticated, service_role;

create table shop.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 180),
  email text not null unique check (email = lower(email) and length(email) between 3 and 254),
  role text not null default 'employee' check (role in ('admin', 'employee')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table shop.employee_identities (
  provider text not null,
  subject text not null,
  employee_id uuid not null references shop.employee_profiles,
  primary key (provider, subject),
  unique (provider, employee_id)
);
create table shop.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 180)
);
create unique index categories_name_key on shop.categories (lower(name));
create table shop.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 180),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
create table shop.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (sku = upper(sku) and length(sku) between 1 and 60),
  barcode text not null default '',
  name text not null check (length(btrim(name)) between 1 and 180),
  category_id uuid not null references shop.categories,
  brand text not null default '',
  model text not null default '',
  description text not null default '',
  supplier_id uuid references shop.suppliers,
  image_url text not null default '' check (image_url = '' or image_url like 'https://%'),
  cost_minor integer not null check (cost_minor between 0 and 999999999),
  sale_minor integer not null check (sale_minor between 0 and 999999999),
  quantity integer not null default 0 check (quantity >= 0),
  minimum_stock integer not null check (minimum_stock between 0 and 1000000),
  archived boolean not null default false check (not archived or quantity = 0),
  created_at timestamptz not null default now()
);
create index products_category_idx on shop.products (category_id);
create index products_name_idx on shop.products (name, id);
create table shop.sales (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references shop.employee_profiles,
  payment text not null check (payment in ('Cash','EVC Plus','ZAAD','Bank Transfer','Other')),
  total_minor bigint not null check (total_minor between 0 and 9007199254740991),
  created_at timestamptz not null default now()
);
create table shop.sale_items (
  sale_id uuid not null references shop.sales,
  product_id uuid not null references shop.products,
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity between 1 and 1000000),
  unit_minor integer not null check (unit_minor between 0 and 999999999),
  cost_minor integer not null check (cost_minor between 0 and 999999999),
  primary key (sale_id, product_id)
);
create table shop.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references shop.products,
  employee_id uuid not null references shop.employee_profiles,
  type text not null check (type in ('in','out','sale','reversal')),
  delta integer not null check (delta between -1000000 and 1000000 and delta <> 0),
  supplier_id uuid references shop.suppliers,
  cost_minor integer check (cost_minor between 0 and 999999999),
  sale_id uuid,
  reverses_id uuid unique references shop.stock_movements,
  reason text not null,
  reference text not null default '',
  notes text not null default '',
  occurred_on date not null,
  created_at timestamptz not null default now(),
  foreign key (sale_id, product_id) references shop.sale_items (sale_id, product_id),
  unique (sale_id, product_id),
  check ((type = 'in' and delta > 0 and cost_minor is not null) or
    (type in ('out','sale') and delta < 0 and cost_minor is null) or type = 'reversal'),
  check ((type = 'sale') = (sale_id is not null)),
  check ((type = 'reversal') = (reverses_id is not null))
);
create table shop.audit_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references shop.employee_profiles,
  action text not null,
  target_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table shop.shop_settings (
  singleton boolean primary key default true check (singleton),
  name text not null default 'Barwaaqo Electronics' check (length(btrim(name)) between 1 and 180),
  timezone text not null default 'Africa/Nairobi'
);
create table shop.command_requests (
  employee_id uuid not null references shop.employee_profiles,
  request_id uuid not null,
  command text not null,
  payload jsonb not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (employee_id, request_id)
);

create index sales_created_idx on shop.sales (created_at desc, id);
create index sales_employee_idx on shop.sales (employee_id, created_at desc, id);
create index items_product_idx on shop.sale_items (product_id);
create index movements_date_idx on shop.stock_movements (occurred_on desc, id);
create index movements_product_idx on shop.stock_movements (product_id, created_at desc, id);
create index movements_supplier_idx on shop.stock_movements (supplier_id, created_at desc, id);
create index movements_employee_idx on shop.stock_movements (employee_id, created_at desc, id);
create index audit_created_idx on shop.audit_logs (created_at desc, id);

alter table shop.employee_profiles enable row level security;
alter table shop.employee_identities enable row level security;
alter table shop.categories enable row level security;
alter table shop.suppliers enable row level security;
alter table shop.products enable row level security;
alter table shop.sales enable row level security;
alter table shop.sale_items enable row level security;
alter table shop.stock_movements enable row level security;
alter table shop.audit_logs enable row level security;
alter table shop.shop_settings enable row level security;
alter table shop.command_requests enable row level security;
revoke all on all tables in schema shop from public, anon, authenticated, service_role;

insert into shop.shop_settings default values;
insert into shop.categories (name) values
  ('Smartphones'), ('Laptops'), ('Desktop Computers'), ('Monitors'), ('Televisions'),
  ('Printers'), ('Headphones'), ('Chargers'), ('Computer Accessories'), ('Other Electronics');

create view shop.product_details as
select p.*, c.name as category_name from shop.products p join shop.categories c on c.id = p.category_id;
create view shop.movement_details as
select m.*, p.name as product_name, e.full_name as employee_name, s.name as supplier_name,
       (select r.id from shop.stock_movements r where r.reverses_id = m.id) as reversed_by
from shop.stock_movements m join shop.products p on p.id = m.product_id
join shop.employee_profiles e on e.id = m.employee_id
left join shop.suppliers s on s.id = m.supplier_id;
create view shop.sale_details as
select s.*, e.full_name as employee_name from shop.sales s join shop.employee_profiles e on e.id = s.employee_id;

create function public.be_employee(p_provider text, p_subject text, p_verified_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  employee shop.employee_profiles;
begin
  select e.* into employee from shop.employee_profiles e
  join shop.employee_identities i on i.employee_id = e.id
  where i.provider = p_provider and i.subject = p_subject;

  if not found and p_verified_email is not null then
    -- Only a pre-approved profile can claim a first identity. Existing bindings stay immutable.
    select e.* into employee from shop.employee_profiles e
    where e.email = lower(p_verified_email) and e.active for update;
    if found then
      insert into shop.employee_identities (provider, subject, employee_id)
      values (p_provider, p_subject, employee.id) on conflict do nothing;
      select e.* into employee from shop.employee_profiles e
      join shop.employee_identities i on i.employee_id = e.id
      where i.provider = p_provider and i.subject = p_subject;
    end if;
  end if;
  if employee.id is null or not employee.active then return null; end if;
  return to_jsonb(employee);
end;
$$;

revoke all on function public.be_employee(text,text,text) from public, anon, authenticated;
grant execute on function public.be_employee(text,text,text) to service_role;
commit;
