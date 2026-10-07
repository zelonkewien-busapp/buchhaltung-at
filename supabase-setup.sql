create extension if not exists pgcrypto;

create table if not exists public.business_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  legal_name text not null default '',
  owner_name text not null default '',
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country text not null default 'Österreich',
  email text not null default '',
  phone text not null default '',
  uid_number text not null default '',
  tax_number text not null default '',
  is_small_business boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null default 'Getränke',
  unit text not null default 'Stk.',
  price numeric(10,2) check (price is null or price >= 0),
  stock numeric(12,3) not null default 0 check (stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.business_profiles enable row level security;
alter table public.products enable row level security;

drop policy if exists "Profile owner access" on public.business_profiles;
create policy "Profile owner access"
on public.business_profiles
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Product owner access" on public.products;
create policy "Product owner access"
on public.products
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete
on public.business_profiles, public.products
to authenticated;

create or replace function public.create_new_account_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_profiles (user_id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (user_id) do nothing;

  insert into public.products (user_id, name, category, unit)
  values
    (new.id, 'Cola', 'Softdrink', 'Flasche'),
    (new.id, 'Cola Zero', 'Softdrink', 'Flasche'),
    (new.id, 'Orangenlimonade', 'Softdrink', 'Flasche'),
    (new.id, 'Zitronenlimonade', 'Softdrink', 'Flasche'),
    (new.id, 'Mineralwasser still', 'Wasser', 'Flasche'),
    (new.id, 'Mineralwasser prickelnd', 'Wasser', 'Flasche'),
    (new.id, 'Bier', 'Bier', 'Flasche'),
    (new.id, 'Alkoholfreies Bier', 'Bier', 'Flasche'),
    (new.id, 'Weißer Spritzer', 'Spritzer', 'Glas'),
    (new.id, 'Gespritzter Apfelsaft', 'Saft', 'Glas'),
    (new.id, 'Kaffee', 'Heißgetränk', 'Tasse'),
    (new.id, 'Tee', 'Heißgetränk', 'Tasse')
  on conflict (user_id, name) do nothing;

  return new;
end;
$$;

drop trigger if exists create_new_account_defaults on auth.users;
create trigger create_new_account_defaults
after insert on auth.users
for each row execute procedure public.create_new_account_defaults();

insert into public.business_profiles (user_id, email)
select id, coalesce(email, '')
from auth.users
on conflict (user_id) do nothing;

insert into public.products (user_id, name, category, unit)
select u.id, p.name, p.category, p.unit
from auth.users u
cross join (values
  ('Cola', 'Softdrink', 'Flasche'),
  ('Cola Zero', 'Softdrink', 'Flasche'),
  ('Orangenlimonade', 'Softdrink', 'Flasche'),
  ('Zitronenlimonade', 'Softdrink', 'Flasche'),
  ('Mineralwasser still', 'Wasser', 'Flasche'),
  ('Mineralwasser prickelnd', 'Wasser', 'Flasche'),
  ('Bier', 'Bier', 'Flasche'),
  ('Alkoholfreies Bier', 'Bier', 'Flasche'),
  ('Weißer Spritzer', 'Spritzer', 'Glas'),
  ('Gespritzter Apfelsaft', 'Saft', 'Glas'),
  ('Kaffee', 'Heißgetränk', 'Tasse'),
  ('Tee', 'Heißgetränk', 'Tasse')
) as p(name, category, unit)
on conflict (user_id, name) do nothing;
