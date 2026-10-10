"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number | string;
  available: number;
};

type SeatOrder = {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number | string;
  total: number | string;
  orderedAt: string;
};

type SeatMenu = {
  seatNumber: number;
  tripName: string;
  active: boolean;
  products: Product[];
  orders: SeatOrder[];
};

export default function SeatOrderPage() {
  const { token } = useParams<{ token: string }>();
  const [menu, setMenu] = useState<SeatMenu | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");

  const loadMenu = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_seat_order_menu", { p_token: token });
    if (error) {
      setMenu(null);
      setMessage(error.message.includes("aktiv")
        ? "Diese Fahrt ist beendet oder der QR-Code ist nicht gültig. Bitte wende dich an den Fahrer."
        : "Getränkekarte konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.");
    } else {
      setMenu(data as SeatMenu);
      setMessage("");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { void loadMenu(); }, [loadMenu]);

  const cartTotal = useMemo(() => menu?.products.reduce((sum, product) =>
    sum + Number(product.price) * (cart[product.id] ?? 0), 0) ?? 0, [cart, menu]);
  const orderTotal = menu?.orders.reduce((sum, order) => sum + Number(order.total), 0) ?? 0;

  function changeQuantity(product: Product, delta: number) {
    setCart((current) => {
      const next = Math.max(0, Math.min(product.available, (current[product.id] ?? 0) + delta));
      return { ...current, [product.id]: next };
    });
  }

  async function submitOrder() {
    if (!token || sending) return;
    const lines = Object.entries(cart)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (!lines.length) {
      setMessage("Bitte zuerst ein Getränk auswählen.");
      return;
    }
    setSending(true);
    const { data, error } = await supabase.rpc("submit_seat_order", { p_token: token, p_lines: lines });
    if (error) {
      setMessage(error.message.replace(/^.*ERROR:\s*/, ""));
    } else {
      setCart({});
      setMessage("Bestellung ist gespeichert. Danke!");
      const orderIds = (data as { orderIds?: string[] } | null)?.orderIds;
      if (orderIds?.length) {
        try {
          await fetch("/api/push/order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, orderIds }),
          });
        } catch {
          // Die Bestellung ist bereits gespeichert. Push-Ausfälle dürfen sie nicht rückgängig machen.
        }
      }
      await loadMenu();
    }
    setSending(false);
  }

  if (loading) {
    return <main className="grid min-h-screen place-items-center bg-slate-50 p-5 text-slate-700">Getränkekarte wird geladen …</main>;
  }

  if (!menu) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 p-5 text-slate-900">
        <h1 className="text-2xl font-bold">Getränkebestellung</h1>
        <p role="status" className="mt-4 rounded-xl bg-white p-4 shadow-sm">{message}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-xl">
        <header className="rounded-2xl bg-emerald-800 p-5 text-white shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-100">Getränkebestellung</p>
          <h1 className="mt-1 text-3xl font-bold">Sitzplatz {menu.seatNumber}</h1>
          <p className="mt-2">{menu.tripName}</p>
          <p className="mt-3 text-sm text-emerald-100">Bestellungen werden diesem Sitzplatz zugeordnet. Bitte nur Getränke auswählen, die du tatsächlich entnimmst.</p>
        </header>

        <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-bold">Getränke auswählen</h2>
          {menu.products.length === 0 ? (
            <p className="mt-3 rounded-xl bg-slate-100 p-4 text-slate-700">Im Kühlschrank ist derzeit kein Getränk verfügbar.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-200">
              {menu.products.map((product) => {
                const quantity = cart[product.id] ?? 0;
                return (
                  <div key={product.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{product.name}</p>
                      <p className="text-sm text-slate-600">{product.category} · {product.unit} · {euro.format(Number(product.price))}</p>
                      <p className="text-xs text-slate-500">Noch {product.available} verfügbar</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <button type="button" aria-label={`${product.name} reduzieren`} disabled={quantity === 0}
                        onClick={() => changeQuantity(product, -1)}
                        className="h-10 w-10 rounded-full border border-slate-300 text-xl disabled:opacity-40">−</button>
                      <span className="w-5 text-center font-bold">{quantity}</span>
                      <button type="button" aria-label={`${product.name} erhöhen`} disabled={quantity >= product.available}
                        onClick={() => changeQuantity(product, 1)}
                        className="h-10 w-10 rounded-full bg-emerald-700 text-xl text-white disabled:opacity-40">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between border-t pt-4 text-lg font-bold">
            <span>Neue Bestellung</span><span>{euro.format(cartTotal)}</span>
          </div>
          <button type="button" disabled={sending || cartTotal <= 0} onClick={() => void submitOrder()}
            className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50">
            {sending ? "Wird gespeichert …" : "Bestellung bestätigen"}
          </button>
        </section>

        <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Bisher am Sitzplatz bestellt</h2>
            <span className="font-bold">{euro.format(orderTotal)}</span>
          </div>
          {menu.orders.length === 0 ? (
            <p className="mt-3 text-slate-600">Noch keine Getränke bestellt.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200">
              {menu.orders.map((order) => (
                <li key={order.id} className="flex justify-between gap-3 py-2 text-sm">
                  <span>{order.productName} × {order.quantity}</span>
                  <span>{euro.format(Number(order.total))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {message && <p role="status" className="mt-4 rounded-xl bg-white p-3 text-slate-700 shadow-sm">{message}</p>}
      </div>
    </main>
  );
}
