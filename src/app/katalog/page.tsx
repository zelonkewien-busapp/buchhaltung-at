"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number | null;
  stock: number;
  barcode: string | null;
};

export default function KatalogPage() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const [barcodes, setBarcodes] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Softdrink");
  const [unit, setUnit] = useState("Flasche");
  const [newPrice, setNewPrice] = useState("");
  const [newBarcode, setNewBarcode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadProducts(id: string) {
    const { data, error } = await supabase
      .from("products")
      .select("id,name,category,unit,price,stock,barcode")
      .eq("user_id", id)
      .eq("is_active", true)
      .order("category")
      .order("name");

    if (error) {
      setMessage(`Produkte konnten nicht geladen werden: ${error.message}`);
      return;
    }

    const list = (data ?? []) as Product[];
    setProducts(list);

    const nextPrices: Record<string, string> = {};
    const nextStocks: Record<string, string> = {};
    const nextBarcodes: Record<string, string> = {};
    for (const product of list) {
      nextPrices[product.id] = product.price == null ? "" : String(product.price);
      nextStocks[product.id] = String(product.stock ?? 0);
      nextBarcodes[product.id] = product.barcode ?? "";
    }
    setPrices(nextPrices);
    setStocks(nextStocks);
    setBarcodes(nextBarcodes);
  }

  useEffect(() => {
    let active = true;

    async function start() {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;

      if (error || !data.user) {
        setMessage("Bitte zuerst auf der Startseite anmelden.");
        setLoading(false);
        return;
      }

      setUserId(data.user.id);
      await loadProducts(data.user.id);
      if (active) setLoading(false);
    }

    void start();
    return () => {
      active = false;
    };
  }, [supabase]);

  function parseAmount(value: string): number | null {
    if (value.trim() === "") return null;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  async function saveProduct(product: Product) {
    const priceText = prices[product.id] ?? "";
    const stockText = stocks[product.id] ?? "0";
    const price = parseAmount(priceText);
    const stock = parseAmount(stockText);

    if ((priceText.trim() !== "" && price === null) || stock === null) {
      setMessage("Bitte gib gültige, nicht negative Zahlen für Preis und Bestand ein.");
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase
      .from("products")
      .update({
        price,
        stock,
        barcode: (barcodes[product.id] ?? "").trim() || null,
      })
      .eq("id", product.id)
      .eq("user_id", userId);

    setBusy(false);

    if (error) {
      setMessage(`Speichern fehlgeschlagen: ${error.message}`);
    } else {
      setMessage(`„${product.name}“ wurde gespeichert.`);
      await loadProducts(userId);
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !name.trim()) return;

    const price = parseAmount(newPrice);
    if (newPrice.trim() !== "" && price === null) {
      setMessage("Bitte gib einen gültigen, nicht negativen Preis ein.");
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase.from("products").insert({
      user_id: userId,
      name: name.trim(),
      category,
      unit,
      price,
      barcode: newBarcode.trim() || null,
      stock: 0,
      is_active: true,
    });

    setBusy(false);

    if (error) {
      setMessage(`Produkt konnte nicht angelegt werden: ${error.message}`);
    } else {
      setName("");
      setNewPrice("");
      setNewBarcode("");
      setMessage("Produkt wurde zum Katalog hinzugefügt.");
      await loadProducts(userId);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-700">
        Getränkekatalog wird geladen …
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <a href="/" className="text-sm font-medium text-emerald-800 underline">
          ← Zurück zur Startseite
        </a>

        <header className="mb-8 mt-5">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">Getränkekatalog</h1>
          <p className="mt-2 text-slate-600">
            Ergänze deine Verkaufspreise und pflege den aktuellen Bestand.
          </p>
        </header>

        {message && (
          <div role="status" className="mb-5 rounded-lg border bg-white p-4 text-sm">
            {message}
          </div>
        )}

        {products.length === 0 ? (
          <section className="mb-6 rounded-xl bg-white p-5 shadow-sm">
            <p>
              Es wurden noch keine Produkte geladen. Du kannst unten eigene Produkte
              hinzufügen.
            </p>
          </section>
        ) : (
          <section className="mb-8 space-y-3">
            {products.map((product) => (
              <article
                key={product.id}
                className="grid gap-4 rounded-xl bg-white p-5 shadow-sm sm:grid-cols-[1fr_180px_150px_150px_auto] sm:items-end"
              >
                <div>
                  <h2 className="font-semibold">{product.name}</h2>
                  <p className="text-sm text-slate-500">
                    {product.category} · {product.unit}
                  </p>
                </div>

                <label className="block">
                  <span className="mb-1 block text-sm">Barcode / EAN</span>
                  <input
                    inputMode="numeric"
                    placeholder="Barcode scannen oder eingeben"
                    value={barcodes[product.id] ?? ""}
                    onChange={(event) =>
                      setBarcodes((current) => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm">Preis (€)</span>
                  <input
                    inputMode="decimal"
                    placeholder="Preis ergänzen"
                    value={prices[product.id] ?? ""}
                    onChange={(event) =>
                      setPrices((current) => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm">Bestand</span>
                  <input
                    inputMode="decimal"
                    value={stocks[product.id] ?? "0"}
                    onChange={(event) =>
                      setStocks((current) => ({
                        ...current,
                        [product.id]: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                  />
                </label>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveProduct(product)}
                  className="rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
                >
                  Speichern
                </button>
              </article>
            ))}
          </section>
        )}

        <section className="rounded-xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-semibold">Produkt hinzufügen</h2>
          <form onSubmit={addProduct} className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm">Produktname</span>
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="z. B. Apfelsaft gespritzt"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm">Kategorie</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              >
                <option>Softdrink</option>
                <option>Bier</option>
                <option>Wein und Spritzer</option>
                <option>Heißgetränk</option>
                <option>Saft</option>
                <option>Sonstiges</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm">Einheit</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              >
                <option>Flasche</option>
                <option>Glas</option>
                <option> Dose</option>
                <option>Tasse</option>
                <option>Stück</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm">Preis in Euro (kann leer bleiben)</span>
              <input
                inputMode="decimal"
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
                placeholder="z. B. 3,50"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm">Barcode / EAN (optional)</span>
              <input
                inputMode="numeric"
                value={newBarcode}
                onChange={(event) => setNewBarcode(event.target.value)}
                placeholder="Barcode scannen oder eingeben"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60 sm:col-span-2"
            >
              Produkt hinzufügen
            </button>
          </form>
        </section>

        <p className="mt-6 text-xs leading-5 text-slate-500">
          Hinterlege bei jedem Produkt den Barcode. Beim Scannen im Verkauf wird
          der Artikel erkannt und zum Warenkorb hinzugefügt.
        </p>
      </div>
    </main>
  );
}
