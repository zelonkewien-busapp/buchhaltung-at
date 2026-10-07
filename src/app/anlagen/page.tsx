"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const euro = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

type Asset = {
  id: string;
  name: string;
  purchase_date: string;
  purchase_cost: number | string;
  useful_life_years: number | string;
  private_share_percent: number | string;
  notes: string | null;
};

function parseNumber(value: string) {
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("de-AT");
}

export default function AnlagenPage() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [name, setName] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [usefulLife, setUsefulLife] = useState("3");
  const [privateShare, setPrivateShare] = useState("0");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAssets = useCallback(
    async (id: string) => {
      const { data, error } = await supabase
        .from("business_assets")
        .select(
          "id,name,purchase_date,purchase_cost,useful_life_years,private_share_percent,notes"
        )
        .eq("user_id", id)
        .order("purchase_date", { ascending: false });

      if (error) {
        setMessage(
          `Anlagenverzeichnis konnte nicht geladen werden: ${error.message}. ` +
            "Prüfe, ob jahresabschluss-setup.sql bereits in Supabase ausgeführt wurde."
        );
        return;
      }
      setAssets((data ?? []) as Asset[]);
    },
    [supabase]
  );

  useEffect(() => {
    let active = true;

    async function start() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (!data.user) {
        setMessage("Bitte zuerst anmelden.");
        setLoading(false);
        return;
      }

      setUserId(data.user.id);
      await loadAssets(data.user.id);
      if (active) setLoading(false);
    }

    void start();
    return () => {
      active = false;
    };
  }, [loadAssets, supabase]);

  async function addAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) return;

    const cost = parseNumber(purchaseCost);
    const years = parseNumber(usefulLife);
    const share = parseNumber(privateShare);

    if (!name.trim() || !purchaseDate) {
      setMessage("Bitte Bezeichnung und Anschaffungsdatum vollständig eintragen.");
      return;
    }
    if (cost === null || cost < 0) {
      setMessage("Bitte gültige Anschaffungskosten eingeben.");
      return;
    }
    if (years === null || !Number.isInteger(years) || years <= 0) {
      setMessage("Bitte eine Nutzungsdauer in ganzen Jahren eingeben.");
      return;
    }
    if (share === null || share < 0 || share > 100) {
      setMessage("Der Privatanteil muss zwischen 0 und 100 Prozent liegen.");
      return;
    }

    setBusy(true);
    setMessage("");
    const { error } = await supabase.from("business_assets").insert({
      user_id: userId,
      name: name.trim(),
      purchase_date: purchaseDate,
      purchase_cost: cost,
      useful_life_years: years,
      private_share_percent: share,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);

    if (error) {
      setMessage(`Anlage konnte nicht gespeichert werden: ${error.message}`);
      return;
    }

    setName("");
    setPurchaseDate("");
    setPurchaseCost("");
    setUsefulLife("3");
    setPrivateShare("0");
    setNotes("");
    setMessage("Anlage wurde gespeichert.");
    await loadAssets(userId);
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`„${asset.name}“ wirklich aus dem Anlagenverzeichnis löschen?`)) {
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("business_assets")
      .delete()
      .eq("id", asset.id)
      .eq("user_id", userId);
    setBusy(false);

    if (error) setMessage(`Anlage konnte nicht gelöscht werden: ${error.message}`);
    else {
      setMessage(`„${asset.name}“ wurde gelöscht.`);
      await loadAssets(userId);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-700">
        Anlagenverzeichnis wird geladen …
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <Link href="/jahresabschluss" className="text-emerald-800 underline">
          ← Zurück zum Jahresabschluss
        </Link>

        <header className="mb-8 mt-5">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">Anlagenverzeichnis</h1>
          <p className="mt-2 text-slate-600">
            Erfasse länger als ein Jahr betrieblich genutzte Anschaffungen, zum Beispiel Laptop, Drucker oder Kühlschrank.
          </p>
        </header>

        {message && (
          <div role="status" className="mb-5 rounded-xl border bg-white p-4">
            {message}
          </div>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-xl font-semibold">Anlage hinzufügen</h2>
          <form onSubmit={addAsset} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Bezeichnung</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="z. B. Getränkekühlschrank"
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Anschaffungsdatum</span>
              <input
                required
                type="date"
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Anschaffungskosten (€)</span>
              <input
                required
                inputMode="decimal"
                value={purchaseCost}
                onChange={(event) => setPurchaseCost(event.target.value)}
                placeholder="z. B. 1200,00"
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Nutzungsdauer in Jahren</span>
              <input
                required
                type="number"
                min="1"
                step="1"
                value={usefulLife}
                onChange={(event) => setUsefulLife(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Privatanteil (%)</span>
              <input
                required
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={privateShare}
                onChange={(event) => setPrivateShare(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">Notiz (optional)</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-300 px-4 py-3"
              />
            </label>
            <button
              disabled={busy}
              className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50 sm:col-span-2"
            >
              Anlage speichern
            </button>
          </form>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Die richtige Nutzungsdauer und eine mögliche Sofortabschreibung bitte steuerlich prüfen lassen. Die App zeigt nur eine lineare AfA-Vorschau.
          </p>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-xl font-semibold">Gespeicherte Anlagen</h2>
          {assets.length ? (
            <div className="mt-4 space-y-3">
              {assets.map((asset) => {
                const cost = Number(asset.purchase_cost);
                const privateShareValue = Number(asset.private_share_percent);
                const usefulLifeValue = Number(asset.useful_life_years);
                const annualDepreciation =
                  (cost * (1 - privateShareValue / 100)) / usefulLifeValue;

                return (
                  <article key={asset.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex flex-wrap justify-between gap-4">
                      <div>
                        <h3 className="font-semibold">{asset.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Anschaffung {displayDate(asset.purchase_date)} · {euro.format(cost)} · {usefulLifeValue} Jahre
                        </p>
                        <p className="text-sm text-slate-600">
                          Privatanteil {privateShareValue} % · lineare AfA-Vorschau {euro.format(annualDepreciation)} pro vollem Jahr
                        </p>
                        {asset.notes && <p className="mt-2 text-sm">{asset.notes}</p>}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeAsset(asset)}
                        className="self-start rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700 disabled:opacity-50"
                      >
                        Löschen
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 text-slate-600">Noch keine Anlagen gespeichert.</p>
          )}
        </section>
      </div>
    </main>
  );
}

