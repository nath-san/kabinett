import { useState, useEffect, useRef, useCallback } from "react";
import type { Route } from "./+types/search";
import { getDb } from "../lib/db.server";
import { clipSearch } from "../lib/clip-search.server";
import { buildImageUrl } from "../lib/images";
import { isMuseumEnabled, sourceFilter } from "../lib/museums.server";

export function meta({ data }: Route.MetaArgs) {
  const q = data?.query || "";
  return [
    { title: q ? `"${q}" — Kabinett` : "Sök — Kabinett" },
    { name: "description", content: "Sök i svenska museers samlingar." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  const museumParam = url.searchParams.get("museum")?.trim().toLowerCase() || "";
  const museum = museumParam && isMuseumEnabled(museumParam) ? museumParam : "";
  if (!query && !museum) return { query, museum, results: [], total: 0 };
  if (!query && museum) {
    const db = getDb();
    const results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
         AND ${sourceFilter("a")}
         AND a.source = ?
       ORDER BY RANDOM() LIMIT 60`
    ).all(museum);
    return { query, museum, results, total: results.length };
  }

  // Color queries — match dominant_color RGB
  const COLOR_TERMS: Record<string, { r: number; g: number; b: number }> = {
    "rött": { r: 180, g: 50, b: 40 }, "röd": { r: 180, g: 50, b: 40 }, "röda": { r: 180, g: 50, b: 40 },
    "blått": { r: 40, g: 70, b: 150 }, "blå": { r: 40, g: 70, b: 150 }, "blåa": { r: 40, g: 70, b: 150 },
    "grönt": { r: 50, g: 130, b: 60 }, "grön": { r: 50, g: 130, b: 60 }, "gröna": { r: 50, g: 130, b: 60 },
    "gult": { r: 200, g: 180, b: 50 }, "gul": { r: 200, g: 180, b: 50 }, "gula": { r: 200, g: 180, b: 50 },
    "svart": { r: 20, g: 20, b: 20 }, "svarta": { r: 20, g: 20, b: 20 },
    "vitt": { r: 240, g: 240, b: 240 }, "vit": { r: 240, g: 240, b: 240 }, "vita": { r: 240, g: 240, b: 240 },
  };
  const colorTarget = COLOR_TERMS[query.toLowerCase()];
  if (colorTarget) {
    const db = getDb();
    const rows = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.color_r IS NOT NULL AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
         AND ${sourceFilter("a")}
         ${museum ? "AND a.source = ?" : ""}
       ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
       LIMIT 120`
    ).all(...(museum ? [museum] : []), colorTarget.r, colorTarget.g, colorTarget.b) as any[];
    return { query, results: rows, total: rows.length };
  }

  // Use CLIP semantic search directly
  try {
    const clipResults = await clipSearch(query, 60, 0, museum || undefined);
    if (clipResults.length > 0) {
      return { query, museum, results: clipResults, total: clipResults.length };
    }
  } catch (err) {
    console.error("[CLIP search error]", err);
    // Fall through to FTS
  }

  // Fallback: FTS text search
  const db = getDb();
  let results: any[];
  let total: number;
  try {
    const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(" ");
    results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              m.name as museum_name
       FROM artworks_fts f
       JOIN artworks a ON a.id = f.rowid
       LEFT JOIN museums m ON m.id = a.source
       WHERE artworks_fts MATCH ?
         AND ${sourceFilter("a")}
         ${museum ? "AND a.source = ?" : ""}
       ORDER BY rank LIMIT 60`
    ).all(ftsQuery, ...(museum ? [museum] : []));
    total = (db.prepare(
      `SELECT COUNT(*) as count
       FROM artworks_fts f JOIN artworks a ON a.id = f.rowid
       WHERE artworks_fts MATCH ?
         AND ${sourceFilter("a")}
         ${museum ? "AND a.source = ?" : ""}`
    ).get(ftsQuery, ...(museum ? [museum] : [])) as any).count;
  } catch {
    const like = `%${query}%`;
    results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              m.name as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE (a.title_sv LIKE ? OR a.artists LIKE ?)
         AND ${sourceFilter("a")}
         ${museum ? "AND a.source = ?" : ""}
       LIMIT 60`
    ).all(like, like, ...(museum ? [museum] : []));
    total = results.length;
  }
  return { query, museum, results, total };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

const TYPE_LABELS: Record<string, string> = {
  artist: "Konstnär", title: "Verk", category: "Kategori",
};

function AutocompleteSearch({ defaultValue, museum }: { defaultValue: string; museum?: string }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const fetchSuggestions = useCallback((val: string) => {
    clearTimeout(timer.current);
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
        const data = await r.json();
        if (data.length === 0) {
          dropdown.classList.add("hidden");
          dropdown.innerHTML = "";
          return;
        }
        dropdown.classList.remove("hidden");
        dropdown.innerHTML = data.map((s: any, i: number) =>
          `<div class="ac-item px-4 py-3 text-sm flex justify-between cursor-pointer hover:bg-cream ${i > 0 ? 'border-t border-stone/5' : ''}" data-value="${s.value.replace(/"/g, '&quot;')}">
            <span class="text-charcoal truncate">${s.value}</span>
            <span class="text-xs text-stone ml-2 shrink-0">${TYPE_LABELS[s.type] || ""}</span>
          </div>`
        ).join("");
      } catch {
        dropdown.classList.add("hidden");
      }
    }, 200);
  }, []);

  const handleDropdownClick = useCallback((e: React.PointerEvent) => {
    const item = (e.target as HTMLElement).closest(".ac-item") as HTMLElement;
    if (!item) return;
    e.preventDefault();
    const val = item.dataset.value || "";
    const dropdown = dropdownRef.current;
    if (dropdown) { dropdown.classList.add("hidden"); dropdown.innerHTML = ""; }
    if (formRef.current) {
      const inp = formRef.current.querySelector("input[name=q]") as HTMLInputElement;
      if (inp) inp.value = val;
      formRef.current.submit();
    }
  }, []);

  return (
    <>
      <form ref={formRef} action="/search" method="get" className="mt-4">
        <div className="flex gap-2">
          {museum && <input type="hidden" name="museum" value={museum} />}
          <input
            type="search" name="q"
            defaultValue={defaultValue}
            onInput={(e) => fetchSuggestions((e.target as HTMLInputElement).value)}
            placeholder="Konstnär, titel, teknik..."
            autoComplete="off"
            className="flex-1 px-4 py-3 rounded-xl bg-linen text-charcoal placeholder:text-stone
                       text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none"
          />
          <button type="submit"
            className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium hover:bg-ink shrink-0">
            Sök
          </button>
        </div>
      </form>
      <div
        ref={dropdownRef}
        onPointerDown={handleDropdownClick}
        className="hidden mt-1 bg-white rounded-xl shadow-lg border border-stone/20 overflow-hidden"
      />
    </>
  );
}

