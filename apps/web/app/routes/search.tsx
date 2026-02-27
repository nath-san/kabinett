import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router";
import type { Route } from "./+types/search";
import Autocomplete from "../components/Autocomplete";
import ArtworkCard from "../components/ArtworkCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { buildImageUrl } from "../lib/images";
import { searchLoader, PAGE_SIZE, type SearchResult, type SearchMode, type MuseumOption } from "./search.loader.server";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta({ data }: Route.MetaArgs) {
  const q = data?.query || "";
  return [
    { title: q ? `"${q}" — Kabinett` : "Sök — Kabinett" },
    { name: "description", content: "Sök bland hundratusentals verk från Sveriges museer — med AI som förstår vad du letar efter." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  return searchLoader(request);
}

function toArtworkItem(result: SearchResult): ArtworkDisplayItem {
  const title = result.title || result.title_sv || result.title_en || "Utan titel";
  const imageUrl = result.imageUrl || (result.iiif_url ? buildImageUrl(result.iiif_url, 400) : "");
  return {
    id: result.id,
    title_sv: title,
    artists: result.artists || (result.artist ? JSON.stringify([{ name: result.artist }]) : null),
    artist_name: result.artist || null,
    dating_text: result.year || result.dating_text || null,
    iiif_url: result.iiif_url || "",
    dominant_color: result.color || result.dominant_color || "#D4CDC3",
    category: null,
    technique_material: null,
    imageUrl,
    museum_name: result.museum_name || null,
    focal_x: result.focal_x ?? null,
    focal_y: result.focal_y ?? null,
  };
}

function SearchAutocompleteForm({
  defaultValue,
  museum,
  autoFocus = false,
}: {
  defaultValue: string;
  museum?: string;
  autoFocus?: boolean;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(defaultValue);

  useEffect(() => {
    setQuery(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }, [autoFocus]);

  const submitSearch = useCallback((value: string) => {
    const trimmed = value.trim();
    const params = new URLSearchParams();
    if (trimmed) params.set("q", trimmed);
    if (museum) params.set("museum", museum);
    const qs = params.toString();
    navigate(qs ? `/search?${qs}` : "/search");
  }, [museum, navigate]);

  return (
    <div className="relative mt-4">
      <Autocomplete
        query={query}
        onQueryChange={setQuery}
        onSelect={submitSearch}
      >
        {({ inputProps }) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch(query);
            }}
          >
            <div className="flex gap-2">
              <label htmlFor="search-input" className="sr-only">Sök</label>
              <input
                {...inputProps}
                ref={inputRef}
                id="search-input"
                type="search"
                name="q"
                placeholder="Konstnär, titel, teknik…"
                className="flex-1 px-4 py-3 rounded-xl bg-[#252019] text-[#F5F0E8] placeholder:text-[rgba(245,240,232,0.4)]
                       text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none focus-ring"
              />
              <button
                type="submit"
                className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium hover:bg-ink shrink-0 focus-ring"
              >
                Sök
              </button>
            </div>
          </form>
        )}
      </Autocomplete>
    </div>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const {
    query,
    museum,
    results: initialResults,
    museumOptions,
    showMuseumBadge,
    searchMode,
    cursor: initialCursor,
    shouldAutoFocus,
  } = loaderData;
  const displayQuery = query;
  const [results, setResults] = useState<SearchResult[]>(initialResults as SearchResult[]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<number | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialCursor !== null);

  // Reset when query changes (SSR navigation)
  useEffect(() => {
    setResults(initialResults);
    setCursor(initialCursor);
    setHasMore(initialCursor !== null);
  }, [initialCursor, initialResults]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !query || cursor === null) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(PAGE_SIZE),
        offset: String(cursor),
        mode: searchMode,
      });
      if (museum) params.set("museum", museum);

      const res = await fetch(`/api/clip-search?${params.toString()}`);
      const data = await res.json() as SearchResult[];
      if (data.length === 0) {
        setHasMore(false);
        setCursor(null);
      } else {
        setResults((prev) => [...prev, ...data]);
        const next = cursor + data.length;
        if (data.length < PAGE_SIZE) {
          setHasMore(false);
          setCursor(null);
        } else {
          setCursor(next);
        }
      }
    } catch {
      setHasMore(false);
      setCursor(null);
    }
    setLoading(false);
  }, [cursor, hasMore, loading, museum, query, searchMode]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore(); },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const showResults = Boolean(query) || Boolean(museum);
  const showMuseumFilters = museumOptions.length > 1;
  const buildSearchUrl = (museumId?: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (museumId) params.set("museum", museumId);
    const qs = params.toString();
    return qs ? `/search?${qs}` : "/search";
  };

  return (
    <div className="min-h-screen pt-14 bg-[#1C1916] text-[#F5F0E8]">
      <div className="px-(--spacing-page) pt-8 pb-4 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <h1 className="font-serif text-[2rem] text-[#F5F0E8] mb-4">Sök</h1>
        <SearchAutocompleteForm defaultValue={query} museum={museum || undefined} autoFocus={shouldAutoFocus} />

        {showMuseumFilters && (
          <div className="mt-4">
            <p className="text-xs text-[rgba(245,240,232,0.55)] mb-2">Samlingar</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={buildSearchUrl()}
                className={[
                  "px-3 py-1.5 min-h-11 rounded-full text-sm font-medium transition-colors inline-flex items-center",
                  "focus-ring",
                  museum
                    ? "bg-[#252019] text-[rgba(245,240,232,0.55)] hover:bg-[#2E2820] hover:text-[#F5F0E8]"
                    : "bg-charcoal text-cream",
                ].join(" ")}
              >
                Alla
              </a>
              {museumOptions.map((option: MuseumOption) => (
                <a
                  key={option.id}
                  href={buildSearchUrl(option.id)}
                  className={[
                    "px-3 py-1.5 min-h-11 rounded-full text-sm font-medium transition-colors inline-flex items-center",
                    "focus-ring",
                    museum === option.id
                      ? "bg-charcoal text-cream"
                      : "bg-[#252019] text-[rgba(245,240,232,0.55)] hover:bg-[#2E2820] hover:text-[#F5F0E8]",
                  ].join(" ")}
                >
                  {option.name}
                </a>
              ))}
            </div>
          </div>
        )}

        {!query && (
          <div className="mt-6">
            <p className="text-xs text-[rgba(245,240,232,0.55)] mb-3">Prova:</p>
            <div className="flex flex-wrap gap-2">
              {["Carl Larsson","Rembrandt","Olja på duk","Akvarell","Porträtt","Landskap","Skulptur","1700-tal","Guld","Vinter"].map(s => (
                <a key={s} href={`/search?q=${encodeURIComponent(s)}`}
                  className="px-3 py-1.5 min-h-11 inline-flex items-center rounded-full bg-[#252019] text-[rgba(245,240,232,0.55)] text-sm font-medium
                             hover:bg-[#2E2820] hover:text-[#F5F0E8] transition-colors focus-ring">{s}</a>
              ))}
            </div>
          </div>
        )}
      </div>

      {showResults && (
        <div className="px-(--spacing-page) pb-24 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <p aria-live="polite" className="text-sm text-[rgba(245,240,232,0.55)] mb-6">
            {results.length > 0
              ? `${results.length}${hasMore ? "+" : ""} träffar${displayQuery ? ` för "${displayQuery}"` : ""}`
              : `Inga träffar${displayQuery ? ` för "${displayQuery}"` : ""}`}
          </p>
          {results.length > 0 && (
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
              {results.map((r) => (
                <ArtworkCard
                  key={r.id}
                  item={toArtworkItem(r)}
                  showMuseumBadge={showMuseumBadge}
                  layout="search"
                  yearLabel={r.year || r.dating_text || null}
                />
              ))}
            </div>
          )}
          {hasMore && (
            <div ref={sentinelRef} className="text-center mt-8 py-4">
              {loading && <p aria-live="polite" className="text-sm text-[rgba(245,240,232,0.55)]">Laddar fler…</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
