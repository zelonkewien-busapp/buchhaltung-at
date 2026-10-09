-- QR-Bestellungen je Sitzplatz fuer eine bestehende Gruppenfahrt.
-- Einmal im Supabase SQL Editor des richtigen Projekts vollstaendig ausfuehren.

create extension if not exists pgcrypto;

create table if not exists public.group_sales_seats (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_sales_trips(id) on delete cascade,
  seat_number integer not null check (seat_number between 1 and 60),
  access_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (trip_id, seat_number)
);

create index if not exists group_sales_seats_trip_idx
  on public.group_sales_seats(trip_id, seat_number);

-- Dauerhafte Codes: einmal gedruckt, bei jeder Fahrt wiederverwendbar.
create table if not exists public.group_sales_seat_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seat_number integer not null check (seat_number between 1 and 60),
  access_token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (user_id, seat_number)
);

alter table public.group_sales_trips
  add column if not exists seat_orders_active boolean not null default false;

alter table public.group_sales_seat_codes enable row level security;
drop policy if exists "group_sales_seat_codes_owner_select" on public.group_sales_seat_codes;
create policy "group_sales_seat_codes_owner_select"
  on public.group_sales_seat_codes for select to authenticated
  using (user_id = auth.uid());
grant select on public.group_sales_seat_codes to authenticated;

create or replace function public.ensure_seat_order_codes(p_count integer default 36)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Fahrer-Anmeldung erforderlich.'; end if;
  if p_count < 4 or p_count > 60 then raise exception 'Sitzplatzzahl muss zwischen 4 und 60 liegen.'; end if;
  insert into public.group_sales_seat_codes(user_id, seat_number)
  select auth.uid(), n from generate_series(1, p_count) n
  on conflict (user_id, seat_number) do nothing;
end;
$$;

create or replace function public.activate_seat_order_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Fahrer-Anmeldung erforderlich.'; end if;
  if not exists (select 1 from public.group_sales_trips where id = p_trip_id and user_id = auth.uid() and status = 'open') then
    raise exception 'Die Fahrt ist nicht offen oder gehört nicht zu deinem Konto.';
  end if;
  update public.group_sales_trips set seat_orders_active = false
   where user_id = auth.uid() and seat_orders_active;
  update public.group_sales_trips set seat_orders_active = true where id = p_trip_id;
end;
$$;

create table if not exists public.group_sales_seat_orders (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.group_sales_trips(id) on delete cascade,
  seat_id uuid not null references public.group_sales_seats(id) on delete cascade,
  withdrawal_id uuid references public.group_sales_withdrawals(id) on delete set null,
  product_id uuid,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  ordered_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists group_sales_seat_orders_trip_seat_idx
  on public.group_sales_seat_orders(trip_id, seat_id, ordered_at);

alter table public.group_sales_seats enable row level security;
alter table public.group_sales_seat_orders enable row level security;

drop policy if exists "group_sales_seats_owner_all" on public.group_sales_seats;
create policy "group_sales_seats_owner_all"
  on public.group_sales_seats for all to authenticated
  using (exists (
    select 1 from public.group_sales_trips t
    where t.id = trip_id and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.group_sales_trips t
    where t.id = trip_id and t.user_id = auth.uid()
  ));

drop policy if exists "group_sales_seat_orders_owner_select" on public.group_sales_seat_orders;
create policy "group_sales_seat_orders_owner_select"
  on public.group_sales_seat_orders for select to authenticated
  using (exists (
    select 1 from public.group_sales_trips t
    where t.id = trip_id and t.user_id = auth.uid()
  ));

grant select, insert, update, delete on public.group_sales_seats to authenticated;
grant select on public.group_sales_seat_orders to authenticated;

create or replace function public.get_seat_order_menu(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat record;
  v_products jsonb;
  v_orders jsonb;
begin
  select s.id as seat_id, s.seat_number, t.id as trip_id, t.customer_name,
         t.fridge_id, t.user_id, t.status
    into v_seat
    from public.group_sales_seat_codes c
    join public.group_sales_trips t on t.user_id = c.user_id
      and t.status = 'open' and t.seat_orders_active
    join public.group_sales_seats s on s.trip_id = t.id and s.seat_number = c.seat_number
   where c.access_token = p_token;

  if not found or v_seat.status <> 'open' then
    raise exception 'Diese Fahrt oder dieser Sitzplatz ist nicht mehr aktiv.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'category', p.category,
    'unit', p.unit,
    'price', p.price,
    'available', fs.quantity
  ) order by p.name), '[]'::jsonb)
    into v_products
    from public.products p
    join public.fridge_stock fs
      on fs.product_id = p.id
     and fs.fridge_id = v_seat.fridge_id
     and fs.user_id = v_seat.user_id
   where p.user_id = v_seat.user_id
     and p.is_active = true
     and p.price is not null
     and p.price > 0
     and fs.quantity > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'productName', o.product_name,
    'quantity', o.quantity,
    'unitPrice', o.unit_price,
    'total', o.quantity * o.unit_price,
    'orderedAt', o.ordered_at
  ) order by o.ordered_at), '[]'::jsonb)
    into v_orders
    from public.group_sales_seat_orders o
   where o.seat_id = v_seat.seat_id and o.status = 'active';

  return jsonb_build_object(
    'seatNumber', v_seat.seat_number,
    'tripName', v_seat.customer_name,
    'active', true,
    'products', v_products,
    'orders', v_orders
  );
end;
$$;

