import type { Route } from "./+types/home";
import React, { useEffect, useMemo, useRef, useState } from "react";
// Search removed — now lives at /search via bottom nav
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

type StatsCard = {
  type: "stats";
  total: number;
  paintings: number;
  artists: number;
  oldest: number;
  ceramics: number;
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

export function meta() {
  return [
    { title: "Kabinett — Upptäck svensk konst" },
    { name: "description", content: "Upptäck Nationalmuseums samling på ett nytt sätt." },
  ];
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
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

  // Load curated hero artworks first
  const { getDb } = await import("../lib/db.server");
  const db = getDb();
  // Pick 5 random from pool
  const shuffled = [...CURATED_POOL].sort(() => Math.random() - 0.5);
  const pickedIds = shuffled.slice(0, 5);
  const curatedRows = db.prepare(
    `SELECT id, title_sv, title_en, artists, dating_text, iiif_url, dominant_color, category, technique_material
     FROM artworks WHERE id IN (${pickedIds.join(",")})
     AND id NOT IN (SELECT artwork_id FROM broken_images)`
  ).all() as any[];
  const curatedMap = new Map(curatedRows.map((r: any) => [r.id, r]));
  const curated = pickedIds
    .map((id) => curatedMap.get(id))
    .filter(Boolean)
    .map((r: any) => ({
      ...r,
      imageUrl: r.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg",
    }));

  const initial = await fetchFeed({ cursor: null, limit: 15, filter: "Alla", origin: url.origin });

  // Load first theme section
  const firstTheme = THEMES[0];
  const themeItems = await fetchFeed({ cursor: null, limit: 6, filter: firstTheme.filter, origin: url.origin });

  // Prepend curated, deduplicate
  const curatedIds = new Set(curated.map((c: any) => c.id));
  const restItems = initial.items.filter((item: any) => !curatedIds.has(item.id));

  // Stats for the collection card
  const stats = {
    total: (db.prepare("SELECT COUNT(*) as c FROM artworks").get() as any).c,
    paintings: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Måleri%'").get() as any).c,
    artists: (db.prepare("SELECT COUNT(DISTINCT json_extract(artists, '$[0].name')) as c FROM artworks WHERE artists IS NOT NULL").get() as any).c,
    oldest: (db.prepare("SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0").get() as any).c,
    ceramics: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Keramik%'").get() as any).c,
  };

  return {
    initialItems: [...curated, ...restItems],
    initialCursor: initial.nextCursor,
    initialHasMore: initial.hasMore,
    firstTheme: { ...firstTheme, items: themeItems.items },
    stats,
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
    // Add a few more artworks then stats
    for (let i = 5; i < Math.min(8, initial.length); i++) {
      entries.push({ type: "art", item: initial[i] });
    }
    entries.push({ type: "stats", ...loaderData.stats });
    for (let i = 8; i < initial.length; i++) {
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

  // Dark mode — use first artwork's color
  const firstColor = useMemo(() => {
    const firstArt = feed.find((entry) => entry.type === "art") as ArtCard | undefined;
    return firstArt?.item.dominant_color || "#1A1815";
  }, [feed]);
  useEffect(() => {
    document.body.style.backgroundColor = firstColor;
    document.body.style.color = "#F5F0E8";
    return () => { document.body.style.backgroundColor = ""; document.body.style.color = ""; };
  }, [firstColor]);

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
      {feed.map((entry, i) =>
        entry.type === "art" ? (
          <ArtworkCard key={`art-${entry.item.id}-${i}`} item={entry.item} index={i} />
        ) : entry.type === "stats" ? (
          <StatsSection key="stats" stats={entry} />
        ) : (
          <ThemeCard key={`theme-${entry.title}-${i}`} section={entry} />
        )
      )}
      <div ref={sentinelRef} style={{ height: "1px" }} />
      {loading && (
        <div style={{ textAlign: "center", padding: "2rem", color: "rgba(255,255,255,0.3)", fontSize: "0.8rem" }}>
          Laddar mer konst…
        </div>
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

function StatsSection({ stats }: { stats: StatsCard }) {
  const items = [
    { value: stats.total.toLocaleString("sv"), label: "verk" },
    { value: stats.artists.toLocaleString("sv"), label: "konstnärer" },
    { value: String(stats.oldest), label: "äldsta verket" },
    { value: stats.paintings.toLocaleString("sv"), label: "målningar" },
    { value: stats.ceramics.toLocaleString("sv"), label: "keramik" },
  ];
  return (
    <div style={{
      padding: "3rem 1.5rem",
      background: "linear-gradient(135deg, #1A1815 0%, #2B2520 100%)",
      textAlign: "center",
    }}>
      <p style={{
        fontSize: "0.65rem", fontWeight: 600,
        letterSpacing: "0.2em", textTransform: "uppercase",
        color: "rgba(255,255,255,0.35)",
      }}>Nationalmuseums samling</p>
      <h2 style={{
        fontFamily: "'Instrument Serif', serif",
        fontSize: "2rem", color: "#F5F0E8",
        margin: "0.5rem 0 1.5rem", lineHeight: 1.1,
      }}>Samlingen i siffror</h2>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "1rem 0.5rem",
        maxWidth: "22rem",
        margin: "0 auto",
      }}>
        {items.map((item) => (
          <div key={item.label}>
            <p style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: "1.6rem", fontWeight: 600,
              color: "#F5F0E8", margin: 0, lineHeight: 1,
            }}>{item.value}</p>
            <p style={{
              fontSize: "0.6rem", color: "rgba(245,240,232,0.45)",
              marginTop: "0.25rem", textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}>{item.label}</p>
          </div>
        ))}
      </div>
      <a href="/discover" style={{
        display: "inline-block",
        marginTop: "1.5rem",
        padding: "0.6rem 1.5rem",
        borderRadius: "999px",
        border: "1px solid rgba(255,255,255,0.15)",
        color: "rgba(255,255,255,0.7)",
        fontSize: "0.78rem", fontWeight: 500,
        textDecoration: "none",
        letterSpacing: "0.02em",
      }}>Upptäck samlingen →</a>
    </div>
  );
}

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
      <a href={`/discover`} style={{
        display: "inline-block", marginTop: "1rem",
        fontSize: "0.8rem", color: "rgba(255,255,255,0.5)",
        textDecoration: "none",
      }}>
        Visa fler →
      </a>
    </div>
  );
}
