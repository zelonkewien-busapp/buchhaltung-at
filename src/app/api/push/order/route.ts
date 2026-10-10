import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";

type StoredSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
};

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!url || !serviceKey || !vapidPublic || !vapidPrivate) {
    return Response.json({ error: "Push-Mitteilungen sind serverseitig noch nicht eingerichtet." }, { status: 503 });
  }

  let body: { token?: string; orderIds?: string[] };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const token = body.token;
  const orderIds = Array.isArray(body.orderIds) ? [...new Set(body.orderIds)].filter((id) => typeof id === "string") : [];
  if (!token || orderIds.length < 1 || orderIds.length > 20) {
    return Response.json({ error: "Bestellnachweis fehlt." }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: seatCode } = await admin.from("group_sales_seat_codes")
    .select("user_id,seat_number").eq("access_token", token).maybeSingle();
  if (!seatCode) return Response.json({ error: "Sitzplatzcode ungültig." }, { status: 403 });

  const { data: trip } = await admin.from("group_sales_trips")
    .select("id,customer_name").eq("user_id", seatCode.user_id).eq("status", "open")
    .eq("seat_orders_active", true).maybeSingle();
  if (!trip) return Response.json({ error: "Keine aktive Fahrt." }, { status: 403 });

  const { data: seat } = await admin.from("group_sales_seats")
    .select("id").eq("trip_id", trip.id).eq("seat_number", seatCode.seat_number).maybeSingle();
  if (!seat) return Response.json({ error: "Sitzplatz nicht gefunden." }, { status: 403 });

  const { data: orders } = await admin.from("group_sales_seat_orders")
    .select("id,product_name,quantity").in("id", orderIds).eq("trip_id", trip.id)
    .eq("seat_id", seat.id).eq("status", "active");
  if (!orders || orders.length !== orderIds.length) {
    return Response.json({ error: "Bestellung konnte nicht bestätigt werden." }, { status: 403 });
  }

  const { data: subscriptions } = await admin.from("seat_push_subscriptions")
    .select("id,user_id,endpoint,subscription").eq("user_id", seatCode.user_id);
  if (!subscriptions?.length) return Response.json({ ok: true, sent: 0 });

  const { data: alreadySent } = await admin.from("seat_order_push_deliveries")
    .select("order_id").in("order_id", orderIds);
  const sentIds = new Set((alreadySent ?? []).map((row) => row.order_id as string));
  const newOrders = orders.filter((order) => !sentIds.has(order.id));
  if (!newOrders.length) return Response.json({ ok: true, sent: 0 });

  const { error: claimError } = await admin.from("seat_order_push_deliveries")
    .insert(newOrders.map((order) => ({ order_id: order.id })));
  if (claimError) return Response.json({ ok: true, sent: 0 });

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  const productText = newOrders.map((order) => `${order.product_name} × ${order.quantity}`).join(", ");
  const payload = JSON.stringify({
    title: `Neue Bestellung · Sitzplatz ${seatCode.seat_number}`,
    body: `${trip.customer_name}: ${productText}`,
    url: "/sitzplatzbestellung",
  });
  const results = await Promise.allSettled(subscriptions.map((row: StoredSubscription) =>
    webpush.sendNotification(row.subscription, payload, { TTL: 60 })
  ));
  const invalidEndpoints = subscriptions.filter((row: StoredSubscription, index: number) => {
    const result = results[index];
    return result.status === "rejected" && [404, 410].includes(Number((result.reason as { statusCode?: number })?.statusCode));
  });
  if (invalidEndpoints.length) {
    await admin.from("seat_push_subscriptions").delete().in("id", invalidEndpoints.map((row) => row.id));
  }
  const delivered = results.filter((result) => result.status === "fulfilled").length;
  if (!delivered) {
    await admin.from("seat_order_push_deliveries").delete().in("order_id", newOrders.map((order) => order.id));
    return Response.json({ error: "Keine Push-Mitteilung konnte zugestellt werden." }, { status: 502 });
  }
  return Response.json({ ok: true, sent: delivered });
}