create or replace function public.submit_seat_order(p_token uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seat record;
  v_line jsonb;
  v_product record;
  v_quantity integer;
  v_product_id uuid;
  v_withdrawal_id uuid;
  v_order_id uuid;
  v_lines_count integer := 0;
  v_total numeric(12,2) := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 20 then
    raise exception 'Bitte waehle mindestens ein und hoechstens 20 Getraenke.';
  end if;

  select s.id as seat_id, s.seat_number, t.id as trip_id, t.fridge_id,
         t.user_id, t.status
    into v_seat
    from public.group_sales_seat_codes c
    join public.group_sales_trips t on t.user_id = c.user_id
      and t.status = 'open' and t.seat_orders_active
    join public.group_sales_seats s on s.trip_id = t.id and s.seat_number = c.seat_number
   where c.access_token = p_token
   for update of t;

  if not found or v_seat.status <> 'open' then
    raise exception 'Diese Fahrt oder dieser Sitzplatz ist nicht mehr aktiv.';
  end if;

  -- Die gesamte Bestellung laeuft in einer Datenbanktransaktion. Scheitert eine
  -- Position, werden Bestand und alle anderen Positionen automatisch zurueckgerollt.
  for v_line in select value from jsonb_array_elements(p_lines) as lines(value) loop
    v_product_id := (v_line->>'productId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 20 then
      raise exception 'Die Getraenkemenge muss zwischen 1 und 20 liegen.';
    end if;

    select p.id, p.name, p.price
      into v_product
      from public.products p
     where p.id = v_product_id
       and p.user_id = v_seat.user_id
       and p.is_active = true
       and p.price is not null
       and p.price > 0;
    if not found then
      raise exception 'Ein Getraenk ist nicht mehr verfuegbar.';
    end if;

    update public.fridge_stock fs
       set quantity = fs.quantity - v_quantity,
           updated_at = now()
     where fs.user_id = v_seat.user_id
       and fs.fridge_id = v_seat.fridge_id
       and fs.product_id = v_product_id
       and fs.quantity >= v_quantity;
    if not found then
      raise exception 'Nicht genug Bestand fuer %. Bitte Fahrer informieren.', v_product.name;
    end if;

    insert into public.group_sales_withdrawals(
      user_id, trip_id, fridge_id, product_id, product_name, quantity, unit_price
    ) values (
      v_seat.user_id, v_seat.trip_id, v_seat.fridge_id, v_product.id,
      v_product.name, v_quantity, v_product.price
    ) returning id into v_withdrawal_id;

    insert into public.group_sales_seat_orders(
      trip_id, seat_id, withdrawal_id, product_id, product_name, quantity, unit_price
    ) values (
      v_seat.trip_id, v_seat.seat_id, v_withdrawal_id, v_product.id,
      v_product.name, v_quantity, v_product.price
    ) returning id into v_order_id;

    insert into public.fridge_stock_movements(
      user_id, fridge_id, product_id, group_trip_id, movement_type, quantity_delta
    ) values (
      v_seat.user_id, v_seat.fridge_id, v_product.id, v_seat.trip_id, 'sale', -v_quantity
    );

    v_lines_count := v_lines_count + 1;
    v_total := v_total + (v_quantity * v_product.price);
  end loop;

  return jsonb_build_object('ok', true, 'lines', v_lines_count, 'total', v_total);
end;
$$;

create or replace function public.cancel_seat_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  if auth.uid() is null then
    raise exception 'Fahrer-Anmeldung erforderlich.';
  end if;

  select o.id, o.trip_id, o.withdrawal_id, o.product_id, o.quantity,
         t.user_id, t.fridge_id, t.status
    into v_order
    from public.group_sales_seat_orders o
    join public.group_sales_seats seat on seat.id = o.seat_id
    join public.group_sales_trips t on t.id = o.trip_id
   where o.id = p_order_id
     and o.status = 'active'
     and t.user_id = auth.uid()
   for update of o;

  if not found or v_order.status <> 'open' then
    raise exception 'Bestellung nicht gefunden oder Fahrt bereits abgeschlossen.';
  end if;

  update public.fridge_stock
     set quantity = quantity + v_order.quantity,
         updated_at = now()
   where user_id = v_order.user_id
     and fridge_id = v_order.fridge_id
     and product_id = v_order.product_id;
  if not found then
    raise exception 'Bestand konnte nicht zurueckgebucht werden.';
  end if;

  delete from public.group_sales_withdrawals
   where id = v_order.withdrawal_id and user_id = auth.uid();

  update public.group_sales_seat_orders
     set status = 'cancelled', cancelled_at = now()
   where id = v_order.id;

  insert into public.fridge_stock_movements(
    user_id, fridge_id, product_id, group_trip_id, movement_type, quantity_delta
  ) values (
    v_order.user_id, v_order.fridge_id, v_order.product_id, v_order.trip_id,
    'count_adjustment', v_order.quantity
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.get_seat_order_menu(uuid) from public;
revoke all on function public.submit_seat_order(uuid, jsonb) from public;
revoke all on function public.cancel_seat_order(uuid) from public;
grant execute on function public.get_seat_order_menu(uuid) to anon, authenticated;
grant execute on function public.submit_seat_order(uuid, jsonb) to anon, authenticated;
grant execute on function public.cancel_seat_order(uuid) to authenticated;
revoke all on function public.ensure_seat_order_codes(integer) from public;
revoke all on function public.activate_seat_order_trip(uuid) from public;
grant execute on function public.ensure_seat_order_codes(integer) to authenticated;
grant execute on function public.activate_seat_order_trip(uuid) to authenticated;
