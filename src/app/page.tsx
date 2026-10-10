"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
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

type TipEntry = {
  id: string;
  amount: number | string;
  note: string | null;
  created_at: string;
};

type TipOverview = { total: number | string; entries: TipEntry[] };

export default function Home() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bankBalance, setBankBalance] = useState(0);
  const [cashBalance, setCashBalance] = useState(0);
  const [bankOpening, setBankOpening] = useState("0");
  const [cashOpening, setCashOpening] = useState("0");
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("Lade Buchungen …");
  const [tipTotal, setTipTotal] = useState(0);
  const [tipEntries, setTipEntries] = useState<TipEntry[]>([]);
  const [tipFormOpen, setTipFormOpen] = useState(false);
  const [tipAmount, setTipAmount] = useState("");
  const [tipNote, setTipNote] = useState("");
  const [tipMessage, setTipMessage] = useState("");
  const [savingTip, setSavingTip] = useState(false);

  async function loadTips() {
    const { data, error } = await supabase.rpc("get_tip_overview");
    if (error) {
      setTipMessage("Trinkgeld konnte nicht geladen werden. Bitte zuerst trinkgeld-setup.sql im Supabase SQL Editor ausführen.");
      return;
    }
    const overview = data as TipOverview | null;
    setTipTotal(Number(overview?.total ?? 0));
    setTipEntries(overview?.entries ?? []);
    setTipMessage("");
  }

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
    await loadTips();
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

  async function saveTip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(tipAmount.trim().replace(",", "."));
    if (!userId) {
      setTipMessage("Bitte anmelden, um Trinkgeld zu speichern.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setTipMessage("Bitte einen Trinkgeldbetrag größer als 0 eingeben.");
      return;
    }
    setSavingTip(true);
    setTipMessage("");
    const { error } = await supabase.from("tips").insert({
      user_id: userId,
      amount: Math.round(amount * 100) / 100,
      note: tipNote.trim() || null,
    });
    setSavingTip(false);
    if (error) {
      setTipMessage(`Trinkgeld konnte nicht gespeichert werden: ${error.message}`);
      return;
    }
    setTipAmount("");
    setTipNote("");
    setTipMessage("Trinkgeld separat gespeichert.");
    await loadTips();
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

        <section className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <p className="text-slate-600">Bankkonto</p>
            <p className="mt-2 text-3xl font-bold">{euro.format(bankBalance)}</p>
          </article>
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <p className="text-slate-600">Barkasse</p>
            <p className="mt-2 text-3xl font-bold">{euro.format(cashBalance)}</p>
          </article>
          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-emerald-200">
            <p className="text-slate-600">Trinkgeld (separat)</p>
            <p className="mt-2 text-3xl font-bold text-emerald-800">{euro.format(tipTotal)}</p>
            <p className="mt-1 text-sm text-slate-500">{tipEntries.length} zuletzt angezeigte Einträge</p>
          </article>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-emerald-200">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Trinkgeldübersicht</h2>
              <p className="mt-1 text-sm text-slate-600">Separat erfasst. Trinkgeld wird nicht in Kontostände, Buchungen oder finanzielle Auswertungen übernommen.</p>
            </div>
            <button type="button" onClick={() => { setTipFormOpen((open) => !open); setTipMessage(""); }}
              className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800">
              {tipFormOpen ? "Eingabe schließen" : "Trinkgeld eingeben"}
            </button>
          </div>

          {tipFormOpen && (
            <form onSubmit={saveTip} className="mt-5 grid gap-4 rounded-xl bg-emerald-50 p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <label className="block">Betrag (€)
                <input required inputMode="decimal" type="text" value={tipAmount} onChange={(e) => setTipAmount(e.target.value)}
                  placeholder="z. B. 5,00" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="block">Notiz (optional)
                <input type="text" value={tipNote} onChange={(e) => setTipNote(e.target.value)}
                  placeholder="z. B. Tagesfahrt" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <button disabled={savingTip} className="rounded-xl bg-slate-800 px-5 py-3 font-semibold text-white disabled:opacity-60">
                {savingTip ? "Speichert …" : "Trinkgeld speichern"}
              </button>
            </form>
          )}
          {tipMessage && <p role="status" className="mt-3 text-sm text-slate-700">{tipMessage}</p>}

          <div className="mt-5 overflow-x-auto">
            {tipEntries.length ? (
              <table className="w-full text-left">
                <thead><tr className="border-b text-slate-500">
                  <th className="py-3 pr-4">Eingegeben am</th><th className="py-3 pr-4">Notiz</th><th className="py-3 text-right">Betrag</th>
                </tr></thead>
                <tbody>{tipEntries.map((tip) => (
                  <tr key={tip.id} className="border-b last:border-0">
                    <td className="py-3 pr-4">{new Date(tip.created_at).toLocaleString("de-AT", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="py-3 pr-4">{tip.note || "—"}</td>
                    <td className="py-3 text-right font-semibold text-emerald-800">{euro.format(Number(tip.amount))}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="py-3 text-slate-600">Noch kein Trinkgeld eingetragen.</p>}
          </div>
          {tipEntries.length === 100 && <p className="mt-2 text-xs text-slate-500">Angezeigt werden die letzten 100 Einträge; die Gesamtsumme umfasst alle Einträge.</p>}
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

        <section className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <Link href="/verkauf" className="rounded-2xl bg-emerald-700 p-6 font-semibold text-white hover:bg-emerald-800">
            Verkauf erfassen →
          </Link>
          <Link href="/ausgaben" className="rounded-2xl bg-white p-6 font-semibold shadow-sm ring-1 ring-slate-200">
            Eingangsbeleg / Ausgabe erfassen →
          </Link>
          <Link href="/katalog" className="rounded-2xl bg-white p-6 font-semibold shadow-sm ring-1 ring-slate-200">
            Getränkekatalog und Bestand →
          </Link>
          <Link href="/sitzplatzbestellung" className="rounded-2xl bg-white p-6 font-semibold shadow-sm ring-1 ring-slate-200 hover:ring-emerald-600">
            Sitzplatzbestellung und QR-Codes →
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
