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
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      <div style={{ padding: "2.75rem 1.25rem 1.5rem" }}>
        <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.2em", color: "#8C8478" }}>
          Konstnärsresa
        </p>
        <h1 className="font-serif" style={{ fontSize: "2.4rem", fontWeight: 700, color: "#3D3831", lineHeight: 1.1, marginTop: "0.5rem" }}>
          {artistName}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.85rem", color: "#8C8478" }}>
          {nationality && <span>{nationality}</span>}
          {nationality && (birth || death) && <span style={{ color: "#D4CDC3" }}>·</span>}
          {(birth || death) && (
            <span>
              {birth || "?"}
              {death ? `–${death}` : birth ? "–" : ""}
            </span>
          )}
          {(nationality || birth || death) && <span style={{ color: "#D4CDC3" }}>·</span>}
          <span>{total} verk</span>
        </div>
        {(wikiDescription || wikiExtract || biography) && (
          <p style={{ marginTop: "0.9rem", fontSize: "0.95rem", color: "#3D3831", maxWidth: "46rem" }}>
            {wikiExtract || biography || wikiDescription}
          </p>
        )}
        {(wikidata || wikipedia) && (
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
            {wikidata && (
              <a href={wikidata} style={{ fontSize: "0.8rem", color: "#8C8478", textDecoration: "none" }}>
                Wikidata
              </a>
            )}
            {wikipedia && (
              <a href={wikipedia} style={{ fontSize: "0.8rem", color: "#8C8478", textDecoration: "none" }}>
                Wikipedia
              </a>
            )}
          </div>
        )}
      </div>

      {timelineWorks.length > 0 && (
        <section style={{ padding: "0 1.25rem 2rem" }}>
          <h2 className="font-serif" style={{ fontSize: "1.35rem", color: "#3D3831", marginBottom: "0.75rem" }}>
            Verk över tid
          </h2>
          <div
            className="no-scrollbar"
            style={{
              display: "grid",
              gridAutoFlow: "column",
              gridAutoColumns: "minmax(140px, 180px)",
              gap: "0.75rem",
              overflowX: "auto",
              paddingBottom: "0.5rem",
              scrollSnapType: "x mandatory",
            }}
          >
            {timelineWorks.map((w) => (
              <a
                key={w.id}
                href={`/artwork/${w.id}`}
                style={{
                  textDecoration: "none",
                  borderRadius: "0.8rem",
                  overflow: "hidden",
                  backgroundColor: "#F0EBE3",
                  scrollSnapAlign: "start",
                }}
              >
                <div style={{ backgroundColor: w.color, aspectRatio: "3/4" }}>
                  <img
                    src={w.imageUrl}
                    alt={w.title}
                    width={400}
                    height={533}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </div>
                <div style={{ padding: "0.6rem" }}>
                  <p style={{ fontSize: "0.78rem", color: "#3D3831", fontWeight: 600 }}>
                    {w.year}
                  </p>
                  <p style={{ fontSize: "0.72rem", color: "#8C8478", marginTop: "0.2rem", lineHeight: 1.3 }}>
                    {w.title}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section style={{ padding: "0 1.25rem 4rem" }}>
        <h2 className="font-serif" style={{ fontSize: "1.35rem", color: "#3D3831", marginBottom: "1rem" }}>
          Alla verk
        </h2>
        <div style={{ columnCount: 2, columnGap: "0.8rem" }}>
          {works.map((w: any) => (
            <a
              key={w.id}
              href={`/artwork/${w.id}`}
              style={{
                breakInside: "avoid",
                display: "block",
                borderRadius: "0.8rem",
                overflow: "hidden",
                backgroundColor: "#F0EBE3",
                marginBottom: "0.8rem",
                textDecoration: "none",
              }}
            >
              <div style={{ backgroundColor: w.color, aspectRatio: "3/4", overflow: "hidden" }}>
                <img
                  src={w.imageUrl}
                  alt={w.title}
                  width={400}
                  height={533}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ padding: "0.65rem" }}>
                <p
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    color: "#3D3831",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {w.title}
                </p>
                {w.year && (
                  <p style={{ fontSize: "0.65rem", color: "#D4CDC3", marginTop: "0.25rem" }}>
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
