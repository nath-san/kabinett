// clipSearch imported lazily to avoid loading CLIP model on startup
import { getDb } from "../lib/db.server";
import { getEnabledMuseums, isMuseumEnabled, isValidMuseumFilter, museumFilterSql, getCollectionOptions, sourceFilter } from "../lib/museums.server";

export type SearchMode = "fts" | "clip" | "color";
import type { MatchType } from "../lib/search-types";
export type { MatchType } from "../lib/search-types";
export type MuseumOption = { id: string; name: string; count: number };
export type SearchResult = {
  id: number;
  title?: string;
  title_sv?: string | null;
  title_en?: string | null;
  iiif_url?: string | null;
  dominant_color?: string | null;
  artists?: string | null;
  dating_text?: string | null;
  museum_name?: string | null;
  technique_material?: string | null;
  descriptions_sv?: string | null;
  imageUrl?: string;
  year?: string;
  artist?: string;
  color?: string;
  focal_x?: number | null;
  focal_y?: number | null;
  matchType?: MatchType;
  snippet?: string | null;
};

import { PAGE_SIZE } from "../lib/search-constants";

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

/** Build a short snippet showing where the query matched */
function buildSnippet(result: SearchResult, query: string): string | null {
  if (!query) return null;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  // Check fields in priority order: technique_material, descriptions_sv
  const fields = [
    result.technique_material,
    result.descriptions_sv,
  ].filter(Boolean) as string[];

  for (const field of fields) {
    const lower = field.toLowerCase();
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1) {
        // Extract ~80 chars around the match
        const start = Math.max(0, idx - 30);
        const end = Math.min(field.length, idx + term.length + 50);
        let snippet = field.slice(start, end).trim();
        if (start > 0) snippet = "…" + snippet;
        if (end < field.length) snippet = snippet + "…";
        return snippet;
      }
    }
  }

  // If technique_material exists, show it as context even without direct match
  if (result.technique_material) {
    const tm = result.technique_material.slice(0, 80);
    return tm.length < result.technique_material.length ? tm + "…" : tm;
  }

  return null;
}

export type SearchResultsPayload = {
  results: SearchResult[];
  total: number;
  cursor: number | null;
};

export type SearchLoaderData = {
  query: string;
  museum: string;
  results: Promise<SearchResultsPayload>;
  museumOptions: MuseumOption[];
  showMuseumBadge: boolean;
  searchMode: SearchMode;
  shouldAutoFocus: boolean;
};

async function loadSearchResults(args: {
  query: string;
  museum: string;
}): Promise<SearchResultsPayload> {
  const { query, museum } = args;
  const db = getDb();
  const sourceA = sourceFilter("a");

  if (!query && !museum) {
    return { results: [], total: 0, cursor: null };
  }

  const mf = museumFilterSql(museum, 'a');

  if (!query && museum) {
    const randomSeed = Math.floor(Date.now() / 60_000);
    const results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              COALESCE(a.sub_museum, m.name) as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         AND ${mf!.sql}
       ORDER BY ((a.rowid * 1103515245 + ?) & 2147483647)
       LIMIT 60`
    ).all(...sourceA.params, ...mf!.params, randomSeed) as SearchResult[];
    return { results, total: results.length, cursor: null };
  }

  const ftsQuery = query
    .split(/\s+/)
    .map((word) => word.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(" ");

  const clipPromise = import("../lib/clip-search.server")
    .then(m => m.clipSearch(query, PAGE_SIZE, 0, museum || undefined))
    .then((results) => {
      const cast = results as unknown as SearchResult[];
      cast.forEach((r) => { r.matchType = "clip"; });
      return cast;
    })
    .catch((err) => {
      console.error("[CLIP search error]", err);
      return [] as SearchResult[];
    });

  const ftsPromise = (async () => {
    if (!ftsQuery) return [] as SearchResult[];

    try {
      const rows = db.prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
                a.technique_material, a.descriptions_sv,
                a.focal_x, a.focal_y,
                COALESCE(a.sub_museum, m.name) as museum_name
         FROM artworks_fts
         JOIN artworks a ON a.id = artworks_fts.rowid
         LEFT JOIN museums m ON m.id = a.source
         WHERE artworks_fts MATCH ?
           AND a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
           ${mf ? "AND " + mf.sql : ""}
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, ...sourceA.params, ...(mf ? mf.params : []), PAGE_SIZE) as SearchResult[];
      rows.forEach((r) => { r.matchType = "fts"; });
      return rows;
    } catch {
      // FTS failed, that's fine — we still have CLIP
      return [] as SearchResult[];
    }
  })();

  const [clipResults, ftsResults] = await Promise.all([clipPromise, ftsPromise]);

  // Build a lookup for FTS results to detect "both" matches
  const ftsIds = new Set(ftsResults.map((r) => r.id));
  const ftsLookup = new Map(ftsResults.map((r) => [r.id, r]));

  // Merge: CLIP first, then unique FTS results
  const seenIds = new Set(clipResults.map((r) => r.id));
  const merged = [...clipResults];

  // Mark CLIP results that are also in FTS as "both", grab snippet fields
  for (const r of merged) {
    if (ftsIds.has(r.id)) {
      r.matchType = "both";
      const ftsRow = ftsLookup.get(r.id);
      if (ftsRow) {
        r.technique_material = ftsRow.technique_material;
        r.descriptions_sv = ftsRow.descriptions_sv;
      }
    }
  }

  for (const fts of ftsResults) {
    if (!seenIds.has(fts.id)) {
      seenIds.add(fts.id);
      merged.push(fts);
    }
  }

  // For CLIP-only results, fetch technique_material for snippet
  const clipOnlyIds = merged
    .filter((r) => r.matchType === "clip" && !r.technique_material)
    .map((r) => r.id);
  if (clipOnlyIds.length > 0) {
    try {
      const placeholders = clipOnlyIds.map(() => "?").join(",");
      const rows = db.prepare(
        `SELECT id, technique_material, descriptions_sv FROM artworks WHERE id IN (${placeholders})`
      ).all(...clipOnlyIds) as { id: number; technique_material: string | null; descriptions_sv: string | null }[];
      const lookup = new Map(rows.map((r) => [r.id, r]));
      for (const r of merged) {
        const sd = lookup.get(r.id);
        if (sd) {
          r.technique_material = r.technique_material || sd.technique_material;
          r.descriptions_sv = r.descriptions_sv || sd.descriptions_sv;
        }
      }
    } catch { /* ok */ }
  }

  // Generate snippets
  for (const r of merged) {
    r.snippet = buildSnippet(r, query);
  }

  const results = merged.slice(0, PAGE_SIZE);
  const total = results.length;

  return {
    results,
    total,
    cursor: nextCursor(results.length),
  };
}

export function searchLoader(request: Request): SearchLoaderData {
  const url = new URL(request.url);
  const shouldAutoFocus = url.searchParams.get("focus") === "1";
  const query = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 140);
  const museumParam = url.searchParams.get("museum")?.trim() || "";
  const enabledMuseums = getEnabledMuseums();
  const museumOptions: MuseumOption[] = getCollectionOptions();
  const showMuseumBadge = enabledMuseums.length > 1;
  const museum = museumParam && isValidMuseumFilter(museumParam) ? museumParam : "";

  return {
    query,
    museum,
    results: loadSearchResults({ query, museum }),
    museumOptions,
    showMuseumBadge,
    searchMode: "clip",
    shouldAutoFocus,
  };
}
