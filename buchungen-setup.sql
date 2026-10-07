create table if not exists public.account_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bank_opening_balance numeric(12,2) not null default 0,
  cash_opening_balance numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_date date not null default current_date,
  type text not null check (type in ('income', 'expense')),
  payment_method text not null check (payment_method in ('bank', 'cash')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  document_no text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_user_date_idx
  on public.bookings (user_id, booking_date desc, created_at desc);

alter table public.account_settings enable row level security;
alter table public.bookings enable row level security;

drop policy if exists "Users manage own account settings" on public.account_settings;
create policy "Users manage own account settings"
  on public.account_settings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users manage own bookings" on public.bookings;
create policy "Users manage own bookings"
  on public.bookings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
