// clipSearch imported lazily to avoid loading CLIP model on startup
import { getDb } from "../lib/db.server";
import { fetchFeed } from "../lib/feed.server";
import { getEnabledMuseums, isValidMuseumFilter, museumFilterSql, getCollectionOptions, sourceFilter } from "../lib/museums.server";

export type SearchMode = "fts" | "clip" | "color" | "theme";
import type { MatchType } from "../lib/search-types";
export type { MatchType } from "../lib/search-types";
export type SearchType = "all" | "artwork" | "artist" | "visual";
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
export type ArtworkSearchResult = SearchResult & { resultType: "artwork" };
export type ArtistSearchResult = {
  resultType: "artist";
  name: string;
  artwork_count: number;
};
export type SearchResultItem = ArtworkSearchResult | ArtistSearchResult;

import { PAGE_SIZE } from "../lib/search-constants";

const COLOR_TERMS: Record<string, { r: number; g: number; b: number }> = {
  "rött": { r: 180, g: 50, b: 40 }, "röd": { r: 180, g: 50, b: 40 }, "röda": { r: 180, g: 50, b: 40 },
  "blått": { r: 40, g: 70, b: 150 }, "blå": { r: 40, g: 70, b: 150 }, "blåa": { r: 40, g: 70, b: 150 },
  "grönt": { r: 50, g: 130, b: 60 }, "grön": { r: 50, g: 130, b: 60 }, "gröna": { r: 50, g: 130, b: 60 },
  "gult": { r: 200, g: 180, b: 50 }, "gul": { r: 200, g: 180, b: 50 }, "gula": { r: 200, g: 180, b: 50 },
  "svart": { r: 20, g: 20, b: 20 }, "svarta": { r: 20, g: 20, b: 20 },
  "vitt": { r: 240, g: 240, b: 240 }, "vit": { r: 240, g: 240, b: 240 }, "vita": { r: 240, g: 240, b: 240 },
};

const THEME_FILTERS = new Map<string, string>([
  ["djur", "Djur"],
  ["havet", "Havet"],
  ["blommor", "Blommor"],
  ["natt", "Natt"],
  ["rött", "Rött"],
  ["blått", "Blått"],
  ["porträtt", "Porträtt"],
  ["1700-tal", "1700-tal"],
  ["1800-tal", "1800-tal"],
  ["skulptur", "Skulptur"],
]);

const CLIP_DEBUG = process.env.KABINETT_CLIP_DEBUG === "1";

function logClipDebug(event: string, payload: Record<string, unknown>): void {
  if (!CLIP_DEBUG) return;
  console.log(event, JSON.stringify(payload));
}


function nextCursor(length: number): number | null {
  return length >= PAGE_SIZE ? length : null;
}

function resolveThemeFilter(query: string): string | null {
  return THEME_FILTERS.get(query.trim().toLowerCase()) || null;
}

