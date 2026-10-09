"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();
const euro = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });

type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  price: number | string | null;
  barcode: string | null;
  stock: number | string;
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

type Mode = "load" | "sale" | "group_sale" | "private";

type GroupTrip = {
  id: string;
  fridge_id: string;
  customer_name: string;
  payment_method: "cash" | "bank";
  customer_street: string | null;
  customer_postal_code: string | null;
  customer_city: string | null;
  opened_at: string;
};

type TripWithdrawal = {
  id: string;
  trip_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number | string;
  unit_price: number | string;
};

type EditableTripLine = {
  key: string;
  productId: string | null;
  productName: string;
  quantity: string;
  unitPrice: string;
};

type PhotoRecommendation = {
  productId: string;
  productName: string;
  quantity: number;
  confidence: number;
};

export default function KuehlschraenkePage() {
  const [userId, setUserId] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [fridges, setFridges] = useState<Fridge[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [groupTrips, setGroupTrips] = useState<GroupTrip[]>([]);
  const [tripWithdrawals, setTripWithdrawals] = useState<TripWithdrawal[]>([]);
  const [fridgeId, setFridgeId] = useState("");
  const [mode, setMode] = useState<Mode>("load");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [newTripName, setNewTripName] = useState("");
  const [tripStreet, setTripStreet] = useState("");
  const [tripPostalCode, setTripPostalCode] = useState("");
  const [tripCity, setTripCity] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [customerName, setCustomerName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank">("cash");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingTrip, setEditingTrip] = useState(false);
  const [editTripName, setEditTripName] = useState("");
  const [editTripPaymentMethod, setEditTripPaymentMethod] = useState<"cash" | "bank">("cash");
  const [editTripStreet, setEditTripStreet] = useState("");
  const [editTripPostalCode, setEditTripPostalCode] = useState("");
  const [editTripCity, setEditTripCity] = useState("");
  const [editTripLines, setEditTripLines] = useState<EditableTripLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [stockPhoto, setStockPhoto] = useState<string | null>(null);
  const [stockPhotoFile, setStockPhotoFile] = useState<File | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRecommendations, setPhotoRecommendations] = useState<PhotoRecommendation[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastScanRef = useRef({ code: "", time: 0 });

  const selectedTrip = groupTrips.find((trip) => trip.id === selectedTripId) ?? null;
  const selectedTripItems = tripWithdrawals.filter((row) => row.trip_id === selectedTripId);
  const selectedTripTotal = selectedTripItems.reduce(
    (sum, row) => sum + Number(row.quantity) * Number(row.unit_price),
    0
  );
  const groupedTripLines = [...selectedTripItems.reduce((map, row) => {
    const key = row.product_id || row.product_name;
    const current = map.get(key) ?? {
      key,
      productId: row.product_id,
      productName: row.product_name,
      quantity: 0,
      total: 0,
    };
    current.quantity += Number(row.quantity);
    current.total += Number(row.quantity) * Number(row.unit_price);
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; productId: string | null; productName: string; quantity: number; total: number }>()).values()]
    .map((line) => ({ ...line, unitPrice: line.quantity > 0 ? line.total / line.quantity : 0 }));

  async function loadData(id: string) {
    const [productResult, fridgeResult] = await Promise.all([
      supabase.from("products")
        .select("id,name,category,unit,price,barcode,stock")
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
    const standardNames = ["Kühlschrank 1", "Kühlschrank 2", "Kühlschrank 3", "Kaffee"];
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
    return activeFridge;
  }

  async function loadGroupTrips(id: string) {
    const { data, error } = await supabase.from("group_sales_trips")
      .select("id,fridge_id,customer_name,payment_method,customer_street,customer_postal_code,customer_city,opened_at")
      .eq("user_id", id)
      .eq("status", "open")
      .order("opened_at", { ascending: false });
    if (error) throw error;

    const trips = (data ?? []) as GroupTrip[];
    setGroupTrips(trips);
    setSelectedTripId((current) =>
      trips.some((trip) => trip.id === current) ? current : trips[0]?.id ?? ""
    );

    const ids = trips.map((trip) => trip.id);
    if (!ids.length) {
      setTripWithdrawals([]);
      return;
    }
    const { data: withdrawals, error: withdrawalError } = await supabase
      .from("group_sales_withdrawals")
      .select("id,trip_id,product_id,product_name,quantity,unit_price")
      .eq("user_id", id)
      .in("trip_id", ids)
      .order("withdrawn_at", { ascending: true });
    if (withdrawalError) throw withdrawalError;
    setTripWithdrawals((withdrawals ?? []) as TripWithdrawal[]);
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
        await loadGroupTrips(data.user.id);
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
    setPhotoRecommendations([]);
    if (!userId) return;

    const { data, error } = await supabase.from("fridge_stock")
      .select("fridge_id,product_id,quantity")
      .eq("user_id", userId)
      .eq("fridge_id", id);

    if (error) setMessage(error.message);
    else {
      setStock((data ?? []) as StockRow[]);
      try {
        await loadGroupTrips(userId);
      } catch (tripError) {
        setMessage(tripError instanceof Error ? tripError.message : "Gruppenfahrten konnten nicht geladen werden.");
      }
    }
  }

  async function createGroupTrip() {
    if (!userId || !fridgeId) return;
    if (!newTripName.trim()) {
      setMessage("Bitte den Namen der Gruppe oder Fahrt eintragen.");
      return;
    }
    if (paymentMethod === "bank" && (!tripStreet.trim() || !tripPostalCode.trim() || !tripCity.trim())) {
      setMessage("Für eine spätere Rechnung bitte Straße, Postleitzahl und Ort ergänzen.");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.from("group_sales_trips")
      .insert({
        user_id: userId,
        fridge_id: fridgeId,
        customer_name: newTripName.trim(),
        payment_method: paymentMethod,
        customer_street: paymentMethod === "bank" ? tripStreet.trim() : null,
        customer_postal_code: paymentMethod === "bank" ? tripPostalCode.trim() : null,
        customer_city: paymentMethod === "bank" ? tripCity.trim() : null,
      })
      .select("id")
      .single();
    setBusy(false);

    if (error || !data) {
      setMessage(`Gruppenfahrt konnte nicht angelegt werden: ${error?.message ?? "Unbekannter Fehler"}`);
      return;
    }
    setNewTripName("");
    setTripStreet("");
    setTripPostalCode("");
    setTripCity("");
    setSelectedTripId(data.id);
    setMode("group_sale");
    setMessage("Gruppenfahrt angelegt. Du kannst dieselbe Fahrt bei allen Kühlschränken auswählen.");
    await loadGroupTrips(userId);
    setSelectedTripId(data.id);
  }

  function oldQuantity(productId: string) {
    const row = stock.find((item) => item.product_id === productId);
    return Number(row?.quantity ?? 0);
  }

  function currentQuantity(productId: string) {
    return Number(counted[productId] ?? 0);
  }

  const isCoffeeLocation = fridges.find((fridge) => fridge.id === fridgeId)?.name === "Kaffee";
  const visibleProducts = products.filter((product) => {
    if (isCoffeeLocation) {
      const isCoffeeItem = product.category === "Heißgetränk" || product.unit === "Tasse" ||
        /kaffee|becher/i.test(product.name);
      return isCoffeeItem;
    }
    return Number(product.stock) > 0 || oldQuantity(product.id) > 0;
  });

  async function handleStockPhoto(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Bitte ein Bild auswählen.");
      return;
    }

    try {
      const sourceUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = sourceUrl;
      await image.decode();
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Bild konnte nicht vorbereitet werden.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(sourceUrl);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!blob) throw new Error("Bild konnte nicht verkleinert werden.");
      const resized = new File([blob], "kuehlschrankfoto.jpg", { type: "image/jpeg" });
      setStockPhoto((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(resized);
      });
      setStockPhotoFile(resized);
      setPhotoRecommendations([]);
      setMessage("Foto bereit. Tippe auf „Foto automatisch zählen“, um einen KI-Zählvorschlag zu erstellen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Foto konnte nicht verarbeitet werden.");
    }
  }

  async function countStockPhoto() {
    if (!stockPhotoFile || photoBusy) return;
    setPhotoBusy(true);
    setMessage("Das Foto wird analysiert …");

    try {
      const formData = new FormData();
      formData.set("image", stockPhotoFile);
      formData.set("productIds", JSON.stringify(visibleProducts.map((product) => product.id)));
      const response = await fetch("/api/stock-photo-count", { method: "POST", body: formData });
      const result = await response.json() as { items?: PhotoRecommendation[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Foto konnte nicht gezählt werden.");

      const items = result.items ?? [];
      setPhotoRecommendations(items);
      setCounted((current) => ({
        ...current,
        ...Object.fromEntries(items
          .filter((item) => item.confidence >= 0.35)
          .map((item) => [item.productId, String(item.quantity)])),
      }));
      setMessage(items.length
        ? "Zählvorschlag erstellt. Bitte alle Mengen unten mit dem Foto abgleichen; unsichere Erkennungen bleiben leer."
        : "Auf dem Foto wurde kein Produkt sicher erkannt. Bitte zähle die Mengen manuell.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fotoanalyse fehlgeschlagen.");
    } finally {
      setPhotoBusy(false);
    }
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

  const startScanner = useCallback(async () => {
    const video = videoRef.current;
    if (!video || controlsRef.current) return;

    const reader = new BrowserMultiFormatReader();
    setMessage("Kamera wird gestartet …");

    try {
      const controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        video,
        (result) => {
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
        }
      );

      controlsRef.current = controls;
      setMessage("Scanne die Artikel, die jetzt noch im Kühlschrank sind.");
    } catch (error) {
      setMessage(error instanceof Error ? `Kamera konnte nicht starten: ${error.message}` : "Kamera konnte nicht starten.");
    }
  }, [products]);

  useEffect(() => {
    if (!scannerOpen) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) void startScanner();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [scannerOpen, startScanner]);

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

    const consumed = changes.filter((item) => item.difference > 0);
    const sold = consumed.filter((item) => Number(item.product.price) > 0);
    const total = Math.round(
      sold.reduce((sum, item) => sum + item.difference * Number(item.product.price), 0) * 100
    ) / 100;

    if (mode === "group_sale" && !selectedTrip) {
      setMessage("Bitte zuerst eine offene Gruppenfahrt auswählen oder anlegen.");
      setBusy(false);
      return;
    }

    if (mode === "group_sale" && consumed.length === 0) {
      setMessage("Es wurde keine Entnahme erkannt. Prüfe den gezählten Restbestand.");
      setBusy(false);
      return;
    }

    if (mode === "group_sale") {
      const notCounted = products.filter(
        (product) => oldQuantity(product.id) > 0 && counted[product.id] === undefined
      );
      if (notCounted.length > 0) {
        setMessage(
          `Bitte prüfe auch: ${notCounted.slice(0, 4).map((product) => product.name).join(", ")}${notCounted.length > 4 ? " …" : ""}. Für ausverkaufte Getränke trage 0 ein.`
        );
        setBusy(false);
        return;
      }
    }

    if (mode === "group_sale" && consumed.some((item) => Number(item.product.price) <= 0)) {
      setMessage("Mindestens ein entnommenes Getränk hat noch keinen Verkaufspreis im Produktkatalog.");
      setBusy(false);
      return;
    }

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
      const bookingDate = new Date().toISOString().slice(0, 10);

      const { data: booking, error } = await supabase.from("bookings")
        .insert({
          user_id: userId,
          booking_date: bookingDate,
          type: "income",
          payment_method: paymentMethod,
          payment_status: paymentMethod === "cash" ? "paid" : "open",
          paid_at: paymentMethod === "cash" ? bookingDate : null,
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

    let withdrawalIds: string[] = [];
    if (mode === "group_sale" && selectedTrip) {
      const { data: withdrawals, error: withdrawalError } = await supabase
        .from("group_sales_withdrawals")
        .insert(consumed.map((item) => ({
          user_id: userId,
          trip_id: selectedTrip.id,
          fridge_id: fridgeId,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: item.difference,
          unit_price: Number(item.product.price),
        })))
        .select("id");

      if (withdrawalError) {
        await supabase.from("fridge_stock").upsert(
          products.map((product) => ({
            user_id: userId,
            fridge_id: fridgeId,
            product_id: product.id,
            quantity: oldQuantity(product.id),
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "fridge_id,product_id" }
        );
        setMessage(`Entnahme konnte nicht zur Gruppenfahrt gespeichert werden: ${withdrawalError.message}`);
        setBusy(false);
        return;
      }
      withdrawalIds = (withdrawals ?? []).map((row) => row.id);
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
        } else if ((mode === "sale" || mode === "group_sale") && item.difference > 0) {
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
          group_trip_id: mode === "group_sale" && item.difference > 0 ? selectedTripId : null,
          movement_type: movementType,
          quantity_delta: delta,
        };
      });

    if (movements.length) {
      const { error: movementError } = await supabase.from("fridge_stock_movements").insert(movements);
      if (movementError) {
        if (withdrawalIds.length) {
          await supabase.from("group_sales_withdrawals").delete().in("id", withdrawalIds);
          await supabase.from("fridge_stock").upsert(
            products.map((product) => ({
              user_id: userId,
              fridge_id: fridgeId,
              product_id: product.id,
              quantity: oldQuantity(product.id),
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "fridge_id,product_id" }
          );
        }
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
    } else if (mode === "group_sale") {
      await loadGroupTrips(userId);
      const addedAmount = consumed.reduce(
        (sum, item) => sum + item.difference * Number(item.product.price),
        0
      );
      setMessage(`${consumed.length} Getränkesorte(n), ${euro.format(addedAmount)} zur Gruppenfahrt „${selectedTrip?.customer_name}“ addiert. Jetzt kannst du den Kühlschrank auffüllen.`);
    } else {
      setMessage(`Verkauf gespeichert. Belegnummer: ${bookingNumber}. Gesamt: ${euro.format(total)}.`);
    }

    setBusy(false);
  }

  function beginEditTrip() {
    if (!selectedTrip) return;
    setEditTripName(selectedTrip.customer_name);
    setEditTripPaymentMethod(selectedTrip.payment_method);
    setEditTripStreet(selectedTrip.customer_street ?? "");
    setEditTripPostalCode(selectedTrip.customer_postal_code ?? "");
    setEditTripCity(selectedTrip.customer_city ?? "");
    setEditTripLines(groupedTripLines.map((line) => ({
      key: line.key,
      productId: line.productId,
      productName: line.productName,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
    })));
    setEditingTrip(true);
    setMessage("");
  }

  function changeEditTripLine(key: string, changes: Partial<EditableTripLine>) {
    setEditTripLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  }

  async function saveGroupTripEdits() {
    if (!userId || !selectedTrip) return;
    if (!editTripName.trim()) {
      setMessage("Bitte einen Gruppennamen eintragen.");
      return;
    }
    if (editTripPaymentMethod === "bank" && (!editTripStreet.trim() || !editTripPostalCode.trim() || !editTripCity.trim())) {
      setMessage("Für die Rechnung bitte Straße, Postleitzahl und Ort ergänzen.");
      return;
    }

    const parsedLines = editTripLines.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice.replace(",", ".")),
    }));
    if (parsedLines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0)) {
      setMessage("Bitte nur ganze Mengen ab 0 und gültige Preise ab 0 eingeben.");
      return;
    }

    setBusy(true);
    setMessage("");
    const originalRows = tripWithdrawals.filter((row) => row.trip_id === selectedTrip.id);

    for (const line of parsedLines) {
      const matchingRows = originalRows.filter((row) => (row.product_id || row.product_name) === line.key);
      if (!matchingRows.length) continue;

      const quantities = matchingRows.map((row) => Number(row.quantity));
      const oldTotal = quantities.reduce((sum, quantity) => sum + quantity, 0);
      if (line.quantity > oldTotal) quantities[quantities.length - 1] += line.quantity - oldTotal;
      if (line.quantity < oldTotal) {
        let toRemove = oldTotal - line.quantity;
        for (let index = quantities.length - 1; index >= 0 && toRemove > 0; index--) {
          const removed = Math.min(quantities[index], toRemove);
          quantities[index] -= removed;
          toRemove -= removed;
        }
      }

      for (let index = 0; index < matchingRows.length; index++) {
        const row = matchingRows[index];
        const nextQuantity = quantities[index];
        const result = nextQuantity === 0
          ? await supabase.from("group_sales_withdrawals").delete().eq("id", row.id).eq("user_id", userId)
          : await supabase.from("group_sales_withdrawals").update({
              quantity: nextQuantity,
              unit_price: Math.round(line.unitPrice * 100) / 100,
            }).eq("id", row.id).eq("user_id", userId);
        if (result.error) {
          setBusy(false);
          setMessage(`Getränkemenge konnte nicht vollständig geändert werden: ${result.error.message}`);
          await loadGroupTrips(userId);
          return;
        }
      }
    }

    const { error } = await supabase.from("group_sales_trips").update({
      customer_name: editTripName.trim(),
      payment_method: editTripPaymentMethod,
      customer_street: editTripPaymentMethod === "bank" ? editTripStreet.trim() : null,
      customer_postal_code: editTripPaymentMethod === "bank" ? editTripPostalCode.trim() : null,
      customer_city: editTripPaymentMethod === "bank" ? editTripCity.trim() : null,
    }).eq("id", selectedTrip.id).eq("user_id", userId).eq("status", "open");

    if (error) {
      setBusy(false);
      setMessage(`Gruppenfahrt konnte nicht gespeichert werden: ${error.message}`);
      await loadGroupTrips(userId);
      return;
    }

    setEditingTrip(false);
    await loadGroupTrips(userId);
    setBusy(false);
    setMessage("Gruppenabrechnung aktualisiert. Die Änderungen gelten für den gemeinsamen Beleg.");
  }

  async function finishGroupTrip() {
    if (!userId || !selectedTrip) return;
    const rows = tripWithdrawals.filter((row) => row.trip_id === selectedTrip.id);
    if (!rows.length) {
      setMessage("Für diese Gruppenfahrt wurden noch keine Getränke erfasst.");
      return;
    }
    if (!window.confirm(`Gruppenfahrt „${selectedTrip.customer_name}“ mit ${euro.format(selectedTripTotal)} abschließen und einen gemeinsamen Beleg erstellen?`)) return;

    setBusy(true);
    setMessage("");
    const grouped = new Map<string, { productId: string | null; name: string; quantity: number; price: number }>();
    for (const row of rows) {
      const key = row.product_id || row.product_name;
      const item = grouped.get(key) ?? {
        productId: row.product_id,
        name: row.product_name,
        quantity: 0,
        price: Number(row.unit_price),
      };
      item.quantity += Number(row.quantity);
      grouped.set(key, item);
    }
    const items = [...grouped.values()];
    const total = Math.round(items.reduce((sum, item) => sum + item.quantity * item.price, 0) * 100) / 100;
    const bookingDate = new Date().toISOString().slice(0, 10);
    const description = items.map((item) => `${item.name} × ${item.quantity}`).join(", ");
    const { data: booking, error: bookingError } = await supabase.from("bookings")
      .insert({
        user_id: userId,
        booking_date: bookingDate,
        type: "income",
        payment_method: selectedTrip.payment_method,
        payment_status: selectedTrip.payment_method === "cash" ? "paid" : "open",
        paid_at: selectedTrip.payment_method === "cash" ? bookingDate : null,
        description: `Gruppenfahrt ${selectedTrip.customer_name}: ${description}`,
        amount: total,
        customer_name: selectedTrip.customer_name,
        customer_street: selectedTrip.customer_street,
        customer_postal_code: selectedTrip.customer_postal_code,
        customer_city: selectedTrip.customer_city,
      })
      .select("id,booking_number")
      .single();

    if (bookingError || !booking) {
      setBusy(false);
      setMessage(`Gemeinsamer Beleg konnte nicht erstellt werden: ${bookingError?.message ?? "Unbekannter Fehler"}`);
      return;
    }

    const { error: itemsError } = await supabase.from("booking_items").insert(
      items.map((item) => ({
        booking_id: booking.id,
        product_id: item.productId,
        product_name: item.name,
        quantity: item.quantity,
        unit_price: item.price,
        line_total: Math.round(item.quantity * item.price * 100) / 100,
      }))
    );

    if (itemsError) {
      await supabase.from("bookings").delete().eq("id", booking.id).eq("user_id", userId);
      setBusy(false);
      setMessage(`Getränke konnten nicht in den Beleg übernommen werden: ${itemsError.message}`);
      return;
    }

    const { error: closeError } = await supabase.from("group_sales_trips")
      .update({ status: "closed", booking_id: booking.id, closed_at: new Date().toISOString() })
      .eq("id", selectedTrip.id)
      .eq("user_id", userId)
      .eq("status", "open");

    if (closeError) {
      await supabase.from("booking_items").delete().eq("booking_id", booking.id);
      await supabase.from("bookings").delete().eq("id", booking.id).eq("user_id", userId);
      setBusy(false);
      setMessage(`Gruppenfahrt konnte nicht abgeschlossen werden: ${closeError.message}`);
      return;
    }

    const finishedName = selectedTrip.customer_name;
    setSelectedTripId("");
    setMode("load");
    await loadGroupTrips(userId);
    setBusy(false);
    setMessage(`Gruppenfahrt „${finishedName}“ abgeschlossen. Beleg ${booking.booking_number}: ${euro.format(total)}.`);
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <Link href="/verkauf" className="text-emerald-800 underline">← Zurück zum Verkauf</Link>
        <h1 className="mt-5 text-3xl font-bold">Kühlschrankbestand</h1>
        <p className="mt-2 text-slate-600">
          Bestand zählen, Gruppenentnahmen über mehrere Tage sammeln und am Ende gemeinsam abrechnen.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-4">
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

        <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Mehrtagestour: Gruppenabrechnung</h2>
          <p className="mt-2 text-sm text-slate-700">
            Bei jedem Kühlschrank den Restbestand zählen und dabei dieselbe Gruppenfahrt auswählen.
            Alle Entnahmen aus allen Kühlschränken und Fahrtagen werden gesammelt und am Ende gemeinsam abgerechnet.
          </p>

          {groupTrips.length > 0 && (
            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="block">
                <span className="mb-2 block font-medium">Offene Gruppenfahrt für alle Kühlschränke</span>
                <select
                  value={selectedTripId}
                  onChange={(event) => {
                    setSelectedTripId(event.target.value);
                    setEditingTrip(false);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3"
                >
                  {groupTrips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.customer_name} · gestartet bei {fridges.find((fridge) => fridge.id === trip.fridge_id)?.name ?? "Kühlschrank"} · {trip.payment_method === "cash" ? "Bar" : "Rechnung"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !selectedTripItems.length}
                onClick={() => void finishGroupTrip()}
                className="rounded-lg bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
              >
                Fahrt abschließen · {euro.format(selectedTripTotal)}
              </button>
            </div>
          )}

          {selectedTrip && (
            <div className="mt-4 rounded-lg bg-white p-4">
              <p className="font-semibold">{selectedTrip.customer_name}</p>
              {selectedTrip.fridge_id !== fridgeId && (
                <p className="mt-1 text-sm text-emerald-800">
                  Diese Gruppenfahrt wurde bei einem anderen Kühlschrank gestartet. Die Entnahmen aus {fridges.find((fridge) => fridge.id === fridgeId)?.name ?? "dem aktuellen Kühlschrank"} werden trotzdem zu derselben Fahrt addiert.
                </p>
              )}
              <p className="text-sm text-slate-600">
                {selectedTripItems.reduce((sum, row) => sum + Number(row.quantity), 0)} Getränke erfasst · Zwischensumme {euro.format(selectedTripTotal)}
              </p>
              {groupedTripLines.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {groupedTripLines.map((item) => (
                    <li key={item.key} className="flex justify-between gap-3">
                      <span>{item.productName} × {item.quantity}</span>
                      <span>{euro.format(item.quantity * item.unitPrice)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" disabled={busy} onClick={beginEditTrip}
                className="mt-3 rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-900 disabled:opacity-50">
                Gruppenabrechnung bearbeiten
              </button>
            </div>
          )}

          {editingTrip && selectedTrip && (
            <div className="mt-4 space-y-4 rounded-lg border border-emerald-300 bg-white p-4">
              <h3 className="font-semibold">Offene Gruppenabrechnung bearbeiten</h3>
              <p className="text-sm text-slate-600">Die Änderungen gelten für den gemeinsamen Beleg. Der bereits gespeicherte Kühlschrankbestand bleibt unverändert.</p>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Gruppe / Kunde</span>
                <input value={editTripName} onChange={(event) => setEditTripName(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Abrechnung</span>
                <select value={editTripPaymentMethod} onChange={(event) => setEditTripPaymentMethod(event.target.value as "cash" | "bank")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="cash">Barzahlung am Ende</option>
                  <option value="bank">Rechnung am Ende</option>
                </select>
              </label>
              {editTripPaymentMethod === "bank" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label><span className="mb-1 block text-sm">Straße</span>
                    <input value={editTripStreet} onChange={(event) => setEditTripStreet(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label><span className="mb-1 block text-sm">Postleitzahl</span>
                    <input value={editTripPostalCode} onChange={(event) => setEditTripPostalCode(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label><span className="mb-1 block text-sm">Ort</span>
                    <input value={editTripCity} onChange={(event) => setEditTripCity(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                </div>
              )}
              <div className="space-y-3">
                <h4 className="font-medium">Getränke und Preise</h4>
                {editTripLines.map((line) => (
                  <div key={line.key} className="grid items-end gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_140px_160px]">
                    <strong>{line.productName}</strong>
                    <label className="text-sm"><span className="mb-1 block">Menge</span>
                      <input type="number" min="0" step="1" inputMode="numeric" value={line.quantity}
                        onChange={(event) => changeEditTripLine(line.key, { quantity: event.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm"><span className="mb-1 block">Einzelpreis (€)</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={line.unitPrice}
                        onChange={(event) => changeEditTripLine(line.key, { unitPrice: event.target.value })}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" disabled={busy} onClick={() => void saveGroupTripEdits()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {busy ? "Speichert …" : "Änderungen speichern"}
                </button>
                <button type="button" disabled={busy} onClick={() => setEditingTrip(false)}
                  className="rounded-lg border border-slate-400 px-4 py-2 disabled:opacity-50">Abbrechen</button>
              </div>
            </div>
          )}

          <details className="mt-4 rounded-lg bg-white p-4">
            <summary className="cursor-pointer font-semibold">Neue Gruppenfahrt anlegen</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1 block">Gruppe / Kunde</span>
                <input value={newTripName} onChange={(event) => setNewTripName(event.target.value)}
                  placeholder="z. B. Reisegruppe Salzburg"
                  className="w-full rounded-lg border border-slate-300 px-3 py-3" />
              </label>
              <label>
                <span className="mb-1 block">Abrechnung</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "cash" | "bank")}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3">
                  <option value="cash">Barzahlung am Ende</option>
                  <option value="bank">Rechnung am Ende</option>
                </select>
              </label>
              {paymentMethod === "bank" && (
                <>
                  <label><span className="mb-1 block">Straße</span>
                    <input value={tripStreet} onChange={(event) => setTripStreet(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                  <label><span className="mb-1 block">Postleitzahl</span>
                    <input value={tripPostalCode} onChange={(event) => setTripPostalCode(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                  <label><span className="mb-1 block">Ort</span>
                    <input value={tripCity} onChange={(event) => setTripCity(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-3" /></label>
                </>
              )}
              <button type="button" disabled={busy} onClick={() => void createGroupTrip()}
                className="self-end rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-50">
                Gruppenfahrt starten
              </button>
            </div>
          </details>
        </section>

        <section className="mt-5 rounded-xl bg-white p-5 shadow-sm">
          {isCoffeeLocation && (
            <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
              Kaffee-Becher zählen: Hier erscheinen Katalogartikel der Kategorie „Heißgetränk“, Produkte mit der Einheit „Tasse“ sowie Artikel mit „Kaffee“ oder „Becher“ im Namen.
            </p>
          )}
          <label className="block">
            <span className="mb-2 block font-medium">Vorgang</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as Mode)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3">
              <option value="load">Bestand einräumen oder zählen</option>
              <option value="sale">Kundenentnahme abrechnen</option>
              <option value="group_sale">Entnahme zur Gruppenfahrt addieren</option>
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

          {mode === "group_sale" && (
            <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
              {selectedTrip
                ? `Entnahmen werden zur offenen Fahrt „${selectedTrip.customer_name}“ addiert und noch nicht einzeln verrechnet.`
                : "Bitte oben eine Gruppenfahrt starten oder auswählen."}
            </p>
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
            <label className="cursor-pointer rounded-lg border border-emerald-700 bg-white px-4 py-3 font-semibold text-emerald-900">
              Kühlschrank fotografieren
              <input type="file" accept="image/*" capture="environment" className="sr-only"
                onChange={(event) => {
                  void handleStockPhoto(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }} />
            </label>
          </div>

          {stockPhoto && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 font-semibold">Fotozählung prüfen</p>
              <p className="mb-3 text-sm text-slate-700">Das Foto wird zur Analyse an OpenAI übertragen. Die Erkennung ist ein Vorschlag: Bitte die Mengen kontrollieren, bevor du speicherst. Das Foto wird nicht in der Datenbank gespeichert.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={stockPhoto} alt="Aufgenommenes Kühlschrankfoto" className="max-h-96 rounded-lg object-contain" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={photoBusy || !stockPhotoFile} onClick={() => void countStockPhoto()}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50">
                  {photoBusy ? "Foto wird analysiert …" : "Foto automatisch zählen"}
                </button>
                <button type="button" disabled={photoBusy} onClick={() => {
                  if (stockPhoto) URL.revokeObjectURL(stockPhoto);
                  setStockPhoto(null);
                  setStockPhotoFile(null);
                  setPhotoRecommendations([]);
                }} className="rounded-lg border px-3 py-2 disabled:opacity-50">Foto entfernen</button>
              </div>
              {photoRecommendations.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-slate-700">
                  {photoRecommendations.map((item) => (
                    <li key={item.productId}>{item.productName}: Vorschlag {item.quantity} · Sicherheit {Math.round(item.confidence * 100)}%</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {scannerOpen && (
            <div className="mt-4 space-y-3">
              <video ref={videoRef} autoPlay playsInline className="w-full max-w-md rounded-xl bg-black" />
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => {
                  controlsRef.current?.stop();
                  controlsRef.current = null;
                  void startScanner();
                }}
                  className="rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-800">
                  Kamera neu starten
                </button>
                <button type="button" onClick={stopScanner}
                  className="rounded-lg border border-slate-400 px-4 py-2">
                  Kamera schließen
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 space-y-3">
            {visibleProducts.map((product) => {
              const before = oldQuantity(product.id);
              const after = currentQuantity(product.id);
              const removed = Math.max(0, before - after);
              return (
                <div key={product.id} className="grid items-center gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_130px_160px]">
                  <div>
                    <strong>{product.name}</strong>
                    <div className="text-sm text-slate-600">
                      Vorher: {before} · gezählt: {after}
              {(mode === "sale" || mode === "group_sale") && removed > 0 && Number(product.price) > 0
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

          {visibleProducts.length === 0 && (
            <p className="mt-5 rounded-lg bg-slate-100 p-4 text-slate-700">
              {isCoffeeLocation
                ? <>Noch kein Kaffeeartikel angelegt. Lege im <Link href="/katalog" className="underline">Produktkatalog</Link> z. B. „Kaffeebecher“ mit Kategorie „Heißgetränk“ an.</>
                : "Keine Produkte mit Bestand vorhanden. Produkte mit Bestand 0 werden hier ausgeblendet."}
            </p>
          )}

          <button type="button" disabled={busy} onClick={() => void save()}
            className="mt-5 rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white disabled:opacity-50">
            {busy ? "Speichert …" : mode === "sale" ? "Entnahme abrechnen" : mode === "group_sale" ? "Entnahme zur Fahrt addieren" : mode === "private" ? "Privatentnahme speichern" : "Bestand speichern"}
          </button>

          {message && <p role="status" className="mt-4 rounded-lg bg-slate-100 p-3">{message}</p>}
        </section>
      </div>
    </main>
  );
}
