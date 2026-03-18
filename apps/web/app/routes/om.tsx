import type { Route } from "./+types/om";
import type { CampaignId } from "../lib/campaign.server";
import { getDb } from "../lib/db.server";
import { sourceFilter } from "../lib/museums.server";
import { getCachedSiteStats as getSiteStats } from "../lib/stats.server";
import { getCampaignConfig } from "../lib/campaign.server";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta({ data }: Route.MetaArgs) {
  const title = data?.museumName
    ? `Om Kabinett × ${data.museumName}`
    : "Om Kabinett — Kabinett";
  const desc = data?.museumName
    ? `Utforska ${data.museumName}s samling med semantisk sökning som förstår vad du letar efter.`
    : "Kabinett samlar Sveriges kulturarv på ett ställe — med semantisk sökning som förstår vad du letar efter.";
  return [
    { title },
    { name: "description", content: desc },
    { property: "og:title", content: title },
    { property: "og:description", content: desc },
    { property: "og:type", content: "website" },
  ];
}

export async function loader() {
  const db = getDb();
  const sourceA = sourceFilter("a");
  const siteStats = getSiteStats(db);
  const campaign = getCampaignConfig();
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

  return { stats, museums, museumName: campaign.museumName, campaignId: campaign.id };
}

function formatRange(minYear: number | null, maxYear: number | null): string {
  if (!minYear || !maxYear) return "Okänt";
  if (minYear === maxYear) return String(minYear);
  return `${minYear}–${maxYear}`;
}

export default function About({ loaderData }: Route.ComponentProps) {
  const { stats, museums, museumName, campaignId } = loaderData;

  const museumList = museums.length > 1
    ? `${museums.map(m => m.name).slice(0, -1).join(", ")} och ${museums[museums.length - 1]?.name}`
    : museums[0]?.name || "";

  return (
    <div className="min-h-screen pt-16 bg-dark-base text-dark-text">
      <div className="max-w-3xl mx-auto px-5 lg:px-6">
        <div className="pt-8">
          <h1 className="font-serif text-[2rem] text-dark-text m-0">
            {museumName ? `Om Kabinett × ${museumName}` : "Om Kabinett"}
          </h1>
          <p className="mt-4 text-[1rem] lg:text-[1.05rem] text-dark-text-secondary leading-[1.7]">
            {museumName
              ? `Utforska ${stats.totalWorks.toLocaleString("sv")} verk från ${museumList} — med semantisk sökning som förstår vad du letar efter.`
              : `Kabinett samlar Sveriges kulturarv på ett ställe. Utforska över ${stats.totalWorks.toLocaleString("sv")} verk från ${museumList} — med semantisk sökning som förstår vad du letar efter.`
            }
          </p>
        </div>

        <section className="pt-10">
          <h2 className="font-serif text-[1.3rem] text-dark-text">Så fungerar det</h2>
          <p className="mt-3 text-[0.95rem] text-dark-text-secondary leading-[1.7]">
            Vi använder CLIP, en AI-modell, för att förstå bildernas innehåll. Det betyder att du kan söka på "solnedgång över havet" och hitta relevanta verk — även om de inte är taggade med de orden.
          </p>
        </section>

        <section className="pt-10">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-dark-raised rounded-card p-5">
              <p className="text-[0.65rem] uppercase tracking-[0.14em] text-dark-text-muted m-0">Verk</p>
              <p className="text-[1.6rem] font-serif text-dark-text mt-2">
                {stats.totalWorks.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-dark-raised rounded-card p-5">
              <p className="text-[0.65rem] uppercase tracking-[0.14em] text-dark-text-muted m-0">Samlingar</p>
              <p className="text-[1.6rem] font-serif text-dark-text mt-2">
                {stats.museums.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-dark-raised rounded-card p-5">
              <p className="text-[0.65rem] uppercase tracking-[0.14em] text-dark-text-muted m-0">Tidsomfång</p>
              <p className="text-[1.6rem] font-serif text-dark-text mt-2">
                {formatRange(stats.minYear, stats.maxYear)}
              </p>
            </div>
          </div>
        </section>

        <section className="pt-10">
          <h2 className="font-serif text-[1.3rem] text-dark-text">Datakällor</h2>
          <p className="mt-3 text-[0.95rem] text-dark-text-secondary leading-[1.7]">
            All metadata (text) är CC0 — fri att använda utan hänvisning. Bilderna delas under respektive museums licensvillkor — vanligtvis{" "}
            <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noopener noreferrer" className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors">CC0</a>,{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors">CC BY</a> eller{" "}
            <a href="https://creativecommons.org/licenses/by-nc-nd/4.0/" target="_blank" rel="noopener noreferrer" className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors">CC BY-NC-ND</a>.
            Licensinformation visas på varje verks sida. {renderDataSourceCopy(campaignId)}
          </p>
        </section>

        <section className="pt-10">
          <h2 className="font-serif text-[1.3rem] text-dark-text">För skolan</h2>
          <p className="mt-3 text-[0.95rem] text-dark-text-secondary leading-[1.7]">
            Kabinett har färdiga{" "}
            <a href="/skola" className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors">
              lektioner
            </a>{" "}
            med diskussionsfrågor och koppling till Lgr22 — redo att använda i klassrummet.
          </p>
        </section>

        <section className="pt-10 pb-16">
          <h2 className="font-serif text-[1.3rem] text-dark-text">Samlingar</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {museums.map((m) => (
              <a
                key={m.name}
                href={`/samling/${encodeURIComponent(m.name)}`}
                className="text-[0.82rem] px-3.5 py-[0.4rem] rounded-full bg-dark-raised text-dark-text no-underline hover:bg-dark-hover transition-colors focus-ring"
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

function renderDataSourceCopy(campaignId: CampaignId) {
  if (campaignId === "nationalmuseum") {
    return <>Data hämtas via Nationalmuseums API.</>;
  }

  if (campaignId === "nordiska" || campaignId === "shm") {
    return (
      <>
        Data hämtas via{" "}
        <a
          href="https://www.raa.se/hitta-information/k-samsok/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors"
        >
          K-samsök
        </a>{" "}
        (Riksantikvarieämbetets aggregator).
      </>
    );
  }

  if (campaignId === "europeana") {
    return (
      <>
        Data hämtas via{" "}
        <a
          href="https://www.europeana.eu"
          target="_blank"
          rel="noopener noreferrer"
          className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors"
        >
          Europeana
        </a>
        .
      </>
    );
  }

  return (
    <>
      Data hämtas via{" "}
      <a
        href="https://www.raa.se/hitta-information/k-samsok/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-dark-text underline decoration-dark-text-muted underline-offset-2 hover:decoration-dark-text transition-colors"
      >
        K-samsök
      </a>{" "}
      (Riksantikvarieämbetets aggregator) och Nationalmuseums API.
    </>
  );
}
