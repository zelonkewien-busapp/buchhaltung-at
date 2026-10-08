-- Mehrtaegige Gruppenfahrten mit gemeinsamer Getraenkeabrechnung.
-- Diese Datei einmal vollstaendig im Supabase SQL Editor ausfuehren.

create extension if not exists pgcrypto;

create table if not exists public.group_sales_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fridge_id uuid not null references public.fridges(id) on delete restrict,
  customer_name text not null,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'bank')),
  customer_street text,
  customer_postal_code text,
  customer_city text,
  status text not null default 'open'
    check (status in ('open', 'closed')),
  booking_id uuid references public.bookings(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists group_sales_trips_user_fridge_status_idx
  on public.group_sales_trips(user_id, fridge_id, status, opened_at desc);

alter table public.group_sales_trips enable row level security;

drop policy if exists "group_sales_trips_select_own" on public.group_sales_trips;
create policy "group_sales_trips_select_own"
  on public.group_sales_trips for select
  using (auth.uid() = user_id);

drop policy if exists "group_sales_trips_insert_own" on public.group_sales_trips;
create policy "group_sales_trips_insert_own"
  on public.group_sales_trips for insert
  with check (auth.uid() = user_id);

drop policy if exists "group_sales_trips_update_own" on public.group_sales_trips;
create policy "group_sales_trips_update_own"
  on public.group_sales_trips for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "group_sales_trips_delete_own" on public.group_sales_trips;
create policy "group_sales_trips_delete_own"
  on public.group_sales_trips for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.group_sales_trips to authenticated;

create table if not exists public.group_sales_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.group_sales_trips(id) on delete cascade,
  fridge_id uuid not null references public.fridges(id) on delete restrict,
  product_id uuid,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  withdrawn_at timestamptz not null default now()
);

create index if not exists group_sales_withdrawals_user_trip_idx
  on public.group_sales_withdrawals(user_id, trip_id, withdrawn_at);

alter table public.group_sales_withdrawals enable row level security;

drop policy if exists "group_sales_withdrawals_select_own" on public.group_sales_withdrawals;
create policy "group_sales_withdrawals_select_own"
  on public.group_sales_withdrawals for select
  using (auth.uid() = user_id);

drop policy if exists "group_sales_withdrawals_insert_own" on public.group_sales_withdrawals;
create policy "group_sales_withdrawals_insert_own"
  on public.group_sales_withdrawals for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.group_sales_trips t
      where t.id = trip_id
        and t.user_id = auth.uid()
        and t.status = 'open'
    )
  );

drop policy if exists "group_sales_withdrawals_delete_own" on public.group_sales_withdrawals;
create policy "group_sales_withdrawals_delete_own"
  on public.group_sales_withdrawals for delete
  using (auth.uid() = user_id);

grant select, insert, delete on table public.group_sales_withdrawals to authenticated;

alter table public.fridge_stock_movements
  add column if not exists group_trip_id uuid
    references public.group_sales_trips(id) on delete set null;

create index if not exists fridge_stock_movements_group_trip_idx
  on public.fridge_stock_movements(group_trip_id)
  where group_trip_id is not null;
