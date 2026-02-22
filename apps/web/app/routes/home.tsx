import type { Route } from "./+types/home";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchFeed } from "../lib/feed.server";
import { useFavorites } from "../lib/favorites";

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
};

type ThemeSection = {
  type: "theme";
  title: string;
  subtitle: string;
  filter: string;
  color: string;
  items: FeedItem[];
};

type ArtCard = { type: "art"; item: FeedItem };
type FeedEntry = ArtCard | ThemeSection;

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

export function meta() {
  return [
    { title: "Kabinett — Upptäck svensk konst" },
    { name: "description", content: "Scrolla genom Nationalmuseums samling." },
  ];
}

export function headers() {
  return { "Cache-Control": "public, max-age=60" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const initial = await fetchFeed({ cursor: null, limit: 15, filter: "Alla", origin: url.origin });

  // Load first theme section
  const firstTheme = THEMES[0];
  const themeItems = await fetchFeed({ cursor: null, limit: 6, filter: firstTheme.filter, origin: url.origin });

  return {
    initialItems: initial.items,
    initialCursor: initial.nextCursor,
    initialHasMore: initial.hasMore,
    firstTheme: { ...firstTheme, items: themeItems.items },
  };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; } catch { return "Okänd konstnär"; }
}

function iiif(url: string, size: number): string {
  return url.replace("http://", "https://") + `full/${size},/0/default.jpg`;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FeedItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const [feed, setFeed] = useState<FeedEntry[]>(() => {
    const entries: FeedEntry[] = [];
    const initial = loaderData.initialItems;
    // First 5 artworks, then first theme, then rest
    for (let i = 0; i < Math.min(5, initial.length); i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    if (loaderData.firstTheme.items.length > 0) {
      entries.push({ type: "theme", ...loaderData.firstTheme });
    }
    for (let i = 5; i < initial.length; i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    return entries;
  });

  const [cursor, setCursor] = useState<number | null>(loaderData.initialCursor ?? null);
  const [hasMore, setHasMore] = useState(loaderData.initialHasMore);
  const [loading, setLoading] = useState(false);
  const [themeIndex, setThemeIndex] = useState(1); // already loaded index 0
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set(loaderData.initialItems.map((i: FeedItem) => i.id)));

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Dark mode — use first artwork's color instead of pure black
  const showingSearch = query.trim().length > 0;
  const firstColor = useMemo(() => {
    if (showingSearch) {
      return searchResults[0]?.dominant_color || "#1A1815";
    }
    const firstArt = feed.find((entry) => entry.type === "art") as ArtCard | undefined;
    return firstArt?.item.dominant_color || "#1A1815";
  }, [feed, searchResults, showingSearch]);
  useEffect(() => {
    document.body.style.backgroundColor = firstColor;
    document.body.style.color = "#F5F0E8";
    return () => { document.body.style.backgroundColor = ""; document.body.style.color = ""; };
  }, [firstColor]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const res = await fetch(`/api/clip-search?q=${encodeURIComponent(trimmed)}&limit=20`, {
          signal: controller.signal,
        });
        const data = await res.json();
        const mapped: FeedItem[] = (data || []).map((item: any) => ({
          id: item.id,
          title_sv: item.title || item.title_sv || "Utan titel",
          artists: JSON.stringify([{ name: item.artist || "Okänd konstnär" }]),
          dating_text: item.year || "",
          iiif_url: "",
          dominant_color: item.color || "#1A1815",
          category: null,
          technique_material: null,
          imageUrl: item.heroUrl || item.imageUrl,
        }));
        setSearchResults(mapped);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      // Fetch next batch of artworks
      const res = await fetch(`/api/feed?filter=Alla&limit=12&cursor=${cursor ?? ""}`);
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
          const themeRes = await fetch(`/api/feed?filter=${encodeURIComponent(theme.filter)}&limit=6`);
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
    <div style={{
      minHeight: "100vh",
      overflowX: "hidden",
    }}>
      <div
        style={{
          position: "fixed",
          top: "3.75rem",
          left: 0,
          right: 0,
          zIndex: 55,
          padding: "0 1rem",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.65rem 0.9rem",
            borderRadius: "999px",
            background: "rgba(12,11,10,0.55)",
            border: "1px solid rgba(255,255,255,0.08)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
            pointerEvents: "auto",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(245,240,232,0.6)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Vad ser du?"
            aria-label="Vad ser du?"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "#F5F0E8",
              fontSize: "0.9rem",
              outline: "none",
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Rensa sök"
              style={{
                border: "none",
                background: "rgba(245,240,232,0.12)",
                color: "#F5F0E8",
                width: "1.6rem",
                height: "1.6rem",
                borderRadius: "999px",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {showingSearch ? (
        <div>
          {searchLoading && searchResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
              Letar i samlingen...
            </div>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.35)", fontSize: "0.85rem" }}>
              Inga träffar än. Prova ett nytt ord.
            </div>
          )}
          {searchResults.map((item, i) => (
            <ArtworkCard key={`search-${item.id}-${i}`} item={item} index={i} />
          ))}
        </div>
      ) : (
        <>
          {feed.map((entry, i) =>
            entry.type === "art" ? (
              <ArtworkCard key={`art-${entry.item.id}-${i}`} item={entry.item} index={i} />
            ) : (
              <ThemeCard key={`theme-${entry.title}-${i}`} section={entry} />
            )
          )}
          <div ref={sentinelRef} style={{ height: "1px" }} />
          {loading && (
            <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
              Laddar mer konst...
            </div>
          )}
        </>
      )}
    </div>
  );
}

const ArtworkCard = React.memo(function ArtworkCard({ item, index }: { item: FeedItem; index: number }) {
  const eager = index < 3;
  const { isFavorite, toggle } = useFavorites();
  const saved = isFavorite(item.id);
  const [pulsing, setPulsing] = useState(false);
  return (
    <a
      href={`/artwork/${item.id}`}
      style={{
        display: "block",
        position: "relative",
        width: "100%",
        height: "100vh",
        backgroundColor: item.dominant_color || "#1A1815",
        textDecoration: "none",
        color: "inherit",
        overflow: "hidden",
        contain: "layout paint",
      }}
    >
      <img
        src={item.imageUrl}
        alt={item.title_sv || ""}
        loading={eager ? "eager" : "lazy"}
        decoding={eager ? "sync" : "async"}
        fetchPriority={eager ? "high" : undefined}
        onLoad={eager ? undefined : (e) => { (e.target as HTMLImageElement).style.opacity = "1"; }}
        onError={(e) => {
          const card = (e.target as HTMLImageElement).closest("a");
          if (card) (card as HTMLElement).style.display = "none";
        }}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          ...(eager ? {} : { opacity: 0, transition: "opacity 0.4s ease" }),
        }}
      />
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 35%, transparent 60%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        padding: "1.5rem",
      }}>
        <p style={{
          fontFamily: '"Instrument Serif", Georgia, serif',
          fontSize: "1.5rem", fontWeight: 600, color: "#fff",
          lineHeight: 1.2, marginBottom: "0.35rem",
        }}>
          {item.title_sv || "Utan titel"}
        </p>
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>
          {parseArtist(item.artists)}
        </p>
        {item.dating_text && (
          <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.35)", marginTop: "0.2rem" }}>
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
        style={{
          position: "absolute",
          right: "1.25rem",
          bottom: "1.25rem",
          width: "2.2rem",
          height: "2.2rem",
          borderRadius: "999px",
          border: "1px solid rgba(255,255,255,0.2)",
          background: saved ? "rgba(196,85,58,0.95)" : "rgba(0,0,0,0.4)",
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          transition: "transform 0.15s ease, background 0.2s ease",
        }}
        className={pulsing ? "heart-pulse" : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill={saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <path d="M20.8 5.6c-1.4-1.6-3.9-1.6-5.3 0L12 9.1 8.5 5.6c-1.4-1.6-3.9-1.6-5.3 0-1.6 1.8-1.4 4.6.2 6.2L12 21l8.6-9.2c1.6-1.6 1.8-4.4.2-6.2z" />
        </svg>
      </button>
    </a>
  );
});

function ThemeCard({ section }: { section: ThemeSection }) {
  return (
    <div style={{
      backgroundColor: section.color,
      padding: "3rem 1rem 2rem",
      scrollSnapAlign: "start",
    }}>
      {/* Theme header */}
      <p style={{
        fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.2em",
        color: "rgba(255,255,255,0.4)", fontWeight: 500,
      }}>
        Tema
      </p>
      <h2 style={{
        fontFamily: '"Instrument Serif", Georgia, serif',
        fontSize: "2rem", fontWeight: 600, color: "#fff",
        marginTop: "0.5rem", lineHeight: 1.1,
      }}>
        {section.title}
      </h2>
      <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.5)", marginTop: "0.35rem" }}>
        {section.subtitle}
      </p>

      {/* Horizontal scroll of themed artworks */}
      <div style={{
        display: "flex", gap: "0.75rem",
        overflowX: "auto", paddingTop: "1.5rem", paddingBottom: "0.5rem",
        scrollSnapType: "x mandatory",
      }} className="no-scrollbar">
        {section.items.map((item: FeedItem) => (
          <a
            key={item.id}
            href={`/artwork/${item.id}`}
            style={{
              flexShrink: 0, width: "70vw", maxWidth: "280px",
              borderRadius: "0.75rem", overflow: "hidden",
              backgroundColor: item.dominant_color || "#1A1815",
              textDecoration: "none", color: "inherit",
              scrollSnapAlign: "start",
            }}
          >
            <div style={{ aspectRatio: "3/4", overflow: "hidden", backgroundColor: item.dominant_color || "#1A1815" }}>
              <img
                src={iiif(item.iiif_url, 400)}
                alt={item.title_sv || ""}
                loading="lazy"
                onLoad={(e) => { (e.target as HTMLImageElement).style.opacity = "1"; }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0, transition: "opacity 0.4s ease" }}
              />
            </div>
            <div style={{ padding: "0.6rem 0.75rem" }}>
              <p style={{
                fontSize: "0.8rem", fontWeight: 500, color: "#fff",
                lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis",
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>
                {item.title_sv || "Utan titel"}
              </p>
              <p style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.5)", marginTop: "0.15rem" }}>
                {parseArtist(item.artists)}
              </p>
            </div>
          </a>
        ))}
      </div>

      {/* "Visa fler" link */}
      <a href={`/explore?filter=${encodeURIComponent(section.filter)}`} style={{
        display: "inline-block", marginTop: "1rem",
        fontSize: "0.8rem", color: "rgba(255,255,255,0.5)",
        textDecoration: "none",
      }}>
        Visa fler →
      </a>
    </div>
  );
}
