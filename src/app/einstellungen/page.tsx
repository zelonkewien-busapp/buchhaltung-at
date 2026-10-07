"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type BusinessProfile = {
  legal_name: string;
  owner_name: string;
  street: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  uid_number: string;
  tax_number: string;
  is_small_business: boolean;
};

const emptyProfile: BusinessProfile = {
  legal_name: "",
  owner_name: "",
  street: "",
  postal_code: "",
  city: "",
  country: "Österreich",
  email: "",
  phone: "",
  uid_number: "",
  tax_number: "",
  is_small_business: true,
};

export default function Home() {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<BusinessProfile>(emptyProfile);
  const [isRegistering, setIsRegistering] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadProfile(
    userId: string,
    accountEmail = user?.email ?? ""
  ): Promise<boolean | null> {
    const { data, error } = await supabase
      .from("business_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      setMessage(`Betriebsdaten konnten nicht geladen werden: ${error.message}`);
      return null;
    }

    if (data) {
      setProfile({
        legal_name: data.legal_name ?? "",
        owner_name: data.owner_name ?? "",
        street: data.street ?? "",
        postal_code: data.postal_code ?? "",
        city: data.city ?? "",
        country: data.country ?? "Österreich",
        email: data.email ?? "",
        phone: data.phone ?? "",
        uid_number: data.uid_number ?? "",
        tax_number: data.tax_number ?? "",
        is_small_business: data.is_small_business ?? true,
      });
      return true;
    } else {
      setProfile({ ...emptyProfile, email: accountEmail });
      return false;
    }
  }

  useEffect(() => {
    let active = true;

    async function checkLogin() {
      const { data } = await supabase.auth.getUser();
      if (!active) return;

      if (data.user) {
        setUser(data.user);
        await loadProfile(data.user.id, data.user.email ?? "");
      }
      setLoading(false);
    }

    void checkLogin();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (active) setUser(session?.user ?? null);
      }
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (isRegistering) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.user && data.session) {
          setUser(data.user);
          setProfile({ ...emptyProfile, email: data.user.email ?? email });
          setMessage("Konto erstellt. Bitte ergänze jetzt deine Betriebsdaten.");
        } else {
          setMessage(
            "Konto angelegt. Bestätige zuerst den Link in deiner E-Mail und melde dich danach hier an."
          );
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;

        if (data.user) {
          setUser(data.user);
          const profileExists = await loadProfile(
            data.user.id,
            data.user.email ?? email
          );

          if (profileExists) {
            setMessage("Anmeldung erfolgreich. Übersicht wird geöffnet …");
            router.replace("/");
          } else if (profileExists === false) {
            setMessage("Anmeldung erfolgreich. Bitte ergänze einmalig deine Betriebsdaten.");
          }
        }
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Das hat nicht funktioniert."
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setBusy(true);
    setMessage("");

    const { error } = await supabase.from("business_profiles").upsert(
      {
        user_id: user.id,
        ...profile,
        email: profile.email || user.email || "",
      },
      { onConflict: "user_id" }
    );

    setBusy(false);

    if (error) {
      setMessage(`Speichern fehlgeschlagen: ${error.message}`);
    } else {
      setMessage("Betriebsdaten gespeichert. Übersicht wird geöffnet …");
      router.replace("/");
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(emptyProfile);
    setMessage("Du bist abgemeldet.");
  }

  function updateProfile(
    field: keyof BusinessProfile,
    value: string | boolean
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-700">
        Buchhaltung.at wird geladen …
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-3xl font-bold">
            {user ? "Betrieb registrieren" : "Willkommen"}
          </h1>
          <p className="mt-2 text-slate-600">
            {user
              ? "Diese Angaben können später auf deinen Rechnungen erscheinen."
              : "Erstelle ein Konto für deine Buchhaltungsunterlagen."}
          </p>
        </header>

        {message && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-slate-200 bg-white p-4 text-sm"
          >
            {message}
          </div>
        )}

        {!user ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <h2 className="mb-5 text-xl font-semibold">
              {isRegistering ? "Neues Konto erstellen" : "Anmelden"}
            </h2>

            <form onSubmit={handleAuth} className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">E-Mail</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Passwort</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete={isRegistering ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
                {isRegistering && (
                  <span className="mt-1 block text-xs text-slate-500">
                    Mindestens 8 Zeichen.
                  </span>
                )}
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60"
              >
                {busy
                  ? "Einen Moment …"
                  : isRegistering
                    ? "Konto erstellen"
                    : "Anmelden"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setIsRegistering(!isRegistering);
                setMessage("");
              }}
              className="mt-5 text-sm font-medium text-emerald-800 underline"
            >
              {isRegistering
                ? "Ich habe schon ein Konto – anmelden"
                : "Ich brauche ein neues Konto"}
            </button>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">Angaben für Rechnungen</h2>
              <button
                type="button"
                onClick={logout}
                className="text-sm text-slate-600 underline"
              >
                Abmelden
              </button>
            </div>

            <form onSubmit={saveProfile} className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Firmenname oder vollständiger Name
                </span>
                <input
                  required
                  value={profile.legal_name}
                  onChange={(event) => updateProfile("legal_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">
                  Inhaber/in oder Ansprechperson
                </span>
                <input
                  value={profile.owner_name}
                  onChange={(event) => updateProfile("owner_name", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="mb-1 block text-sm font-medium">Straße und Hausnummer</span>
                <input
                  value={profile.street}
                  onChange={(event) => updateProfile("street", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Postleitzahl</span>
                <input
                  value={profile.postal_code}
                  onChange={(event) => updateProfile("postal_code", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Ort</span>
                <input
                  value={profile.city}
                  onChange={(event) => updateProfile("city", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Land</span>
                <input
                  value={profile.country}
                  onChange={(event) => updateProfile("country", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Telefon</span>
                <input
                  type="tel"
                  value={profile.phone}
                  onChange={(event) => updateProfile("phone", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">E-Mail für Rechnungen</span>
                <input
                  type="email"
                  value={profile.email}
                  onChange={(event) => updateProfile("email", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">UID-Nummer (falls vorhanden)</span>
                <input
                  value={profile.uid_number}
                  onChange={(event) => updateProfile("uid_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Steuernummer (falls vorhanden)</span>
                <input
                  value={profile.tax_number}
                  onChange={(event) => updateProfile("tax_number", event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
                />
              </label>

              <label className="flex items-start gap-3 rounded-lg bg-slate-50 p-3 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={profile.is_small_business}
                  onChange={(event) =>
                    updateProfile("is_small_business", event.target.checked)
                  }
                  className="mt-1"
                />
                <span className="text-sm">
                  Ich wende die Kleinunternehmerregelung an. Bitte prüfe diese Angabe
                  mit deiner Steuerberatung.
                </span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60 sm:col-span-2"
              >
                {busy ? "Wird gespeichert …" : "Betriebsdaten speichern"}
              </button>
            </form>

            <p className="mt-5 text-xs leading-5 text-slate-500">
              Die Eingabe speichert Betriebsdaten für das Konto. Sie bestätigt
              keine steuerliche oder rechtliche Prüfung.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
