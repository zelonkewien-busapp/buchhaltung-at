create table if not exists public.booking_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  booking_year integer not null,
  last_number bigint not null default 0,
  primary key (user_id, booking_year)
);

alter table public.bookings
  add column if not exists booking_number text;

alter table public.incoming_expenses
  add column if not exists booking_number text;

create table if not exists public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create or replace function public.next_booking_number(p_user_id uuid, p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Nicht berechtigt';
  end if;

  insert into public.booking_counters (user_id, booking_year, last_number)
  values (p_user_id, p_year, 1)
  on conflict (user_id, booking_year)
  do update set last_number = booking_counters.last_number + 1
  returning last_number into next_value;

  return 'BH-' || p_year::text || '-' || lpad(next_value::text, 6, '0');
end;
$$;

create or replace function public.assign_booking_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_number is null or trim(new.booking_number) = '' then
    new.booking_number := public.next_booking_number(
      new.user_id,
      extract(year from coalesce(new.booking_date, current_date))::integer
    );
  end if;
  return new;
end;
$$;

create or replace function public.assign_expense_booking_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.booking_number is null or trim(new.booking_number) = '' then
    new.booking_number := public.next_booking_number(
      new.user_id,
      extract(year from coalesce(new.invoice_date, current_date))::integer
    );
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_assign_number on public.bookings;
create trigger bookings_assign_number
before insert on public.bookings
for each row execute function public.assign_booking_number();

drop trigger if exists expenses_assign_number on public.incoming_expenses;
create trigger expenses_assign_number
before insert on public.incoming_expenses
for each row execute function public.assign_expense_booking_number();

create unique index if not exists bookings_user_number_idx
  on public.bookings (user_id, booking_number)
  where booking_number is not null;

create unique index if not exists expenses_user_number_idx
  on public.incoming_expenses (user_id, booking_number)
  where booking_number is not null;

alter table public.booking_items enable row level security;

drop policy if exists "Users manage own booking items" on public.booking_items;
create policy "Users manage own booking items"
  on public.booking_items
  for all
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_items.booking_id
        and b.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.bookings b
      where b.id = booking_items.booking_id
        and b.user_id = auth.uid()
    )
  );
