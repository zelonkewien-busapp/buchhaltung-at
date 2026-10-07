"use client";

import { FormEvent, useEffect, useState } from "react";
import { createWorker } from "tesseract.js";
import { createClient } from "@/lib/supabase/client";

type SavedExpense = {
  id: string;
  supplier: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  created_at: string;
};

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
  const matches = [
    ...text.matchAll(
      /\b\d{1,6}(?:[. ]\d{3})*(?:,\d{2})\s*(?:€|EUR)?/gi
    ),
  ];
  if (!matches.length) return "";
  const lastMatch = matches[matches.length - 1][0];
  const amount = parseGermanAmount(lastMatch);
  return amount === null ? "" : amount.toFixed(2).replace(".", ",");
}

export default function AusgabenPage() {
  const [supabase] = useState(() => createClient());
  const [userId, setUserId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [supplier, setSupplier] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [amount, setAmount] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [expenses, setExpenses] = useState<SavedExpense[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadExpenses(id: string) {
    const { data, error } = await supabase
      .from("incoming_expenses")
      .select("id,supplier,invoice_number,invoice_date,total_amount,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      setMessage(`Belege konnten nicht geladen werden: ${error.message}`);
      return;
    }

    setExpenses((data ?? []) as SavedExpense[]);
  }

  useEffect(() => {
    let active = true;

    async function start() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (!data.user) {
        setMessage("Bitte zuerst auf der Startseite anmelden.");
        setLoading(false);
        return;
      }

      setUserId(data.user.id);
      await loadExpenses(data.user.id);
      if (active) setLoading(false);
    }

    void start();
    return () => {
      active = false;
    };
  }, [supabase]);

  function selectFile(selected: File | null) {
    setFile(selected);
    setOcrText("");
    setPreview(selected ? URL.createObjectURL(selected) : "");
    setMessage("");
  }

  async function scanReceipt() {
    if (!file) {
      setMessage("Bitte zuerst ein Belegfoto oder PDF auswählen.");
      return;
    }

    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      setMessage("Bitte ein Foto oder eine PDF-Datei auswählen.");
      return;
    }

    setBusy(true);
    setMessage("Beleg wird gelesen. Beim ersten Mal kann es etwas dauern.");

    let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

    try {
      let text = "";

      if (file.type.startsWith("image/")) {
        worker = await createWorker("deu+eng");
        const result = await worker.recognize(file);
        text = result.data.text.trim();
      } else {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const document = await pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
        }).promise;

        const pageCount = Math.min(document.numPages, 5);
        const pageTexts: string[] = [];

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          setMessage(`PDF wird gelesen: Seite ${pageNumber} von ${pageCount} …`);

          const page = await document.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const embeddedText = textContent.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .trim();

          if (embeddedText.length > 25) {
            pageTexts.push(embeddedText);
          } else {
            if (!worker) worker = await createWorker("deu+eng");

            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = window.document.createElement("canvas");
            const context = canvas.getContext("2d");

            if (!context) {
              throw new Error("Die PDF-Seite konnte nicht verarbeitet werden.");
            }

            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);

            await page.render({ canvas: canvas,  canvasContext: context, viewport }).promise;
            const result = await worker.recognize(canvas);
            pageTexts.push(result.data.text.trim());

            canvas.width = 0;
            canvas.height = 0;
          }
        }

        text = pageTexts.filter(Boolean).join("\n\n");
      }

      setOcrText(text);

      const firstLine = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 2);

      if (firstLine && !supplier) setSupplier(firstLine);
      if (!invoiceDate) setInvoiceDate(findDate(text));
      if (!amount) setAmount(findAmount(text));

      setMessage(
        text
          ? "Text erkannt. Bitte Lieferant, Datum und Betrag prüfen und korrigieren."
          : "Es wurde kein Text erkannt. Du kannst die Angaben manuell eintragen."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Texterkennung fehlgeschlagen: ${error.message}`
          : "Texterkennung fehlgeschlagen. Bitte Angaben manuell eintragen."
      );
    } finally {
      if (worker) await worker.terminate();
      setBusy(false);
    }
  }
  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!userId || !file) {
      setMessage("Bitte anmelden und ein Belegfoto auswählen.");
      return;
    }

    const parsedAmount = amount.trim() ? parseGermanAmount(amount) : null;
    if (amount.trim() && parsedAmount === null) {
      setMessage("Bitte einen gültigen Betrag eingeben, zum Beispiel 12,50.");
      return;
    }

    setBusy(true);
    setMessage("Beleg wird gespeichert …");

    const safeName = file.name
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 60);
    const storagePath = `${userId}/${Date.now()}-${safeName || "beleg"}`;

    const { error: uploadError } = await supabase.storage
      .from("incoming-invoices")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      setBusy(false);
      setMessage(`Foto konnte nicht hochgeladen werden: ${uploadError.message}`);
      return;
    }

    const { error: saveError } = await supabase
      .from("incoming_expenses")
      .insert({
        user_id: userId,
        supplier: supplier.trim(),
        invoice_number: invoiceNumber.trim() || null,
        invoice_date: invoiceDate || null,
        total_amount: parsedAmount,
        storage_path: storagePath,
        ocr_text: ocrText || null,
        status: "saved",
      });

    if (saveError) {
      await supabase.storage.from("incoming-invoices").remove([storagePath]);
      setBusy(false);
      setMessage(`Belegdaten konnten nicht gespeichert werden: ${saveError.message}`);
      return;
    }

    setFile(null);
    setPreview("");
    setSupplier("");
    setInvoiceNumber("");
    setInvoiceDate("");
    setAmount("");
    setOcrText("");
    await loadExpenses(userId);
    setBusy(false);
    setMessage("Eingangsbeleg und Foto wurden gespeichert.");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-700">
        Ausgaben werden geladen …
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <a href="/" className="text-sm font-medium text-emerald-800 underline">
          ← Zurück zur Startseite
        </a>

        <header className="mb-8 mt-5">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">Eingangsbeleg hinzufügen</h1>
          <p className="mt-2 text-slate-600">
            Beleg fotografieren, Text auslesen lassen und erkannte Angaben prüfen.
          </p>
        </header>

        {message && (
          <div role="status" className="mb-5 rounded-lg border bg-white p-4 text-sm">
            {message}
          </div>
        )}

        <section className="rounded-xl bg-white p-5 shadow-sm sm:p-6">
          <form onSubmit={saveExpense} className="space-y-5">
            <label className="block">
              <span className="mb-2 block font-medium">Belegfoto</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                className="block w-full rounded-lg border border-slate-300 p-3"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Foto oder PDF, maximal 10 MB. Bei PDFs werden zunächst bis zu fünf Seiten gelesen.
              </span>
            </label>

            {file?.type.startsWith("image/") && preview && (
              <img
                src={preview}
                alt="Vorschau des ausgewählten Eingangsbelegs"
                className="max-h-96 rounded-lg border object-contain"
              />
            )}
            {file?.type === "application/pdf" && (
              <p className="rounded-lg border bg-slate-50 p-4">
                PDF ausgewählt: {file.name}
              </p>
            )}

            <button
              type="button"
              onClick={() => void scanReceipt()}
              disabled={busy || !file}
              className="rounded-lg border border-emerald-700 px-4 py-2.5 font-semibold text-emerald-800 disabled:opacity-50"
            >
              {busy ? "Bitte warten …" : "Text aus Foto oder PDF erkennen"}
            </button>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Lieferant</span>
                <input
                  value={supplier}
                  onChange={(event) => setSupplier(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Rechnungsnummer</span>
                <input
                  value={invoiceNumber}
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Rechnungsdatum</span>
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(event) => setInvoiceDate(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Gesamtbetrag in Euro</span>
                <input
                  inputMode="decimal"
                  placeholder="z. B. 12,50"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>
            </div>

            {ocrText && (
              <details className="rounded-lg bg-slate-50 p-4">
                <summary className="cursor-pointer font-medium">
                  Erkannter Text anzeigen
                </summary>
                <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                  {ocrText}
                </pre>
              </details>
            )}

            <button
              type="submit"
              disabled={busy || !file}
              className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
            >
              Foto und Beleg speichern
            </button>
          </form>
        </section>

        <section className="mt-8 rounded-xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-semibold">Zuletzt gespeicherte Belege</h2>

          {expenses.length === 0 ? (
            <p className="mt-3 text-slate-600">Noch keine Eingangsbelege gespeichert.</p>
          ) : (
            <ul className="mt-4 divide-y">
              {expenses.map((expense) => (
                <li key={expense.id} className="flex flex-wrap justify-between gap-2 py-3">
                  <span>
                    <strong>{expense.supplier || "Lieferant nicht erkannt"}</strong>
                    <span className="block text-sm text-slate-500">
                      {expense.invoice_date || "Kein Datum"}
                      {expense.invoice_number ? ` · Nr. ${expense.invoice_number}` : ""}
                    </span>
                  </span>
                  <span className="font-semibold">
                    {expense.total_amount == null
                      ? "Betrag offen"
                      : new Intl.NumberFormat("de-AT", {
                          style: "currency",
                          currency: "EUR",
                        }).format(expense.total_amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-5 text-xs leading-5 text-slate-500">
          OCR kann Angaben falsch erkennen. Prüfe die Felder vor dem Speichern.
        </p>
      </div>
    </main>
  );
}


