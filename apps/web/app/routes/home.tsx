import { useEffect, useMemo, useRef, useState } from "react";
import ArtworkCard, { type CardVariant } from "../components/ArtworkCard";
import HeroSearch from "../components/HeroSearch";
import SpotlightCard, { type SpotlightCardData } from "../components/SpotlightCard";
import StatsSection, { type StatsCardData } from "../components/StatsSection";
import ThemeCard, { type ThemeCardSection } from "../components/ThemeCard";
import WalkPromoCard from "../components/WalkPromoCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { getDb } from "../lib/db.server";
import { fetchFeed } from "../lib/feed.server";
import { buildDirectImageUrl, buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getCachedSiteStats } from "../lib/stats.server";
import type { Route } from "./+types/home";

function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "\\u003C/");
}

type FeedItem = ArtworkDisplayItem;
type FeedItemRow = Omit<FeedItem, "imageUrl">;

type HomeLoaderData = {
  initialItems: FeedItem[];
  initialCursor: number | null;
  initialHasMore: boolean;
  preloadedThemes: ThemeCardSection[];
  showMuseumBadge: boolean;
  stats: StatsCardData;
  spotlight: SpotlightCardData | null;
  ogImageUrl: string | null;
  canonicalUrl: string;
  origin: string;
};

type ThemeSectionEntry = { type: "theme" } & ThemeCardSection;
type StatsCardEntry = { type: "stats" } & StatsCardData;
type ArtCard = { type: "art"; item: FeedItem };
type SpotlightCardEntry = { type: "spotlight" } & SpotlightCardData;
type WalkPromoCardEntry = {
  type: "walkPromo";
};
type FeedEntry = ArtCard | ThemeSectionEntry | StatsCardEntry | SpotlightCardEntry | WalkPromoCardEntry;

const THEMES = [
  { title: "Djur i konsten", subtitle: "Från hästar till hundar", filter: "Djur", color: "#2D3A2D" },
  { title: "Havslandskap", subtitle: "Vatten, kust och hav", filter: "Havet", color: "#1A2A3A" },
  { title: "I rött", subtitle: "Passion och drama", filter: "Rött", color: "#3A1A1A" },
  { title: "Blommor", subtitle: "Natur i närbild", filter: "Blommor", color: "#2A2D1A" },
  { title: "1800-talet", subtitle: "Romantik och realism", filter: "1800-tal", color: "#2A2520" },
  { title: "Nattscener", subtitle: "Mörker och mystik", filter: "Natt", color: "#0F0F1A" },
  { title: "I blått", subtitle: "Melankoli och hav", filter: "Blått", color: "#1A1A2E" },
  { title: "Porträtt", subtitle: "Ansikten genom tiderna", filter: "Porträtt", color: "#2E2620" },
  { title: "1700-talet", subtitle: "Rokoko och upplysning", filter: "1700-tal", color: "#28261E" },
  { title: "Skulptur", subtitle: "Form i tre dimensioner", filter: "Skulptur", color: "#222222" },
];

export function meta({ data }: Route.MetaArgs) {
  const title = "Kabinett — Utforska Sveriges kulturarv";
  const total = data?.stats?.total ?? 0;
  const museums = data?.stats?.museums ?? 0;
  const description = `Upptäck över ${Math.floor(total / 1000) * 1000} verk från ${museums} svenska samlingar.`;
  const tags = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (data?.ogImageUrl) {
    tags.push(
      { property: "og:image", content: data.ogImageUrl },
      { name: "twitter:image", content: data.ogImageUrl }
    );
  }
  return tags;
}

export const links = ({ data }: { data?: { canonicalUrl?: string } } = {}) => {
  if (!data?.canonicalUrl) return [];
  return [{ rel: "canonical", href: data.canonicalUrl }];
};

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

const CURATED_POOL = [
  26034, 24215, 25407,
  18693, 24409, 20407,
  19423, 18654, 149858, 23703, 18506,
  19459, 19189, 20173,
  22514, 32542, 18870, 32544,
  18703,
  21452, 18510, 25383,
  18684, 18559, 132606, 19347,
  18899, 19456, 213756,
  19353, 21632, 137836,
  132618,
  243405,
  18013, 18402, 40203,
  22255, 18743,
  18157,
  17583, 21617, 22374,
  17611, 17603,
  17771, 17775,
  22701,
  23023,
  18131,
  19582, 19713,
  23465,
  244352,
  91112,
  14799, 177393,
  24217, 24219,
  22642,
  18868, 23281, 18856, 23115, 23843,
  18876, 18888, 23924, 18887, 23434,
  24311, 19218, 18633, 23461, 18895,
  39240, 18486, 21202, 19600, 19198,
  26295, 24204, 18837, 36992,
];

