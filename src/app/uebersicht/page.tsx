import Link from "next/link";

const kacheln = [
  {
    titel: "Eingangsbelege und Ausgaben",
    text: "Rechnungsfoto oder PDF auswählen und Belegdaten erfassen.",
    link: "/ausgaben",
    button: "Beleg erfassen",
  },
  {
    titel: "Produktkatalog und Bestand",
    text: "Getränke, Snacks, Preise und Warenzugänge verwalten.",
    link: "/katalog",
    button: "Katalog öffnen",
  },
  {
    titel: "Betriebsdaten",
    text: "Angaben für deine Rechnungen ansehen oder bearbeiten.",
    link: "/",
    button: "Betriebsdaten öffnen",
  },
  {
    titel: "Jahresabschluss",
    text: "Jahreszahlen prüfen, Inventur speichern und Steuerberaterpaket laden.",
    link: "/jahresabschluss",
    button: "Jahresabschluss öffnen",
  },
];

export default function Uebersicht() {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8">
          <p className="font-bold tracking-wide text-emerald-700">BUCHHALTUNG.AT</p>
          <h1 className="mt-2 text-4xl font-bold">Übersicht</h1>
          <p className="mt-3 text-lg text-slate-600">
            Belege, Ausgaben und Warenbestand an einem Ort.
          </p>
        </header>

        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {kacheln.map((kachel) => (
            <article
              key={kachel.titel}
              className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
            >
              <h2 className="text-xl font-semibold">{kachel.titel}</h2>
              <p className="mt-3 min-h-14 text-slate-600">{kachel.text}</p>
              <Link
                href={kachel.link}
                className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white hover:bg-emerald-800"
              >
                {kachel.button}
              </Link>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-xl font-semibold">Verkaufsbereich</h2>
          <p className="mt-2 text-slate-600">
            Verkaufsbelege, Rechnungen und QR-Codes sind der nächste Ausbau.
          </p>
        </section>

        <p className="mt-8 text-sm text-slate-500">
          Prototyp: Bitte prüfe Belege und Rechnungsangaben vor der Verwendung.
        </p>
      </div>
    </main>
  );
}
