import { useEffect, useMemo, useRef, useState } from "react";
import ArtworkCard, { type CardVariant } from "../components/ArtworkCard";
import HeroSearch from "../components/HeroSearch";
import SpotlightCard, { type SpotlightCardData } from "../components/SpotlightCard";
import StatsSection, { type StatsCardData } from "../components/StatsSection";
import ThemeCard, { type ThemeCardSection } from "../components/ThemeCard";
import WalkPromoCard from "../components/WalkPromoCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { homeLoader, type HomeLoaderData } from "./home.loader.server";
import { THEMES } from "../lib/themes";
import type { Route } from "./+types/home";

function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "\\u003C/");
}

type FeedItem = ArtworkDisplayItem;

type ThemeSectionEntry = { type: "theme" } & ThemeCardSection;
type StatsCardEntry = { type: "stats" } & StatsCardData;
type ArtCard = { type: "art"; item: FeedItem };
type SpotlightCardEntry = { type: "spotlight" } & SpotlightCardData;
type WalkPromoCardEntry = { type: "walkPromo" };
type FeedEntry = ArtCard | ThemeSectionEntry | StatsCardEntry | SpotlightCardEntry | WalkPromoCardEntry;

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

export async function loader({ request }: Route.LoaderArgs) {
  return homeLoader(request);
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
