import { useState, useEffect, useRef, useCallback } from "react";
import type { Route } from "./+types/explore";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Utforska — Kabinett" },
    { name: "description", content: "89 000 verk. Börja nånstans." },
  ];
}

// Temporary: fetch from API directly until we wire up SQLite
const API_BASE = "https://api.nationalmuseum.se/api/objects";

interface Artwork {
  id: number;
  title: string;
  artist: string;
  iiif: string;
  category: string;
  year: string;
}

const FILTERS = [
  { label: "Alla", value: "" },
  { label: "Måleri", value: "Måleri" },
  { label: "Skulptur", value: "Skulptur" },
  { label: "Grafik", value: "Grafik" },
  { label: "Teckning", value: "Teckning" },
  { label: "Fotografi", value: "Fotografi" },
  { label: "Keramik", value: "Keramik" },
  { label: "Textil", value: "Textil" },
];

export default function Explore() {
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchArtworks = useCallback(
    async (pageNum: number, append = false) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}?page=${pageNum}&limit=40`);
        const text = await res.text();
        const cleaned = text.replace(/[\x00-\x1f\x7f]/g, (ch) =>
          ch === "\n" || ch === "\r" || ch === "\t" ? ch : ""
        );
        const data = JSON.parse(cleaned);
        const items = data?.data?.items ?? [];

        if (items.length === 0) {
          setHasMore(false);
          setLoading(false);
          return;
        }

        const mapped: Artwork[] = items
          .filter((item: any) => item.iiif)
          .map((item: any) => ({
            id: item.id,
            title: item.title?.sv || item.title?.en || "Utan titel",
            artist:
              item.artists?.[0]?.name ||
              "Okänd konstnär",
            iiif: item.iiif,
            category: item.category?.sv?.split(" (")?.[0] || "",
            year: item.dating?.[0]?.date?.sv || "",
          }));

        setArtworks((prev) => (append ? [...prev, ...mapped] : mapped));
      } catch (err) {
        console.error("Failed to fetch:", err);
      }
      setLoading(false);
    },
    []
  );

  // Initial load
  useEffect(() => {
    fetchArtworks(1);
  }, [fetchArtworks]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          setPage((prev) => {
            const next = prev + 1;
            fetchArtworks(next, true);
            return next;
          });
        }
      },
      { rootMargin: "400px" }
    );

    observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [loading, hasMore, fetchArtworks]);

  const filtered = activeFilter
    ? artworks.filter((a) => a.category.includes(activeFilter))
    : artworks;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      {/* Header */}
      <div className="px-(--spacing-page) pt-8 pb-2">
        <h1 className="font-serif text-3xl font-bold text-charcoal">
          Utforska
        </h1>
        <p className="text-warm-gray text-sm mt-1">
          {artworks.length > 0
            ? `${artworks.length} verk laddade`
            : "Laddar samlingen..."}
        </p>
      </div>

      {/* Filter chips */}
      <div className="px-(--spacing-page) py-4 flex gap-2 overflow-x-auto scrollbar-none">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => setActiveFilter(filter.value)}
            className={`
              px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap
              transition-all duration-200
              ${
                activeFilter === filter.value
                  ? "bg-charcoal text-cream"
                  : "bg-linen text-warm-gray hover:bg-stone hover:text-charcoal"
              }
            `}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Masonry grid */}
      <div className="px-(--spacing-page) pb-24">
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
          {filtered.map((artwork, i) => (
            <ArtworkCard key={`${artwork.id}-${i}`} artwork={artwork} index={i} />
          ))}
        </div>

        {/* Infinite scroll sentinel */}
        {hasMore && <div ref={sentinelRef} className="h-10" />}

        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-stone border-t-charcoal rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Floating shuffle button */}
      <button
        onClick={() => {
          const randomPage = Math.floor(Math.random() * 2084) + 1;
          setPage(randomPage);
          setArtworks([]);
          setHasMore(true);
          fetchArtworks(randomPage);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        className="fixed bottom-6 right-6 bg-charcoal text-cream px-5 py-3 rounded-full
                   text-sm font-medium shadow-lg hover:bg-ink transition-all
                   active:scale-95 z-40"
      >
        ✦ Slumpa
      </button>
    </div>
  );
}

function ArtworkCard({ artwork, index }: { artwork: Artwork; index: number }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <a
      href={`/artwork/${artwork.id}`}
      className="block break-inside-avoid rounded-xl overflow-hidden bg-linen
                 group animate-in fade-in"
      style={{ animationDelay: `${Math.min(index * 50, 500)}ms` }}
    >
      <div className="relative overflow-hidden">
        <img
          src={`${artwork.iiif}full/400,/0/default.jpg`}
          alt={artwork.title}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          className={`
            w-full h-auto object-cover
            group-hover:scale-105 transition-transform duration-700
            ${loaded ? "opacity-100" : "opacity-0"}
            transition-opacity duration-500
          `}
        />
        {!loaded && (
          <div className="absolute inset-0 bg-stone/30 animate-pulse" />
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
          {artwork.title}
        </p>
        <p className="text-xs text-warm-gray mt-1">{artwork.artist}</p>
        {artwork.year && (
          <p className="text-xs text-stone mt-0.5">{artwork.year}</p>
        )}
      </div>
    </a>
  );
}
