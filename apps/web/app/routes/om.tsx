import type { Route } from "./+types/om";
import { getDb } from "../lib/db.server";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";

export function meta() {
  return [
    { title: "Om Kabinett — Kabinett" },
    { name: "description", content: "Kabinett samlar Sveriges kulturarv på ett ställe." },
    { property: "og:title", content: "Om Kabinett" },
    { property: "og:description", content: "Kabinett samlar Sveriges kulturarv på ett ställe." },
    { property: "og:type", content: "website" },
  ];
}

type MuseumLink = { id: string; name: string };

export async function loader() {
  const db = getDb();
  const enabledMuseums = getEnabledMuseums();

  const stats = {
    totalWorks: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${sourceFilter()}`).get() as any).c as number,
    museums: enabledMuseums.length,
    minYear: (db.prepare(`SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0 AND ${sourceFilter()}`).get() as any).c as number | null,
    maxYear: (db.prepare(`SELECT MAX(COALESCE(year_end, year_start)) as c FROM artworks WHERE year_start > 0 AND ${sourceFilter()}`).get() as any).c as number | null,
  };

  let museums: MuseumLink[] = [];
  if (enabledMuseums.length > 0) {
    const order = `CASE id ${enabledMuseums.map((id, i) => `WHEN '${id}' THEN ${i}`).join(" ")} END`;
    const rows = db.prepare(
      `SELECT id, name FROM museums WHERE enabled = 1 AND id IN (${enabledMuseums.map(() => "?").join(",")}) ORDER BY ${order}`
    ).all(...enabledMuseums) as any[];
    museums = rows.map((row) => ({ id: row.id, name: row.name }));
  }

  return { stats, museums };
}

function formatRange(minYear: number | null, maxYear: number | null): string {
  if (!minYear || !maxYear) return "Okänt";
  if (minYear === maxYear) return String(minYear);
  return `${minYear}–${maxYear}`;
}

export default function About({ loaderData }: Route.ComponentProps) {
  const { stats, museums } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-cream">
      <div className="max-w-4xl mx-auto px-4 lg:px-6">
        <div className="pt-6">
          <h1 className="font-serif text-[2.2rem] lg:text-[2.6rem] text-charcoal m-0">Om Kabinett</h1>
          <p className="mt-3 text-[1rem] lg:text-[1.05rem] text-warm-gray">
            Kabinett samlar Sveriges kulturarv på ett ställe. Utforska verk från Nationalmuseum, Statens historiska museer och Nordiska museet — allt med semantisk sökning som förstår vad du letar efter.
          </p>
        </div>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-charcoal">Så fungerar det</h2>
          <p className="mt-2 text-[0.95rem] text-warm-gray">
            Vi använder CLIP, en AI-modell, för att förstå bildernas innehåll. Det betyder att du kan söka på "solnedgång över havet" och hitta relevanta verk — även om de inte är taggade med de orden.
          </p>
        </section>

        <section className="pt-8">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Verk</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">
                {stats.totalWorks.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Museer</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">
                {stats.museums.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Tidsomfång</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">
                {formatRange(stats.minYear, stats.maxYear)}
              </p>
            </div>
          </div>
        </section>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-charcoal">Datakällor</h2>
          <p className="mt-2 text-[0.95rem] text-warm-gray">
            All metadata är CC0. Bilderna är i Public Domain. Data hämtas via K-samsök (Riksantikvarieämbetets aggregator) och Nationalmuseums API.
          </p>
        </section>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-charcoal">Museer</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {museums.map((m) => (
              <a
                key={m.id}
                href={`/museum/${encodeURIComponent(m.id)}`}
                className="text-[0.85rem] px-3 py-[0.35rem] rounded-full bg-linen text-ink no-underline"
              >
                {m.name}
              </a>
            ))}
          </div>
        </section>

        <section className="pt-8 pb-10">
          <h2 className="font-serif text-[1.3rem] text-charcoal">Teknik</h2>
          <p className="mt-2 text-[0.95rem] text-warm-gray">
            Byggt med React Router, SQLite, Tailwind CSS och Transformers.js
          </p>
        </section>
      </div>
    </div>
  );
}
