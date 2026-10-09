"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserQRCodeSvgWriter } from "@zxing/browser";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Fridge = { id: string; name: string };
type Trip = { id: string; customer_name: string; fridge_id: string; opened_at: string };
type Seat = { id: string; trip_id: string; seat_number: number; access_token: string };
type SeatOrder = {
  id: string;
  trip_id: string;
  seat_id: string;
  product_name: string;
  quantity: number;
  unit_price: number | string;
  ordered_at: string;
};

function SeatQr({ token, seatNumber }: { token: string; seatNumber: number }) {
  const target = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/sitzplatz/${token}`;
  }, [token]);
  const qrRef = useCallback((element: HTMLDivElement | null) => {
    if (!element || !target) return;
    try {
      const svg = new BrowserQRCodeSvgWriter().write(target, 220, 220);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", `QR-Code für Sitzplatz ${seatNumber}`);
      element.replaceChildren(svg);
    } catch {
      element.textContent = "QR-Code konnte nicht erstellt werden.";
    }
  }, [seatNumber, target]);

  return (
    <div className="seat-print-card rounded-xl border border-slate-300 bg-white p-3 text-center">
      <p className="seat-label mb-1 font-bold">Sitz {seatNumber}</p>
      <div ref={qrRef} className="mx-auto flex min-h-28 w-28 items-center justify-center [&>svg]:h-28 [&>svg]:w-28" />
      <p className="seat-caption mt-1 text-xs text-slate-600">Scannen und Getränke bestellen</p>
    </div>
  );
}

export default function SitzplatzbestellungPage() {
  const [userId, setUserId] = useState("");
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [orders, setOrders] = useState<SeatOrder[]>([]);
  const [selectedTripId, setSelectedTripId] = useState("");
  const [tripName, setTripName] = useState("");
  const [fridgeId, setFridgeId] = useState("");
  const [seatCount, setSeatCount] = useState("36");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [customerStreet, setCustomerStreet] = useState("");
  const [customerPostalCode, setCustomerPostalCode] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadTrips = useCallback(async (id: string) => {
    const { data, error } = await supabase.from("group_sales_trips")
      .select("id,customer_name,fridge_id,opened_at")
      .eq("user_id", id)
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    if (error) throw error;
    const list = (data ?? []) as Trip[];
    setTrips(list);
    setSelectedTripId((current) => list.some((trip) => trip.id === current) ? current : list[0]?.id ?? "");
  }, []);

  const loadTripData = useCallback(async (tripId: string) => {
    if (!tripId) { setSeats([]); setOrders([]); return; }
    const { data: seatRows, error: seatError } = await supabase.from("group_sales_seats")
      .select("id,trip_id,seat_number,access_token")
      .eq("trip_id", tripId)
      .order("seat_number");
    if (seatError) throw seatError;
    const seatList = (seatRows ?? []) as Seat[];
    setSeats(seatList);
    const { data: orderRows, error: orderError } = await supabase.from("group_sales_seat_orders")
      .select("id,trip_id,seat_id,product_name,quantity,unit_price,ordered_at")
      .eq("trip_id", tripId)
      .eq("status", "active")
      .order("ordered_at");
    if (orderError) throw orderError;
    setOrders((orderRows ?? []) as SeatOrder[]);
  }, []);

  useEffect(() => {
    async function start() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) { setMessage("Bitte zuerst anmelden."); return; }
      setUserId(data.user.id);
      const { data: fridgeRows, error: fridgeError } = await supabase.from("fridges")
        .select("id,name").eq("user_id", data.user.id).order("name");
      if (fridgeError) { setMessage(fridgeError.message); return; }
      const fridgeList = (fridgeRows ?? []) as Fridge[];
      setFridges(fridgeList);
      setFridgeId(fridgeList.find((fridge) => fridge.name === "Kühlschrank 1")?.id ?? fridgeList[0]?.id ?? "");
      try { await loadTrips(data.user.id); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Fahrten konnten nicht geladen werden."); }
    }
    void start();
  }, [loadTrips]);

  useEffect(() => {
    void loadTripData(selectedTripId).catch((error) => {
      setMessage(error instanceof Error ? error.message : "Sitzplätze konnten nicht geladen werden.");
    });
  }, [loadTripData, selectedTripId]);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;
  const seatsByNumber = useMemo(() => new Map(seats.map((seat) => [seat.seat_number, seat])), [seats]);
  const ordersBySeat = useMemo(() => {
    const map = new Map<string, SeatOrder[]>();
    for (const order of orders) map.set(order.seat_id, [...(map.get(order.seat_id) ?? []), order]);
    return map;
  }, [orders]);
  const total = orders.reduce((sum, order) => sum + order.quantity * Number(order.unit_price), 0);
  const loungeSeats = seats.filter((seat) => seat.seat_number <= 4);
  const standardSeats = seats.filter((seat) => seat.seat_number > 4);

  async function createTrip() {
    if (!userId || !fridgeId || busy) return;
    const count = Number(seatCount);
    if (!tripName.trim()) { setMessage("Bitte einen Fahrt- oder Gruppennamen eintragen."); return; }
    if (!Number.isInteger(count) || count < 4 || count > 60) { setMessage("Die Sitzplatzzahl muss zwischen 4 und 60 liegen."); return; }
    if (paymentMethod === "bank" && (!customerStreet.trim() || !customerPostalCode.trim() || !customerCity.trim())) {
      setMessage("Für die spätere Rechnung bitte Rechnungsadresse ergänzen."); return;
    }
    setBusy(true);
    setMessage("");
    const { data: trip, error: tripError } = await supabase.from("group_sales_trips")
      .insert({
        user_id: userId,
        fridge_id: fridgeId,
        customer_name: tripName.trim(),
        payment_method: paymentMethod,
        customer_street: paymentMethod === "bank" ? customerStreet.trim() : null,
        customer_postal_code: paymentMethod === "bank" ? customerPostalCode.trim() : null,
        customer_city: paymentMethod === "bank" ? customerCity.trim() : null,
      })
      .select("id")
      .single();
    if (tripError || !trip) {
      setBusy(false); setMessage(`Fahrt konnte nicht angelegt werden: ${tripError?.message ?? "unbekannter Fehler"}`); return;
    }
    const { error: seatError } = await supabase.from("group_sales_seats").insert(
      Array.from({ length: count }, (_, index) => ({ trip_id: trip.id, seat_number: index + 1 }))
    );
    if (seatError) {
      await supabase.from("group_sales_trips").delete().eq("id", trip.id).eq("user_id", userId);
      setBusy(false); setMessage(`Sitzplätze konnten nicht angelegt werden: ${seatError.message}. Bitte zuerst die SQL-Datei im Supabase SQL Editor ausführen.`); return;
    }
    setTripName("");
    await loadTrips(userId);
    setSelectedTripId(trip.id);
    await loadTripData(trip.id);
    setBusy(false);
    setMessage(`Fahrt mit ${count} Sitzplätzen angelegt. Die QR-Codes kannst du jetzt drucken.`);
  }

  async function cancelOrder(order: SeatOrder) {
    if (busy || !window.confirm(`${order.product_name} × ${order.quantity} für diesen Sitzplatz stornieren und Bestand zurückbuchen?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("cancel_seat_order", { p_order_id: order.id });
    if (error) setMessage(`Bestellung konnte nicht storniert werden: ${error.message}`);
    else { setMessage("Bestellung storniert und Bestand zurückgebucht."); await loadTripData(selectedTripId); }
    setBusy(false);
  }

  function printSeatCodes() { window.print(); }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="no-print">
          <Link href="/uebersicht" className="text-emerald-800 underline">← Zur Übersicht</Link>
          <h1 className="mt-5 text-3xl font-bold">Sitzplatzbestellung</h1>
          <p className="mt-2 text-slate-600">Kunden bestellen per QR-Code. Bestätigte Getränke werden dem Kühlschrankbestand und der Gruppenabrechnung zugeordnet.</p>

          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-bold">Neue Fahrt starten</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Fahrt / Gruppe / Rechnungsempfänger
                <input value={tripName} onChange={(event) => setTripName(event.target.value)} placeholder="z. B. Tagesfahrt Wachau" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" />
              </label>
              <label className="text-sm font-medium">Kühlschrank
                <select value={fridgeId} onChange={(event) => setFridgeId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base">
                  {fridges.map((fridge) => <option key={fridge.id} value={fridge.id}>{fridge.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Sitzplätze
                <input type="number" min="4" max="60" value={seatCount} onChange={(event) => setSeatCount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" />
              </label>
              <label className="text-sm font-medium">Abrechnung
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "bank")} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base">
                  <option value="cash">Bar / sofort bezahlt</option><option value="bank">Rechnung / Überweisung</option>
                </select>
              </label>
            </div>
            {paymentMethod === "bank" && <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-medium">Straße<input value={customerStreet} onChange={(event) => setCustomerStreet(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
              <label className="text-sm font-medium">PLZ<input value={customerPostalCode} onChange={(event) => setCustomerPostalCode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
              <label className="text-sm font-medium">Ort<input value={customerCity} onChange={(event) => setCustomerCity(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-3 text-base" /></label>
            </div>}
            <button type="button" disabled={busy || !fridges.length} onClick={() => void createTrip()} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">
              {busy ? "Wird angelegt …" : "Fahrt mit Sitzplätzen anlegen"}
            </button>
          </section>

          <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <label className="min-w-64 flex-1 text-sm font-medium">Offene Fahrt
                <select value={selectedTripId} onChange={(event) => setSelectedTripId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base">
                  <option value="">Fahrt auswählen</option>
                  {trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.customer_name}</option>)}
                </select>
              </label>
              <button type="button" disabled={!selectedTrip || seats.length === 0} onClick={printSeatCodes} className="rounded-xl border border-emerald-700 px-5 py-3 font-bold text-emerald-900 disabled:opacity-50">QR-Codes drucken</button>
            </div>
            {selectedTrip && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 p-4">
              <div><strong>{selectedTrip.customer_name}</strong><p className="text-sm text-slate-700">{seats.length} Plätze · {orders.length} aktive Bestellpositionen</p></div>
              <div className="text-right"><strong className="text-xl">{euro.format(total)}</strong><p className="text-sm text-slate-600">offene Gesamtsumme</p></div>
            </div>}
            <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Die QR-Codes funktionieren nur während der offenen Fahrt. Ein Scan öffnet die Getränkekarte für genau diesen Platz. Bestellung und Bestand werden erst nach Bestätigung geändert.</p>
          </section>

          {selectedTrip && <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Bestellungen je Sitzplatz</h2>
              <Link href="/kuehlschraenke" className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Zur gemeinsamen Abrechnung</Link>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {seats.map((seat) => {
                const seatOrders = ordersBySeat.get(seat.id) ?? [];
                const seatTotal = seatOrders.reduce((sum, order) => sum + order.quantity * Number(order.unit_price), 0);
                return <article className="rounded-xl border border-slate-200 p-4" key={seat.id}>
                  <div className="flex items-center justify-between"><h3 className="font-bold">Sitzplatz {seat.seat_number}</h3><span className="font-semibold">{euro.format(seatTotal)}</span></div>
                  {seatOrders.length === 0 ? <p className="mt-2 text-sm text-slate-500">Noch keine Bestellung</p> : <ul className="mt-2 space-y-2">
                    {seatOrders.map((order) => <li key={order.id} className="flex items-start justify-between gap-2 border-t pt-2 text-sm">
                      <span>{order.product_name} × {order.quantity}<br /><span className="text-xs text-slate-500">{new Date(order.ordered_at).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}</span></span>
                      <span className="flex items-center gap-2">{euro.format(order.quantity * Number(order.unit_price))}<button type="button" disabled={busy} aria-label="Bestellung stornieren" onClick={() => void cancelOrder(order)} className="rounded border border-red-300 px-2 py-1 text-red-700 disabled:opacity-50">Storno</button></span>
                    </li>)}
                  </ul>}
                </article>;
              })}
            </div>
          </section>}
          {message && <p role="status" className="mt-4 rounded-xl bg-white p-3 shadow-sm">{message}</p>}
        </div>

        {selectedTrip && seats.length > 0 && <section className="seat-print-area mt-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <header className="seat-print-header mb-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Sitzplatz-QR-Codes</p>
            <h2 className="text-2xl font-bold">{selectedTrip.customer_name}</h2>
            <p className="text-sm text-slate-600">Ausschneiden und am jeweiligen Sitzplatz anbringen.</p>
          </header>
          <div className="mb-4 rounded-xl border border-slate-200 p-3">
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500">Vorne · Tisch-/Loungebereich</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {loungeSeats.map((seat) => <SeatQr key={seat.id} token={seat.access_token} seatNumber={seat.seat_number} />)}
            </div>
          </div>
          <p className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500">Fahrgastraum · Blickrichtung nach vorne ↑</p>
          <div className="space-y-3">
            {Array.from({ length: Math.ceil(standardSeats.length / 4) }, (_, rowIndex) => {
              const row = standardSeats.slice(rowIndex * 4, rowIndex * 4 + 4);
              return <div key={rowIndex} className="seat-row grid grid-cols-[1fr_1fr_0.25fr_1fr_1fr] gap-2">
                {row.slice(0, 2).map((seat) => <SeatQr key={seat.id} token={seat.access_token} seatNumber={seat.seat_number} />)}
                <div aria-hidden="true" className="flex items-center justify-center text-[10px] text-slate-400">Gang</div>
                {row.slice(2).map((seat) => <SeatQr key={seat.id} token={seat.access_token} seatNumber={seat.seat_number} />)}
              </div>;
            })}
          </div>
        </section>}
      </div>
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 10mm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .seat-print-area { display: block !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
          .seat-print-header { margin-bottom: 8mm !important; }
          .seat-print-card { padding: 2mm !important; border-radius: 2mm !important; break-inside: avoid; }
          .seat-print-card svg { width: 27mm !important; height: 27mm !important; }
          .seat-label { margin: 0 !important; font-size: 12pt !important; }
          .seat-caption { margin: 1mm 0 0 !important; font-size: 7pt !important; }
          .seat-row { margin-bottom: 2mm !important; }
          .seat-print-area > div { break-inside: avoid; }
        }
      `}</style>
    </main>
  );
}
