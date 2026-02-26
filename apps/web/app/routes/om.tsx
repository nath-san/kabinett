import type { Route } from "./+types/om";
import { getDb } from "../lib/db.server";
import { sourceFilter } from "../lib/museums.server";
import { getSiteStats } from "../lib/stats.server";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta() {
  return [
    { title: "Om Kabinett — Kabinett" },
    { name: "description", content: "Kabinett samlar Sveriges kulturarv på ett ställe — med semantisk sökning som förstår vad du letar efter." },
    { property: "og:title", content: "Om Kabinett" },
    { property: "og:description", content: "Kabinett samlar Sveriges kulturarv på ett ställe — med semantisk sökning som förstår vad du letar efter." },
    { property: "og:type", content: "website" },
  ];
}

export async function loader() {
  const db = getDb();
  const sourceA = sourceFilter("a");
  const siteStats = getSiteStats(db);
  const stats = {
    totalWorks: siteStats.totalWorks,
    museums: siteStats.museums,
    minYear: siteStats.minYear,
    maxYear: siteStats.maxYear,
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
    <div className="min-h-screen pt-16 bg-[#1C1916] text-[#F5F0E8]">
      <div className="max-w-4xl mx-auto px-4 lg:px-6">
        <div className="pt-6">
          <h1 className="font-serif text-[2rem] text-[#F5F0E8] m-0">Om Kabinett</h1>
          <p className="mt-3 text-[1rem] lg:text-[1.05rem] text-[rgba(245,240,232,0.55)]">
            Kabinett samlar Sveriges kulturarv på ett ställe. Utforska över {stats.totalWorks.toLocaleString("sv")} verk från {museums.map(m => m.name).slice(0, -1).join(", ")} och {museums[museums.length - 1]?.name} — med semantisk sökning som förstår vad du letar efter.
          </p>
        </div>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8]">Så fungerar det</h2>
          <p className="mt-2 text-[0.95rem] text-[rgba(245,240,232,0.55)]">
            Vi använder CLIP, en AI-modell, för att förstå bildernas innehåll. Det betyder att du kan söka på "solnedgång över havet" och hitta relevanta verk — även om de inte är taggade med de orden.
          </p>
        </section>

        <section className="pt-8">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-[#252019] rounded-2xl p-4">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(245,240,232,0.55)] m-0">Verk</p>
              <p className="text-[1.6rem] font-serif text-[#F5F0E8] mt-2">
                {stats.totalWorks.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-[#252019] rounded-2xl p-4">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(245,240,232,0.55)] m-0">Museer</p>
              <p className="text-[1.6rem] font-serif text-[#F5F0E8] mt-2">
                {stats.museums.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-[#252019] rounded-2xl p-4">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[rgba(245,240,232,0.55)] m-0">Tidsomfång</p>
              <p className="text-[1.6rem] font-serif text-[#F5F0E8] mt-2">
                {formatRange(stats.minYear, stats.maxYear)}
              </p>
            </div>
          </div>
        </section>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8]">Datakällor</h2>
          <p className="mt-2 text-[0.95rem] text-[rgba(245,240,232,0.55)]">
            All metadata är CC0. Bilderna är i Public Domain. Data hämtas via K-samsök (Riksantikvarieämbetets aggregator) och Nationalmuseums API.
          </p>
        </section>

        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8]">Samlingar</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {museums.map((m) => (
              <a
                key={m.name}
                href={`/samling/${encodeURIComponent(m.name)}`}
                className="text-[0.85rem] px-3 py-[0.35rem] rounded-full bg-[#252019] text-[#F5F0E8] no-underline hover:bg-[#2E2820] transition-colors focus-ring"
              >
                {m.name}
              </a>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