let homeCache: { data: HomeLoaderData; ts: number } | null = null;
const HOME_CACHE_TTL_MS = 300_000;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const canonicalUrl = `${url.origin}${url.pathname}`;

  if (homeCache && Date.now() - homeCache.ts < HOME_CACHE_TTL_MS) {
    return { ...homeCache.data, canonicalUrl };
  }

  const enabledMuseums = getEnabledMuseums();
  const sourceA = sourceFilter("a");
  const db = getDb();

  const shuffled = [...CURATED_POOL].sort(() => Math.random() - 0.5);
  const pickedIds = shuffled.slice(0, 5);
  const curatedRows = db.prepare(
    `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
            a.focal_x, a.focal_y,
            COALESCE(a.sub_museum, m.name) as museum_name
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE a.id IN (${pickedIds.join(",")})
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}`
  ).all(...sourceA.params) as FeedItemRow[];

  const curatedMap = new Map(curatedRows.map((row) => [row.id, row]));
  const curated = pickedIds
    .map((id) => curatedMap.get(id))
    .filter((row): row is FeedItemRow => Boolean(row))
    .map((row) => ({
      ...row,
      imageUrl: buildImageUrl(row.iiif_url, 400),
    }));

  const ogImageUrl = curated[0]?.iiif_url ? buildDirectImageUrl(curated[0].iiif_url, 800) : null;

  const preloadThemes = THEMES.slice(0, 3);
  const [initial, ...themeResults] = await Promise.all([
    fetchFeed({ cursor: null, limit: 15, filter: "Alla" }),
    ...preloadThemes.map((theme) => fetchFeed({ cursor: null, limit: 8, filter: theme.filter })),
  ]);

  const curatedIds = new Set(curated.map((item) => item.id));
  const restItems = initial.items.filter((item) => !curatedIds.has(item.id));

  const siteStats = getCachedSiteStats(db);
  const stats: StatsCardData = {
    total: siteStats.totalWorks,
    museums: siteStats.museums,
    paintings: siteStats.paintings,
    yearsSpan: siteStats.yearsSpan,
  };

  const topArtists = db.prepare(
    `SELECT a.artists, COUNT(*) as cnt
     FROM artworks a
     WHERE a.artists IS NOT NULL
       AND a.artists != ''
       AND a.artists != '[]'
       AND a.artists != '[null]'
       AND a.artists NOT LIKE '%Okänd%'
       AND a.artists NOT LIKE '%okänd%'
       AND ${sourceA.sql}
     GROUP BY a.artists
     ORDER BY cnt DESC
     LIMIT 20`
  ).all(...sourceA.params) as Array<{ artists: string | null }>;

  let spotlight: SpotlightCardData | null = null;
  if (topArtists.length > 0) {
    const pickedArtist = topArtists[Math.floor(Math.random() * topArtists.length)]?.artists;
    if (pickedArtist) {
      const spotlightRows = db.prepare(
        `SELECT a.id, a.title_sv, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                a.focal_x, a.focal_y,
                COALESCE(a.sub_museum, m.name) as museum_name
         FROM artworks a
         LEFT JOIN museums m ON m.id = a.source
         WHERE a.artists = ?
           AND a.iiif_url IS NOT NULL
           AND ${sourceA.sql}
         LIMIT 5`
      ).all(pickedArtist, ...sourceA.params) as FeedItemRow[];

      if (spotlightRows.length > 0) {
        spotlight = {
          artistName: parseArtist(pickedArtist),
          items: spotlightRows.map((row) => ({
            ...row,
            imageUrl: buildImageUrl(row.iiif_url, 200),
          })),
        };
      }
    }
  }

  const result: HomeLoaderData = {
    initialItems: [...curated, ...restItems],
    initialCursor: initial.nextCursor,
    initialHasMore: initial.hasMore,
    preloadedThemes: preloadThemes.map((theme, i) => ({ ...theme, items: themeResults[i].items })).filter((theme) => theme.items.length > 0),
    showMuseumBadge: enabledMuseums.length > 1,
    stats,
    spotlight,
    ogImageUrl,
    canonicalUrl,
    origin: url.origin,
  };

  homeCache = { data: result, ts: Date.now() };
  return result;
}

