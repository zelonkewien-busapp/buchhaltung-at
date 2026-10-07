"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
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

type ScannerTarget =
  | { kind: "new" }
  | { kind: "existing"; productId: string };

const productCategories = [
  "Softdrink",
  "Bier",
  "Wein und Spritzer",
  "Heißgetränk",
  "Saft",
  "Snack",
  "Sonstiges",
];

const productUnits = ["Flasche", "Glas", "Dose", "Tasse", "Stück"];

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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget | null>(null);
  const [scannerStatus, setScannerStatus] = useState<"idle" | "starting" | "active">("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef({ code: "", time: 0 });

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

  const releaseCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    const video = videoRef.current;
    const stream = video?.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    if (video) video.srcObject = null;
  }, []);

  useEffect(() => () => releaseCamera(), [releaseCamera]);

  useEffect(() => {
    if (!scannerOpen || !scannerTarget) return;
    const target = scannerTarget;

    let cancelled = false;
    let localControls: { stop: () => void } | null = null;

    async function runScanner() {
      const video = videoRef.current;
      if (!video) {
        setMessage("Kamerafenster konnte nicht geöffnet werden. Bitte erneut versuchen.");
        setScannerOpen(false);
        setScannerTarget(null);
        setScannerStatus("idle");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("Dieser Browser unterstützt keinen Kamerazugriff. Bitte die HTTPS-Adresse in Safari oder Chrome öffnen.");
        setScannerOpen(false);
        setScannerTarget(null);
        setScannerStatus("idle");
        return;
      }

      const reader = new BrowserMultiFormatReader();
      setScannerStatus("starting");
      setMessage("Kamera wird gestartet …");

      try {
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          video,
          (result) => {
            if (!result || cancelled) return;

            const code = result.getText().trim();
            const now = Date.now();
            if (lastScanRef.current.code === code && now - lastScanRef.current.time < 1500) return;
            lastScanRef.current = { code, time: now };

            if (target.kind === "new") {
              setNewBarcode(code);
              setMessage(`Barcode ${code} erkannt. Bitte jetzt das Produkt hinzufügen.`);
            } else {
              setBarcodes((current) => ({ ...current, [target.productId]: code }));
              setMessage(`Barcode ${code} erkannt. Bitte beim Artikel noch auf „Speichern“ tippen.`);
            }

            setScannerStatus("idle");
            setScannerOpen(false);
            setScannerTarget(null);
          }
        );

        localControls = controls;
        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setScannerStatus("active");
        setMessage("Kamera aktiv – halte den Barcode ruhig und vollständig ins Bild.");
      } catch (error) {
        if (cancelled) return;
        setScannerStatus("idle");
        setScannerOpen(false);
        setScannerTarget(null);
        setMessage(
          error instanceof Error
            ? `Kamera konnte nicht starten: ${error.message}`
            : "Kamera konnte nicht starten. Bitte Kamerazugriff erlauben."
        );
      }
    }

    void runScanner();

    return () => {
      cancelled = true;
      localControls?.stop();
      if (controlsRef.current === localControls) controlsRef.current = null;

      const video = videoRef.current;
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (video) video.srcObject = null;
    };
  }, [scannerOpen, scannerTarget]);

  function openBarcodeScanner(target: ScannerTarget) {
    releaseCamera();
    lastScanRef.current = { code: "", time: 0 };
    setScannerTarget(target);
    setScannerStatus("starting");
    setScannerOpen(true);
  }

  function stopBarcodeScanner() {
    releaseCamera();
    setScannerStatus("idle");
    setScannerOpen(false);
    setScannerTarget(null);
    setMessage("Kamera geschlossen.");
  }

  function parseAmount(value: string): number | null {
    if (value.trim() === "") return null;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  async function findProductWithBarcode(
    barcode: string,
    excludedProductId?: string
  ): Promise<Pick<Product, "id" | "name"> | null> {
    const normalizedBarcode = barcode.trim();
    if (!normalizedBarcode || !userId) return null;

    let query = supabase
      .from("products")
      .select("id,name")
      .eq("user_id", userId)
      .eq("barcode", normalizedBarcode)
      .limit(1);

    if (excludedProductId) {
      query = query.neq("id", excludedProductId);
    }

    const { data } = await query.maybeSingle();
    return data;
  }

  function duplicateBarcodeMessage(barcode: string, productName?: string) {
    return productName
      ? `Der Barcode ${barcode} ist bereits bei „${productName}“ gespeichert.`
      : `Der Barcode ${barcode} ist bereits bei einem anderen Produkt gespeichert.`;
  }

  function updateProductField(
    productId: string,
    field: "name" | "category" | "unit",
    value: string
  ) {
    setProducts((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, [field]: value } : product
      )
    );
  }

  async function saveProduct(product: Product) {
    const priceText = prices[product.id] ?? "";
    const stockText = stocks[product.id] ?? "0";
    const price = parseAmount(priceText);
    const stock = parseAmount(stockText);

    if (!product.name.trim()) {
      setMessage("Bitte gib einen Produktnamen ein.");
      return;
    }

    if ((priceText.trim() !== "" && price === null) || stock === null) {
      setMessage("Bitte gib gültige, nicht negative Zahlen für Preis und Bestand ein.");
      return;
    }

    const barcode = (barcodes[product.id] ?? "").trim();

    setBusy(true);
    setMessage("");

    const duplicate = await findProductWithBarcode(barcode, product.id);
    if (duplicate) {
      setBusy(false);
      setMessage(duplicateBarcodeMessage(barcode, duplicate.name));
      return;
    }

    const { error } = await supabase
      .from("products")
      .update({
        name: product.name.trim(),
        category: product.category,
        unit: product.unit,
        price,
        stock,
        barcode: barcode || null,
      })
      .eq("id", product.id)
      .eq("user_id", userId);

    setBusy(false);

    if (error) {
      setMessage(
        error.code === "23505"
          ? duplicateBarcodeMessage(barcode)
          : `Speichern fehlgeschlagen: ${error.message}`
      );
    } else {
      setMessage(`„${product.name}“ wurde gespeichert.`);
      await loadProducts(userId);
    }
  }

  async function removeProduct(product: Product) {
    if (!userId || busy) return;

    setBusy(true);
    setMessage("");

    const [productResult, fridgeResult] = await Promise.all([
      supabase
        .from("products")
        .select("stock")
        .eq("id", product.id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("fridge_stock")
        .select("quantity")
        .eq("product_id", product.id)
        .eq("user_id", userId),
    ]);

    if (productResult.error || fridgeResult.error) {
      setBusy(false);
      setMessage(
        `Produkt konnte nicht geprüft werden: ${
          productResult.error?.message ?? fridgeResult.error?.message
        }`
      );
      return;
    }

    const catalogStock = Number(productResult.data?.stock ?? 0);
    const fridgeStock = (fridgeResult.data ?? []).reduce(
      (sum, row) => sum + Number(row.quantity ?? 0),
      0
    );

    if (catalogStock > 0 || fridgeStock > 0) {
      setBusy(false);
      setMessage(
        `„${product.name}“ hat noch Bestand (Katalog: ${catalogStock}, Kühlschränke: ${fridgeStock}). ` +
          "Setze den Bestand zuerst auf 0 und lösche den Artikel danach."
      );
      return;
    }

    const confirmed = window.confirm(
      `„${product.name}“ wirklich aus dem Produktkatalog löschen? ` +
        "Alte Rechnungen und Verkaufsdaten bleiben erhalten."
    );

    if (!confirmed) {
      setBusy(false);
      return;
    }

    const { error } = await supabase
      .from("products")
      .update({ is_active: false, barcode: null })
      .eq("id", product.id)
      .eq("user_id", userId);

    setBusy(false);

    if (error) {
      setMessage(`Produkt konnte nicht gelöscht werden: ${error.message}`);
    } else {
      setMessage(`„${product.name}“ wurde aus dem Produktkatalog entfernt.`);
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

    const barcode = newBarcode.trim();

    setBusy(true);
    setMessage("");

    const duplicate = await findProductWithBarcode(barcode);
    if (duplicate) {
      setBusy(false);
      setMessage(duplicateBarcodeMessage(barcode, duplicate.name));
      return;
    }

    const { error } = await supabase.from("products").insert({
      user_id: userId,
      name: name.trim(),
      category,
      unit,
      price,
      barcode: barcode || null,
      stock: 0,
      is_active: true,
    });

    setBusy(false);

    if (error) {
      setMessage(
        error.code === "23505"
          ? duplicateBarcodeMessage(barcode)
          : `Produkt konnte nicht angelegt werden: ${error.message}`
      );
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
        Produktkatalog wird geladen …
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
          <h1 className="mt-2 text-3xl font-bold">Produktkatalog</h1>
          <p className="mt-2 text-slate-600">
            Bearbeite Getränke und Snacks, Verkaufspreise, Barcodes und Bestände.
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
                className="rounded-xl bg-white p-5 shadow-sm"
              >
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block sm:col-span-2 lg:col-span-1">
                    <span className="mb-1 block text-sm">Produktname</span>
                    <input
                      required
                      value={product.name}
                      onChange={(event) =>
                        updateProductField(product.id, "name", event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm">Kategorie</span>
                    <select
                      value={product.category}
                      onChange={(event) =>
                        updateProductField(product.id, "category", event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                    >
                      {productCategories.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm">Einheit</span>
                    <select
                      value={product.unit}
                      onChange={(event) =>
                        updateProductField(product.id, "unit", event.target.value)
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                    >
                      {productUnits.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block sm:col-span-2 lg:col-span-3">
                  <span className="mb-1 block text-sm">Barcode / EAN</span>
                  <div className="flex gap-2">
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
                      className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2.5"
                    />
                    <button type="button" onClick={() => openBarcodeScanner({ kind: "existing", productId: product.id })}
                      className="shrink-0 rounded-lg border border-emerald-700 px-3 py-2.5 font-semibold text-emerald-800">
                      Kamera
                    </button>
                  </div>
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
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveProduct(product)}
                    className="rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
                  >
                    Änderungen speichern
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeProduct(product)}
                    className="rounded-lg border border-red-300 px-4 py-2.5 font-semibold text-red-700 disabled:opacity-60"
                  >
                    Produkt löschen
                  </button>
                </div>
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
                {productCategories.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm">Einheit</span>
              <select
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
              >
                {productUnits.map((option) => (
                  <option key={option}>{option}</option>
                ))}
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

            <div className="block">
              <span className="mb-1 block text-sm">Barcode / EAN (optional)</span>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  value={newBarcode}
                  onChange={(event) => setNewBarcode(event.target.value)}
                  placeholder="Barcode scannen oder eingeben"
                  className="min-w-0 w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
                <button type="button" onClick={() => openBarcodeScanner({ kind: "new" })}
                  className="shrink-0 rounded-lg border border-emerald-700 px-3 py-2.5 font-semibold text-emerald-800">
                  Kamera
                </button>
              </div>
            </div>

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

        {scannerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
            <section className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl sm:p-5">
              <h2 className="text-xl font-bold">Barcode scannen</h2>
              <p className="mt-1 text-sm text-slate-600">
                Halte den Strichcode vollständig und möglichst gerade ins Bild.
              </p>

              <div className="relative mt-4 overflow-hidden rounded-xl bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="h-[55vh] max-h-[560px] w-full object-cover"
                />
                {scannerStatus === "starting" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center font-semibold text-white">
                    Kamera wird gestartet …
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-[8%] top-1/2 h-28 -translate-y-1/2 rounded-lg border-2 border-emerald-400" />
              </div>

              <button
                type="button"
                onClick={stopBarcodeScanner}
                className="mt-4 w-full rounded-lg border border-slate-400 px-4 py-3 font-semibold"
              >
                Kamera schließen
              </button>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
