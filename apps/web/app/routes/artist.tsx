import { useState, useRef, useEffect, useCallback } from "react";
import type { Route } from "./+types/artist";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import GridCard from "../components/GridCard";

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

function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

function sanitizeExternalUrl(url: string | null | undefined) {
  if (!url) return "";
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function getWikidataId(url: string) {
  const match = url.match(/Q\d+/i);
  return match ? match[0].toUpperCase() : "";
}

const EXTERNAL_FETCH_TIMEOUT_MS = 3_000;

function isTimeoutError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Simple in-memory wiki cache (survives across requests, cleared on redeploy)
const wikiCache = new Map<string, { data: any; ts: number }>();
const WIKI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchWikiSummary(wikidataUrl: string, wikipediaUrl: string) {
  const cacheKey = `${wikidataUrl}|${wikipediaUrl}`;
  const cached = wikiCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < WIKI_CACHE_TTL_MS) {
    return cached.data;
  }

  const data: {
    description?: string;
    extract?: string;
    wikiTitle?: string;
    wikiUrl?: string;
  } = {};

  const wikidataId = wikidataUrl ? getWikidataId(wikidataUrl) : "";

  if (wikidataId) {
    try {
      const json = await fetchJsonWithTimeout(
        `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`
      );
      if (json) {
        const entity = json?.entities?.[wikidataId];
        data.description =
          entity?.descriptions?.sv?.value || entity?.descriptions?.en?.value;
        data.wikiTitle = entity?.sitelinks?.svwiki?.title || "";
      }
    } catch (err) {
      if (!isTimeoutError(err)) {
        console.error(err);
      }
    }
  }

  const wikiTitle =
    data.wikiTitle ||
    (wikipediaUrl
      ? decodeURIComponent(new URL(wikipediaUrl).pathname.replace("/wiki/", ""))
      : "");

  if (wikiTitle) {
    try {
      const json = await fetchJsonWithTimeout(
        `https://sv.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          wikiTitle
        )}`
      );
      if (json) {
        data.extract = json?.extract || "";
        data.wikiUrl = json?.content_urls?.desktop?.page || wikipediaUrl;
      }
    } catch (err) {
      if (!isTimeoutError(err)) {
        console.error(err);
      }
    }
  }

  wikiCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta({ data }: Route.MetaArgs) {
  const name = data?.artistName || "Konstnär";
  return [
    { title: `${name} — Kabinett` },
    {
      name: "description",
      content: `Verk av ${name} i Kabinett.`,
    },
    { property: "og:title", content: name },
    { property: "og:description", content: `Utforska verk av ${name}` },
  ];
}

const PAGE_SIZE = 60;

export async function loader({ params }: Route.LoaderArgs) {
  let name = "";
  try {
    name = decodeURIComponent(params.name || "").trim();
  } catch (error) {
    if (error instanceof URIError) {
      throw new Response("Ogiltig URL-kodning", { status: 400 });
    }
    throw error;
  }
  if (!name) throw new Response("Saknar namn", { status: 400 });

  const offset = 0; // First page; infinite scroll loads more via /api/artist-works

  const db = getDb();
  const source = sourceFilter();

  const normalizedName = normalizeArtistName(name);

  const rows = normalizedName
    ? (db
        .prepare(
          `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.dating_text, a.year_start, a.year_end, a.category, a.actors_json
           FROM artwork_artists aa
           JOIN artworks a ON a.id = aa.artwork_id
           WHERE aa.artist_name_norm = ? AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
             AND a.id NOT IN (SELECT artwork_id FROM broken_images)
             AND ${source.sql}
           ORDER BY a.year_start ASC NULLS LAST
           LIMIT ? OFFSET ?`
        )
        .all(normalizedName, ...source.params, PAGE_SIZE + 1, offset) as any[])
    : [];

  const hasMore = rows.length > PAGE_SIZE;
  if (hasMore) rows.pop();

  const total = normalizedName
    ? ((db
        .prepare(
          `SELECT COUNT(*) as c
           FROM artwork_artists aa
           JOIN artworks a ON a.id = aa.artwork_id
           WHERE aa.artist_name_norm = ?
             AND ${source.sql}`
        )
        .get(normalizedName, ...source.params) as any).c as number)
    : 0;

  let actor: ActorInfo | null = null;
  for (const row of rows) {
    if (!row.actors_json) continue;
    const actors = parseActors(row.actors_json);
    actor = findActor(actors, name);
    if (actor) break;
  }

  const fallbackRow = !actor && normalizedName
    ? (db
        .prepare(
          `SELECT a.actors_json FROM artwork_artists aa
           JOIN artworks a ON a.id = aa.artwork_id
           WHERE aa.artist_name_norm = ? AND a.actors_json IS NOT NULL AND ${source.sql} LIMIT 1`
        )
        .get(normalizedName, ...source.params) as any)
    : null;

  if (!actor && fallbackRow?.actors_json) {
    const actors = parseActors(fallbackRow.actors_json);
    actor = findActor(actors, name) || actors[0] || null;
  }

  const nationality = actor?.actor_nationality || "";
  const { birth, death } = extractYears(actor?.dates);
  const links = extractLinks(actor?.links);
  const wikidata = sanitizeExternalUrl(links.wikidata);
  const wikipedia = sanitizeExternalUrl(links.wikipedia);
  const wikiSummary = wikidata ? await fetchWikiSummary(wikidata, wikipedia) : {};

  // Timeline: cap at 30
  const timelineWorks = rows.length > 0
    ? rows
        .filter((w) => w.year_start)
        .slice(0, 30)
        .map((r) => ({
          id: r.id,
          title: r.title_sv || r.title_en || "Utan titel",
          imageUrl: buildImageUrl(r.iiif_url, 400),
          year: r.year_start,
          color: r.dominant_color || "#D4CDC3",
        }))
    : [];

  const gridWorks = rows.map((r) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    imageUrl: buildImageUrl(r.iiif_url, 400),
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
    hasMore,
  };
}

type GridWork = {
  id: string;
  title: string;
  imageUrl: string;
  color: string;
  year: string;
};

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
    works: initialWorks,
    hasMore: initialHasMore,
  } = loaderData;

  const altArtist = artistName || "Okänd konstnär";

  const [works, setWorks] = useState<GridWork[]>(initialWorks);
  const [canLoadMore, setCanLoadMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(initialWorks.length);

  // Reset when navigating to a different artist
  useEffect(() => {
    setWorks(initialWorks);
    setCanLoadMore(initialHasMore);
    offsetRef.current = initialWorks.length;
  }, [initialWorks, initialHasMore]);

  const loadMore = useCallback(async () => {
    if (loading || !canLoadMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        name: artistName,
        offset: String(offsetRef.current),
      });
      const res = await fetch(`/api/artist-works?${params.toString()}`);
      if (!res.ok) throw new Error("Kunde inte ladda fler verk");
      const data = await res.json() as { works: GridWork[]; hasMore: boolean };
      if (data.works.length === 0) {
        setCanLoadMore(false);
      } else {
        offsetRef.current += data.works.length;
        setWorks((prev) => [...prev, ...data.works]);
        setCanLoadMore(data.hasMore);
      }
    } catch {
      setCanLoadMore(false);
    } finally {
      setLoading(false);
    }
  }, [artistName, canLoadMore, loading]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      <div className="pt-[2.75rem] px-5 pb-6 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <p className="text-xs uppercase tracking-[0.2em] text-warm-gray">
          Konstnärsresa
        </p>
        <h1 className="font-serif text-[2.2rem] lg:text-[2.6rem] font-bold text-charcoal leading-[1.1] mt-2">
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
              <a href={wikidata} className="text-[0.8rem] text-warm-gray no-underline focus-ring">
                Wikidata
              </a>
            )}
            {wikipedia && (
              <a href={wikipedia} className="text-[0.8rem] text-warm-gray no-underline focus-ring">
                Wikipedia
              </a>
            )}
          </div>
        )}
      </div>

      {timelineWorks.length > 0 && (
        <section className="px-5 pb-8 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <h2 className="font-serif text-[1.4rem] text-charcoal mb-3">
            Verk över tid
          </h2>
          <div className="grid grid-flow-col auto-cols-[minmax(140px,180px)] gap-3 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar lg:auto-cols-[minmax(180px,220px)]">
            {timelineWorks.map((w) => (
              <a
                key={w.id}
                href={`/artwork/${w.id}`}
                className="no-underline rounded-card overflow-hidden bg-linen snap-start focus-ring"
              >
                <div className="aspect-[3/4]" style={{ backgroundColor: w.color }}>
                  <img
                    src={w.imageUrl}
                    alt={`${w.title} — ${altArtist}`}
                    width={400}
                    height={533}
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3">
                  <p className="text-xs text-charcoal font-medium leading-snug">
                    {w.year}
                  </p>
                  <p className="text-sm text-warm-gray mt-1 leading-snug line-clamp-2 min-h-[2.1rem]">
                    {w.title}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="px-5 pb-16 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <h2 className="font-serif text-[1.4rem] text-charcoal mb-4">
          Alla verk
        </h2>
        <div className="columns-2 gap-3 md:columns-3 lg:columns-4 lg:gap-4">
          {works.map((w) => (
            <GridCard key={w.id} item={{ ...w, artist: altArtist }} />
          ))}
        </div>
        <div ref={sentinelRef} className="h-4" />
        {loading && (
          <p className="text-center text-[0.85rem] text-warm-gray py-4">
            Laddar fler verk…
          </p>
        )}
      </section>
    </div>
  );
}
