import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtworkCard, { type CardVariant } from "../components/ArtworkCard";
import HeroSearch from "../components/HeroSearch";
import SpotlightCard, { type SpotlightCardData } from "../components/SpotlightCard";
import StatsSection, { type StatsCardData } from "../components/StatsSection";
import ThemeCard, { type ThemeCardSection } from "../components/ThemeCard";
import WalkPromoCard from "../components/WalkPromoCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { useScrollReveal } from "../hooks/useScrollReveal";
import { homeLoader, type HomeLoaderData } from "./home.loader.server";
import { getThemes } from "../lib/themes";
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
  const total = data?.stats?.total ?? 0;
  const museums = data?.stats?.museums ?? 0;
  const roundedTotal = total >= 1000 ? Math.floor(total / 1000) * 1000 : total;
  const title = data?.metaTitle || "Kabinett — Utforska Sveriges kulturarv";
  const description = data?.metaDescription || `Upptäck över ${roundedTotal} verk från ${museums} svenska samlingar.`;
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
  if (data?.noindex) {
    tags.push({ name: "robots", content: "noindex,nofollow" });
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

function getCardVariant(positionInFeed: number, item?: { iiif_url?: string | null }): CardVariant {
  const p = positionInFeed % 6;
  // SHM images max out at ~400px — never show them as large cards
  const isSHM = item?.iiif_url?.includes("media.samlingar.shm.se");
  if (p === 0 && !isSHM) return "large";
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
      // Insert full-width modules only after a completed desktop row.
      // With the current card mix, 5 artworks fills the first 3-column block
      // without leaving a gap before a col-span-3 section.
      if (i === 4 && themes[0]) {
        entries.push({ type: "theme", ...themes[0] });
        entries.push({ type: "walkPromo" });
      }
      if (i === 9 && loaderData.spotlight) {
        entries.push({ type: "spotlight", ...loaderData.spotlight });
      }
      if (i === 11 && themes[1]) {
        entries.push({ type: "theme", ...themes[1] });
      }
      if (i === 14) {
        entries.push({ type: "stats", ...loaderData.stats });
      }
      if (i === 16 && themes[2]) {
        entries.push({ type: "theme", ...themes[2] });
      }
    }

    if (initial.length <= 14) {
      entries.push({ type: "stats", ...loaderData.stats });
    }

    if (themes.length > 0 && !entries.some((entry) => entry.type === "theme")) {
      entries.push({ type: "theme", ...themes[0] });
      entries.push({ type: "walkPromo" });
    }

    if (initial.length <= 10 && loaderData.spotlight && !entries.some((entry) => entry.type === "spotlight")) {
      entries.push({ type: "spotlight", ...loaderData.spotlight });
    }

    return entries;
  });

  const [hasMore, setHasMore] = useState(loaderData.initialHasMore);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<number | null>(loaderData.initialCursor ?? null);
  const themeIndexRef = useRef(loaderData.preloadedThemes?.length ?? 1);
  const loadedIdsRef = useRef<Set<number>>(new Set(loaderData.initialItems.map((item: FeedItem) => item.id)));
  const inFlightRef = useRef(false);

  const bgColor = useMemo(() => {
    const firstArt = feed.find((entry): entry is ArtCard => entry.type === "art");
    const hex = firstArt?.item.dominant_color || "#1A1815";
    const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return "#0F0E0D";
    const mix = 0.25;
    const floor = 22;
    const r = Math.max(floor, Math.round(parseInt(m[1], 16) * mix));
    const g = Math.max(floor, Math.round(parseInt(m[2], 16) * mix));
    const b = Math.max(floor, Math.round(parseInt(m[3], 16) * mix));
    return `rgb(${r},${g},${b})`;
  }, [feed]);

  // Lazy-load spotlight client-side
  useEffect(() => {
    if (loaderData.spotlight) return; // already have it from server
    fetch("/api/spotlight")
      .then(r => r.json())
      .then(data => {
        if (!data) return;
        setFeed(prev => {
          if (prev.some(e => e.type === "spotlight")) return prev;
          // Insert after position 4 or at end
          const idx = Math.min(5, prev.length);
          const next = [...prev];
          next.splice(idx, 0, { type: "spotlight", ...data });
          return next;
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.body.style.backgroundColor = bgColor;
    document.body.style.color = "#F5F0E8";
    return () => {
      document.body.style.backgroundColor = "";
      document.body.style.color = "";
    };
  }, [bgColor]);

  const loadMore = useCallback(async () => {
    if (inFlightRef.current || !hasMore) return;
    inFlightRef.current = true;
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/feed?filter=Alla&limit=12&cursor=${cursorRef.current ?? ""}`);
      if (!res.ok) throw new Error("Kunde inte hämta fler verk");
      const data = await res.json() as { items?: FeedItem[]; nextCursor?: number | null; hasMore?: boolean };
      const nextItems: FeedItem[] = (data.items || []).filter((item: FeedItem) => !loadedIdsRef.current.has(item.id));

      const newEntries: FeedEntry[] = nextItems.map((item) => ({ type: "art", item }));

      if (nextItems.length > 0) {
        const campaignThemes = getThemes(loaderData.campaignId);
        if (themeIndexRef.current < campaignThemes.length) {
          const theme = campaignThemes[themeIndexRef.current];
          try {
            const themeRes = await fetch(`/api/feed?filter=${encodeURIComponent(theme.filter)}&limit=8`);
            if (!themeRes.ok) throw new Error("Kunde inte hämta tema");
            const themeData = await themeRes.json() as { items?: FeedItem[] };
            if (themeData.items?.length) {
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
          themeIndexRef.current += 1;
        }
      }

      if (newEntries.length > 0) {
        setFeed((prev) => [...prev, ...newEntries]);
      }

      nextItems.forEach((item) => loadedIdsRef.current.add(item.id));
      cursorRef.current = data.nextCursor ?? null;
      setHasMore(Boolean(data.hasMore));
    } catch {
      setLoadError("Kunde inte ladda fler verk just nu.");
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [hasMore, loaderData.campaignId]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore || loading) return;
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
  }, [hasMore, loading, loadMore]);

  const scrollRef = useScrollReveal<HTMLDivElement>();

  return (
    <div className="min-h-screen overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteJsonLd) }}
      />
      <div ref={scrollRef} className="md:max-w-4xl lg:max-w-7xl md:mx-auto md:px-6 lg:px-8">
        <HeroSearch
          totalWorks={loaderData.stats.total}
          headline={loaderData.heroHeadline}
          subline={loaderData.heroSubline}
          introText={loaderData.heroIntro}
          isCampaign={loaderData.noindex}
          campaignId={loaderData.campaignId}
        />

        {<div className="grid grid-cols-1 md:gap-1.5 lg:grid-cols-3 lg:gap-2 lg:grid-flow-dense">
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
                    variant={getCardVariant(artPosition, entry.item)}
                    showMuseumBadge={loaderData.showMuseumBadge}
                  />
                );
              }

              if (entry.type === "stats") {
                if (loaderData.noindex) return null; // Skip stats card in campaign mode
                return (
                  <div key="stats" className="lg:col-span-3 mt-4 mb-2 md:mt-6 md:mb-3 lg:mt-10 lg:mb-5">
                    <StatsSection stats={entry} museumName={loaderData.museumName} />
                  </div>
                );
              }

              if (entry.type === "spotlight") {
                return (
                  <div key={`spotlight-${entry.artistName}-${index}`} className="lg:col-span-3 mt-4 mb-2 md:mt-6 md:mb-3 lg:mt-10 lg:mb-5">
                    <SpotlightCard spotlight={entry} />
                  </div>
                );
              }

              if (entry.type === "walkPromo") {
                // All campaigns now have walks
                return (
                  <div key={`walks-${index}`} className="lg:col-span-3 mt-4 mb-2 md:mt-6 md:mb-3 lg:mt-10 lg:mb-5">
                    <WalkPromoCard campaignId={loaderData.campaignId} />
                  </div>
                );
              }

              return (
                <div key={`theme-${entry.title}-${index}`} className="lg:col-span-3 mt-4 mb-2 md:mt-6 md:mb-3 lg:mt-10 lg:mb-5">
                  <ThemeCard section={entry} showMuseumBadge={loaderData.showMuseumBadge} />
                </div>
              );
            });
          })()}
        </div>}

        {<div ref={sentinelRef} className="h-px" />}
        {loading && (
          <div aria-live="polite" className="text-center p-8 text-dark-text-muted text-[0.8rem]">
            Laddar mer konst…
          </div>
        )}
        {loadError && !loading && (
          <div aria-live="polite" className="text-center p-8">
            <p className="text-dark-text-muted text-[0.8rem] mb-3">{loadError}</p>
            <button
              type="button"
              onClick={() => { setLoadError(""); void loadMore(); }}
              className="px-4 py-2 rounded-full bg-dark-raised text-dark-text-secondary text-sm font-medium hover:bg-dark-hover hover:text-dark-text transition-colors focus-ring"
            >
              Försök igen
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