function ResultCard({ r }: { r: any }) {
  return (
    <a key={r.id} href={`/artwork/${r.id}`}
      className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group">
      <div
        style={{ backgroundColor: r.color || r.dominant_color || "#D4CDC3" }}
        className="overflow-hidden aspect-[3/4]"
      >
        <img src={r.imageUrl || (r.iiif_url ? buildImageUrl(r.iiif_url, 400) : "")}
          alt={r.title || r.title_sv || ""} width={400} height={533}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
          {r.title || r.title_sv || r.title_en || "Utan titel"}</p>
        <p className="text-xs text-warm-gray mt-1">{r.artist || parseArtist(r.artists)}</p>
        {r.museum_name && <p className="text-[0.65rem] text-warm-gray mt-0.5">{r.museum_name}</p>}
        {(r.year || r.dating_text) && <p className="text-xs text-stone mt-0.5">{r.year || r.dating_text}</p>}
      </div>
    </a>
  );
}

const PAGE_SIZE = 60;

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, museum, results: initialResults, total } = loaderData;
  const [results, setResults] = useState(initialResults);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialResults.length >= PAGE_SIZE);

  // Reset when query changes (SSR navigation)
  useEffect(() => {
    setResults(initialResults);
    setHasMore(initialResults.length >= PAGE_SIZE);
  }, [initialResults]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clip-search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${results.length}${museum ? `&museum=${museum}` : ""}`
      );
      const data = await res.json();
      if (data.length === 0) {
        setHasMore(false);
      } else {
        setResults((prev: any[]) => [...prev, ...data]);
        if (data.length < PAGE_SIZE) setHasMore(false);
      }
    } catch {
      setHasMore(false);
    }
    setLoading(false);
  }, [loading, hasMore, query, results.length]);

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

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Sök</h1>
        <AutocompleteSearch defaultValue={query} museum={museum || undefined} />

        {!query && (
          <div className="mt-6">
            <p className="text-xs text-warm-gray mb-3">Prova:</p>
            <div className="flex flex-wrap gap-2">
              {["Carl Larsson","Rembrandt","Olja på duk","Akvarell","Porträtt","Landskap","Skulptur","1700-tal","Guld","Vinter"].map(s => (
                <a key={s} href={`/search?q=${encodeURIComponent(s)}`}
                  className="px-3 py-1.5 rounded-full bg-linen text-warm-gray text-sm font-medium
                             hover:bg-stone hover:text-charcoal transition-colors">{s}</a>
              ))}
            </div>
          </div>
        )}
      </div>

      {showResults && (
        <div className="px-(--spacing-page) pb-24 md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <p className="text-sm text-warm-gray mb-6">
            {results.length > 0
              ? `${results.length} träffar${query ? ` för "${query}"` : ""}`
              : `Inga träffar${query ? ` för "${query}"` : ""}`}
          </p>
          {results.length > 0 && (
            <div className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 space-y-3">
              {results.map((r: any) => (
                <ResultCard key={r.id} r={r} />
              ))}
            </div>
          )}
          {hasMore && (
            <div ref={sentinelRef} className="text-center mt-8 py-4">
              {loading && <p className="text-sm text-warm-gray">Laddar fler...</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
