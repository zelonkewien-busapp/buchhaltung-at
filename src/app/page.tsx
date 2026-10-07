"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Booking = {
  id: string;
  booking_date: string;
  type: "income" | "expense";
  payment_method: "cash" | "bank";
  description: string;
  amount: number | string;
  document_no: string | null;
};

export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bankBalance, setBankBalance] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankOpening, setBankOpening] = useState("0");
  const [cashOpening, setCashOpening] = useState("0");
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("Lade Buchungen …");

  async function loadData() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setMessage("Bitte anmelden, um deine Übersicht zu sehen.");
      return;
    }

    setUserId(auth.user.id);

    const [{ data: rows, error }, { data: settings }] = await Promise.all([
      supabase.from("bookings").select("*").eq("user_id", auth.user.id)
        .order("booking_date", { ascending: false }).order("created_at", { ascending: false }).limit(1000),
      supabase.from("account_settings").select("*").eq("user_id", auth.user.id).maybeSingle(),
    ]);

    if (error) {
      setMessage(`Buchungen konnten nicht geladen werden: ${error.message}`);
      return;
    }

    const all = (rows ?? []) as Booking[];
    const bankStart = Number(settings?.bank_opening_balance ?? 0);
    const cashStart = Number(settings?.cash_opening_balance ?? 0);
    setBankOpening(String(bankStart));
    setCashOpening(String(cashStart));
    setBookings(all.slice(0, 10));

    const balances = all.reduce((sum, row) => {
      const value = Number(row.amount) * (row.type === "income" ? 1 : -1);
      if (row.payment_method === "bank") sum.bank += value;
      if (row.payment_method === "cash") sum.cash += value;
      return sum;
    }, { bank: bankStart, cash: cashStart });

    setBankBalance(balances.bank);
    setCashBalance(balances.cash);
    setMessage(all.length ? "" : "Noch keine Buchungen gespeichert.");
  }

  useEffect(() => { void loadData(); }, []);

  async function saveOpeningBalances() {
    if (!userId) return;
    const { error } = await supabase.from("account_settings").upsert({
      user_id: userId,
      bank_opening_balance: Number(bankOpening.replace(",", ".")) || 0,
      cash_opening_balance: Number(cashOpening.replace(",", ".")) || 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    if (error) setMessage(`Anfangsstände konnten nicht gespeichert werden: ${error.message}`);
    else {
      setMessage("Anfangsstände gespeichert.");
      await loadData();
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8">
<section className="mx-auto max-w-7xl px-5 py-4">
  <a href="/kuehlschraenke" className="inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">
    Kühlschrankverwaltung öffnen
  </a>
</section>
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-4xl font-bold">Übersicht</h1>
          <p className="mt-3 text-lg text-slate-600">Buchungen, Kontostände und deine Arbeitsbereiche.</p>
        </header>

        <section className="grid gap-5 md:grid-cols-2">
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <p className="text-slate-600">Bankkonto</p>
            <p className="mt-2 text-3xl font-bold">{euro.format(bankBalance)}</p>
          </article>
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <p className="text-slate-600">Barkasse</p>
            <p className="mt-2 text-3xl font-bold">{euro.format(cashBalance)}</p>
          </article>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Anfangsstände festlegen</h2>
          <p className="mt-2 text-sm text-slate-600">Trage hier den Kontostand ein, ab dem die App deine Buchungen mitrechnet.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label>Bankkonto
              <input type="number" step="0.01" value={bankOpening} onChange={(e) => setBankOpening(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" />
            </label>
            <label>Barkasse
              <input type="number" step="0.01" value={cashOpening} onChange={(e) => setCashOpening(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" />
            </label>
          </div>
          <button onClick={saveOpeningBalances} className="mt-4 rounded-xl bg-slate-800 px-5 py-3 font-semibold text-white">
            Anfangsstände speichern
          </button>
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-3">
          <Link href="/verkauf" className="rounded-2xl bg-emerald-700 p-6 font-semibold text-white hover:bg-emerald-800">
            Verkauf erfassen →
          </Link>
          <Link href="/ausgaben" className="rounded-2xl bg-white p-6 font-semibold shadow-sm ring-1 ring-slate-200">
            Eingangsbeleg / Ausgabe erfassen →
          </Link>
          <Link href="/katalog" className="rounded-2xl bg-white p-6 font-semibold shadow-sm ring-1 ring-slate-200">
            Produktkatalog und Bestand →
          </Link>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-2xl font-semibold">Letzte 10 Buchungen</h2>
          {bookings.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr className="border-b text-slate-500">
                  <th className="py-3 pr-4">Datum</th><th className="py-3 pr-4">Beschreibung</th>
                  <th className="py-3 pr-4">Zahlungsart</th><th className="py-3 text-right">Betrag</th>
                </tr></thead>
                <tbody>{bookings.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-3 pr-4">{new Date(row.booking_date).toLocaleDateString("de-AT")}</td>
                    <td className="py-3 pr-4">{row.description}</td>
                    <td className="py-3 pr-4">{row.payment_method === "cash" ? "Bar" : "Bank"}</td>
                    <td className={`py-3 text-right font-semibold ${row.type === "income" ? "text-emerald-700" : "text-red-700"}`}>
                      {row.type === "expense" ? "−" : "+"}{euro.format(Number(row.amount))}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="mt-3 text-slate-600">{message}</p>}
        </section>

        <Link href="/einstellungen" className="mt-6 inline-block text-emerald-700 underline">
          Betriebsdaten und Rechnungsangaben
        </Link>
      </div>
    </main>
  );
}
