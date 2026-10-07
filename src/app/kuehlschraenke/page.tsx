"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Product = {
  id: string;
  name: string;
  price: number | string | null;
  barcode: string | null;
};

type Fridge = {
  id: string;
  name: string;
};

type StockRow = {
  fridge_id: string;
  product_id: string;
  quantity: number | string;
};

type Mode = "load" | "sale" | "private";

export default function KuehlschraenkePage() {
  const [userId, setUserId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [fridgeId, setFridgeId] = useState("");
  const [mode, setMode] = useState<Mode>("load");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef({ code: "", time: 0 });

  async function loadData(id: string) {
    const [productResult, fridgeResult] = await Promise.all([
      supabase.from("products")
        .select("id,name,price,barcode")
        .eq("user_id", id)
        .eq("is_active", true)
        .order("name"),
      supabase.from("fridges")
        .select("id,name")
        .eq("user_id", id)
        .order("name"),
    ]);

    if (productResult.error) throw productResult.error;
    if (fridgeResult.error) throw fridgeResult.error;

    let fridgeList = (fridgeResult.data ?? []) as Fridge[];
    const standardNames = ["Kühlschrank 1", "Kühlschrank 2", "Kühlschrank 3"];
    const missing = standardNames.filter((name) => !fridgeList.some((item) => item.name === name));

    if (missing.length) {
      const { data, error } = await supabase.from("fridges")
        .insert(missing.map((name) => ({ user_id: id, name })))
        .select("id,name");
      if (error) throw error;
      fridgeList = [...fridgeList, ...((data ?? []) as Fridge[])];
    }

    fridgeList.sort((a, b) => a.name.localeCompare(b.name, "de"));
    setProducts((productResult.data ?? []) as Product[]);
    setFridges(fridgeList);

    const activeFridge = fridgeId || fridgeList[0]?.id || "";
    if (!fridgeId && activeFridge) setFridgeId(activeFridge);

    if (activeFridge) {
      const { data, error } = await supabase.from("fridge_stock")
        .select("fridge_id,product_id,quantity")
        .eq("user_id", id)
        .eq("fridge_id", activeFridge);
      if (error) throw error;
      setStock((data ?? []) as StockRow[]);
    }
  }

  useEffect(() => {
    async function start() {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        setMessage("Bitte zuerst anmelden.");
        return;
      }

      setUserId(data.user.id);
      try {
        await loadData(data.user.id);
      } catch (loadError) {
        setMessage(loadError instanceof Error ? loadError.message : "Daten konnten nicht geladen werden.");
      }
    }

    void start();
    return () => controlsRef.current?.stop();
  }, []);

  async function changeFridge(id: string) {
    setFridgeId(id);
    setCounted({});
    if (!userId) return;

    const { data, error } = await supabase.from("fridge_stock")
      .select("fridge_id,product_id,quantity")
      .eq("user_id", userId)
      .eq("fridge_id", id);

    if (error) setMessage(error.message);
    else setStock((data ?? []) as StockRow[]);
  }

  function oldQuantity(productId: string) {
    const row = stock.find((item) => item.product_id === productId);
    return Number(row?.quantity ?? 0);
  }

  function currentQuantity(productId: string) {
    return Number(counted[productId] ?? 0);
  }

  function changeCount(productId: string, value: string) {
    setCounted((current) => ({ ...current, [productId]: value }));
  }

  function addScannedProduct(product: Product) {
    setCounted((current) => ({
      ...current,
      [product.id]: String(Number(current[product.id] ?? 0) + 1),
    }));
    setMessage(`„${product.name}“ gezählt.`);
  }

  async function startScanner() {
    if (!videoRef.current) return;

    const reader = new BrowserMultiFormatReader();
    setMessage("Kamera wird gestartet …");

    try {
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result) return;

        const code = result.getText().trim();
        const now = Date.now();
        if (lastScanRef.current.code === code && now - lastScanRef.current.time < 1200) return;
        lastScanRef.current = { code, time: now };

        const product = products.find((item) => item.barcode?.trim() === code);
        if (product) {
          addScannedProduct(product);
        } else {
          setMessage(`Barcode ${code} ist noch keinem Artikel zugeordnet. Bitte im Getränkekatalog anlernen.`);
        }
      });

      controlsRef.current = controls;
      setMessage("Scanne die Artikel, die jetzt noch im Kühlschrank sind.");
    } catch (error) {
      setMessage(error instanceof Error ? `Kamera konnte nicht starten: ${error.message}` : "Kamera konnte nicht starten.");
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScannerOpen(false);
  }

  async function save() {
    if (!userId || !fridgeId) return;
    setBusy(true);
    setMessage("");

    const changes = products.map((product) => {
      const before = oldQuantity(product.id);
      const after = currentQuantity(product.id);
      return { product, before, after, difference: before - after };
    });

    const sold = changes.filter((item) => item.difference > 0 && Number(item.product.price) > 0);
    const total = Math.round(
      sold.reduce((sum, item) => sum + item.difference * Number(item.product.price), 0) * 100
    ) / 100;

    if (mode === "sale" && (!customerName.trim() || sold.length === 0)) {
      setMessage(sold.length === 0
        ? "Es wurde keine Entnahme erkannt. Prüfe den gezählten Restbestand."
        : "Bitte den Kundennamen eingeben.");
      setBusy(false);
      return;
    }

    if (mode === "sale" && paymentMethod === "bank" &&
        (!street.trim() || !postalCode.trim() || !city.trim())) {
      setMessage("Für die Rechnung bitte Straße, Postleitzahl und Ort ergänzen.");
      setBusy(false);
      return;
    }

    let bookingId: string | null = null;
    let bookingNumber = "";

    if (mode === "sale") {
      const description = sold
        .map((item) => `${item.product.name} × ${item.difference}`)
        .join(", ");

      const { data: booking, error } = await supabase.from("bookings")
        .insert({
          user_id: userId,
          booking_date: new Date().toISOString().slice(0, 10),
          type: "income",
          payment_method: paymentMethod,
          description: `Kühlschrankverkauf: ${description}`,
          amount: total,
          customer_name: customerName.trim(),
          customer_street: paymentMethod === "bank" ? street.trim() : null,
          customer_postal_code: paymentMethod === "bank" ? postalCode.trim() : null,
          customer_city: paymentMethod === "bank" ? city.trim() : null,
        })
        .select("id,booking_number")
        .single();

      if (error || !booking) {
        setMessage(`Verkauf konnte nicht gespeichert werden: ${error?.message ?? "Unbekannter Fehler"}`);
        setBusy(false);
        return;
      }

      bookingId = booking.id;
      bookingNumber = booking.booking_number;

      const { error: itemsError } = await supabase.from("booking_items").insert(
        sold.map((item) => ({
          booking_id: booking.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.difference,
          unit_price: Number(item.product.price),
          line_total: Math.round(item.difference * Number(item.product.price) * 100) / 100,
        }))
      );

      if (itemsError) {
        await supabase.from("bookings").delete().eq("id", booking.id);
        setMessage(`Artikel konnten nicht gespeichert werden: ${itemsError.message}`);
        setBusy(false);
        return;
      }
    }

    const stockRows = products.map((product) => ({
      user_id: userId,
      fridge_id: fridgeId,
      product_id: product.id,
      quantity: currentQuantity(product.id),
      updated_at: new Date().toISOString(),
    }));

    const { error: stockError } = await supabase.from("fridge_stock")
      .upsert(stockRows, { onConflict: "fridge_id,product_id" });

    if (stockError) {
      if (bookingId) await supabase.from("bookings").delete().eq("id", bookingId);
      setMessage(`Bestand konnte nicht gespeichert werden: ${stockError.message}`);
      setBusy(false);
      return;
    }

    const movements = changes
      .filter((item) => item.before !== item.after)
      .map((item) => {
        let movementType: string;
        let delta: number;

        if (mode === "load") {
          movementType = "load";
          delta = item.after - item.before;
        } else if (mode === "private" && item.difference > 0) {
          movementType = "private_withdrawal";
          delta = -item.difference;
        } else if (mode === "sale" && item.difference > 0) {
          movementType = "sale";
          delta = -item.difference;
        } else {
          movementType = "count_adjustment";
          delta = item.after - item.before;
        }

        return {
          user_id: userId,
          fridge_id: fridgeId,
          product_id: item.product.id,
          booking_id: mode === "sale" && item.difference > 0 ? bookingId : null,
          movement_type: movementType,
          quantity_delta: delta,
        };
      });

    if (movements.length) {
      const { error: movementError } = await supabase.from("fridge_stock_movements").insert(movements);
      if (movementError) {
        setMessage(`Bestand gespeichert, Bewegungsprotokoll meldet aber: ${movementError.message}`);
        setBusy(false);
        return;
      }
    }

    setCounted({});
    await changeFridge(fridgeId);

    if (mode === "load") {
      setMessage("Der Bestand wurde gespeichert.");
    } else if (mode === "private") {
      setMessage("Privatentnahme wurde getrennt vom Verkauf im Kühlschrankprotokoll erfasst.");
    } else {
      setMessage(`Verkauf gespeichert. Belegnummer: ${bookingNumber}. Gesamt: ${euro.format(total)}.`);
    }

    setBusy(false);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <Link href="/verkauf" className="text-emerald-800 underline">← Zurück zum Verkauf</Link>
        <h1 className="mt-5 text-3xl font-bold">Kühlschrankbestand</h1>
        <p className="mt-2 text-slate-600">
          Bestand einräumen oder nach der Kundenentnahme den verbliebenen Inhalt scannen.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {fridges.map((fridge) => (
            <button key={fridge.id} onClick={() => void changeFridge(fridge.id)}
              className={`rounded-xl border p-4 text-left font-semibold ${
                fridgeId === fridge.id ? "border-emerald-700 bg-emerald-50" : "border-slate-300 bg-white"
              }`}>
              {fridge.name}
              <span className="mt-1 block text-sm font-normal text-slate-600">
                {stock.filter((row) => row.fridge_id === fridge.id && Number(row.quantity) > 0).length} Artikel mit Bestand
              </span>
            </button>
          ))}
        </div>

        <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
          <label className="block">
            <span className="mb-2 block font-medium">Vorgang</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3">
              <option value="load">Bestand einräumen oder zählen</option>
              <option value="sale">Kundenentnahme abrechnen</option>
              <option value="private">Privatentnahme</option>
            </select>
          </label>

          {mode === "sale" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block">Kundenname</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-3" />
              </label>
              <label>
                <span className="mb-1 block">Zahlungsart</span>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "bank")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3">
                  <option value="cash">Barverkauf</option>
                  <option value="bank">Rechnung auf Bankkonto</option>
                </select>
              </label>
              {paymentMethod === "bank" && (
                <>
                  <label><span className="mb-1 block">Straße</span>
                    <input value={street} onChange={(e) => setStreet(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                  <label><span className="mb-1 block">Postleitzahl</span>
                    <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                  <label><span className="mb-1 block">Ort</span>
                    <input value={city} onChange={(e) => setCity(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                </>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => {
              setScannerOpen(true);
              setMessage("");
            }}
              className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white">
              Restbestand mit Kamera scannen
            </button>
            <Link href="/katalog" className="rounded-lg border border-slate-400 px-4 py-3">
              Barcodes im Katalog anlernen
            </Link>
          </div>

          {scannerOpen && (
            <div className="mt-4 space-y-3">
              <video ref={videoRef} autoPlay playsInline className="w-full max-w-md rounded-xl bg-black" />
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => void startScanner()}
                  className="rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-800">
                  Kamera starten
                </button>
                <button type="button" onClick={stopScanner}
                  className="rounded-lg border border-slate-400 px-4 py-2">
                  Kamera schließen
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3">
            {products.map((product) => {
              const before = oldQuantity(product.id);
              const after = currentQuantity(product.id);
              const removed = Math.max(0, before - after);
              return (
                <div key={product.id} className="grid items-center gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_130px_160px]">
                  <div>
                    <strong>{product.name}</strong>
                    <div className="text-sm text-slate-600">
                      Vorher: {before} · gezählt: {after}
                      {mode === "sale" && removed > 0 && Number(product.price) > 0
                        ? ` · Entnahme: ${removed} · ${euro.format(removed * Number(product.price))}`
                        : ""}
                    </div>
                  </div>
                  <label className="text-sm">
                    <span className="mb-1 block">Gezählte Menge</span>
                    <input type="number" min="0" step="1" inputMode="numeric"
                      value={counted[product.id] ?? ""}
                      onChange={(e) => changeCount(product.id, e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <div className="text-sm text-slate-600">
                    Barcode: {product.barcode || "noch nicht angelernt"}
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" disabled={busy} onClick={() => void save()}
            className="mt-5 rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Speichert …" : mode === "sale" ? "Entnahme abrechnen" : mode === "private" ? "Privatentnahme speichern" : "Bestand speichern"}
          </button>

          {message && <p role="status" className="mt-4 rounded-lg bg-slate-100 p-3">{message}</p>}
        </section>
      </div>
    </main>
  );
}
