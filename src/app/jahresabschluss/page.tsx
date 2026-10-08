"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const euro = new Intl.NumberFormat("de-AT", {
  style: "currency",
  currency: "EUR",
});

type Booking = {
  id: string;
  booking_date: string;
  type: "income" | "expense";
  payment_method: "cash" | "bank";
  payment_status: "paid" | "open";
  paid_at: string | null;
  description: string;
  amount: number | string;
  document_no: string | null;
  booking_number: string | null;
  customer_name: string | null;
  source_document_path: string | null;
  source_document_name: string | null;
};

type Expense = {
  id: string;
  supplier: string;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | string | null;
  expense_category: string;
  payment_method: "cash" | "bank";
  payment_status: "paid" | "open";
  paid_at: string | null;
  created_at: string;
  storage_path: string | null;
};

type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number | string | null;
  stock: number | string;
  is_active: boolean;
};

type FridgeStock = {
  product_id: string;
  quantity: number | string;
};

type Asset = {
  id: string;
  name: string;
  purchase_date: string;
  purchase_cost: number | string;
  useful_life_years: number | string;
  private_share_percent: number | string;
  notes: string | null;
};

type Closing = {
  fiscal_year: number;
  status: "draft" | "closed";
  income_total: number | string;
  expense_total: number | string;
  profit_total: number | string;
  closed_at: string | null;
  updated_at: string;
};

type InventoryRow = {
  productId: string;
  name: string;
  category: string;
  unit: string;
  warehouseQuantity: number;
  fridgeQuantity: number;
  totalQuantity: number;
  sellingPrice: number | null;
};

type ZipEntry = {
  name: string;
  content: string | Uint8Array;
};

type ReceiptDocument = {
  kind: "Eingangsbeleg" | "Ausgangsbeleg";
  date: string;
  label: string;
  path: string;
};

function asNumber(value: number | string | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateInYear(value: string | null | undefined, year: number) {
  return Boolean(value && value.slice(0, 4) === String(year));
}

function displayDate(value: string | null | undefined) {
  if (!value) return "–";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("de-AT");
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "Beleg";
}

function fileExtension(path: string, contentType = "") {
  const match = path.match(/\.[a-zA-Z0-9]{1,8}$/);
  if (match) return match[0].toLowerCase();
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/jpeg") return ".jpg";
  return ".bin";
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Belegbild konnte nicht gelesen werden."));
    reader.readAsDataURL(blob);
  });
}

function effectiveBookingDate(booking: Booking) {
  if (booking.payment_status === "open") return null;
  return booking.paid_at || booking.booking_date;
}

function effectiveExpenseDate(expense: Expense) {
  if (expense.payment_status === "open") return null;
  return expense.paid_at || expense.invoice_date || expense.created_at.slice(0, 10);
}

