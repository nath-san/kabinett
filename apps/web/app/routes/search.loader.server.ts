import { clipSearch } from "../lib/clip-search.server";
import { getDb } from "../lib/db.server";
import { getEnabledMuseums, isMuseumEnabled, sourceFilter } from "../lib/museums.server";

export type SearchMode = "fts" | "clip" | "color";
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
  imageUrl?: string;
  year?: string;
  artist?: string;
  color?: string;
  focal_x?: number | null;
  focal_y?: number | null;
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

export type SearchLoaderData = {
  query: string;
  museum: string;
  results: SearchResult[];
  total: number;
  museumOptions: MuseumOption[];
  showMuseumBadge: boolean;
  searchMode: SearchMode;
  cursor: number | null;
  shouldAutoFocus: boolean;
};

export async function searchLoader(request: Request): Promise<SearchLoaderData> {
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
    return { query, museum, results: [], total: 0, museumOptions, showMuseumBadge, searchMode: "clip", cursor: null, shouldAutoFocus };
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
    ).all(...sourceA.params, museum, randomSeed) as SearchResult[];
    return { query, museum, results, total: results.length, museumOptions, showMuseumBadge, searchMode: "clip", cursor: null, shouldAutoFocus };
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
    ).all(...sourceA.params, ...(museum ? [museum] : []), colorTarget.r, colorTarget.g, colorTarget.b, PAGE_SIZE, 0) as SearchResult[];
    return { query, museum, results: rows, total: rows.length, museumOptions, showMuseumBadge, searchMode: "color", cursor: nextCursor(rows.length), shouldAutoFocus };
  }

  // CLIP semantic search
  try {
    const clipResults = await clipSearch(query, PAGE_SIZE, 0, museum || undefined);
    if (clipResults.length > 0) {
      return { query, museum, results: clipResults as unknown as SearchResult[], total: clipResults.length, museumOptions, showMuseumBadge, searchMode: "clip", cursor: nextCursor(clipResults.length), shouldAutoFocus };
    }
  } catch (err) {
    console.error("[CLIP search error]", err);
  }

  // FTS fallback
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
      return { query, museum, results: [], total: 0, museumOptions, showMuseumBadge, searchMode: "fts", cursor: null, shouldAutoFocus };
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

  return { query, museum, results, total, museumOptions, showMuseumBadge, searchMode: "fts", cursor: nextCursor(results.length), shouldAutoFocus };
}
