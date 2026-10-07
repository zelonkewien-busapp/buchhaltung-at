"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

export default function BankdatenPage() {
  const [userId, setUserId] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [bic, setBic] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setMessage("Bitte zuerst anmelden.");
        return;
      }
      setUserId(auth.user.id);

      const { data, error } = await supabase
        .from("business_profiles")
        .select("account_holder, iban, bic")
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (error) setMessage(`Bankdaten konnten nicht geladen werden: ${error.message}`);
      if (data) {
        setAccountHolder(data.account_holder ?? "");
        setIban(data.iban ?? "");
        setBic(data.bic ?? "");
      }
    }

    void load();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const { data, error } = await supabase
      .from("business_profiles")
      .update({
        account_holder: accountHolder.trim(),
        iban: iban.replace(/\s/g, "").toUpperCase(),
        bic: bic.replace(/\s/g, "").toUpperCase() || null,
      })
      .eq("user_id", userId)
      .select("user_id")
      .maybeSingle();

    if (error) {
      setMessage(`Speichern fehlgeschlagen: ${error.message}`);
    } else if (!data) {
      setMessage("Bitte zuerst deine Betriebsdaten speichern.");
    } else {
      setMessage("Bankverbindung wurde gespeichert.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-emerald-700 underline">← Zur Übersicht</Link>
        <h1 className="mt-6 text-3xl font-bold">Bankverbindung für Rechnungen</h1>
        <p className="mt-2 text-slate-600">Diese Angaben erscheinen auf deinen Rechnungen.</p>

        <form onSubmit={save} className="mt-6 space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <label className="block">
            <span className="mb-2 block font-medium">Kontoinhaber/in</span>
            <input required value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3" />
          </label>

          <label className="block">
            <span className="mb-2 block font-medium">IBAN</span>
            <input required value={iban} onChange={(e) => setIban(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="AT00 0000 0000 0000 0000" />
          </label>

          <label className="block">
            <span className="mb-2 block font-medium">BIC (optional)</span>
            <input value={bic} onChange={(e) => setBic(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3" />
          </label>

          <button className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">
            Bankverbindung speichern
          </button>
          {message && <p role="status">{message}</p>}
        </form>
      </div>
    </main>
  );
}
