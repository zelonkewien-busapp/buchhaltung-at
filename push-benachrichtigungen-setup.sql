-- Push-Benachrichtigungen für erfolgreiche Sitzplatzbestellungen.
-- Einmal vollständig im Supabase SQL Editor ausführen.

create table if not exists public.seat_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.seat_push_subscriptions enable row level security;
drop policy if exists "seat_push_owner_select" on public.seat_push_subscriptions;
create policy "seat_push_owner_select" on public.seat_push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "seat_push_owner_insert" on public.seat_push_subscriptions;
create policy "seat_push_owner_insert" on public.seat_push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "seat_push_owner_update" on public.seat_push_subscriptions;
create policy "seat_push_owner_update" on public.seat_push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "seat_push_owner_delete" on public.seat_push_subscriptions;
create policy "seat_push_owner_delete" on public.seat_push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.seat_push_subscriptions to authenticated;

-- Protokolliert bereits gemeldete Bestellpositionen, damit Wiederholungen
-- desselben Requests keine doppelten Push-Mitteilungen auslösen.
create table if not exists public.seat_order_push_deliveries (
  order_id uuid primary key references public.group_sales_seat_orders(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.seat_order_push_deliveries enable row level security;
revoke all on public.seat_order_push_deliveries from anon, authenticated;

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
  v_order_ids uuid[] := array[]::uuid[];
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
    v_order_ids := array_append(v_order_ids, v_order_id);

    insert into public.fridge_stock_movements(
      user_id, fridge_id, product_id, group_trip_id, movement_type, quantity_delta
    ) values (
      v_seat.user_id, v_seat.fridge_id, v_product.id, v_seat.trip_id, 'sale', -v_quantity
    );

    v_lines_count := v_lines_count + 1;
    v_total := v_total + (v_quantity * v_product.price);
  end loop;

  return jsonb_build_object('ok', true, 'lines', v_lines_count, 'total', v_total, 'orderIds', to_jsonb(v_order_ids));
end;
$$;

