"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { createWorker } from "tesseract.js";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Product = { id: string; name: string; price: number | string; barcode: string | null };
type SaleLine = { key: number; productId: string; quantity: string };
type InvoiceLine = { name: string; quantity: number; price: number; total: number };
type Invoice = {
  number: string;
  date: string;
  customerName: string;
  customerStreet: string;
  customerPostalCode: string;
  customerCity: string;
  customerContact: string;
  customerCostCenter: string;
  customerPurchaseOrder: string;
  items: InvoiceLine[];
  total: number;
};

function field(profile: Record<string, unknown> | null, names: string[]) {
  if (!profile) return "";
  for (const name of names) {
    const value = profile[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function parseGermanAmount(value: string): number | null {
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/€|EUR/gi, "")
    .replace(/\.(?=\d{3}(?:,|$))/g, "")
    .replace(",", ".");
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function findDate(text: string): string {
  const match = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/);
  if (!match) return "";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function findAmount(text: string): string {
  const matches = [...text.matchAll(/\b\d{1,6}(?:[. ]\d{3})*(?:,\d{2})\s*(?:€|EUR)?/gi)];
  if (!matches.length) return "";
  const amount = parseGermanAmount(matches[matches.length - 1][0]);
  return amount === null ? "" : amount.toFixed(2).replace(".", ",");
}

export default function VerkaufPage() {
  const [userId, setUserId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerStatus, setScannerStatus] = useState("");
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [linkProductId, setLinkProductId] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);
  const [lines, setLines] = useState<SaleLine[]>([{ key: 1, productId: "", quantity: "1" }]);
  const [nextKey, setNextKey] = useState(2);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [customerName, setCustomerName] = useState("");
  const [customerStreet, setCustomerStreet] = useState("");
  const [customerPostalCode, setCustomerPostalCode] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [customerCostCenter, setCustomerCostCenter] = useState("");
  const [customerPurchaseOrder, setCustomerPurchaseOrder] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [salePdf, setSalePdf] = useState<File | null>(null);
  const [salePdfText, setSalePdfText] = useState("");
  const [salePdfDate, setSalePdfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salePdfDescription, setSalePdfDescription] = useState("");
  const [salePdfAmount, setSalePdfAmount] = useState("");
  const [salePdfCustomer, setSalePdfCustomer] = useState("");
  const [salePdfPaymentMethod, setSalePdfPaymentMethod] = useState<"cash" | "bank">("cash");
  const [salePdfPaymentStatus, setSalePdfPaymentStatus] = useState<"paid" | "open">("paid");
  const [salePdfMessage, setSalePdfMessage] = useState("");
  const [salePdfBusy, setSalePdfBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setMessage("Bitte zuerst anmelden.");
        return;
      }

      setUserId(auth.user.id);
      const [{ data: productData, error: productError }, { data: profileData }] = await Promise.all([
        supabase.from("products").select("id, name, price, barcode")
          .eq("user_id", auth.user.id).eq("is_active", true)
          .not("price", "is", null).order("name"),
        supabase.from("business_profiles").select("*")
          .eq("user_id", auth.user.id).maybeSingle(),
      ]);

      if (productError) setMessage(`Artikel konnten nicht geladen werden: ${productError.message}`);
      setProducts((productData ?? []) as Product[]);
      setProfile((profileData ?? null) as Record<string, unknown> | null);
    }

    void load();
  }, []);

  const iban = field(profile, ["iban"]).replace(/\s/g, "").toUpperCase();
  const bic = field(profile, ["bic"]);
  const accountHolder = field(profile, ["account_holder", "business_name", "company_name", "full_name", "name"]);
  const sellerName = field(profile, ["business_name", "company_name", "full_name", "name"]);
  const sellerStreet = field(profile, ["street", "street_address", "address"]);
  const sellerCity = [
    field(profile, ["postal_code", "zip"]),
    field(profile, ["city", "town"]),
    field(profile, ["country"]),
  ].filter(Boolean).join(" ");

  function productFor(id: string) {
    return products.find((product) => product.id === id);
  }

  function chooseSalePdf(file: File | null) {
    setSalePdf(file);
    setSalePdfText("");
    setSalePdfMessage("");
    setSalePdfAmount("");
    if (file) {
      setSalePdfDescription((current) => current || `Verkauf laut PDF: ${file.name.replace(/\.pdf$/i, "")}`);
    }
  }

  async function scanSalePdf() {
    if (!salePdf || salePdf.type !== "application/pdf") {
      setSalePdfMessage("Bitte zuerst eine PDF-Datei auswählen.");
      return;
    }
    if (salePdf.size > 10 * 1024 * 1024) {
      setSalePdfMessage("Die PDF darf höchstens 10 MB groß sein.");
      return;
    }

    setSalePdfBusy(true);
    setSalePdfMessage("PDF wird gelesen. Bitte warten …");
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await salePdf.arrayBuffer()) }).promise;
      const pageTexts: string[] = [];
      const pageCount = Math.min(pdf.numPages, 5);

      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        setSalePdfMessage(`PDF wird gelesen: Seite ${pageNumber} von ${pageCount} …`);
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const embeddedText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
        if (embeddedText.length > 25) {
          pageTexts.push(embeddedText);
          continue;
        }

        if (!worker) worker = await createWorker("deu+eng");
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF-Seite konnte nicht verarbeitet werden.");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const result = await worker.recognize(canvas);
        pageTexts.push(result.data.text.trim());
        canvas.width = 0;
        canvas.height = 0;
      }

      const text = pageTexts.filter(Boolean).join("\n\n");
      setSalePdfText(text);
      const extractedDate = findDate(text);
      const extractedAmount = findAmount(text);
      if (extractedDate) setSalePdfDate(extractedDate);
      if (extractedAmount) setSalePdfAmount(extractedAmount);
      setSalePdfMessage(text
        ? "Text erkannt. Datum und Gesamtbetrag bitte prüfen und vor dem Speichern bestätigen."
        : "Kein Text erkannt. Datum, Beschreibung und Betrag bitte manuell eintragen.");
    } catch (error) {
      setSalePdfMessage(error instanceof Error
        ? `PDF konnte nicht gelesen werden: ${error.message}`
        : "PDF konnte nicht gelesen werden. Bitte Angaben manuell eintragen.");
    } finally {
      if (worker) await worker.terminate();
      setSalePdfBusy(false);
    }
  }

  async function saveSalePdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !salePdf) {
      setSalePdfMessage("Bitte anmelden und eine PDF-Datei auswählen.");
      return;
    }
    const parsedAmount = parseGermanAmount(salePdfAmount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setSalePdfMessage("Bitte einen gültigen Gesamtbetrag größer 0 eingeben.");
      return;
    }
    if (!salePdfDate || !salePdfDescription.trim()) {
      setSalePdfMessage("Bitte Datum und Verkaufsbeschreibung ergänzen.");
      return;
    }

    setSalePdfBusy(true);
    setSalePdfMessage("PDF und Verkauf werden gespeichert …");
    const safeName = salePdf.name.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
    const storagePath = `${userId}/verkaeufe/${Date.now()}-${safeName || "verkauf"}.pdf`;
    const { error: uploadError } = await supabase.storage.from("incoming-invoices").upload(storagePath, salePdf, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadError) {
      setSalePdfBusy(false);
      setSalePdfMessage(`PDF konnte nicht gespeichert werden: ${uploadError.message}`);
      return;
    }

    const { data: booking, error } = await supabase.from("bookings").insert({
      user_id: userId,
      booking_date: salePdfDate,
      type: "income",
      payment_method: salePdfPaymentMethod,
      payment_status: salePdfPaymentStatus,
      paid_at: salePdfPaymentStatus === "paid" ? salePdfDate : null,
      description: salePdfDescription.trim(),
      amount: Math.round(parsedAmount * 100) / 100,
      customer_name: salePdfCustomer.trim() || null,
      source_document_path: storagePath,
      source_document_name: salePdf.name,
      source_document_ocr_text: salePdfText || null,
    }).select("booking_number").single();

    if (error || !booking) {
      await supabase.storage.from("incoming-invoices").remove([storagePath]);
      setSalePdfBusy(false);
      setSalePdfMessage(`Verkauf konnte nicht gespeichert werden: ${error?.message ?? "Unbekannter Fehler"}`);
      return;
    }

    setSalePdf(null);
    setSalePdfText("");
    setSalePdfDate(new Date().toISOString().slice(0, 10));
    setSalePdfDescription("");
    setSalePdfAmount("");
    setSalePdfCustomer("");
    setSalePdfPaymentMethod("cash");
    setSalePdfPaymentStatus("paid");
    setSalePdfBusy(false);
    setSalePdfMessage(`PDF-Verkauf gespeichert. Belegnummer: ${booking.booking_number}. Die Einnahme erscheint im Jahresabschluss.`);
  }

  function lineTotal(line: SaleLine) {
    const product = productFor(line.productId);
    return product ? Number(line.quantity || 0) * Number(product.price) : 0;
  }

  const total = Math.round(lines.reduce((sum, line) => sum + lineTotal(line), 0) * 100) / 100;

  function updateLine(key: number, changes: Partial<SaleLine>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, productId: "", quantity: "1" }]);
    setNextKey((value) => value + 1);
  }

  function stopBarcodeScanner() {
    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;
    setScannerOpen(false);
  }

  function addScannedProduct(product: Product) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: String(Number(line.quantity || 0) + 1) }
            : line
        );
      }
      return [...current, { key: Date.now(), productId: product.id, quantity: "1" }];
    });
  }

  async function startBarcodeScanner() {
    if (!videoRef.current) return;

    setScannerStatus("Kamera wird gestartet …");
    const reader = new BrowserMultiFormatReader();

    try {
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (!result) return;

          const code = result.getText().trim();
          scannerControlsRef.current?.stop();
          scannerControlsRef.current = null;
          setScannerOpen(false);

          const product = products.find((item) => item.barcode?.trim() === code);
          if (product) {
            addScannedProduct(product);
            setScannedBarcode("");
            setMessage(`„${product.name}“ wurde zum Warenkorb hinzugefügt.`);
          } else {
            setScannedBarcode(code);
            setLinkProductId("");
            setMessage(`Barcode ${code} ist noch keinem Artikel zugeordnet.`);
          }
        }
      );
      scannerControlsRef.current = controls;
      setScannerStatus("Barcode ins Kamerabild halten.");
    } catch (error) {
      setScannerStatus(
        error instanceof Error
          ? `Kamera konnte nicht gestartet werden: ${error.message}`
          : "Kamera konnte nicht gestartet werden."
      );
    }
  }

  async function assignScannedBarcode() {
    const product = products.find((item) => item.id === linkProductId);
    if (!product || !scannedBarcode) {
      setMessage("Bitte zuerst den passenden Katalogartikel auswählen.");
      return;
    }

    const { error } = await supabase
      .from("products")
      .update({ barcode: scannedBarcode })
      .eq("id", product.id)
      .eq("user_id", userId);

    if (error) {
      setMessage(`Barcode konnte nicht gespeichert werden: ${error.message}`);
      return;
    }

    const updatedProduct = { ...product, barcode: scannedBarcode };
    setProducts((current) =>
      current.map((item) => item.id === product.id ? updatedProduct : item)
    );
    addScannedProduct(updatedProduct);
    setScannedBarcode("");
    setLinkProductId("");
    setMessage(`Barcode wurde „${product.name}“ zugeordnet und zum Warenkorb hinzugefügt.`);
  }

  useEffect(() => {
    return () => scannerControlsRef.current?.stop();
  }, []);

  async function saveSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setInvoice(null);

    if (!lines.length || lines.some((line) => !line.productId || Number(line.quantity) <= 0)) {
      setMessage("Bitte für jede Zeile einen Artikel und eine gültige Anzahl auswählen.");
      return;
    }

    if (paymentMethod === "bank" && !iban) {
      setMessage("Für eine Rechnung zuerst die Bankverbindung hinterlegen.");
      return;
    }

    if (paymentMethod === "bank" && (!customerName.trim() || !customerStreet.trim() || !customerPostalCode.trim() || !customerCity.trim())) {
      setMessage("Für die Rechnung bitte Name und vollständige Anschrift des Kunden eingeben.");
      return;
    }

    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      setMessage("Bitte zuerst anmelden.");
      setBusy(false);
      return;
    }

    const invoiceLines = lines.map((line) => {
      const product = productFor(line.productId)!;
      const quantity = Number(line.quantity);
      const price = Number(product.price);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: price,
        line_total: Math.round(quantity * price * 100) / 100,
      };
    });

    const description = invoiceLines.map((line) => `${line.product_name} × ${line.quantity}`).join(", ");
    const bookingDate = new Date().toISOString().slice(0, 10);
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .insert({
        user_id: auth.user.id,
        booking_date: bookingDate,
        type: "income",
        payment_method: paymentMethod,
        payment_status: paymentMethod === "cash" ? "paid" : "open",
        paid_at: paymentMethod === "cash" ? bookingDate : null,
        description: `Verkauf: ${description}`,
        amount: total,
        customer_name: paymentMethod === "bank" ? customerName.trim() : null,
        customer_street: paymentMethod === "bank" ? customerStreet.trim() : null,
        customer_postal_code: paymentMethod === "bank" ? customerPostalCode.trim() : null,
        customer_city: paymentMethod === "bank" ? customerCity.trim() : null,
        customer_contact: paymentMethod === "bank" ? customerContact.trim() || null : null,
        customer_cost_center: paymentMethod === "bank" ? customerCostCenter.trim() || null : null,
        customer_purchase_order: paymentMethod === "bank" ? customerPurchaseOrder.trim() || null : null,
      })
      .select("id, booking_number")
      .single();

    if (bookingError || !booking) {
      setMessage(`Speichern fehlgeschlagen: ${bookingError?.message ?? "Unbekannter Fehler"}`);
      setBusy(false);
      return;
    }

    const itemRows = invoiceLines.map((line) => ({ ...line, booking_id: booking.id }));
    const { error: itemError } = await supabase.from("booking_items").insert(itemRows);

    if (itemError) {
      await supabase.from("bookings").delete().eq("id", booking.id);
      setMessage(`Artikelzeilen konnten nicht gespeichert werden: ${itemError.message}`);
      setBusy(false);
      return;
    }

    if (paymentMethod === "bank") {
      setInvoice({
        number: booking.booking_number,
        date: new Date().toLocaleDateString("de-AT"),
        customerName: customerName.trim(),
        customerStreet: customerStreet.trim(),
        customerPostalCode: customerPostalCode.trim(),
        customerCity: customerCity.trim(),
        customerContact: customerContact.trim(),
        customerCostCenter: customerCostCenter.trim(),
        customerPurchaseOrder: customerPurchaseOrder.trim(),
        items: invoiceLines.map((line) => ({
          name: line.product_name,
          quantity: line.quantity,
          price: line.unit_price,
          total: line.line_total,
        })),
        total,
      });
      setMessage(
        "Rechnung erstellt und als offen gespeichert. Nach Zahlungseingang kannst du sie im Jahresabschluss als bezahlt markieren."
      );
    } else {
      setMessage(`Kassenbeleg gespeichert. Belegnummer: ${booking.booking_number}`);
    }

    setLines([{ key: nextKey, productId: "", quantity: "1" }]);
    setNextKey((value) => value + 1);
    setBusy(false);
  }

  const qrText = invoice && iban
    ? ["BCD", "001", "1", "SCT", bic, accountHolder || sellerName, iban,
        `EUR${invoice.total.toFixed(2)}`, "", invoice.number, ""].join("\n")
    : "";

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="text-emerald-700 underline print:hidden">← Zur Übersicht</Link>
        <div className="mt-3 flex flex-wrap gap-4 print:hidden">
          <Link href="/auswertung" className="text-emerald-700 underline">Verkaufsauswertung</Link>
          <Link href="/katalog" className="text-emerald-700 underline">Produktkatalog</Link>
        </div>
        <h1 className="mt-6 text-3xl font-bold print:hidden">Verkaufsbeleg erstellen</h1>

        <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm print:hidden">
          <h2 className="text-xl font-semibold">Verkauf aus PDF übernehmen</h2>
          <p className="mt-2 text-sm text-slate-700">
            PDF auswählen und Text erkennen lassen. Bitte Datum und Betrag kontrollieren; erst danach wird die Einnahme gespeichert.
          </p>
          <form onSubmit={saveSalePdf} className="mt-4 space-y-4">
            <label className="block">
              <span className="mb-2 block font-medium">Verkaufsbeleg als PDF (maximal 10 MB)</span>
              <input type="file" accept="application/pdf,.pdf" required
                onChange={(event) => chooseSalePdf(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-slate-300 bg-white p-3" />
            </label>
            {salePdf && <p className="text-sm text-slate-600">Ausgewählt: {salePdf.name}</p>}
            <button type="button" disabled={!salePdf || salePdfBusy} onClick={() => void scanSalePdf()}
              className="rounded-xl border border-emerald-800 px-5 py-3 font-semibold text-emerald-900 disabled:opacity-50">
              {salePdfBusy ? "Bitte warten …" : "Text und Betrag aus PDF erkennen"}
            </button>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-2 block font-medium">Verkaufsdatum</span>
                <input type="date" required value={salePdfDate} onChange={(event) => setSalePdfDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="block">
                <span className="mb-2 block font-medium">Gesamtbetrag in Euro</span>
                <input required inputMode="decimal" value={salePdfAmount} onChange={(event) => setSalePdfAmount(event.target.value)}
                  placeholder="z. B. 125,50" className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-2 block font-medium">Beschreibung</span>
                <input required value={salePdfDescription} onChange={(event) => setSalePdfDescription(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="block">
                <span className="mb-2 block font-medium">Kunde (optional)</span>
                <input value={salePdfCustomer} onChange={(event) => setSalePdfCustomer(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3" />
              </label>
              <label className="block">
                <span className="mb-2 block font-medium">Zahlungsart</span>
                <select value={salePdfPaymentMethod} onChange={(event) => setSalePdfPaymentMethod(event.target.value as "cash" | "bank")}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                  <option value="cash">Bar</option>
                  <option value="bank">Bankkonto</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block font-medium">Zahlungsstatus</span>
                <select value={salePdfPaymentStatus} onChange={(event) => setSalePdfPaymentStatus(event.target.value as "paid" | "open")}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                  <option value="paid">Bezahlt</option>
                  <option value="open">Noch offen</option>
                </select>
              </label>
            </div>
            <button disabled={salePdfBusy || !salePdf}
              className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
              {salePdfBusy ? "Speichert …" : "PDF als Verkauf speichern"}
            </button>
            {salePdfMessage && <p role="status" className="rounded-lg bg-white p-3">{salePdfMessage}</p>}
            {salePdfText && (
              <details className="rounded-lg bg-white p-3">
                <summary className="cursor-pointer font-medium">Erkannten PDF-Text prüfen</summary>
                <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap text-xs">{salePdfText}</pre>
              </details>
            )}
          </form>
        </section>

        <form onSubmit={saveSale} className="mt-6 space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 print:hidden">
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <button
              type="button"
              onClick={() => {
                setScannerOpen(true);
                setScannerStatus("");
                setMessage("");
              }}
              className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white"
            >
              Barcode mit dem Handy scannen
            </button>

            {scannerOpen && (
              <div className="mt-4 space-y-3">
                <video ref={videoRef} autoPlay playsInline className="w-full max-w-md rounded-xl bg-black" />
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void startBarcodeScanner()}
                    className="rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-800">
                    Kamera starten
                  </button>
                  <button type="button" onClick={stopBarcodeScanner}
                    className="rounded-lg border border-slate-400 px-4 py-2">
                    Schließen
                  </button>
                </div>
                {scannerStatus && <p role="status">{scannerStatus}</p>}
              </div>
            )}

            {scannedBarcode && (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <label>
                  <span className="mb-1 block font-medium">
                    Neuer Barcode {scannedBarcode} – Artikel zuordnen
                  </span>
                  <select value={linkProductId} onChange={(event) => setLinkProductId(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
                    <option value="">Katalogartikel auswählen</option>
                    {products.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => void assignScannedBarcode()}
                  className="self-end rounded-lg border border-emerald-700 px-4 py-2.5 font-semibold text-emerald-800">
                  Anlernen und hinzufügen
                </button>
              </div>
            )}
          </section>

          <div className="space-y-4">
            {lines.map((line, index) => {
              const product = productFor(line.productId);
              return (
                <section key={line.key} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3 flex justify-between">
                    <h2 className="font-semibold">Artikel {index + 1}</h2>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
                        className="text-red-700 underline">Entfernen</button>
                    )}
                  </div>

                  <label className="block">
                    <span className="mb-2 block font-medium">Artikel</span>
                    <select required value={line.productId}
                      onChange={(e) => updateLine(line.key, { productId: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
                      <option value="">Artikel auswählen</option>
                      {products.map((item) => (
                        <option key={item.id} value={item.id}>{item.name} – {euro.format(Number(item.price))}</option>
                      ))}
                    </select>
                  </label>

                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <label>
                      <span className="mb-2 block font-medium">Anzahl</span>
                      <input type="number" min="0.001" step="0.001" value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                    </label>
                    <div><span className="mb-2 block font-medium">Einzelpreis</span>
                      <div className="rounded-xl bg-slate-100 px-4 py-3">{product ? euro.format(Number(product.price)) : "—"}</div>
                    </div>
                    <div><span className="mb-2 block font-medium">Zeilenpreis</span>
                      <div className="rounded-xl bg-slate-100 px-4 py-3 font-semibold">{product ? euro.format(lineTotal(line)) : "—"}</div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <button type="button" onClick={addLine} className="rounded-xl border border-emerald-700 px-5 py-3 font-semibold text-emerald-800">
            + Weiteren Artikel hinzufügen
          </button>

          <label className="block">
            <span className="mb-2 block font-medium">Zahlungsart</span>
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "cash" | "bank")}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3">
              <option value="cash">Barkasse</option>
              <option value="bank">Bankkonto – Rechnung</option>
            </select>
          </label>

          {paymentMethod === "bank" && (
            <>
              {iban ? (
                <p className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
                  Bankverbindung hinterlegt: {iban}
                </p>
              ) : (
                <p className="rounded-xl bg-amber-50 p-4 text-amber-900">
                  Für eine Rechnung zuerst deine{" "}
                  <Link className="underline" href="/einstellungen/bank">Bankverbindung hinterlegen</Link>.
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block font-medium">Kundenname</span>
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Straße und Hausnummer</span>
                  <input value={customerStreet} onChange={(e) => setCustomerStreet(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Ansprechpartner (optional)</span>
                  <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Postleitzahl</span>
                  <input value={customerPostalCode} onChange={(e) => setCustomerPostalCode(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Ort</span>
                  <input value={customerCity} onChange={(e) => setCustomerCity(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Ihre Kostenstelle (optional)</span>
                  <input value={customerCostCenter} onChange={(e) => setCustomerCostCenter(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
                <label className="block">
                  <span className="mb-2 block font-medium">Ihre Bestellnummer (optional)</span>
                  <input value={customerPurchaseOrder} onChange={(e) => setCustomerPurchaseOrder(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-3" />
                </label>
              </div>
            </>
          )}

          <div className="rounded-xl bg-slate-100 p-4 text-right">
            <span className="mr-3 font-medium">Gesamtbetrag</span>
            <strong className="text-2xl">{euro.format(total)}</strong>
          </div>

          <button disabled={busy || products.length === 0 || (paymentMethod === "bank" && !iban)}
            className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Speichert …" : paymentMethod === "bank" ? "Rechnung erstellen" : "Verkaufsbeleg speichern"}
          </button>
          {message && <p role="status">{message}</p>}
        </form>

        {invoice && (
          <section className="mt-8 rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200 print:mt-0 print:shadow-none print:ring-0">
            <div className="mb-8 flex justify-between gap-8">
              <div>
                <p className="text-sm font-bold tracking-wide text-emerald-700">{sellerName || "Rechnungssteller"}</p>
                <p>{sellerStreet}</p>
                <p>{sellerCity}</p>
                <p>{field(profile, ["invoice_email", "email"])}</p>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-bold">Rechnung</h2>
                <p className="mt-2">Belegnummer: {invoice.number}</p>
                <p>Datum: {invoice.date}</p>
              </div>
            </div>

            <div className="mb-8">
              <p className="font-semibold">{invoice.customerName}</p>
              <p>{invoice.customerStreet}</p>
              {invoice.customerContact && <p>z. H. {invoice.customerContact}</p>}
              <p>{invoice.customerPostalCode} {invoice.customerCity}</p>
              {invoice.customerCostCenter && <p className="mt-2">Kostenstelle: {invoice.customerCostCenter}</p>}
              {invoice.customerPurchaseOrder && <p>Bestellnummer: {invoice.customerPurchaseOrder}</p>}
            </div>

            <table className="w-full border-collapse text-left">
              <thead><tr className="border-b border-slate-300">
                <th className="py-2">Artikel</th><th className="py-2 text-right">Anzahl</th>
                <th className="py-2 text-right">Einzelpreis</th><th className="py-2 text-right">Summe</th>
              </tr></thead>
              <tbody>{invoice.items.map((item, index) => (
                <tr key={index} className="border-b border-slate-200">
                  <td className="py-3">{item.name}</td>
                  <td className="py-3 text-right">{item.quantity}</td>
                  <td className="py-3 text-right">{euro.format(item.price)}</td>
                  <td className="py-3 text-right">{euro.format(item.total)}</td>
                </tr>
              ))}</tbody>
            </table>

            <p className="mt-6 text-right text-2xl font-bold">Gesamtbetrag: {euro.format(invoice.total)}</p>
            <div className="mt-8 flex items-center gap-5 border-t border-slate-200 pt-5">
              <QRCodeSVG value={qrText} size={132} />
              <div>
                <p className="font-semibold">Per Banküberweisung bezahlen</p>
                <p>Kontoinhaber: {accountHolder || sellerName}</p>
                <p>IBAN: {iban}</p>
                {bic && <p>BIC: {bic}</p>}
                <p>Verwendungszweck: {invoice.number}</p>
              </div>
            </div>

            <button onClick={() => window.print()}
              className="mt-8 rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white print:hidden">
              Rechnung drucken oder als PDF speichern
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
