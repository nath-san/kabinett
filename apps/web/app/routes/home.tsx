import type { Route } from "./+types/home";
import React, { useEffect, useMemo, useRef, useState } from "react";
// Search removed — now lives at /search via bottom nav
import { getDb } from "../lib/db.server";
import { fetchFeed } from "../lib/feed.server";
import { useFavorites } from "../lib/favorites";
import { buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getCachedSiteStats } from "../lib/stats.server";

function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "\\u003C/");
}

type FeedItem = {
  id: number;
  title_sv: string | null;
  artists: string | null;
  dating_text: string | null;
  iiif_url: string;
  dominant_color: string | null;
  category: string | null;
  technique_material: string | null;
  imageUrl: string;
  museum_name: string | null;
};

type ThemeSection = {
  type: "theme";
  title: string;
  subtitle: string;
  filter: string;
  color: string;
  items: FeedItem[];
};

type StatsCard = {
  type: "stats";
  total: number;
  museums: number;
  paintings: number;
  yearsSpan: number;
};
type ArtCard = { type: "art"; item: FeedItem };
type FeedEntry = ArtCard | ThemeSection | StatsCard;

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
  const description = "Upptäck över en miljon verk från nio svenska samlingar.";
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

// Pool of ~100 iconic artworks — 5 random picked each load
// Curated for variety: max 2–3 per artist, mix of periods and styles
const CURATED_POOL = [
  // Carl Larsson
  26034, 24215, 25407,
  // Anders Zorn
  18693, 24409, 20407,
  // Bruno Liljefors
  19423, 18654, 149858, 23703, 18506,
  // Ernst Josephson
  19459, 19189, 20173,
  // Carl Fredrik Hill
  22514, 32542, 18870, 32544,
  // Eugène Jansson
  18703,
  // Richard Bergh
  21452, 18510, 25383,
  // Nils Kreuger
  18684, 18559, 132606, 19347,
  // Karl Nordström
  18899, 19456, 213756,
  // Hanna Pauli
  19353, 21632, 137836,
  // Eva Bonnier
  132618,
  // Julia Beck
  243405,
  // Alexander Roslin
  18013, 18402, 40203,
  // Gustaf Cederström
  22255, 18743,
  // Georg von Rosen
  18157,
  // Rembrandt
  17583, 21617, 22374,
  // Rubens
  17611, 17603,
  // Boucher
  17771, 17775,
  // Watteau
  22701,
  // El Greco
  23023,
  // Cranach
  18131,
  // Albert Edelfelt
  19582, 19713,
  // Jenny Nyström
  23465,
  // Isaac Grünewald
  244352,
  // Johan Tobias Sergel
  91112,
  // David Klöcker Ehrenstrahl
  14799, 177393,
  // Carl Larsson (Ett hem-serien)
  24217, 24219,
  // Goya
  22642,
  // Tiepolo — check if exists
  // More variety
  18868, 23281, 18856, 23115, 23843,
  18876, 18888, 23924, 18887, 23434,
  24311, 19218, 18633, 23461, 18895,
  39240, 18486, 21202, 19600, 19198,
  26295, 24204, 18837, 36992,
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const canonicalUrl = `${url.origin}${url.pathname}`;
  const enabledMuseums = getEnabledMuseums();
  const sourceA = sourceFilter("a");

  // Load curated hero artworks first
  const db = getDb();
  // Pick 5 random from pool
  const shuffled = [...CURATED_POOL].sort(() => Math.random() - 0.5);
  const pickedIds = shuffled.slice(0, 5);
  const curatedRows = db.prepare(
    `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
            COALESCE(a.sub_museum, m.name) as museum_name
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE a.id IN (${pickedIds.join(",")})
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}`
  ).all(...sourceA.params) as any[];
  const curatedMap = new Map(curatedRows.map((r: any) => [r.id, r]));
  const curated = pickedIds
    .map((id) => curatedMap.get(id))
    .filter(Boolean)
    .map((r: any) => ({
      ...r,
      imageUrl: buildImageUrl(r.iiif_url, 400),
    }));
  const ogImageUrl = curated[0]?.imageUrl || null;

  // Load first rows in parallel
  const firstTheme = THEMES[0];
  const [initial, themeItems] = await Promise.all([
    fetchFeed({ cursor: null, limit: 15, filter: "Alla" }),
    fetchFeed({ cursor: null, limit: 8, filter: firstTheme.filter }),
  ]);

  // Prepend curated, deduplicate
  const curatedIds = new Set(curated.map((c: any) => c.id));
  const restItems = initial.items.filter((item: any) => !curatedIds.has(item.id));

  // Stats for the collection card (cached in memory — read-only DB, never changes between deploys)
  const siteStats = getCachedSiteStats(db);
  const stats = {
    total: siteStats.totalWorks,
    museums: siteStats.museums,
    paintings: siteStats.paintings,
    yearsSpan: siteStats.yearsSpan,
  };

  return {
    initialItems: [...curated, ...restItems],
    initialCursor: initial.nextCursor,
    initialHasMore: initial.hasMore,
    firstTheme: { ...firstTheme, items: themeItems.items },
    showMuseumBadge: enabledMuseums.length > 1,
    stats,
    ogImageUrl,
    canonicalUrl,
    origin: url.origin,
  };
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
    // First 6 artworks (fills 2 rows of 3 on desktop), then theme, then rest
    for (let i = 0; i < Math.min(6, initial.length); i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    if (loaderData.firstTheme.items.length > 0) {
      entries.push({ type: "theme", ...loaderData.firstTheme });
    }
    // Add more artworks then stats (9 = 3 rows of 3)
    for (let i = 6; i < Math.min(9, initial.length); i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    entries.push({ type: "stats", ...loaderData.stats });
    for (let i = 9; i < initial.length; i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    return entries;
  });

  const [cursor, setCursor] = useState<number | null>(loaderData.initialCursor ?? null);
  const [hasMore, setHasMore] = useState(loaderData.initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [themeIndex, setThemeIndex] = useState(1); // already loaded index 0
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set(loaderData.initialItems.map((i: FeedItem) => i.id)));

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Dark mode — use first artwork's color
  const firstColor = useMemo(() => {
    const firstArt = feed.find((entry) => entry.type === "art") as ArtCard | undefined;
    return firstArt?.item.dominant_color || "#1A1815";
  }, [feed]);
  useEffect(() => {
    // On mobile: use artwork color. On desktop: always dark neutral
    const mql = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      document.body.style.backgroundColor = mql.matches ? "#0F0E0D" : firstColor;
      document.body.style.color = "#F5F0E8";
    };
    update();
    mql.addEventListener("change", update);
    return () => { mql.removeEventListener("change", update); document.body.style.backgroundColor = ""; document.body.style.color = ""; };
  }, [firstColor]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setLoadError("");
    try {
      // Fetch next batch of artworks
      const res = await fetch(`/api/feed?filter=Alla&limit=12&cursor=${cursor ?? ""}`);
      if (!res.ok) throw new Error("Kunde inte hämta fler verk");
      const data = await res.json();
      const nextItems: FeedItem[] = (data.items || []).filter((item: FeedItem) => !loadedIds.has(item.id));

      const newEntries: FeedEntry[] = [];
      for (const item of nextItems) {
        newEntries.push({ type: "art", item });
      }

      // Every load, try to insert a theme section
      if (themeIndex < THEMES.length) {
        const theme = THEMES[themeIndex];
        try {
          const themeRes = await fetch(`/api/feed?filter=${encodeURIComponent(theme.filter)}&limit=8`);
          if (!themeRes.ok) throw new Error("Kunde inte hämta tema");
          const themeData = await themeRes.json();
          if (themeData.items?.length > 0) {
            // Insert theme after ~5 artworks
            const insertAt = Math.min(5, newEntries.length);
            newEntries.splice(insertAt, 0, {
              type: "theme",
              ...theme,
              items: themeData.items,
            });
          }
        } catch { /* skip theme on error */ }
        setThemeIndex((prev) => prev + 1);
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

  // Infinite scroll observer
  useEffect(() => {
    const target = sentinelRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
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
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-2 lg:grid-flow-dense">
          {feed.map((entry, i) =>
            entry.type === "art" ? (
              <ArtworkCard key={`art-${entry.item.id}-${i}`} item={entry.item} index={i} showMuseumBadge={loaderData.showMuseumBadge} />
            ) : entry.type === "stats" ? (
              <div key="stats" className="lg:col-span-3">
                <StatsSection stats={entry} />
              </div>
            ) : (
              <div key={`theme-${entry.title}-${i}`} className="lg:col-span-3">
                <ThemeCard section={entry} showMuseumBadge={loaderData.showMuseumBadge} />
              </div>
            )
          )}
        </div>
        <div ref={sentinelRef} className="h-px" />
        {loading && (
          <div aria-live="polite" className="text-center p-8 text-[rgba(255,255,255,0.3)] text-[0.8rem]">
            Laddar mer konst…
          </div>
        )}
        {loadError && !loading && (
          <div aria-live="polite" className="text-center p-8 text-[rgba(255,255,255,0.45)] text-[0.8rem]">
            {loadError}
          </div>
        )}
      </div>
    </div>
  );
}

const ArtworkCard = React.memo(function ArtworkCard({ item, index, showMuseumBadge }: { item: FeedItem; index: number; showMuseumBadge: boolean }) {
  const eager = index < 3;
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(item.id);
  const [pulsing, setPulsing] = useState(false);
  return (
    <a
      href={`/artwork/${item.id}`}
      className={`block relative w-full h-[100vh] md:h-[85vh] lg:h-auto lg:aspect-[3/4] lg:max-h-[32rem] no-underline text-inherit overflow-hidden contain-[layout_paint] lg:rounded-xl group/card focus-ring ${index === 0 ? "lg:col-span-2 lg:aspect-[3/2]" : ""}`}
      style={{ backgroundColor: item.dominant_color || "#1A1815" }}
    >
      <img
        src={item.imageUrl}
        alt={`${item.title_sv || "Utan titel"} — ${parseArtist(item.artists)}`}
        loading={eager ? "eager" : "lazy"}
        decoding="auto"
        fetchPriority={eager ? "high" : undefined}
        onLoad={eager ? undefined : (e) => {
          const img = e.currentTarget;
          img.classList.remove("opacity-0");
          img.classList.add("opacity-100");
        }}
        onError={(e) => {
          e.currentTarget.classList.add("is-broken");
        }}
        className={[
          "absolute inset-0 w-full h-full object-cover",
          eager ? "" : "opacity-0 lg:opacity-100",
        ].join(" ")}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.1)_35%,transparent_60%)] pointer-events-none lg:opacity-70 lg:group-hover/card:opacity-100 lg:transition-opacity lg:duration-500" />
      <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-7">
        <p className="font-serif text-[1.5rem] lg:text-[1.7rem] font-semibold text-white leading-[1.2] mb-[0.35rem]">
          {item.title_sv || "Utan titel"}
        </p>
        <p className="text-[0.85rem] lg:text-[0.9rem] text-[rgba(255,255,255,0.6)]">
          {parseArtist(item.artists)}
        </p>
        {showMuseumBadge && item.museum_name && item.museum_name !== 'Statens historiska museer' && (
          <p className="text-[0.7rem] text-warm-gray mt-[0.15rem]">
            {item.museum_name}
          </p>
        )}
        {item.dating_text && (
          <p className="text-[0.75rem] lg:text-[0.8rem] text-[rgba(255,255,255,0.35)] mt-[0.2rem]">
            {item.dating_text}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={saved ? "Ta bort favorit" : "Spara som favorit"}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!saved) {
            setPulsing(true);
            window.setTimeout(() => setPulsing(false), 350);
          }
          toggle(item.id);
        }}
        className={[
          "absolute right-5 bottom-5 lg:right-6 lg:bottom-6 w-11 h-11 lg:w-[2.75rem] lg:h-[2.75rem] rounded-full border border-[rgba(255,255,255,0.2)] text-white inline-flex items-center justify-center cursor-pointer backdrop-blur-[6px] transition-[transform,background] ease-[ease] duration-[200ms]",
          "focus-ring",
          saved ? "bg-[rgba(196,85,58,0.95)]" : "bg-[rgba(0,0,0,0.4)]",
          pulsing ? "heart-pulse" : "",
        ].join(" ")}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.8 5.6c-1.4-1.6-3.9-1.6-5.3 0L12 9.1 8.5 5.6c-1.4-1.6-3.9-1.6-5.3 0-1.6 1.8-1.4 4.6.2 6.2L12 21l8.6-9.2c1.6-1.6 1.8-4.4.2-6.2z" />
        </svg>
      </button>
    </a>
  );
});

