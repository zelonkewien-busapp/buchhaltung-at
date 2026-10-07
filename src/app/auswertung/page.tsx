"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Product = { id: string; name: string };
type ItemRow = {
  product_id: string | null;
  product_name: string;
  quantity: number | string;
  line_total: number | string;
};

export default function AuswertungPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<{ name: string; quantity: number; revenue: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setMessage("Bitte zuerst anmelden.");
        setLoading(false);
        return;
      }

      const [{ data: products, error: productError }, { data: items, error: itemError }] =
        await Promise.all([
          supabase.from("products").select("id,name").eq("user_id", auth.user.id).eq("is_active", true),
          supabase.from("booking_items")
            .select("product_id,product_name,quantity,line_total,bookings!inner(user_id,type)")
            .eq("bookings.user_id", auth.user.id)
            .eq("bookings.type", "income"),
        ]);

      if (productError || itemError) {
        setMessage(`Auswertung konnte nicht geladen werden: ${productError?.message ?? itemError?.message}`);
        setLoading(false);
        return;
      }

      const totals = new Map<string, { name: string; quantity: number; revenue: number }>();
      for (const product of (products ?? []) as Product[]) {
        totals.set(product.id, { name: product.name, quantity: 0, revenue: 0 });
      }

      for (const item of (items ?? []) as ItemRow[]) {
        const key = item.product_id ?? item.product_name;
        const current = totals.get(key) ?? {
          name: item.product_name,
          quantity: 0,
          revenue: 0,
        };
        current.quantity += Number(item.quantity) || 0;
        current.revenue += Number(item.line_total) || 0;
        totals.set(key, current);
      }

      setRows(Array.from(totals.values()).sort((a, b) => b.quantity - a.quantity));
      setLoading(false);
    }

    void load();
  }, [supabase]);

  const mostSold = [...rows].sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  const leastSold = [...rows].sort((a, b) => a.quantity - b.quantity).slice(0, 5);

  function list(items: typeof rows) {
    return items.map((item, index) => (
      <li key={`${item.name}-${index}`} className="flex justify-between gap-4 border-b border-slate-100 py-3">
        <span>{item.name}</span>
        <span className="whitespace-nowrap text-right">
          {item.quantity} Stück · {euro.format(item.revenue)}
        </span>
      </li>
    ));
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/verkauf" className="text-emerald-700 underline">← Zurück zum Verkauf</Link>
        <header className="mb-8 mt-5">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">Verkaufsauswertung</h1>
          <p className="mt-2 text-slate-600">Verkaufte Stückzahlen und Umsätze aller gespeicherten Verkäufe.</p>
        </header>

        {message && <p role="status" className="mb-5 rounded-lg bg-white p-4">{message}</p>}
        {loading ? (
          <p>Auswertung wird geladen …</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <section className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Am meisten verkauft</h2>
              {mostSold.length ? <ol className="mt-3">{list(mostSold)}</ol> : <p className="mt-3 text-slate-600">Noch keine Artikel im Katalog.</p>}
            </section>
            <section className="rounded-xl bg-white p-5 shadow-sm">
              <h2 className="text-xl font-semibold">Am wenigsten verkauft</h2>
              {leastSold.length ? <ol className="mt-3">{list(leastSold)}</ol> : <p className="mt-3 text-slate-600">Noch keine Artikel im Katalog.</p>}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}