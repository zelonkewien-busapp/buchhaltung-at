-- Jahresabschluss-Erweiterung für buchhaltung.at
-- Diese Datei einmal vollständig im Supabase SQL Editor ausführen.

create extension if not exists pgcrypto;

-- Zahlungsstatus für Ausgangsrechnungen und Kassenbelege.
alter table public.bookings
  add column if not exists payment_status text;

alter table public.bookings
  add column if not exists paid_at date;

update public.bookings
   set payment_status = 'paid'
 where payment_status is null;

update public.bookings
   set paid_at = booking_date
 where payment_status = 'paid'
   and paid_at is null;

alter table public.bookings
  alter column payment_status set default 'paid';

alter table public.bookings
  alter column payment_status set not null;

-- Zusätzliche Angaben für Eingangsbelege.
alter table public.incoming_expenses
  add column if not exists expense_category text;

alter table public.incoming_expenses
  add column if not exists payment_method text;

alter table public.incoming_expenses
  add column if not exists payment_status text;

alter table public.incoming_expenses
  add column if not exists paid_at date;

update public.incoming_expenses
   set expense_category = 'Sonstiges'
 where expense_category is null;

update public.incoming_expenses
   set payment_method = 'bank'
 where payment_method is null;

update public.incoming_expenses
   set payment_status = 'paid'
 where payment_status is null;

update public.incoming_expenses
   set paid_at = coalesce(invoice_date, created_at::date)
 where payment_status = 'paid'
   and paid_at is null;

alter table public.incoming_expenses
  alter column expense_category set default 'Sonstiges';

alter table public.incoming_expenses
  alter column expense_category set not null;

alter table public.incoming_expenses
  alter column payment_method set default 'bank';

alter table public.incoming_expenses
  alter column payment_method set not null;

alter table public.incoming_expenses
  alter column payment_status set default 'paid';

alter table public.incoming_expenses
  alter column payment_status set not null;

-- Gespeicherter Jahresstand. Die eigentlichen Belege bleiben unverändert erhalten.
create table if not exists public.annual_closings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fiscal_year integer not null check (fiscal_year between 2000 and 2200),
  status text not null default 'closed' check (status in ('draft', 'closed')),
  income_total numeric(14,2) not null default 0,
  expense_total numeric(14,2) not null default 0,
  profit_total numeric(14,2) not null default 0,
  booking_count integer not null default 0,
  expense_receipt_count integer not null default 0,
  inventory_snapshot jsonb not null default '[]'::jsonb,
  assets_snapshot jsonb not null default '[]'::jsonb,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fiscal_year)
);

-- Erlaubt auch ein erneutes Ausfuehren, falls annual_closings bereits existiert.
alter table public.annual_closings
  add column if not exists assets_snapshot jsonb not null default '[]'::jsonb;

create index if not exists annual_closings_user_year_idx
  on public.annual_closings(user_id, fiscal_year);

alter table public.annual_closings enable row level security;

drop policy if exists "annual_closings_select_own" on public.annual_closings;
create policy "annual_closings_select_own"
  on public.annual_closings
  for select
  using (auth.uid() = user_id);

drop policy if exists "annual_closings_insert_own" on public.annual_closings;
create policy "annual_closings_insert_own"
  on public.annual_closings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "annual_closings_update_own" on public.annual_closings;
create policy "annual_closings_update_own"
  on public.annual_closings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "annual_closings_delete_own" on public.annual_closings;
create policy "annual_closings_delete_own"
  on public.annual_closings
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.annual_closings to authenticated;

-- Anlagenverzeichnis für länger als ein Jahr betrieblich genutzte Wirtschaftsgüter.
create table if not exists public.business_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  purchase_date date not null,
  purchase_cost numeric(14,2) not null check (purchase_cost >= 0),
  useful_life_years integer not null check (useful_life_years > 0),
  private_share_percent numeric(5,2) not null default 0
    check (private_share_percent between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_assets_user_date_idx
  on public.business_assets(user_id, purchase_date);

alter table public.business_assets enable row level security;

drop policy if exists "business_assets_select_own" on public.business_assets;
create policy "business_assets_select_own"
  on public.business_assets
  for select
  using (auth.uid() = user_id);

drop policy if exists "business_assets_insert_own" on public.business_assets;
create policy "business_assets_insert_own"
  on public.business_assets
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "business_assets_update_own" on public.business_assets;
create policy "business_assets_update_own"
  on public.business_assets
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "business_assets_delete_own" on public.business_assets;
create policy "business_assets_delete_own"
  on public.business_assets
  for delete
  using (auth.uid() = user_id);

grant select, insert, update, delete on table public.business_assets to authenticated;