function assetDepreciation(asset: Asset, selectedYear: number) {
  const purchaseYear = Number(asset.purchase_date.slice(0, 4));
  const purchaseMonth = Number(asset.purchase_date.slice(5, 7));
  const cost = asNumber(asset.purchase_cost);
  const privateShare = asNumber(asset.private_share_percent);
  const usefulLife = Math.max(1, asNumber(asset.useful_life_years));
  const depreciableAmount = cost * (1 - privateShare / 100);
  const fullYearAmount = depreciableAmount / usefulLife;
  let remaining = depreciableAmount;
  let annualAmount = 0;
  let accumulated = 0;

  if (selectedYear < purchaseYear) {
    return { annualAmount: 0, accumulated: 0, remaining: depreciableAmount };
  }

  for (let year = purchaseYear; year <= selectedYear && remaining > 0; year += 1) {
    const firstYearFactor = year === purchaseYear && purchaseMonth >= 7 ? 0.5 : 1;
    const amount = Math.min(fullYearAmount * firstYearFactor, remaining);
    remaining -= amount;
    accumulated += amount;
    if (year === selectedYear) annualAmount = amount;
  }

  return {
    annualAmount: Math.round(annualAmount * 100) / 100,
    accumulated: Math.round(accumulated * 100) / 100,
    remaining: Math.round(Math.max(0, remaining) * 100) / 100,
  };
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFile(rows: Array<Array<string | number | null | undefined>>) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

function decimal(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDate(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
}

function zipTime(date: Date) {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
}

function makeZip(entries: ZipEntry[]) {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const now = new Date();
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, zipTime(now), true);
    localView.setUint16(12, zipDate(now), true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, zipTime(now), true);
    centralView.setUint16(14, zipDate(now), true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    centralParts.push(central);

    localOffset += local.length;
    centralSize += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  const parts = [...localParts, ...centralParts, end].map(
    (part) => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
  );
  return new Blob(parts, { type: "application/zip" });
}

export default function JahresabschlussPage() {
  const [supabase] = useState(() => createClient());
  const currentYear = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const [year, setYear] = useState(currentYear);
  const [userId, setUserId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [fridgeStock, setFridgeStock] = useState<FridgeStock[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [paidDates, setPaidDates] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAllBookings = useCallback(
    async (id: string) => {
      const rows: Booking[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("bookings")
          .select(
            "id,booking_date,type,payment_method,payment_status,paid_at,description,amount,document_no,booking_number,customer_name,source_document_path,source_document_name"
          )
          .eq("user_id", id)
          .order("booking_date", { ascending: true })
          .range(from, from + 999);

        if (error) throw error;
        const page = (data ?? []) as Booking[];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows;
    },
    [supabase]
  );

  const loadAllExpenses = useCallback(
    async (id: string) => {
      const rows: Expense[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("incoming_expenses")
          .select(
            "id,supplier,invoice_number,invoice_date,total_amount,expense_category,payment_method,payment_status,paid_at,created_at,storage_path"
          )
          .eq("user_id", id)
          .order("created_at", { ascending: true })
          .range(from, from + 999);

        if (error) throw error;
        const page = (data ?? []) as Expense[];
        rows.push(...page);
        if (page.length < 1000) break;
      }
      return rows;
    },
    [supabase]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        setMessage("Bitte zuerst anmelden.");
        setLoading(false);
        return;
      }

      setUserId(auth.user.id);

      const [
        bookingRows,
        expenseRows,
        productResult,
        fridgeResult,
        assetResult,
        profileResult,
        closingResult,
      ] = await Promise.all([
        loadAllBookings(auth.user.id),
        loadAllExpenses(auth.user.id),
        supabase
          .from("products")
          .select("id,name,category,unit,price,stock,is_active")
          .eq("user_id", auth.user.id)
          .order("name"),
        supabase
          .from("fridge_stock")
          .select("product_id,quantity")
          .eq("user_id", auth.user.id),
        supabase
          .from("business_assets")
          .select(
            "id,name,purchase_date,purchase_cost,useful_life_years,private_share_percent,notes"
          )
          .eq("user_id", auth.user.id)
          .order("purchase_date"),
        supabase
          .from("business_profiles")
          .select("legal_name,owner_name")
          .eq("user_id", auth.user.id)
          .maybeSingle(),
        supabase
          .from("annual_closings")
          .select(
            "fiscal_year,status,income_total,expense_total,profit_total,closed_at,updated_at"
          )
          .eq("user_id", auth.user.id)
          .eq("fiscal_year", year)
          .maybeSingle(),
      ]);

      const firstError =
        productResult.error ||
        fridgeResult.error ||
        assetResult.error ||
        profileResult.error ||
        closingResult.error;
      if (firstError) throw firstError;

      setBookings(bookingRows);
      setExpenses(expenseRows);
      setProducts((productResult.data ?? []) as Product[]);
      setFridgeStock((fridgeResult.data ?? []) as FridgeStock[]);
      setAssets((assetResult.data ?? []) as Asset[]);
      setBusinessName(
        profileResult.data?.legal_name || profileResult.data?.owner_name || "Mein Betrieb"
      );
      setClosing((closingResult.data ?? null) as Closing | null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
      setMessage(
        `Jahresabschluss konnte nicht geladen werden: ${errorMessage}. ` +
          "Prüfe, ob jahresabschluss-setup.sql bereits in Supabase ausgeführt wurde."
      );
    } finally {
      setLoading(false);
    }
  }, [loadAllBookings, loadAllExpenses, supabase, year]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const annual = useMemo(() => {
    const annualBookings = bookings.filter((booking) =>
      dateInYear(effectiveBookingDate(booking), year)
    );
    const incomeRows = annualBookings.filter((booking) => booking.type === "income");
    const bookingExpenseRows = annualBookings.filter(
      (booking) => booking.type === "expense"
    );
    const paidExpenseRows = expenses.filter((expense) =>
      dateInYear(effectiveExpenseDate(expense), year)
    );

    const incomeTotal = incomeRows.reduce(
      (sum, booking) => sum + asNumber(booking.amount),
      0
    );
    const bookingExpenseTotal = bookingExpenseRows.reduce(
      (sum, booking) => sum + asNumber(booking.amount),
      0
    );
    const receiptExpenseTotal = paidExpenseRows.reduce(
      (sum, expense) => sum + asNumber(expense.total_amount),
      0
    );
    const depreciationRows = assets
      .filter((asset) => asset.purchase_date <= `${year}-12-31`)
      .map((asset) => ({
        asset,
        ...assetDepreciation(asset, year),
      }));
    const depreciationTotal = depreciationRows.reduce(
      (sum, asset) => sum + asset.annualAmount,
      0
    );
    const expenseTotal =
      bookingExpenseTotal + receiptExpenseTotal + depreciationTotal;

    const expenseGroups = new Map<string, number>();
    for (const expense of paidExpenseRows) {
      const category = expense.expense_category || "Sonstiges";
      expenseGroups.set(
        category,
        (expenseGroups.get(category) ?? 0) + asNumber(expense.total_amount)
      );
    }
    if (bookingExpenseTotal) {
      expenseGroups.set(
        "Weitere gebuchte Ausgaben",
        (expenseGroups.get("Weitere gebuchte Ausgaben") ?? 0) + bookingExpenseTotal
      );
    }
    if (depreciationTotal) {
      expenseGroups.set("AfA-Vorschau", depreciationTotal);
    }

    const fridgeTotals = new Map<string, number>();
    for (const row of fridgeStock) {
      fridgeTotals.set(
        row.product_id,
        (fridgeTotals.get(row.product_id) ?? 0) + asNumber(row.quantity)
      );
    }

    const inventoryRows: InventoryRow[] = products
      .map((product) => {
        const warehouseQuantity = asNumber(product.stock);
        const fridgeQuantity = fridgeTotals.get(product.id) ?? 0;
        return {
          productId: product.id,
          name: product.name,
          category: product.category,
          unit: product.unit,
          warehouseQuantity,
          fridgeQuantity,
          totalQuantity: warehouseQuantity + fridgeQuantity,
          sellingPrice: product.price == null ? null : asNumber(product.price),
        };
      })
      .filter((product) => product.totalQuantity !== 0 || products.find((row) => row.id === product.productId)?.is_active);

    const endOfYear = `${year}-12-31`;
    const openInvoices = bookings.filter(
      (booking) =>
        booking.type === "income" &&
        booking.booking_date <= endOfYear &&
        (booking.payment_status === "open" ||
          Boolean(booking.paid_at && booking.paid_at > endOfYear))
    );
    const openExpenses = expenses.filter((expense) => {
      const documentDate = expense.invoice_date || expense.created_at.slice(0, 10);
      return (
        documentDate <= endOfYear &&
        (expense.payment_status === "open" ||
          Boolean(expense.paid_at && expense.paid_at > endOfYear))
      );
    });
    const yearExpenses = expenses.filter((expense) =>
      dateInYear(expense.invoice_date || expense.created_at.slice(0, 10), year)
    );
    const missingAmounts = yearExpenses.filter(
      (expense) => expense.total_amount == null
    );
    const missingDates = yearExpenses.filter((expense) => !expense.invoice_date);

    return {
      annualBookings,
      incomeRows,
      bookingExpenseRows,
      paidExpenseRows,
      depreciationRows,
      depreciationTotal,
      incomeTotal,
      expenseTotal,
      profitTotal: incomeTotal - expenseTotal,
      expenseGroups: [...expenseGroups.entries()].sort((a, b) => b[1] - a[1]),
      inventoryRows,
      inventoryQuantity: inventoryRows.reduce(
        (sum, product) => sum + product.totalQuantity,
        0
      ),
      openInvoices,
      openExpenses,
      missingAmounts,
      missingDates,
    };
  }, [assets, bookings, expenses, fridgeStock, products, year]);

  async function markBookingPaid(booking: Booking) {
    const paidAt = paidDates[booking.id] || today;
    setBusy(true);
    const { error } = await supabase
      .from("bookings")
      .update({ payment_status: "paid", paid_at: paidAt })
      .eq("id", booking.id)
      .eq("user_id", userId);
    setBusy(false);

    if (error) setMessage(`Zahlung konnte nicht gespeichert werden: ${error.message}`);
    else {
      setMessage(`Rechnung ${booking.booking_number || ""} wurde als bezahlt markiert.`);
      await loadData();
    }
  }

  async function markExpensePaid(expense: Expense) {
    const paidAt = paidDates[expense.id] || today;
    setBusy(true);
    const { error } = await supabase
      .from("incoming_expenses")
      .update({ payment_status: "paid", paid_at: paidAt })
      .eq("id", expense.id)
      .eq("user_id", userId);
    setBusy(false);

    if (error) setMessage(`Zahlung konnte nicht gespeichert werden: ${error.message}`);
    else {
      setMessage(`Eingangsbeleg von ${expense.supplier || "Lieferant"} wurde als bezahlt markiert.`);
      await loadData();
    }
  }

  async function saveClosing() {
    if (!userId) return;
    if (annual.missingAmounts.length || annual.missingDates.length) {
      setMessage(
        "Der Jahresstand kann erst gespeichert werden, wenn alle Belege einen Betrag und ein Rechnungsdatum haben."
      );
      return;
    }

    const confirmed = window.confirm(
      `Jahresstand ${year} mit einem vorläufigen Ergebnis von ${euro.format(
        annual.profitTotal
      )} speichern? Vorherige Jahresstände dieses Jahres werden aktualisiert.`
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage("");
    const now = new Date().toISOString();
    const { error } = await supabase.from("annual_closings").upsert(
      {
        user_id: userId,
        fiscal_year: year,
        status: "closed",
        income_total: Math.round(annual.incomeTotal * 100) / 100,
        expense_total: Math.round(annual.expenseTotal * 100) / 100,
        profit_total: Math.round(annual.profitTotal * 100) / 100,
        booking_count: annual.annualBookings.length,
        expense_receipt_count: annual.paidExpenseRows.length,
        inventory_snapshot: annual.inventoryRows,
        assets_snapshot: annual.depreciationRows.map(
          ({ asset, annualAmount, accumulated, remaining }) => ({
            ...asset,
            annualAmount,
            accumulated,
            remaining,
          })
        ),
        closed_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,fiscal_year" }
    );
    setBusy(false);

    if (error) setMessage(`Jahresstand konnte nicht gespeichert werden: ${error.message}`);
    else {
      setMessage(
        `Jahresstand ${year} wurde gespeichert. Lade jetzt das Steuerberaterpaket herunter.`
      );
      await loadData();
    }
  }

  function annualReceiptDocuments(): ReceiptDocument[] {
    const incoming: ReceiptDocument[] = expenses
      .filter((expense) => expense.storage_path)
      .filter((expense) => dateInYear(expense.invoice_date || expense.created_at, year))
      .map((expense) => ({
        kind: "Eingangsbeleg",
        date: expense.invoice_date || expense.created_at.slice(0, 10),
        label: `${expense.supplier || "Lieferant"}${expense.invoice_number ? ` – ${expense.invoice_number}` : ""}`,
        path: expense.storage_path as string,
      }));

    const outgoing: ReceiptDocument[] = bookings
      .filter((booking) => booking.type === "income" && booking.source_document_path)
      .filter((booking) => dateInYear(booking.booking_date, year))
      .map((booking) => ({
        kind: "Ausgangsbeleg",
        date: booking.booking_date,
        label: `${booking.description || "Verkauf"}${booking.booking_number || booking.document_no ? ` – ${booking.booking_number || booking.document_no}` : ""}${booking.source_document_name ? ` (${booking.source_document_name})` : ""}`,
        path: booking.source_document_path as string,
      }));

    return [...incoming, ...outgoing].sort((a, b) =>
      a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind, "de")
    );
  }

  async function downloadPackage() {
    const summary = csvFile([
      ["Jahresabschluss", year],
      ["Betrieb", businessName],
      ["Erstellt am", new Date().toLocaleString("de-AT")],
      ["Bezahlte Betriebseinnahmen", decimal(annual.incomeTotal)],
      [
        "Bezahlte Betriebsausgaben ohne AfA",
        decimal(annual.expenseTotal - annual.depreciationTotal),
      ],
      ["AfA-Vorschau", decimal(annual.depreciationTotal)],
      ["Betriebsausgaben inklusive AfA-Vorschau", decimal(annual.expenseTotal)],
      ["Vorläufiger Gewinn/Verlust", decimal(annual.profitTotal)],
      ["Bezahlte Buchungen", annual.annualBookings.length],
      ["Eingangsbelege", annual.paidExpenseRows.length],
      ["Offene Kundenrechnungen", annual.openInvoices.length],
      ["Offene Lieferantenrechnungen", annual.openExpenses.length],
    ]);

    const bookingCsv = csvFile([
      [
        "Zahlungsdatum",
        "Art",
        "Zahlungsweg",
        "Belegnummer",
        "Beschreibung",
        "Kunde",
        "Betrag EUR",
      ],
      ...annual.annualBookings.map((booking) => [
        effectiveBookingDate(booking),
        booking.type === "income" ? "Einnahme" : "Ausgabe",
        booking.payment_method === "cash" ? "Bar" : "Bank",
        booking.booking_number || booking.document_no,
        booking.description,
        booking.customer_name,
        decimal(asNumber(booking.amount)),
      ]),
    ]);

    const expenseCsv = csvFile([
      [
        "Zahlungsdatum",
        "Rechnungsdatum",
        "Lieferant",
        "Rechnungsnummer",
        "Kategorie",
        "Zahlungsweg",
        "Betrag EUR",
      ],
      ...annual.paidExpenseRows.map((expense) => [
        effectiveExpenseDate(expense),
        expense.invoice_date,
        expense.supplier,
        expense.invoice_number,
        expense.expense_category,
        expense.payment_method === "cash" ? "Bar" : "Bank",
        decimal(asNumber(expense.total_amount)),
      ]),
    ]);

    const inventoryCsv = csvFile([
      [
        "Produkt",
        "Kategorie",
        "Einheit",
        "Lagerbestand",
        "Kühlschrankbestand",
        "Gesamtmenge",
        "Verkaufspreis EUR (nur Information)",
      ],
      ...annual.inventoryRows.map((product) => [
        product.name,
        product.category,
        product.unit,
        product.warehouseQuantity,
        product.fridgeQuantity,
        product.totalQuantity,
        product.sellingPrice == null ? "" : decimal(product.sellingPrice),
      ]),
    ]);

    const incomingGoodsCsv = csvFile([
      [
        "Zahlungsdatum",
        "Rechnungsdatum",
        "Lieferant",
        "Rechnungsnummer",
        "Betrag EUR",
      ],
      ...annual.paidExpenseRows
        .filter((expense) => expense.expense_category === "Wareneinkauf")
        .map((expense) => [
          effectiveExpenseDate(expense),
          expense.invoice_date,
          expense.supplier,
          expense.invoice_number,
          decimal(asNumber(expense.total_amount)),
        ]),
    ]);

    const assetsCsv = csvFile([
      [
        "Anlage",
        "Anschaffungsdatum",
        "Anschaffungskosten EUR",
        "Nutzungsdauer Jahre",
        "Privatanteil Prozent",
        `AfA-Vorschau ${year} EUR`,
        `Buchwert-Vorschau 31.12.${year} EUR`,
        "Notiz",
      ],
      ...annual.depreciationRows.map(({ asset, annualAmount, remaining }) => [
        asset.name,
        asset.purchase_date,
        decimal(asNumber(asset.purchase_cost)),
        asset.useful_life_years,
        decimal(asNumber(asset.private_share_percent)),
        decimal(annualAmount),
        decimal(remaining),
        asset.notes,
      ]),
    ]);

    const openItemsCsv = csvFile([
      [
        "Art",
        "Belegdatum",
        "Name",
        "Belegnummer",
        "Betrag EUR",
        "Status zum 31.12.",
        "Spaeter bezahlt am",
      ],
      ...annual.openInvoices.map((booking) => [
        "Offene Kundenrechnung",
        booking.booking_date,
        booking.customer_name,
        booking.booking_number || booking.document_no,
        decimal(asNumber(booking.amount)),
        "Offen",
        booking.payment_status === "paid" ? booking.paid_at : "",
      ]),
      ...annual.openExpenses.map((expense) => [
        "Offene Lieferantenrechnung",
        expense.invoice_date || expense.created_at.slice(0, 10),
        expense.supplier,
        expense.invoice_number,
        decimal(asNumber(expense.total_amount)),
        "Offen",
        expense.payment_status === "paid" ? expense.paid_at : "",
      ]),
    ]);

    const reportRows = annual.expenseGroups
      .map(
        ([category, total]) =>
          `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(euro.format(total))}</td></tr>`
      )
      .join("");
    const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Jahresabschluss ${year}</title>
<style>body{font-family:Arial,sans-serif;max-width:900px;margin:40px auto;color:#0f172a}h1{margin-bottom:4px}.muted{color:#64748b}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:left}th{background:#f1f5f9}.total{font-weight:bold}button{padding:10px 16px}@media print{button{display:none}}</style></head>
<body><button onclick="window.print()">Drucken / als PDF speichern</button>
<h1>Jahresübersicht ${year}</h1><p>${escapeHtml(businessName)}</p>
<p class="muted">Erstellt am ${escapeHtml(new Date().toLocaleString("de-AT"))}</p>
<table><tbody><tr><th>Bezahlte Betriebseinnahmen</th><td>${escapeHtml(euro.format(annual.incomeTotal))}</td></tr>
<tr><th>Bezahlte Betriebsausgaben ohne AfA</th><td>${escapeHtml(euro.format(annual.expenseTotal - annual.depreciationTotal))}</td></tr>
<tr><th>AfA-Vorschau</th><td>${escapeHtml(euro.format(annual.depreciationTotal))}</td></tr>
<tr><th>Betriebsausgaben inklusive AfA-Vorschau</th><td>${escapeHtml(euro.format(annual.expenseTotal))}</td></tr>
<tr class="total"><th>Vorläufiger Gewinn/Verlust</th><td>${escapeHtml(euro.format(annual.profitTotal))}</td></tr></tbody></table>
<h2>Ausgaben nach Kategorien</h2><table><thead><tr><th>Kategorie</th><th>Summe</th></tr></thead><tbody>${reportRows || "<tr><td colspan='2'>Keine Ausgaben</td></tr>"}</tbody></table>
<p class="muted">Diese Auswertung ist eine Arbeitsunterlage. Die lineare AfA ist nur eine Vorschau. Nutzungsdauer, Privatanteile, Sofortabschreibung, Gewinnfreibetrag und weitere steuerliche Korrekturen sind fachlich zu prüfen.</p>
</body></html>`;

    const notes = `STEUERBERATERPAKET ${year}\r\n\r\n` +
      `Betrieb: ${businessName}\r\n` +
      `Erstellt: ${new Date().toLocaleString("de-AT")}\r\n\r\n` +
      `Enthalten sind bezahlte Einnahmen und Ausgaben nach dem in der App gespeicherten Zahlungsdatum.\r\n` +
      `Offene Rechnungen sind getrennt aufgeführt und nicht im Ergebnis enthalten.\r\n` +
      `Alle hinterlegten Ein- und Ausgangsbelege des Jahres liegen zusätzlich im Ordner Belege.\r\n` +
      `Der Inventurbestand enthält Lager und Kühlschränke. Verkaufspreise sind nur Information und keine steuerliche Warenbewertung.\r\n` +
      `Die AfA ist eine lineare Vorschau mit Halbjahresregel. Nutzungsdauer, Sofortabschreibung und Privatanteil bitte mit dem Steuerberater prüfen.\r\n` +
      `Bitte auch Sozialversicherung, Gewinnfreibetrag und sonstige steuerliche Korrekturen prüfen.\r\n`;

    const receiptDocuments = annualReceiptDocuments();
    const receiptEntries: ZipEntry[] = [];
    const receiptIndexRows: Array<Array<string | number>> = [["Typ", "Datum", "Beleg", "Datei im ZIP"]];
    const missingReceipts: string[] = [];
    for (const [index, receipt] of receiptDocuments.entries()) {
      const { data, error } = await supabase.storage.from("incoming-invoices").download(receipt.path);
      if (error || !data) {
        missingReceipts.push(receipt.label);
        continue;
      }
      const arrayBuffer = await data.arrayBuffer();
      const archiveName = `Belege/${String(index + 1).padStart(3, "0")}-${receipt.kind === "Eingangsbeleg" ? "Ein" : "Aus"}-${safeFileName(receipt.label)}${fileExtension(receipt.path, data.type)}`;
      receiptEntries.push({
        name: archiveName,
        content: new Uint8Array(arrayBuffer),
      });
      receiptIndexRows.push([receipt.kind, receipt.date, receipt.label, archiveName]);
    }
    if (missingReceipts.length) {
      setMessage(`Das Steuerberaterpaket wurde nicht erstellt: ${missingReceipts.length} Beleg(e) konnten nicht geladen werden. Bitte Storage-Zugriff prüfen: ${missingReceipts.slice(0, 3).join(", ")}${missingReceipts.length > 3 ? " …" : ""}`);
      return;
    }
    const receiptIndex = csvFile(receiptIndexRows);

    const blob = makeZip([
      { name: `01-Zusammenfassung-${year}.csv`, content: summary },
      { name: `02-Buchungen-${year}.csv`, content: bookingCsv },
      { name: `03-Eingangsbelege-${year}.csv`, content: expenseCsv },
      { name: `04-Inventur-${year}.csv`, content: inventoryCsv },
      { name: `05-Offene-Posten-${year}.csv`, content: openItemsCsv },
      { name: `06-Wareneingangsbuch-${year}.csv`, content: incomingGoodsCsv },
      { name: `07-Anlagenverzeichnis-${year}.csv`, content: assetsCsv },
      { name: `08-Belegverzeichnis-${year}.csv`, content: receiptIndex },
      { name: `Jahresuebersicht-${year}.html`, content: html },
      { name: "HINWEISE.txt", content: notes },
      ...receiptEntries,
    ]);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Steuerberaterpaket-${year}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(`Steuerberaterpaket ${year} wurde heruntergeladen.`);
  }

  async function printAnnualPackage() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setMessage("Der Druck wurde vom Browser blockiert. Bitte Pop-ups für diese Seite erlauben und erneut auf „Jahresbericht + alle Belege drucken“ tippen.");
      return;
    }

    const receipts = annualReceiptDocuments();
    setBusy(true);
    setMessage(`Jahresbericht und ${receipts.length} Belege werden für den Druck vorbereitet …`);
    printWindow.document.open();
    printWindow.document.write("<!doctype html><html lang=de><meta charset=utf-8><title>Druck wird vorbereitet</title><body style='font:16px Arial;padding:32px'>Belege werden geladen und für den Druck vorbereitet …</body></html>");
    printWindow.document.close();

    try {
      const renderedReceipts: string[] = [];
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      for (const [index, receipt] of receipts.entries()) {
        setMessage(`Druck wird vorbereitet: Beleg ${index + 1} von ${receipts.length} …`);
        const { data, error } = await supabase.storage.from("incoming-invoices").download(receipt.path);
        if (error || !data) throw new Error(`${receipt.label}: ${error?.message || "Datei nicht gefunden"}`);

        const heading = `<h2>${escapeHtml(receipt.kind)} · ${escapeHtml(displayDate(receipt.date))}</h2><p>${escapeHtml(receipt.label)}</p>`;
        const isPdf = data.type === "application/pdf" || receipt.path.toLowerCase().endsWith(".pdf");
        if (isPdf) {
          const pdf = await pdfjs.getDocument({ data: new Uint8Array(await data.arrayBuffer()) }).promise;
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.6 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error(`${receipt.label}: PDF-Seite konnte nicht dargestellt werden.`);
            await page.render({ canvasContext: context, viewport, canvas } as never).promise;
            renderedReceipts.push(`<section class="receipt-page">${pageNumber === 1 ? heading : `<h2>${escapeHtml(receipt.kind)} · ${escapeHtml(displayDate(receipt.date))} (Seite ${pageNumber})</h2>`}<img src="${canvas.toDataURL("image/jpeg", 0.88)}" alt="${escapeHtml(receipt.label)}"></section>`);
          }
        } else {
          const dataUrl = await blobAsDataUrl(data);
          renderedReceipts.push(`<section class="receipt-page">${heading}<img src="${dataUrl}" alt="${escapeHtml(receipt.label)}"></section>`);
        }
      }

      const reportRows = annual.expenseGroups
        .map(([category, total]) => `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(euro.format(total))}</td></tr>`)
        .join("");
      const receiptIndexRows = receipts.length
        ? receipts.map((receipt) => `<tr><td>${escapeHtml(receipt.kind)}</td><td>${escapeHtml(displayDate(receipt.date))}</td><td>${escapeHtml(receipt.label)}</td></tr>`).join("")
        : "<tr><td colspan='3'>Für dieses Jahr sind keine Belegdateien hinterlegt.</td></tr>";
      const report = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Jahresabschluss ${year}</title><style>
        body{font-family:Arial,sans-serif;color:#0f172a;margin:0} .report{padding:24mm 18mm;page-break-after:always}.report-last{page-break-after:auto}h1{margin-bottom:4px}.muted{color:#64748b}table{border-collapse:collapse;width:100%;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#f1f5f9}.receipt-page{box-sizing:border-box;min-height:275mm;padding:14mm 12mm;page-break-after:always;break-after:page}.receipt-page:last-child{page-break-after:auto;break-after:auto}.receipt-page img{display:block;max-width:100%;max-height:235mm;margin:12mm auto 0;object-fit:contain}.receipt-page h2{font-size:16px;margin:0}.receipt-page p{margin:5px 0 0;color:#475569}@media print{.no-print{display:none}}@media screen{body{max-width:900px;margin:24px auto}.report,.receipt-page{border:1px solid #cbd5e1;margin-bottom:20px}}
        </style></head><body><section class="report${receipts.length ? "" : " report-last"}"><button class="no-print" onclick="window.print()">Drucken</button><h1>Jahresübersicht ${year}</h1><p>${escapeHtml(businessName)}</p><p class="muted">Erstellt am ${escapeHtml(new Date().toLocaleString("de-AT"))}</p><table><tbody><tr><th>Bezahlte Betriebseinnahmen</th><td>${escapeHtml(euro.format(annual.incomeTotal))}</td></tr><tr><th>Bezahlte Betriebsausgaben ohne AfA</th><td>${escapeHtml(euro.format(annual.expenseTotal - annual.depreciationTotal))}</td></tr><tr><th>AfA-Vorschau</th><td>${escapeHtml(euro.format(annual.depreciationTotal))}</td></tr><tr><th>Betriebsausgaben inklusive AfA-Vorschau</th><td>${escapeHtml(euro.format(annual.expenseTotal))}</td></tr><tr><th>Vorläufiger Gewinn/Verlust</th><td>${escapeHtml(euro.format(annual.profitTotal))}</td></tr></tbody></table><h2>Ausgaben nach Kategorien</h2><table><thead><tr><th>Kategorie</th><th>Summe</th></tr></thead><tbody>${reportRows || "<tr><td colspan='2'>Keine Ausgaben</td></tr>"}</tbody></table><h2>Belegverzeichnis (${receipts.length})</h2><table><thead><tr><th>Art</th><th>Datum</th><th>Beleg</th></tr></thead><tbody>${receiptIndexRows}</tbody></table></section>${renderedReceipts.join("")}</body></html>`;
      printWindow.document.open();
      printWindow.document.write(report);
      printWindow.document.close();
      await Promise.all(Array.from(printWindow.document.images).map((image) => image.decode().catch(() => undefined)));
      printWindow.focus();
      printWindow.print();
      setMessage(`Druckansicht bereit: Jahresbericht und ${receipts.length} Belege (${renderedReceipts.length} Seiten) sind enthalten.`);
    } catch (error) {
      printWindow.close();
      const errorMessage = error instanceof Error ? error.message : "Unbekannter Fehler";
      setMessage(`Druck wurde abgebrochen, damit keine Belege fehlen: ${errorMessage}`);
    } finally {
      setBusy(false);
    }
  }

  const years = Array.from({ length: 8 }, (_, index) => currentYear - index);
  const blockingIssueCount = annual.missingAmounts.length + annual.missingDates.length;

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-8 text-slate-700">
        Jahresabschluss wird geladen …
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-emerald-800 underline">
          ← Zurück zur Übersicht
        </Link>

        <header className="mb-8 mt-5">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">Jahresabschluss</h1>
          <p className="mt-2 text-slate-600">
            Einnahmen-Ausgaben-Rechnung prüfen, Inventur festhalten und Unterlagen exportieren.
          </p>
        </header>

        {message && (
          <div role="status" className="mb-5 rounded-xl border bg-white p-4">
            {message}
          </div>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <label className="block">
              <span className="mb-1 block font-medium">Abschlussjahr</span>
              <select
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3"
              >
                {years.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            {closing ? (
              <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Jahresstand gespeichert am {displayDate(closing.closed_at)}. Nach Änderungen bitte erneut speichern.
              </p>
            ) : (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Für {year} wurde noch kein Jahresstand gespeichert.
              </p>
            )}
          </div>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm text-slate-600">Bezahlte Einnahmen</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700">
              {euro.format(annual.incomeTotal)}
            </p>
          </article>
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm text-slate-600">Ausgaben inkl. AfA-Vorschau</p>
            <p className="mt-2 text-2xl font-bold text-red-700">
              {euro.format(annual.expenseTotal)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              davon AfA-Vorschau {euro.format(annual.depreciationTotal)}
            </p>
          </article>
          <article className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm">
            <p className="text-sm text-slate-300">Vorläufiger Gewinn/Verlust</p>
            <p className="mt-2 text-2xl font-bold">{euro.format(annual.profitTotal)}</p>
          </article>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-xl font-semibold">1. Daten prüfen</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <p className={`rounded-xl p-4 ${annual.missingAmounts.length ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}>
              {annual.missingAmounts.length
                ? `${annual.missingAmounts.length} Beleg(e) ohne Betrag`
                : "Alle Belege haben einen Betrag."}
            </p>
            <p className={`rounded-xl p-4 ${annual.missingDates.length ? "bg-red-50 text-red-900" : "bg-emerald-50 text-emerald-900"}`}>
              {annual.missingDates.length
                ? `${annual.missingDates.length} Beleg(e) ohne Rechnungsdatum`
                : "Alle Belege haben ein Rechnungsdatum."}
            </p>
            <p className="rounded-xl bg-amber-50 p-4 text-amber-900">
              {annual.openInvoices.length} zum Jahresende offene Kundenrechnung(en)
            </p>
            <p className="rounded-xl bg-amber-50 p-4 text-amber-900">
              {annual.openExpenses.length} zum Jahresende offene Lieferantenrechnung(en)
            </p>
          </div>
        </section>

        {(annual.openInvoices.length > 0 || annual.openExpenses.length > 0) && (
          <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-xl font-semibold">Zum Jahresende offene Rechnungen</h2>
            <p className="mt-2 text-sm text-slate-600">
              Erst nach dem tatsächlichen Zahlungseingang oder der Zahlung als bezahlt markieren.
              Später bezahlte Rechnungen bleiben hier für den ausgewählten Jahresstichtag sichtbar.
            </p>
            <div className="mt-4 space-y-3">
              {annual.openInvoices.map((booking) => (
                <article key={booking.id} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold">
                    Kundenrechnung {booking.booking_number || booking.document_no || "ohne Nummer"}
                  </p>
                  <p className="text-sm text-slate-600">
                    {displayDate(booking.booking_date)} · {booking.customer_name || booking.description} · {euro.format(asNumber(booking.amount))}
                  </p>
                  {booking.payment_status === "open" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        aria-label="Zahlungseingang"
                        type="date"
                        value={paidDates[booking.id] || today}
                        onChange={(event) =>
                          setPaidDates((current) => ({ ...current, [booking.id]: event.target.value }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void markBookingPaid(booking)}
                        className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        Zahlung eingegangen
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-medium text-emerald-800">
                      Nach dem Jahresstichtag bezahlt am {displayDate(booking.paid_at)}
                    </p>
                  )}
                </article>
              ))}
              {annual.openExpenses.map((expense) => (
                <article key={expense.id} className="rounded-xl border border-slate-200 p-4">
                  <p className="font-semibold">
                    Lieferantenrechnung {expense.invoice_number || "ohne Nummer"}
                  </p>
                  <p className="text-sm text-slate-600">
                    {displayDate(expense.invoice_date)} · {expense.supplier || "Lieferant"} · {euro.format(asNumber(expense.total_amount))}
                  </p>
                  {expense.payment_status === "open" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        aria-label="Zahlungsdatum"
                        type="date"
                        value={paidDates[expense.id] || today}
                        onChange={(event) =>
                          setPaidDates((current) => ({ ...current, [expense.id]: event.target.value }))
                        }
                        className="rounded-lg border border-slate-300 px-3 py-2"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void markExpensePaid(expense)}
                        className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
                      >
                        Als bezahlt markieren
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm font-medium text-emerald-800">
                      Nach dem Jahresstichtag bezahlt am {displayDate(expense.paid_at)}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-xl font-semibold">2. Ausgaben nach Kategorien</h2>
            {annual.expenseGroups.length ? (
              <ul className="mt-4 divide-y">
                {annual.expenseGroups.map(([category, total]) => (
                  <li key={category} className="flex justify-between gap-4 py-3">
                    <span>{category}</span>
                    <strong>{euro.format(total)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-slate-600">Keine bezahlten Ausgaben in diesem Jahr.</p>
            )}
          </article>

          <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
            <h2 className="text-xl font-semibold">3. Anlagenverzeichnis und AfA</h2>
            <p className="mt-2 text-sm text-slate-600">
              {annual.depreciationRows.length} Anlage(n) · AfA-Vorschau {year}: {euro.format(annual.depreciationTotal)}
            </p>
            {annual.depreciationRows.length ? (
              <ul className="mt-4 max-h-72 divide-y overflow-auto">
                {annual.depreciationRows.map(({ asset, annualAmount, remaining }) => (
                  <li key={asset.id} className="py-3">
                    <div className="flex justify-between gap-4">
                      <span className="font-medium">{asset.name}</span>
                      <strong>{euro.format(annualAmount)}</strong>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Anschaffung {displayDate(asset.purchase_date)} · Restbuchwert nach {year}: {euro.format(remaining)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-slate-600">Noch keine betrieblichen Anlagen erfasst.</p>
            )}
            <Link
              href="/anlagen"
              className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white"
            >
              Anlagen verwalten
            </Link>
          </article>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-xl font-semibold">4. Inventurstand</h2>
          <p className="mt-2 text-sm text-slate-600">
            Aktuell insgesamt {annual.inventoryQuantity} Einheiten in Lager und Kühlschränken.
          </p>
          <div className="mt-4 max-h-96 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b text-slate-500">
                  <th className="py-2 pr-3">Produkt</th>
                  <th className="py-2 pr-3 text-right">Lager</th>
                  <th className="py-2 pr-3 text-right">Kühlschrank</th>
                  <th className="py-2 text-right">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {annual.inventoryRows.map((product) => (
                  <tr key={product.productId} className="border-b last:border-0">
                    <td className="py-2 pr-3">{product.name}</td>
                    <td className="py-2 pr-3 text-right">{product.warehouseQuantity}</td>
                    <td className="py-2 pr-3 text-right">{product.fridgeQuantity}</td>
                    <td className="py-2 text-right font-semibold">{product.totalQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Die Verkaufspreise dienen nur zur Information und werden nicht als steuerlicher Einstandswert verwendet.
          </p>
        </section>

        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
          <h2 className="text-xl font-semibold">5. Jahresstand und Export</h2>
          <p className="mt-2 text-slate-600">
            Speichere zuerst den geprüften Jahresstand. Danach kannst du den Jahresbericht mit allen hinterlegten Ein- und Ausgangsbelegen in einem Druckdialog ausgeben oder das vollständige ZIP-Paket herunterladen.
          </p>
          {blockingIssueCount > 0 && (
            <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-900">
              Noch {blockingIssueCount} unvollständige Angabe(n). Der Jahresstand kann deshalb noch nicht gespeichert werden.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={busy || blockingIssueCount > 0}
              onClick={() => void saveClosing()}
              className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {closing ? "Jahresstand aktualisieren" : "Jahresstand speichern"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void printAnnualPackage()}
              className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              Jahresbericht + alle Belege drucken
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadPackage()}
              className="rounded-xl border border-emerald-700 px-5 py-3 font-semibold text-emerald-800 disabled:opacity-50"
            >
              Steuerberaterpaket als ZIP herunterladen
            </button>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Vorläufige Auswertung: Die AfA ist eine lineare Vorschau. Nutzungsdauer, Sofortabschreibung,
            Privatanteile, Gewinnfreibetrag und weitere steuerliche Korrekturen bitte mit der Steuerberatung prüfen.
          </p>
        </section>
      </div>
    </main>
  );
}

