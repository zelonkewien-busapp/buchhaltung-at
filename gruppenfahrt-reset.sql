-- Setzt eine offene Gruppenfahrt zurueck und bucht nur ihre protokollierten
-- Bestandsabgaenge wieder ein. Andere Fahrten und Bestandswerte bleiben unberuehrt.

alter table public.group_sales_trips
  add column if not exists seat_orders_active boolean not null default false;

create or replace function public.reset_group_sales_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_movement record;
  v_restore_quantity integer;
  v_restored_units integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Bitte zuerst anmelden.';
  end if;

  select t.id, t.user_id, t.customer_name, t.status, t.seat_orders_active
    into v_trip
    from public.group_sales_trips t
   where t.id = p_trip_id
     and t.user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Die Gruppenfahrt wurde nicht gefunden.';
  end if;
  if v_trip.status <> 'open' then
    raise exception 'Abgeschlossene Fahrten mit Beleg koennen hier nicht zurueckgesetzt werden.';
  end if;

  -- Bewegungen sind die Quelle der Wahrheit fuer den tatsaechlich veraenderten
  -- Lagerbestand. Positive Stornobewegungen (z. B. stornierte QR-Bestellungen)
  -- werden gegengerechnet, damit diese Menge nicht ein zweites Mal addiert wird.
  for v_movement in
    select m.fridge_id, m.product_id,
           greatest(0, -sum(m.quantity_delta))::integer as restore_quantity
      from public.fridge_stock_movements m
     where m.user_id = auth.uid()
       and m.group_trip_id = p_trip_id
       and m.product_id is not null
     group by m.fridge_id, m.product_id
    having sum(m.quantity_delta) < 0
  loop
    v_restore_quantity := v_movement.restore_quantity;
    if v_restore_quantity > 0 then
      insert into public.fridge_stock as current_stock(user_id, fridge_id, product_id, quantity, updated_at)
      values (auth.uid(), v_movement.fridge_id, v_movement.product_id, v_restore_quantity, now())
      on conflict (fridge_id, product_id) do update
        set quantity = current_stock.quantity + excluded.quantity,
            updated_at = now();

      insert into public.fridge_stock_movements(
        user_id, fridge_id, product_id, group_trip_id, movement_type, quantity_delta
      ) values (
        auth.uid(), v_movement.fridge_id, v_movement.product_id, null,
        'count_adjustment', v_restore_quantity
      );

      v_restored_units := v_restored_units + v_restore_quantity;
    end if;
  end loop;

  -- Dauerhafte Sitzplatzcodes sollen nach dem Entfernen der aktiven Fahrt bei
  -- Bedarf zur juengsten noch offenen Fahrt weiterfuehren.
  if v_trip.seat_orders_active then
    update public.group_sales_trips
       set seat_orders_active = false
     where user_id = auth.uid() and seat_orders_active;

    update public.group_sales_trips t
       set seat_orders_active = true
     where t.id = (
       select other_trip.id
         from public.group_sales_trips other_trip
        where other_trip.user_id = auth.uid()
          and other_trip.status = 'open'
          and other_trip.id <> p_trip_id
        order by other_trip.opened_at desc
        limit 1
     );
  end if;

  delete from public.group_sales_trips
   where id = p_trip_id and user_id = auth.uid() and status = 'open';

  return jsonb_build_object(
    'ok', true,
    'customer_name', v_trip.customer_name,
    'restored_units', v_restored_units
  );
end;
$$;

revoke all on function public.reset_group_sales_trip(uuid) from public;
grant execute on function public.reset_group_sales_trip(uuid) to authenticated;
