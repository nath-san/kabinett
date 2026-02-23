import type { Route } from "./+types/artist";
import { getDb } from "../lib/db.server";

function buildIiif(url: string, size: number) {
  return url.replace("http://", "https://") + `full/${size},/0/default.jpg`;
}

type ActorDate = { date_type?: string; date_earliest?: string | number };

type ActorLink = { link_type?: string; link?: string };

type ActorInfo = {
  actor_full_name?: string;
  actor_nationality?: string;
  actor_biography?: string;
  dates?: ActorDate[];
  links?: ActorLink[];
};

function parseActors(json: string | null): ActorInfo[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findActor(actors: ActorInfo[], name: string): ActorInfo | null {
  const lowered = name.toLowerCase();
  return (
    actors.find((a) => a.actor_full_name?.toLowerCase() === lowered) ||
    actors.find((a) => a.actor_full_name?.toLowerCase().includes(lowered)) ||
    null
  );
}

function extractYears(dates: ActorDate[] | undefined) {
  if (!dates) return { birth: "", death: "" };
  const birth = dates.find((d) => d.date_type?.toLowerCase().includes("födelse"));
  const death = dates.find((d) => d.date_type?.toLowerCase().includes("döds"));
  return {
    birth: birth?.date_earliest ? String(birth.date_earliest).slice(0, 4) : "",
    death: death?.date_earliest ? String(death.date_earliest).slice(0, 4) : "",
  };
}

function extractLinks(links: ActorLink[] | undefined) {
  let wikidata = "";
  let wikipedia = "";
  for (const link of links || []) {
    if (!link?.link) continue;
    const type = link.link_type?.toLowerCase() || "";
    if (type.includes("wikidata") || link.link.includes("wikidata.org")) {
      wikidata = link.link;
    }
    if (type.includes("wikipedia") || link.link.includes("wikipedia.org")) {
      wikipedia = link.link;
    }
  }
  return { wikidata, wikipedia };
}

function getWikidataId(url: string) {
  const match = url.match(/Q\d+/i);
  return match ? match[0].toUpperCase() : "";
}

async function fetchWikiSummary(wikidataUrl: string, wikipediaUrl: string) {
  const data: {
    description?: string;
    extract?: string;
    wikiTitle?: string;
    wikiUrl?: string;
  } = {};

  const wikidataId = wikidataUrl ? getWikidataId(wikidataUrl) : "";

  if (wikidataId) {
    try {
      const res = await fetch(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`
      );
      if (res.ok) {
        const json = await res.json();
        const entity = json?.entities?.[wikidataId];
        data.description =
          entity?.descriptions?.sv?.value || entity?.descriptions?.en?.value;
        data.wikiTitle = entity?.sitelinks?.svwiki?.title || "";
      }
    } catch {}
  }

  const wikiTitle =
    data.wikiTitle ||
    (wikipediaUrl
      ? decodeURIComponent(new URL(wikipediaUrl).pathname.replace("/wiki/", ""))
      : "");

  if (wikiTitle) {
    try {
      const res = await fetch(
        `https://sv.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          wikiTitle
        )}`
      );
      if (res.ok) {
        const json = await res.json();
        data.extract = json?.extract || "";
        data.wikiUrl = json?.content_urls?.desktop?.page || wikipediaUrl;
      }
    } catch {}
  }

  return data;
}

export function meta({ data }: Route.MetaArgs) {
  const name = data?.artistName || "Konstnär";
  return [
    { title: `${name} — Kabinett` },
    {
      name: "description",
      content: `Verk av ${name} ur Nationalmuseums samling.`,
    },
    { property: "og:title", content: name },
    { property: "og:description", content: `Utforska verk av ${name}` },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const name = decodeURIComponent(params.name || "").trim();
  if (!name) throw new Response("Saknar namn", { status: 400 });

  const db = getDb();

  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, dating_text, year_start, year_end, category, actors_json
       FROM artworks
       WHERE artists LIKE ? AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
       ORDER BY year_start ASC NULLS LAST`
    )
    .all(`%${name}%`) as any[];

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE artists LIKE ?`).get(
      `%${name}%`
    ) as any
  ).c as number;

  let actor: ActorInfo | null = null;
  for (const row of rows) {
    if (!row.actors_json) continue;
    const actors = parseActors(row.actors_json);
    actor = findActor(actors, name);
    if (actor) break;
  }

  const fallbackRow = !actor
    ? (db
        .prepare(
          `SELECT actors_json FROM artworks WHERE artists LIKE ? AND actors_json IS NOT NULL LIMIT 1`
        )
        .get(`%${name}%`) as any)
    : null;

  if (!actor && fallbackRow?.actors_json) {
    const actors = parseActors(fallbackRow.actors_json);
    actor = findActor(actors, name) || actors[0] || null;
  }

  const nationality = actor?.actor_nationality || "";
  const { birth, death } = extractYears(actor?.dates);
  const { wikidata, wikipedia } = extractLinks(actor?.links);
  const wikiSummary = wikidata ? await fetchWikiSummary(wikidata, wikipedia) : {};

  const timelineWorks = rows
    .filter((w) => w.year_start)
    .map((r) => ({
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      imageUrl: buildIiif(r.iiif_url, 400),
      year: r.year_start,
      color: r.dominant_color || "#D4CDC3",
    }));

  const gridWorks = rows.map((r) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    imageUrl: buildIiif(r.iiif_url, 400),
    color: r.dominant_color || "#D4CDC3",
    year: r.dating_text || "",
  }));

  return {
    artistName: name,
    nationality,
    birth,
    death,
    biography: actor?.actor_biography || "",
    wikidata,
    wikipedia: wikiSummary.wikiUrl || wikipedia,
    wikiDescription: wikiSummary.description || "",
    wikiExtract: wikiSummary.extract || "",
    total,
    timelineWorks,
    works: gridWorks,
  };
}

export default function Artist({ loaderData }: Route.ComponentProps) {
  const {
    artistName,
    nationality,
    birth,
    death,
    biography,
    wikidata,
    wikipedia,
    wikiDescription,
    wikiExtract,
    total,
    timelineWorks,
    works,
  } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      <div className="pt-[2.75rem] px-5 pb-6 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <p className="text-[0.75rem] uppercase tracking-[0.2em] text-warm-gray">
          Konstnärsresa
        </p>
        <h1 className="font-serif text-[2.4rem] font-bold text-charcoal leading-[1.1] mt-2">
          {artistName}
        </h1>
        <div className="flex flex-wrap gap-2 mt-3 text-[0.85rem] text-warm-gray">
          {nationality && <span>{nationality}</span>}
          {nationality && (birth || death) && <span className="text-stone">·</span>}
          {(birth || death) && (
            <span>
              {birth || "?"}
              {death ? `–${death}` : birth ? "–" : ""}
            </span>
          )}
          {(nationality || birth || death) && <span className="text-stone">·</span>}
          <span>{total} verk</span>
        </div>
        {(wikiDescription || wikiExtract || biography) && (
          <p className="mt-[0.9rem] text-[0.95rem] text-charcoal max-w-[46rem]">
            {wikiExtract || biography || wikiDescription}
          </p>
        )}
        {(wikidata || wikipedia) && (
          <div className="flex gap-3 mt-4 flex-wrap">
            {wikidata && (
              <a href={wikidata} className="text-[0.8rem] text-warm-gray no-underline">
                Wikidata
              </a>
            )}
            {wikipedia && (
              <a href={wikipedia} className="text-[0.8rem] text-warm-gray no-underline">
                Wikipedia
              </a>
            )}
          </div>
        )}
      </div>

      {timelineWorks.length > 0 && (
        <section className="px-5 pb-8 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <h2 className="font-serif text-[1.35rem] text-charcoal mb-3">
            Verk över tid
          </h2>
          <div className="grid grid-flow-col auto-cols-[minmax(140px,180px)] gap-3 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar lg:auto-cols-[minmax(180px,220px)]">
            {timelineWorks.map((w) => (
              <a
                key={w.id}
                href={`/artwork/${w.id}`}
                className="no-underline rounded-[0.8rem] overflow-hidden bg-linen snap-start"
              >
                <div className="aspect-[3/4]" style={{ backgroundColor: w.color }}>
                  <img
                    src={w.imageUrl}
                    alt={w.title}
                    width={400}
                    height={533}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-[0.6rem]">
                  <p className="text-[0.78rem] text-charcoal font-semibold">
                    {w.year}
                  </p>
                  <p className="text-[0.72rem] text-warm-gray mt-[0.2rem] leading-[1.3]">
                    {w.title}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="px-5 pb-16 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <h2 className="font-serif text-[1.35rem] text-charcoal mb-4">
          Alla verk
        </h2>
        <div className="columns-2 [column-gap:0.8rem] md:columns-3 lg:columns-4 lg:[column-gap:1rem]">
          {works.map((w: any) => (
            <a
              key={w.id}
              href={`/artwork/${w.id}`}
              className="break-inside-avoid block rounded-[0.8rem] overflow-hidden bg-linen mb-[0.8rem] no-underline"
            >
              <div className="aspect-[3/4] overflow-hidden" style={{ backgroundColor: w.color }}>
                <img
                  src={w.imageUrl}
                  alt={w.title}
                  width={400}
                  height={533}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-[0.65rem]">
                <p className="text-[0.8rem] font-medium text-charcoal leading-[1.3] overflow-hidden line-clamp-2">
                  {w.title}
                </p>
                {w.year && (
                  <p className="text-[0.65rem] text-stone mt-1">
                    {w.year}
                  </p>
                )}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