function StatsSection({ stats }: { stats: StatsCard }) {
  const items = [
    { value: stats.total.toLocaleString("sv"), label: "verk" },
    { value: stats.museums.toLocaleString("sv"), label: "samlingar" },
    { value: `${stats.yearsSpan} år`, label: "år av historia" },
    { value: stats.paintings.toLocaleString("sv"), label: "målningar" },
  ];
  return (
    <div className="py-12 md:py-16 lg:py-20 px-6 md:px-8 bg-[linear-gradient(135deg,#1A1815_0%,#2B2520_100%)] text-center lg:rounded-[1.5rem]">
      <p className="text-[0.65rem] font-semibold tracking-[0.2em] uppercase text-[rgba(255,255,255,0.35)]">
        Sveriges kulturarv
      </p>
      <h2 className="font-serif text-[2rem] lg:text-[2.6rem] text-[#F5F0E8] mt-2 mb-6 leading-[1.1]">
        Samlingen i siffror
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-4 lg:gap-x-8 lg:gap-y-6 max-w-[18rem] md:max-w-[30rem] lg:max-w-5xl mx-auto">
        {items.map((item) => (
          <div key={item.label}>
            <p className="font-serif text-[1.6rem] md:text-[2rem] lg:text-[2.7rem] font-semibold text-[#F5F0E8] m-0 leading-none">
              {item.value}
            </p>
            <p className="text-[0.6rem] md:text-[0.65rem] lg:text-[0.7rem] text-[rgba(245,240,232,0.45)] mt-1 uppercase tracking-[0.08em]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
      <a
        href="/discover"
        className="inline-block mt-6 py-[0.6rem] px-6 rounded-full border border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.7)] text-[0.78rem] font-medium no-underline tracking-[0.02em] focus-ring"
      >
        Upptäck samlingen →
      </a>
    </div>
  );
}

function ThemeCard({ section, showMuseumBadge }: { section: ThemeSection; showMuseumBadge: boolean }) {
  return (
    <div
      className="pt-12 px-4 md:px-6 lg:px-8 pb-8 snap-start lg:rounded-[1.5rem] lg:overflow-hidden"
      style={{ backgroundColor: section.color }}
    >
      {/* Theme header */}
      <p className="text-[0.7rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.4)] font-medium">
        Tema
      </p>
      <h2 className="font-serif text-[2rem] font-semibold text-white mt-2 leading-[1.1]">
        {section.title}
      </h2>
      <p className="text-[0.85rem] text-[rgba(255,255,255,0.5)] mt-[0.35rem]">
        {section.subtitle}
      </p>

      {/* Horizontal scroll of themed artworks */}
      <div className="flex gap-3 md:gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-4 lg:gap-4 overflow-x-auto lg:overflow-visible pt-6 pb-2 lg:pb-0 snap-x snap-mandatory lg:snap-none no-scrollbar">
        {section.items.map((item: FeedItem) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            className="shrink-0 w-[70vw] max-w-[280px] lg:w-auto lg:max-w-none rounded-xl overflow-hidden no-underline text-inherit snap-start lg:snap-none focus-ring"
            style={{ backgroundColor: item.dominant_color || "#1A1815" }}
          >
            <div
              className="aspect-[3/4] overflow-hidden"
              style={{ backgroundColor: item.dominant_color || "#1A1815" }}
            >
              <img
                src={buildImageUrl(item.iiif_url, 400)}
                alt={`${item.title_sv || "Utan titel"} — ${parseArtist(item.artists)}`}
                loading="lazy"
                width={400}
                height={533}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  img.classList.remove("opacity-0");
                  img.classList.add("opacity-100");
                }}
                onError={(e) => {
                  e.currentTarget.classList.add("is-broken");
                }}
                className="w-full h-full object-cover opacity-0 transition-opacity duration-[400ms] ease-[ease]"
              />
            </div>
            <div className="py-[0.6rem] px-3">
              <p className="text-[0.8rem] font-medium text-white leading-[1.3] overflow-hidden line-clamp-2">
                {item.title_sv || "Utan titel"}
              </p>
              <p className="text-[0.7rem] text-[rgba(255,255,255,0.5)] mt-[0.15rem]">
                {parseArtist(item.artists)}
              </p>
              {showMuseumBadge && item.museum_name && item.museum_name !== 'Statens historiska museer' && (
                <p className="text-[0.65rem] text-warm-gray mt-[0.15rem]">
                  {item.museum_name}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>

      {/* "Visa fler" link */}
      <a href={`/search?q=${encodeURIComponent(section.filter || section.title)}`} className="inline-block mt-4 text-[0.8rem] text-[rgba(255,255,255,0.5)] no-underline focus-ring">
        Visa fler →
      </a>
    </div>
  );
}