function normalizeQueryToken(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isVisualObjectQuery(query: string): boolean {
  const normalized = normalizeQueryToken(query);
  if (!normalized) return false;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  if (words.some((word) => /\d/.test(word))) return false;
  return true;
}

function chooseFtsSeedIds(results: SearchResult[], query: string, limit = 12): number[] {
  const normalizedQuery = normalizeQueryToken(query);
  const candidates = results.filter((row) => {
    const title = normalizeQueryToken(row.title || row.title_sv || row.title_en || "");
    // Avoid exact lexical mirror matches when seeding CLIP; they lock onto metadata buckets.
    return title !== normalizedQuery;
  });
  const pool = candidates.length >= 4 ? candidates : results;
  const picked: number[] = [];
  const seenMuseums = new Set<string>();

  for (const row of pool) {
    const museum = (row.museum_name || "").trim().toLowerCase();
    if (museum && seenMuseums.has(museum)) continue;
    picked.push(row.id);
    if (museum) seenMuseums.add(museum);
    if (picked.length >= limit) return picked;
  }
  for (const row of pool) {
    if (picked.includes(row.id)) continue;
    picked.push(row.id);
    if (picked.length >= limit) break;
  }
  return picked;
}

function filterClipByConfidence(
  results: SearchResult[],
  options?: { visual?: boolean; limit?: number }
): SearchResult[] {
  if (results.length === 0) return [];
  const visual = options?.visual === true;
  const limit = Math.max(1, options?.limit ?? results.length);
  const sorted = [...results].sort(
    (a, b) => Number((b as any).similarity ?? 0) - Number((a as any).similarity ?? 0)
  );
  const topSim = Number((sorted[0] as any).similarity ?? 0);
  const probeIndex = Math.min(sorted.length - 1, 9);
  const probeSim = Number((sorted[probeIndex] as any).similarity ?? topSim);
  const spread = topSim - probeSim;

  // Flat score distributions can be noisy, but avoid zeroing CLIP entirely on borderline cases.
  if (sorted.length >= 5 && spread < 0.01) {
    if (topSim < (visual ? 0.24 : 0.26)) return [];
    const flatCap = visual ? Math.min(limit, 60) : 12;
    return sorted.slice(0, Math.min(flatCap, sorted.length));
  }

  const minSimilarity = visual
    ? Math.max(0.20, topSim - 0.18)
    : Math.max(0.22, topSim - 0.12);
  const filtered = sorted.filter((row) => Number((row as any).similarity ?? -1) >= minSimilarity);
  if (filtered.length > 0) return filtered;
  return sorted.slice(0, Math.min(visual ? Math.min(limit, 24) : 8, sorted.length));
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
  results: SearchResultItem[];
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
  searchType: SearchType;
  shouldAutoFocus: boolean;
};

function parseMode(rawMode: string | null): SearchMode | null {
  if (rawMode === "fts" || rawMode === "clip" || rawMode === "color" || rawMode === "theme") return rawMode;
  return null;
}

function parseSearchType(rawType: string | null): SearchType {
  if (rawType === "all" || rawType === "artwork" || rawType === "artist" || rawType === "visual") {
    return rawType;
  }
  return "all";
}

function toArtworkSearchResults(results: SearchResult[]): ArtworkSearchResult[] {
  return results.map((result) => ({
    ...result,
    resultType: "artwork",
  }));
}

function buildFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/["'()]/g, "").trim())
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(" ");
}

function buildTitleOnlyFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((word) => word.replace(/["'()]/g, "").trim())
    .filter(Boolean);

  if (terms.length === 0) return "";

  return terms
    .map((word) => `(title_sv : \"${word}\"* OR title_en : \"${word}\"*)`)
    .join(" AND ");
}

function resolveSearchMode(rawMode: string | null, query: string): SearchMode {
  const parsed = parseMode(rawMode);
  if (parsed) return parsed;
  const normalized = query.trim().toLowerCase();
  if (normalized && COLOR_TERMS[normalized]) return "color";
  return "clip";
}

async function loadSearchResults(args: {
  query: string;
  museum: string;
  mode: SearchMode;
  type: SearchType;
}): Promise<SearchResultsPayload> {
  const { query, museum, mode, type } = args;
  const visualIntent = isVisualObjectQuery(query);
  const db = getDb();
  const sourceA = sourceFilter("a");

  if (!query && !museum) {
    return { results: [], total: 0, cursor: null };
  }

  const mf = museumFilterSql(museum, 'a');

  const runClipSearch = async (): Promise<SearchResult[]> => {
    return import("../lib/clip-search.server").then(async (clipMod) => {
      // Run CLIP on both original and English translation, take best results
      const { translateToEnglish } = await import("../lib/translate.server");
      const enQuery = await translateToEnglish(query);
      const isTranslated = enQuery.toLowerCase() !== query.toLowerCase();
      logClipDebug("[CLIP translate]", { original: query, translated: enQuery, isTranslated });

      const preferTranslated = visualIntent && isTranslated;
      const queries = preferTranslated
        ? [clipMod.clipSearch(enQuery, PAGE_SIZE, 0, museum || undefined)]
        : [clipMod.clipSearch(query, PAGE_SIZE, 0, museum || undefined)];
      if (!preferTranslated && isTranslated) {
        queries.push(clipMod.clipSearch(enQuery, PAGE_SIZE, 0, museum || undefined));
      }
      const results = await Promise.all(queries);

      // Merge: dedupe by id, keep highest similarity
      const best = new Map<number, any>();
      for (const resultSet of results) {
        for (const r of resultSet as any[]) {
          const existing = best.get(r.id);
          if (!existing || r.similarity > existing.similarity) {
            best.set(r.id, r);
          }
        }
      }
      // Sort by similarity descending
      const merged = [...best.values()].sort((a, b) => b.similarity - a.similarity).slice(0, PAGE_SIZE);
      const cast = merged as unknown as SearchResult[];
      cast.forEach((r) => { r.matchType = "clip" as MatchType; });
      return cast;
    })
      .catch((err) => {
        console.error("[CLIP search error]", err);
        return [] as SearchResult[];
      });
  };

  if (!query && museum) {
    if (type === "artist") {
      return { results: [], total: 0, cursor: null };
    }

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
    return { results: toArtworkSearchResults(results), total: results.length, cursor: null };
  }

  if (query && type === "artist") {
    try {
      const rows = db.prepare(
        `SELECT name, artwork_count
         FROM artists
         WHERE name LIKE ?
         ORDER BY artwork_count DESC
         LIMIT ?`
      ).all(`%${query}%`, PAGE_SIZE) as Array<{ name: string; artwork_count: number }>;

      const results: ArtistSearchResult[] = rows.map((row) => ({
        resultType: "artist",
        name: row.name,
        artwork_count: row.artwork_count,
      }));

      return {
        results,
        total: results.length,
        cursor: null,
      };
    } catch (artistErr) {
      console.error("[Artist search error]", artistErr);
      return { results: [], total: 0, cursor: null };
    }
  }

  if (query && type === "artwork") {
    const titleFtsQuery = buildTitleOnlyFtsQuery(query);
    if (!titleFtsQuery) {
      return { results: [], total: 0, cursor: null };
    }

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
      ).all(titleFtsQuery, ...sourceA.params, ...(mf ? mf.params : []), PAGE_SIZE) as SearchResult[];

      rows.forEach((r) => {
        r.matchType = "fts" as MatchType;
        r.snippet = buildSnippet(r, query);
      });

      return {
        results: toArtworkSearchResults(rows),
        total: rows.length,
        cursor: null,
      };
    } catch (artworkErr) {
      console.error("[Artwork search error]", artworkErr);
      return { results: [], total: 0, cursor: null };
    }
  }

  if (query && type === "visual") {
    const clipResults = await runClipSearch();
    const filteredClip = filterClipByConfidence(clipResults, { visual: true, limit: PAGE_SIZE })
      .slice(0, PAGE_SIZE);

    const idsToHydrate = filteredClip
      .filter((r) => !r.technique_material)
      .map((r) => r.id);
    if (idsToHydrate.length > 0) {
      try {
        const placeholders = idsToHydrate.map(() => "?").join(",");
        const rows = db.prepare(
          `SELECT id, technique_material, descriptions_sv FROM artworks WHERE id IN (${placeholders})`
        ).all(...idsToHydrate) as Array<{ id: number; technique_material: string | null; descriptions_sv: string | null }>;
        const lookup = new Map(rows.map((row) => [row.id, row]));
        for (const result of filteredClip) {
          const hydrated = lookup.get(result.id);
          if (hydrated) {
            result.technique_material = result.technique_material || hydrated.technique_material;
            result.descriptions_sv = result.descriptions_sv || hydrated.descriptions_sv;
          }
        }
      } catch (hydrateErr) {
        console.error("[Visual hydrate error]", hydrateErr);
      }
    }

    for (const row of filteredClip) {
      row.matchType = "clip" as MatchType;
      row.snippet = buildSnippet(row, query);
    }

    return {
      results: toArtworkSearchResults(filteredClip),
      total: filteredClip.length,
      cursor: null,
    };
  }

  if (query && mode === "theme") {
    const themeFilter = resolveThemeFilter(query);
    if (!themeFilter) {
      return { results: [], total: 0, cursor: null };
    }
    const themed = await fetchFeed({ cursor: null, limit: PAGE_SIZE, filter: themeFilter });
    const results = themed.items.map((item) => ({
      id: item.id,
      title_sv: item.title_sv,
      title_en: null,
      iiif_url: item.iiif_url,
      dominant_color: item.dominant_color,
      artists: item.artists,
      dating_text: item.dating_text,
      technique_material: item.technique_material,
      museum_name: item.museum_name,
      focal_x: item.focal_x,
      focal_y: item.focal_y,
      imageUrl: item.imageUrl,
      snippet: null,
    })) as SearchResult[];
    return {
      results: toArtworkSearchResults(results),
      total: results.length,
      cursor: themed.hasMore ? themed.nextCursor : null,
    };
  }

  if (query && mode === "color") {
    const colorTarget = COLOR_TERMS[query.toLowerCase()];
    if (!colorTarget) return { results: [], total: 0, cursor: null };

    const rows = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.focal_x, a.focal_y,
              COALESCE(a.sub_museum, m.name) as museum_name
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.color_r IS NOT NULL
         AND a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
         ${mf ? `AND ${mf.sql}` : ""}
       ORDER BY ABS(a.color_r - ?) + ABS(a.color_g - ?) + ABS(a.color_b - ?)
       LIMIT ?`
    ).all(
      ...sourceA.params,
      ...(mf ? mf.params : []),
      colorTarget.r,
      colorTarget.g,
      colorTarget.b,
      PAGE_SIZE
    ) as SearchResult[];

    rows.forEach((row) => {
      row.matchType = "color" as MatchType;
      row.snippet = null;
    });

    return {
      results: toArtworkSearchResults(rows),
      total: rows.length,
      cursor: nextCursor(rows.length),
    };
  }

  const ftsQuery = buildFtsQuery(query);

  const clipPromise = runClipSearch();

  const ftsPromise = (async () => {
    logClipDebug("[FTS query]", { q: query, ftsQuery });
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
      rows.forEach((r) => { r.matchType = "fts" as MatchType; });
      return rows;
    } catch (ftsErr) {
      console.error("[FTS error]", ftsErr);
      return [] as SearchResult[];
    }
  })();

  let [clipResults, ftsResults] = await Promise.all([clipPromise, ftsPromise]);

  const initialTopSim = Number((clipResults[0] as any)?.similarity ?? 0);
  const initialProbeIndex = Math.min(Math.max(clipResults.length - 1, 0), 9);
  const initialProbeSim = Number((clipResults[initialProbeIndex] as any)?.similarity ?? initialTopSim);
  const initialSpread = initialTopSim - initialProbeSim;
  const shouldSeedFromFts = ftsResults.length >= 4
    && (
      (visualIntent && clipResults.length < 8)
      || (!visualIntent && (clipResults.length === 0 || initialSpread < 0.02))
    );

  if (shouldSeedFromFts) {
    try {
      const clipMod = await import("../lib/clip-search.server");
      const seedIds = chooseFtsSeedIds(ftsResults, query, 12);
      const seeded = await clipMod.clipSearchFromSeedIds(
        seedIds,
        PAGE_SIZE,
        0,
        museum || undefined
      );
      const best = new Map<number, SearchResult>();
      for (const row of [...clipResults, ...(seeded as unknown as SearchResult[])]) {
        const existing = best.get(row.id);
        if (!existing || Number((row as any).similarity ?? 0) > Number((existing as any).similarity ?? 0)) {
          best.set(row.id, row);
        }
      }
      clipResults = [...best.values()]
        .sort((a, b) => Number((b as any).similarity ?? 0) - Number((a as any).similarity ?? 0))
        .slice(0, PAGE_SIZE);
      clipResults.forEach((r) => { r.matchType = "clip" as MatchType; });
      logClipDebug("[CLIP seeded]", {
        q: query,
        visualIntent,
        seedCount: seedIds.length,
        seededCount: seeded.length,
        mergedClipCount: clipResults.length,
      });
    } catch (seedErr) {
      console.error("[CLIP seed error]", seedErr);
    }
  }

  // Build a lookup for FTS results to detect "both" matches
  const ftsIds = new Set(ftsResults.map((r) => r.id));
  const ftsLookup = new Map(ftsResults.map((r) => [r.id, r]));

  // Merge: CLIP first (filtered by similarity), then unique FTS results
  const rawSims = clipResults.slice(0, 5).map((r) => ({ title: (r as any).title?.slice(0, 30), sim: (r as any).similarity }));
  logClipDebug("[CLIP sims]", { q: query, top: rawSims });
  const filteredClip = filterClipByConfidence(clipResults);
  const topSim = Number((clipResults[0] as any)?.similarity ?? 0);
  const probeIndex = Math.min(Math.max(clipResults.length - 1, 0), 9);
  const probeSim = Number((clipResults[probeIndex] as any)?.similarity ?? topSim);
  const spread = topSim - probeSim;
  logClipDebug("[CLIP merge]", {
    q: query,
    visualIntent,
    clipRaw: clipResults.length,
    clipKept: filteredClip.length,
    ftsCount: ftsResults.length,
    topSim,
    spread,
  });
  const seenClipIds = new Set(filteredClip.map((r) => r.id));
  const merged: SearchResult[] = [];
  const clipOnly: SearchResult[] = [];

  // Mark CLIP results that are also in FTS as "both", grab snippet fields
  for (const r of filteredClip) {
    if (ftsIds.has(r.id)) {
      r.matchType = "both" as MatchType;
      const ftsRow = ftsLookup.get(r.id);
      if (ftsRow) {
        r.technique_material = ftsRow.technique_material;
        r.descriptions_sv = ftsRow.descriptions_sv;
      }
      merged.push(r);
    } else {
      clipOnly.push(r);
    }
  }

  const ftsOnly = ftsResults.filter((fts) => !seenClipIds.has(fts.id));
  const confidentClip = spread >= 0.03 && topSim >= 0.32;
  const clipBatch = visualIntent ? (confidentClip ? 3 : 2) : (confidentClip ? 2 : 1);
  const ftsBatch = visualIntent ? 1 : (confidentClip ? 1 : 2);
  logClipDebug("[CLIP mix]", {
    q: query,
    visualIntent,
    overlap: merged.length,
    clipOnly: clipOnly.length,
    ftsOnly: ftsOnly.length,
    clipBatch,
    ftsBatch,
  });
  let clipIndex = 0;
  let ftsIndex = 0;

  while (
    merged.length < PAGE_SIZE &&
    (clipIndex < clipOnly.length || ftsIndex < ftsOnly.length)
  ) {
    for (let i = 0; i < clipBatch && merged.length < PAGE_SIZE; i += 1) {
      const row = clipOnly[clipIndex++];
      if (!row) break;
      merged.push(row);
    }
    for (let i = 0; i < ftsBatch && merged.length < PAGE_SIZE; i += 1) {
      const row = ftsOnly[ftsIndex++];
      if (!row) break;
      merged.push(row);
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
    } catch (ftsErr) { /* ok */ }
  }

  // Generate snippets
  for (const r of merged) {
    r.snippet = buildSnippet(r, query);
  }

  const results = merged.slice(0, PAGE_SIZE);
  const total = results.length;

  return {
    results: toArtworkSearchResults(results),
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
  const searchMode = resolveSearchMode(url.searchParams.get("mode"), query);
  const searchType = parseSearchType(url.searchParams.get("type"));
  const museum = searchMode === "theme"
    ? ""
    : museumParam && isValidMuseumFilter(museumParam)
      ? museumParam
      : "";

  return {
    query,
    museum,
    results: loadSearchResults({ query, museum, mode: searchMode, type: searchType }),
    museumOptions,
    showMuseumBadge,
    searchMode,
    searchType,
    shouldAutoFocus,
  };
}
