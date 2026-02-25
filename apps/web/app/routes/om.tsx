import type { Route } from "./+types/om";
import { getDb } from "../lib/db.server";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

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
  const source = sourceFilter();
  const sourceA = sourceFilter("a");

  const stats = {
    totalWorks: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${source.sql}`).get(...source.params) as any).c as number,
    museums: (db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT DISTINCT COALESCE(sub_museum, m.name) as museum_name
        FROM artworks a
        LEFT JOIN museums m ON m.id = a.source
        WHERE ${sourceA.sql} AND COALESCE(sub_museum, m.name) IS NOT NULL AND COALESCE(sub_museum, m.name) != 'Statens historiska museer'
      )
    `).get(...sourceA.params) as any).c as number,
    minYear: (db.prepare(`SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0 AND ${source.sql}`).get(...source.params) as any).c as number | null,
    maxYear: (db.prepare(`SELECT MAX(COALESCE(year_end, year_start)) as c FROM artworks WHERE year_start > 0 AND ${source.sql}`).get(...source.params) as any).c as number | null,
  };

  const collections = db.prepare(`
    SELECT COALESCE(a.sub_museum, m.name) as coll_name, a.source as id, COUNT(*) as cnt
    FROM artworks a
    LEFT JOIN museums m ON m.id = a.source
    WHERE ${sourceA.sql}
      AND COALESCE(a.sub_museum, m.name) IS NOT NULL
      AND COALESCE(a.sub_museum, m.name) != 'Statens historiska museer'
    GROUP BY coll_name
    ORDER BY cnt DESC
  `).all(...sourceA.params) as Array<{ name: string; id: string; cnt: number }>;
  const museums = collections.map((row: any) => ({ id: row.id, name: row.coll_name }));

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
            Kabinett samlar Sveriges kulturarv på ett ställe. Utforska över en miljon verk från Nationalmuseum, Livrustkammaren, Hallwylska museet, Nordiska museet och fler — med semantisk sökning som förstår vad du letar efter.
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
          <h2 className="font-serif text-[1.3rem] text-charcoal">Samlingar</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {museums.map((m) => (
              <a
                key={m.name}
                href={`/samling/${encodeURIComponent(m.name)}`}
                className="text-[0.85rem] px-3 py-[0.35rem] rounded-full bg-linen text-ink no-underline hover:bg-stone transition-colors focus-ring"
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
