import { useState, useEffect, useRef, useCallback } from "react";
import type { Route } from "./+types/search";
import { getDb } from "../lib/db.server";
import { clipSearch } from "../lib/clip-search.server";
import { buildImageUrl } from "../lib/images";
import { getEnabledMuseums, isMuseumEnabled, sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

type MuseumOption = { id: string; name: string; count: number };
type SearchResult = {
  id: number;
  title?: string;
  title_sv?: string | null;
  title_en?: string | null;
  iiif_url?: string | null;
  dominant_color?: string | null;
  artists?: string | null;
  dating_text?: string | null;
  museum_name?: string | null;
  imageUrl?: string;
  year?: string;
  artist?: string;
  color?: string;
  focal_x?: number | null;
  focal_y?: number | null;
};
type Suggestion = { value: string; type: string };
type SearchMode = "fts" | "clip" | "color";

const PAGE_SIZE = 60;
const COLOR_TERMS: Record<string, { r: number; g: number; b: number }> = {
  "rött": { r: 180, g: 50, b: 40 }, "röd": { r: 180, g: 50, b: 40 }, "röda": { r: 180, g: 50, b: 40 },
  "blått": { r: 40, g: 70, b: 150 }, "blå": { r: 40, g: 70, b: 150 }, "blåa": { r: 40, g: 70, b: 150 },
  "grönt": { r: 50, g: 130, b: 60 }, "grön": { r: 50, g: 130, b: 60 }, "gröna": { r: 50, g: 130, b: 60 },
  "gult": { r: 200, g: 180, b: 50 }, "gul": { r: 200, g: 180, b: 50 }, "gula": { r: 200, g: 180, b: 50 },
  "svart": { r: 20, g: 20, b: 20 }, "svarta": { r: 20, g: 20, b: 20 },
  "vitt": { r: 240, g: 240, b: 240 }, "vit": { r: 240, g: 240, b: 240 }, "vita": { r: 240, g: 240, b: 240 },
};

function nextCursor(length: number): number | null {
  return length >= PAGE_SIZE ? length : null;
}

function focalObjectPosition(focalX: number | null | undefined, focalY: number | null | undefined): string {
  const x = Number.isFinite(focalX) ? focalX as number : 0.5;
  const y = Number.isFinite(focalY) ? focalY as number : 0.5;
  return `${x * 100}% ${y * 100}%`;
}

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
  const url = new URL(request.url);
  const shouldAutoFocus = url.searchParams.get("focus") === "1";
  const query = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 140);
  const museumParam = url.searchParams.get("museum")?.trim().toLowerCase() || "";
  const db = getDb();
  const sourceA = sourceFilter("a");
  const enabledMuseums = getEnabledMuseums();
  let museumOptions: MuseumOption[] = [];
  if (enabledMuseums.length > 0) {
    const order = `CASE id ${enabledMuseums.map((id, i) => `WHEN '${id}' THEN ${i}`).join(" ")} END`;
    const countRows = db.prepare(
      `SELECT source as id, COUNT(*) as count
       FROM artworks
       WHERE source IN (${enabledMuseums.map(() => "?").join(",")})
       GROUP BY source`
    ).all(...enabledMuseums) as Array<{ id: string; count: number }>;
    const countMap = new Map(countRows.map((row) => [row.id, row.count]));
    const rows = db.prepare(
      `SELECT id, name
       FROM museums
       WHERE enabled = 1 AND id IN (${enabledMuseums.map(() => "?").join(",")})
       ORDER BY ${order}`
    ).all(...enabledMuseums) as Array<{ id: string; name: string }>;
    museumOptions = rows.map((row) => ({
      id: row.id,
      name: row.name,
      count: countMap.get(row.id) ?? 0,
    }));
  }
  const showMuseumBadge = enabledMuseums.length > 1;
  const museum = museumParam && isMuseumEnabled(museumParam) ? museumParam : "";
  if (!query && !museum) {
    return { query, museum, results: [], total: 0, museumOptions, showMuseumBadge, searchMode: "clip" as SearchMode, cursor: null, shouldAutoFocus };
  }
  if (!query && museum) {
    const randomSeed = Math.floor(Date.now() / 60_000);
    const results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         AND a.source = ?
       ORDER BY ((a.rowid * 1103515245 + ?) & 2147483647)
       LIMIT 60`
    ).all(...sourceA.params, museum, randomSeed);
    return {
      query,
      museum,
      results,
      total: results.length,
      museumOptions,
      showMuseumBadge,
      searchMode: "clip" as SearchMode,
      cursor: null,
      shouldAutoFocus,
    };
  }

  const colorTarget = COLOR_TERMS[query.toLowerCase()];
  if (colorTarget) {
    const rows = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.color_r IS NOT NULL AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         ${museum ? "AND a.source = ?" : ""}
       ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
       LIMIT ? OFFSET ?`
    ).all(...sourceA.params, ...(museum ? [museum] : []), colorTarget.r, colorTarget.g, colorTarget.b, PAGE_SIZE, 0) as any[];
    return {
      query,
      museum,
      results: rows,
      total: rows.length,
      museumOptions,
      showMuseumBadge,
      searchMode: "color" as SearchMode,
      cursor: nextCursor(rows.length),
      shouldAutoFocus,
    };
  }

  // Use CLIP semantic search directly
  try {
    const clipResults = await clipSearch(query, PAGE_SIZE, 0, museum || undefined);
    if (clipResults.length > 0) {
      return {
        query,
        museum,
        results: clipResults,
        total: clipResults.length,
        museumOptions,
        showMuseumBadge,
        searchMode: "clip" as SearchMode,
        cursor: nextCursor(clipResults.length),
        shouldAutoFocus,
      };
    }
  } catch (err) {
    console.error("[CLIP search error]", err);
    // Fall through to FTS
  }

  // Fallback: FTS text search
  let results: SearchResult[];
  let total: number;
  try {
    const ftsQuery = query
      .split(/\s+/)
      .map((word) => word.replace(/"/g, "").trim())
      .filter(Boolean)
      .map((word) => `"${word}"*`)
      .join(" ");

    if (!ftsQuery) {
      return {
        query,
        museum,
        results: [],
        total: 0,
        museumOptions,
        showMuseumBadge,
        searchMode: "fts" as SearchMode,
        cursor: null,
        shouldAutoFocus,
      };
    }

    results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              m.name as museum_name
       FROM artworks_fts
       JOIN artworks a ON a.id = artworks_fts.rowid
       LEFT JOIN museums m ON m.id = a.source
       WHERE artworks_fts MATCH ?
         AND a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         ${museum ? "AND a.source = ?" : ""}
       ORDER BY rank LIMIT ? OFFSET ?`
    ).all(ftsQuery, ...sourceA.params, ...(museum ? [museum] : []), PAGE_SIZE, 0) as SearchResult[];
    total = (db.prepare(
      `SELECT COUNT(*) as count
       FROM artworks_fts JOIN artworks a ON a.id = artworks_fts.rowid
       WHERE artworks_fts MATCH ?
         AND a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         ${museum ? "AND a.source = ?" : ""}`
    ).get(ftsQuery, ...sourceA.params, ...(museum ? [museum] : [])) as { count: number }).count;
  } catch {
    const like = `%${query}%`;
    results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE (a.title_sv LIKE ? OR a.artists LIKE ?)
         AND a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         ${museum ? "AND a.source = ?" : ""}
       LIMIT ? OFFSET ?`
    ).all(like, like, ...sourceA.params, ...(museum ? [museum] : []), PAGE_SIZE, 0) as SearchResult[];
    total = results.length;
  }
  return {
    query,
    museum,
    results,
    total,
    museumOptions,
    showMuseumBadge,
    searchMode: "fts" as SearchMode,
    cursor: nextCursor(results.length),
    shouldAutoFocus,
  };
}

