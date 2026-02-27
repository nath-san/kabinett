import { useCallback, useEffect, useRef, useState } from "react";
import Autocomplete from "./Autocomplete";
import ArtworkCard, { type CardVariant } from "./ArtworkCard";
import { buildImageUrl } from "../lib/images";
import type { ArtworkDisplayItem } from "./artwork-meta";

function getCardVariant(position: number): CardVariant {
  const p = position % 6;
  if (p === 0) return "large";
  return "small";
}

type ClipApiResult = {
  id: number;
  title?: string;
  title_sv?: string | null;
  artist?: string;
  artists?: string | null;
  imageUrl?: string;
  heroUrl?: string;
  iiif_url?: string;
  color?: string;
  dominant_color?: string | null;
  focal_x?: number | null;
  focal_y?: number | null;
  focalX?: number | null;
  focalY?: number | null;
  museum_name?: string | null;
  category?: string | null;
  technique_material?: string | null;
  dating_text?: string | null;
  similarity?: number;
};

function toDisplayItem(r: ClipApiResult): ArtworkDisplayItem {
  return {
    id: r.id,
    title_sv: r.title || r.title_sv || null,
    artists: r.artist ? JSON.stringify([{ name: r.artist }]) : r.artists || null,
    iiif_url: r.iiif_url || "",
    imageUrl: r.imageUrl || (r.iiif_url ? buildImageUrl(r.iiif_url, 400) : ""),
    dominant_color: r.color || r.dominant_color || "#1A1815",
    focal_x: r.focalX ?? r.focal_x ?? null,
    focal_y: r.focalY ?? r.focal_y ?? null,
    museum_name: r.museum_name || null,
    category: r.category || null,
    technique_material: r.technique_material || null,
    dating_text: r.dating_text || null,
  };
}

export default function HeroSearch({
  totalWorks,
  showMuseumBadge = false,
  onSearchActive,
}: {
  totalWorks: number;
  showMuseumBadge?: boolean;
  onSearchActive?: (active: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ArtworkDisplayItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    const trimmed = q.trim();
    if (!trimmed) {
      setSearchQuery(null);
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchQuery(trimmed);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/clip-search?q=${encodeURIComponent(trimmed)}&limit=100`, {
        signal: controller.signal,
      });
      const data: ClipApiResult[] = res.ok ? await res.json() : [];
      if (controller.signal.aborted) return;
      setSearchResults(data.map(toDisplayItem));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      // Fallback: navigate to search page
      window.location.href = `/search?q=${encodeURIComponent(trimmed)}`;
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }, []);

  // Notify parent about search state
  useEffect(() => {
    onSearchActive?.(searchResults !== null && searchResults.length > 0);
  }, [searchResults, onSearchActive]);

  // Auto-search after 3 characters with debounce
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const trimmed = query.trim();
    if (trimmed.length >= 3) {
      searchTimer.current = setTimeout(() => doSearch(trimmed), 400);
    } else if (trimmed.length === 0 && searchQuery) {
      setSearchQuery(null);
      setSearchResults(null);
    }
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, doSearch, searchQuery]);

  const clearSearch = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (abortRef.current) abortRef.current.abort();
    setSearchQuery(null);
    setSearchResults(null);
    setSearching(false);
    setQuery("");
  }, []);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (searchTimer.current) clearTimeout(searchTimer.current);
      doSearch(query);
    },
    [query, doSearch]
  );

  return (
    <>
      <div className="pt-[4.8rem] pb-4 px-5 md:px-2 lg:px-0 lg:pt-[5rem] lg:pb-4">
        <h1 className="font-serif text-[1.55rem] md:text-[1.8rem] lg:text-[2.2rem] text-[#F5F0E8] text-center leading-[1.15] tracking-[-0.01em]">
          {totalWorks.toLocaleString("sv-SE")} konstverk.{" "}
          <span className="text-[rgba(245,240,232,0.45)]">Sök på vad som helst.</span>
        </h1>

        <Autocomplete
          query={query}
          onQueryChange={setQuery}
          onSelect={(value) => {
            setQuery(value);
            doSearch(value);
          }}
          dropdownClassName="relative z-50 max-w-lg mx-auto mt-1 bg-[#1C1916] rounded-xl shadow-lg border border-[rgba(245,240,232,0.1)] overflow-hidden"
        >
          {({ inputProps }) => (
            <form onSubmit={handleSubmit} className="mt-4 md:mt-5 max-w-lg mx-auto">
              <label htmlFor="hero-search" className="sr-only">
                Sök bland konstverk
              </label>
              <div className="flex items-center gap-3 rounded-2xl bg-[rgba(245,240,232,0.1)] backdrop-blur-[12px] border border-[rgba(245,240,232,0.18)] px-5 py-3.5 transition-all duration-200 focus-within:border-[rgba(201,176,142,0.45)] focus-within:bg-[rgba(245,240,232,0.14)] focus-within:shadow-[0_0_30px_rgba(201,176,142,0.08)]">
                <svg
                  aria-hidden="true"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="text-[rgba(201,176,142,0.6)] shrink-0"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  {...inputProps}
                  id="hero-search"
                  type="search"
                  placeholder="porträtt, blå himmel, stilleben…"
                  className="flex-1 bg-transparent text-[#F5F0E8] placeholder:text-[rgba(245,240,232,0.35)] text-[1rem] md:text-[1.05rem] px-0 py-0 border-none outline-none [&::-webkit-search-cancel-button]:hidden"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label="Rensa sökning"
                    className="text-[rgba(245,240,232,0.45)] hover:text-[rgba(245,240,232,0.8)] transition-colors p-1 focus-ring"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </form>
          )}
        </Autocomplete>

        <div className="h-5 mt-2 flex items-center justify-center gap-4">
          {searching ? (
            <p className="text-[0.78rem] text-[rgba(245,240,232,0.4)]">Söker…</p>
          ) : searchQuery && searchResults ? (
            <>
              <p className="text-[0.78rem] text-[rgba(245,240,232,0.45)]">
                {searchResults.length >= 100 ? "100+" : searchResults.length} träffar för &ldquo;{searchQuery}&rdquo;
              </p>
              {searchResults.length > 0 && (
                <a
                  href={`/search?q=${encodeURIComponent(searchQuery)}`}
                  className="text-[0.73rem] text-[rgba(201,176,142,0.6)] no-underline hover:text-[rgba(201,176,142,0.9)] transition-colors focus-ring"
                >
                  Visa alla →
                </a>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Inline search results */}
      {searchResults && searchResults.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 lg:gap-2 lg:grid-flow-dense">
          {searchResults.map((item, i) => (
            <ArtworkCard
              key={`search-${item.id}-${i}`}
              item={item}
              index={i}
              variant={getCardVariant(i)}
              showMuseumBadge={showMuseumBadge}
            />
          ))}
        </div>
      )}
    </>
  );
}