function getCardVariant(positionInFeed: number): CardVariant {
  const p = positionInFeed % 6;
  if (p === 0) return "large";
  return "small";
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Kabinett",
    url: loaderData.canonicalUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${loaderData.origin}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  const [feed, setFeed] = useState<FeedEntry[]>(() => {
    const entries: FeedEntry[] = [];
    const initial = loaderData.initialItems;
    const themes = loaderData.preloadedThemes || [];
    for (let i = 0; i < initial.length; i++) {
      entries.push({ type: "art", item: initial[i] });
      if (i === 2 && themes[0]) {
        entries.push({ type: "theme", ...themes[0] });
        entries.push({ type: "walkPromo" });
      }
      if (i === 4 && loaderData.spotlight) {
        entries.push({ type: "spotlight", ...loaderData.spotlight });
      }
      if (i === 6 && themes[1]) {
        entries.push({ type: "theme", ...themes[1] });
      }
      if (i === 8) {
        entries.push({ type: "stats", ...loaderData.stats });
      }
      if (i === 10 && themes[2]) {
        entries.push({ type: "theme", ...themes[2] });
      }
    }

    if (initial.length <= 8) {
      entries.push({ type: "stats", ...loaderData.stats });
    }

    if (themes.length > 0 && !entries.some((entry) => entry.type === "theme")) {
      entries.push({ type: "theme", ...themes[0] });
      entries.push({ type: "walkPromo" });
    }

    if (initial.length <= 12 && loaderData.spotlight && !entries.some((entry) => entry.type === "spotlight")) {
      entries.push({ type: "spotlight", ...loaderData.spotlight });
    }

    return entries;
  });

  const [searchActive, setSearchActive] = useState(false);

  const [cursor, setCursor] = useState<number | null>(loaderData.initialCursor ?? null);
  const [hasMore, setHasMore] = useState(loaderData.initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [themeIndex, setThemeIndex] = useState(loaderData.preloadedThemes?.length ?? 1);
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set(loaderData.initialItems.map((item: FeedItem) => item.id)));

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const bgColor = useMemo(() => {
    const firstArt = feed.find((entry): entry is ArtCard => entry.type === "art");
    const hex = firstArt?.item.dominant_color || "#1A1815";
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return "#0F0E0D";
    const mix = 0.15;
    const r = Math.round(parseInt(m[1], 16) * mix);
    const g = Math.round(parseInt(m[2], 16) * mix);
    const b = Math.round(parseInt(m[3], 16) * mix);
    return `rgb(${r},${g},${b})`;
  }, [feed]);

  useEffect(() => {
    document.body.style.backgroundColor = bgColor;
    document.body.style.color = "#F5F0E8";
    return () => {
      document.body.style.backgroundColor = "";
      document.body.style.color = "";
    };
  }, [bgColor]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/feed?filter=Alla&limit=12&cursor=${cursor ?? ""}`);
      if (!res.ok) throw new Error("Kunde inte hämta fler verk");
      const data = await res.json();
      const nextItems: FeedItem[] = (data.items || []).filter((item: FeedItem) => !loadedIds.has(item.id));

      const newEntries: FeedEntry[] = [];
      for (const item of nextItems) {
        newEntries.push({ type: "art", item });
      }

      if (themeIndex < THEMES.length) {
        const theme = THEMES[themeIndex];
        try {
          const themeRes = await fetch(`/api/feed?filter=${encodeURIComponent(theme.filter)}&limit=8`);
          if (!themeRes.ok) throw new Error("Kunde inte hämta tema");
          const themeData = await themeRes.json();
          if (themeData.items?.length > 0) {
            const insertAt = Math.min(5, newEntries.length);
            newEntries.splice(insertAt, 0, {
              type: "theme",
              ...theme,
              items: themeData.items,
            });
          }
        } catch {
          // skip theme on error
        }
        setThemeIndex((prev: number) => prev + 1);
      }

      setFeed((prev) => [...prev, ...newEntries]);
      setLoadedIds((prev) => {
        const next = new Set(prev);
        nextItems.forEach((item) => next.add(item.id));
        return next;
      });
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setHasMore(false);
      setLoadError("Kunde inte ladda fler verk just nu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, cursor, themeIndex]);

  return (
    <div className="min-h-screen overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
      />
      <div className="md:max-w-4xl lg:max-w-7xl md:mx-auto md:px-6 lg:px-8">
        <HeroSearch totalWorks={loaderData.stats.total} showMuseumBadge={loaderData.showMuseumBadge} onSearchActive={setSearchActive} />

        {!searchActive && <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-2 lg:grid-flow-dense">
          {(() => {
            let artPosition = -1;
            return feed.map((entry, index) => {
              if (entry.type === "art") {
                artPosition += 1;
                return (
                  <ArtworkCard
                    key={`art-${entry.item.id}-${index}`}
                    item={entry.item}
                    index={artPosition}
                    variant={getCardVariant(artPosition)}
                    showMuseumBadge={loaderData.showMuseumBadge}
                  />
                );
              }

              if (entry.type === "stats") {
                return (
                  <div key="stats" className="lg:col-span-3">
                    <StatsSection stats={entry} />
                  </div>
                );
              }

              if (entry.type === "spotlight") {
                return (
                  <div key={`spotlight-${entry.artistName}-${index}`} className="lg:col-span-3">
                    <SpotlightCard spotlight={entry} />
                  </div>
                );
              }

              if (entry.type === "walkPromo") {
                return (
                  <div key={`walks-${index}`} className="lg:col-span-3">
                    <WalkPromoCard />
                  </div>
                );
              }

              return (
                <div key={`theme-${entry.title}-${index}`} className="lg:col-span-3">
                  <ThemeCard section={entry} showMuseumBadge={loaderData.showMuseumBadge} />
                </div>
              );
            });
          })()}
        </div>}

        {!searchActive && <div ref={sentinelRef} className="h-px" />}
        {!searchActive && loading && (
          <div aria-live="polite" className="text-center p-8 text-[rgba(255,255,255,0.3)] text-[0.8rem]">
            Laddar mer konst…
          </div>
        )}
        {!searchActive && loadError && !loading && (
          <div aria-live="polite" className="text-center p-8 text-[rgba(255,255,255,0.45)] text-[0.8rem]">
            {loadError}
          </div>
        )}
      </div>
    </div>
  );
}