const TYPE_LABELS: Record<string, string> = {
  artist: "Konstnär", title: "Verk", category: "Kategori",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function AutocompleteSearch({
  defaultValue,
  museum,
  autoFocus = false,
}: {
  defaultValue: string;
  museum?: string;
  autoFocus?: boolean;
}) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const input = inputRef.current;
    if (!input) return;
    window.requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }, [autoFocus]);

  const fetchSuggestions = useCallback((val: string) => {
    if (timer.current) clearTimeout(timer.current);
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    if (val.length < 2) {
      dropdown.innerHTML = "";
      dropdown.classList.add("hidden");
      return;
    }

    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(val)}`);
        const data = await r.json() as Suggestion[];
        if (data.length === 0) {
          dropdown.classList.add("hidden");
          dropdown.innerHTML = "";
          return;
        }
        dropdown.classList.remove("hidden");
        dropdown.innerHTML = data.map((s, i) => {
          const encodedValue = encodeURIComponent(s.value);
          const safeValue = escapeHtml(s.value);
          const safeType = escapeHtml(TYPE_LABELS[s.type] || "");
          return `<div class="ac-item focus-ring px-4 py-3 text-sm flex justify-between cursor-pointer hover:bg-[#2E2820] ${i > 0 ? "border-t border-stone/5" : ""}" data-value="${encodedValue}" role="button" tabindex="0">
            <span class="text-[#F5F0E8] truncate">${safeValue}</span>
            <span class="text-xs text-[rgba(245,240,232,0.4)] ml-2 shrink-0">${safeType}</span>
          </div>`
        }).join("");
      } catch {
        dropdown.classList.add("hidden");
      }
    }, 200);
  }, []);

  const handleDropdownClick = useCallback((e: React.PointerEvent) => {
    const item = (e.target as HTMLElement).closest(".ac-item") as HTMLElement;
    if (!item) return;
    e.preventDefault();
    const val = decodeURIComponent(item.dataset.value || "");
    const dropdown = dropdownRef.current;
    if (dropdown) { dropdown.classList.add("hidden"); dropdown.innerHTML = ""; }
    if (formRef.current) {
      const inp = formRef.current.querySelector("input[name=q]") as HTMLInputElement;
      if (inp) inp.value = val;
      formRef.current.submit();
    }
  }, []);

  const handleDropdownKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("ac-item")) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const val = decodeURIComponent(target.dataset.value || "");
    const dropdown = dropdownRef.current;
    if (dropdown) { dropdown.classList.add("hidden"); dropdown.innerHTML = ""; }
    if (formRef.current) {
      const inp = formRef.current.querySelector("input[name=q]") as HTMLInputElement;
      if (inp) inp.value = val;
      formRef.current.submit();
    }
  }, []);

  return (
    <div className="relative mt-4">
      <form ref={formRef} action="/search" method="get">
        <div className="flex gap-2">
          {museum && <input type="hidden" name="museum" value={museum} />}
          <label htmlFor="search-input" className="sr-only">Sök</label>
          <input
            ref={inputRef}
            id="search-input"
            type="search" name="q"
            defaultValue={defaultValue}
            onInput={(e) => fetchSuggestions((e.target as HTMLInputElement).value)}
            placeholder="Konstnär, titel, teknik…"
            autoComplete="off"
            className="flex-1 px-4 py-3 rounded-xl bg-[#252019] text-[#F5F0E8] placeholder:text-[rgba(245,240,232,0.4)]
                       text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none focus-ring"
          />
          <button type="submit"
            className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium hover:bg-ink shrink-0 focus-ring">
            Sök
          </button>
        </div>
      </form>
      <div
        ref={dropdownRef}
        onPointerDown={handleDropdownClick}
        onKeyDown={handleDropdownKeyDown}
        role="listbox"
        className="hidden absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-stone/20 overflow-hidden"
      />
    </div>
  );
}

function ResultCard({ r, showMuseumBadge }: { r: SearchResult; showMuseumBadge: boolean }) {
  const title = r.title || r.title_sv || r.title_en || "Utan titel";
  const artist = r.artist || parseArtist(r.artists ?? null);
  return (
    <a key={r.id} href={`/artwork/${r.id}`}
      className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-[#252019] group focus-ring">
      <div
        style={{ backgroundColor: r.color || r.dominant_color || "#D4CDC3" }}
        className="overflow-hidden aspect-[3/4]"
      >
        <img src={r.imageUrl || (r.iiif_url ? buildImageUrl(r.iiif_url, 400) : "")}
          loading="lazy"
          decoding="async"
          alt={`${title} — ${artist}`} width={400} height={533}
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          style={{ objectPosition: focalObjectPosition(r.focal_x, r.focal_y) }} />
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-[#F5F0E8] leading-snug line-clamp-2">
          {title}</p>
        <p className="text-xs text-[rgba(245,240,232,0.55)] mt-1">{artist}</p>
        {showMuseumBadge && r.museum_name && (
          <p className="text-[0.65rem] text-[rgba(245,240,232,0.55)] mt-0.5">{r.museum_name}</p>
        )}
        {(r.year || r.dating_text) && <p className="text-xs text-[rgba(245,240,232,0.4)] mt-0.5">{r.year || r.dating_text}</p>}
      </div>
    </a>
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
        <AutocompleteSearch defaultValue={query} museum={museum || undefined} autoFocus={shouldAutoFocus} />

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
                <ResultCard key={r.id} r={r} showMuseumBadge={showMuseumBadge} />
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
