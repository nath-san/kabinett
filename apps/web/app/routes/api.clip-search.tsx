import type { LoaderFunctionArgs } from "react-router";
import { clipSearch } from "../lib/clip-search.server";
import { getDb } from "../lib/db.server";
import { isMuseumEnabled, sourceFilter } from "../lib/museums.server";

type SearchMode = "clip" | "fts" | "color";

const COLOR_TERMS: Record<string, { r: number; g: number; b: number }> = {
  "rött": { r: 180, g: 50, b: 40 }, "röd": { r: 180, g: 50, b: 40 }, "röda": { r: 180, g: 50, b: 40 },
  "blått": { r: 40, g: 70, b: 150 }, "blå": { r: 40, g: 70, b: 150 }, "blåa": { r: 40, g: 70, b: 150 },
  "grönt": { r: 50, g: 130, b: 60 }, "grön": { r: 50, g: 130, b: 60 }, "gröna": { r: 50, g: 130, b: 60 },
  "gult": { r: 200, g: 180, b: 50 }, "gul": { r: 200, g: 180, b: 50 }, "gula": { r: 200, g: 180, b: 50 },
  "svart": { r: 20, g: 20, b: 20 }, "svarta": { r: 20, g: 20, b: 20 },
  "vitt": { r: 240, g: 240, b: 240 }, "vit": { r: 240, g: 240, b: 240 }, "vita": { r: 240, g: 240, b: 240 },
};

function parseMode(rawMode: string | null): SearchMode {
  if (rawMode === "fts" || rawMode === "clip" || rawMode === "color") return rawMode;
  return "clip";
}

function buildFtsQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((word) => word.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(" ");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const errorResponse = () => Response.json([], { headers: { "X-Error": "1" } });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 140);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const rawOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.min(Math.max(rawOffset, 0), 10_000) : 0;
  const museum = url.searchParams.get("museum")?.trim().toLowerCase() || "";
  const mode = parseMode(url.searchParams.get("mode"));

  if (!q) return Response.json([]);

  const scoped = museum && isMuseumEnabled(museum) ? museum : undefined;
  const db = getDb();
  const sourceA = sourceFilter("a");

  if (mode === "clip") {
    try {
      // Hybrid: CLIP + FTS in parallel, CLIP results first, FTS fills gaps
      const [clipResults, ftsResults] = await Promise.all([
        clipSearch(q, limit, offset, scoped).catch(() => [] as any[]),
        (async () => {
          const ftsQuery = buildFtsQuery(q);
          if (!ftsQuery) return [];
          try {
            return db.prepare(
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
                 ${scoped ? "AND a.source = ?" : ""}
               ORDER BY rank LIMIT ? OFFSET ?`
            ).all(ftsQuery, ...sourceA.params, ...(scoped ? [scoped] : []), limit, offset) as any[];
          } catch {
            return [];
          }
        })(),
      ]);

      // Merge: CLIP first, then FTS-unique items
      const seenIds = new Set(clipResults.map((r: any) => r.id));
      const merged = [...clipResults];
      for (const r of ftsResults) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          merged.push(r);
        }
      }
      return Response.json(merged.slice(0, limit));
    } catch (err) {
      console.error(err);
      return errorResponse();
    }
  }

  if (mode === "color") {
    const colorTarget = COLOR_TERMS[q.toLowerCase()];
    if (!colorTarget) return Response.json([]);

    try {
      const results = db.prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
                a.focal_x, a.focal_y,
                m.name as museum_name
         FROM artworks a
         LEFT JOIN museums m ON m.id = a.source
         WHERE a.color_r IS NOT NULL
           AND a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
           ${scoped ? "AND a.source = ?" : ""}
         ORDER BY ABS(a.color_r - ?) + ABS(a.color_g - ?) + ABS(a.color_b - ?)
         LIMIT ? OFFSET ?`
      ).all(
        ...sourceA.params,
        ...(scoped ? [scoped] : []),
        colorTarget.r,
        colorTarget.g,
        colorTarget.b,
        limit,
        offset
      ) as any[];

      return Response.json(results);
    } catch (err) {
      console.error(err);
      return errorResponse();
    }
  }

  const ftsQuery = buildFtsQuery(q);
  if (!ftsQuery) return Response.json([]);

  try {
    const results = db.prepare(
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
         ${scoped ? "AND a.source = ?" : ""}
       ORDER BY rank LIMIT ? OFFSET ?`
    ).all(ftsQuery, ...sourceA.params, ...(scoped ? [scoped] : []), limit, offset) as any[];

    return Response.json(results);
  } catch {
    try {
      const like = `%${q}%`;
      const results = db.prepare(
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
           ${scoped ? "AND a.source = ?" : ""}
         LIMIT ? OFFSET ?`
      ).all(like, like, ...sourceA.params, ...(scoped ? [scoped] : []), limit, offset) as any[];

      return Response.json(results);
    } catch (err) {
      console.error(err);
      return errorResponse();
    }
  }
}
