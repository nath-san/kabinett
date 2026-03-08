import type { LoaderFunctionArgs } from "react-router";
import { clipSearch, clipSearchFromSeedIds } from "../lib/clip-search.server";
import { getDb } from "../lib/db.server";
import { isMuseumEnabled, sourceFilter } from "../lib/museums.server";
import { translateToEnglish } from "../lib/translate.server";

type SearchMode = "clip" | "fts" | "color";
type SearchType = "all" | "artwork" | "artist" | "visual";

const COLOR_TERMS: Record<string, { r: number; g: number; b: number }> = {
  "rött": { r: 180, g: 50, b: 40 }, "röd": { r: 180, g: 50, b: 40 }, "röda": { r: 180, g: 50, b: 40 },
  "blått": { r: 40, g: 70, b: 150 }, "blå": { r: 40, g: 70, b: 150 }, "blåa": { r: 40, g: 70, b: 150 },
  "grönt": { r: 50, g: 130, b: 60 }, "grön": { r: 50, g: 130, b: 60 }, "gröna": { r: 50, g: 130, b: 60 },
  "gult": { r: 200, g: 180, b: 50 }, "gul": { r: 200, g: 180, b: 50 }, "gula": { r: 200, g: 180, b: 50 },
  "svart": { r: 20, g: 20, b: 20 }, "svarta": { r: 20, g: 20, b: 20 },
  "vitt": { r: 240, g: 240, b: 240 }, "vit": { r: 240, g: 240, b: 240 }, "vita": { r: 240, g: 240, b: 240 },
};

const CLIP_DEBUG = process.env.KABINETT_CLIP_DEBUG === "1";

function logClipDebug(event: string, payload: Record<string, unknown>): void {
  if (!CLIP_DEBUG) return;
  console.log(event, JSON.stringify(payload));
}

function parseMode(rawMode: string | null): SearchMode {
  if (rawMode === "fts" || rawMode === "clip" || rawMode === "color") return rawMode;
  return "clip";
}

function parseType(rawType: string | null): SearchType {
  if (rawType === "all" || rawType === "artwork" || rawType === "artist" || rawType === "visual") {
    return rawType;
  }
  return "all";
}

function buildFtsQuery(q: string): string {
  return q
    .split(/\s+/)
    .map((word) => word.replace(/"/g, "").trim())
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(" ");
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

function chooseFtsSeedIds(results: any[], query: string, limit = 12): number[] {
  const normalizedQuery = normalizeQueryToken(query);
  const candidates = results.filter((row) => {
    const title = normalizeQueryToken(row.title || row.title_sv || row.title_en || "");
    return title !== normalizedQuery;
  });
  const pool = candidates.length >= 4 ? candidates : results;
  const picked: number[] = [];
  const seenMuseums = new Set<string>();

  for (const row of pool) {
    const museum = String(row.museum_name || "").trim().toLowerCase();
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

function filterClipByConfidence<T extends { similarity?: number }>(results: T[]): T[] {
  if (results.length === 0) return [];
  const sorted = [...results].sort(
    (a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0)
  );
  const topSim = Number(sorted[0]?.similarity ?? 0);
  const probeIndex = Math.min(sorted.length - 1, 9);
  const probeSim = Number(sorted[probeIndex]?.similarity ?? topSim);
  const spread = topSim - probeSim;

  // Flat results (CLIP can't distinguish) — only keep if top score is decent
  if (sorted.length >= 5 && spread < 0.01) {
    if (topSim < 0.28) return [];
    return sorted.slice(0, Math.min(12, sorted.length));
  }

  // Tighter floor + narrower band from top
  const minSimilarity = Math.max(0.25, topSim - 0.10);
  const filtered = sorted.filter((row) => Number(row.similarity ?? -1) >= minSimilarity);
  if (filtered.length > 0) return filtered;
  return sorted.slice(0, Math.min(8, sorted.length));
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
  const type = parseType(url.searchParams.get("type"));
  const visualIntent = isVisualObjectQuery(q);

  if (!q) return Response.json([]);

  const scoped = museum && isMuseumEnabled(museum) ? museum : undefined;
  const db = getDb();
  const sourceA = sourceFilter("a");

  if (mode === "clip") {
    try {
      // Hybrid: CLIP + FTS in parallel, CLIP results first, FTS fills gaps
      const enQuery = await translateToEnglish(q);
      const clipPromises: Array<Promise<any[]>> = [clipSearch(q, limit, offset, scoped).catch(() => [] as any[])];
      if (enQuery.trim().toLowerCase() !== q.toLowerCase()) {
        clipPromises.push(clipSearch(enQuery, limit, offset, scoped).catch(() => [] as any[]));
      }

      const [clipBatches, ftsResults] = await Promise.all([
        Promise.all(clipPromises),
        (async () => {
          const ftsQuery = buildFtsQuery(q);
          if (!ftsQuery) return [];
          try {
            return db.prepare(
              `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
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
                 ${scoped ? "AND a.source = ?" : ""}
               ORDER BY rank LIMIT ? OFFSET ?`
            ).all(ftsQuery, ...sourceA.params, ...(scoped ? [scoped] : []), limit, offset) as any[];
          } catch {
            return [];
          }
        })(),
      ]);

      const bestClip = new Map<number, any>();
      for (const resultSet of clipBatches) {
        for (const row of resultSet) {
          const current = bestClip.get(row.id);
          if (!current || row.similarity > current.similarity) {
            bestClip.set(row.id, row);
          }
        }
      }
      const rawClip = [...bestClip.values()];
      let clipResults = filterClipByConfidence(rawClip);
      let topSim = Number(clipResults[0]?.similarity ?? 0);
      let probeIndex = Math.min(Math.max(clipResults.length - 1, 0), 9);
      let probeSim = Number(clipResults[probeIndex]?.similarity ?? topSim);
      let spread = topSim - probeSim;
      const shouldSeedFromFts = ftsResults.length >= 4
        && (
          (visualIntent && clipResults.length < 8)
          || (!visualIntent && (clipResults.length === 0 || spread < 0.02))
        );
      if (shouldSeedFromFts) {
        const seedIds = chooseFtsSeedIds(ftsResults, q, 12);
        const seeded = await clipSearchFromSeedIds(seedIds, limit, offset, scoped).catch(() => [] as any[]);
        const bestHybrid = new Map<number, any>();
        for (const row of [...clipResults, ...seeded]) {
          const existing = bestHybrid.get(row.id);
          if (!existing || Number(row.similarity ?? 0) > Number(existing.similarity ?? 0)) {
            bestHybrid.set(row.id, row);
          }
        }
        clipResults = filterClipByConfidence(
          [...bestHybrid.values()].sort((a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0))
        );
        topSim = Number(clipResults[0]?.similarity ?? 0);
        probeIndex = Math.min(Math.max(clipResults.length - 1, 0), 9);
        probeSim = Number(clipResults[probeIndex]?.similarity ?? topSim);
        spread = topSim - probeSim;
        logClipDebug("[CLIP api seeded]", {
          q,
          visualIntent,
          seedCount: seedIds.length,
          seededCount: seeded.length,
          clipAfterSeed: clipResults.length,
        });
      }
      logClipDebug("[CLIP api]", {
        q,
        type,
        visualIntent,
        translated: enQuery.trim().toLowerCase() !== q.toLowerCase(),
        clipRaw: rawClip.length,
        clipKept: clipResults.length,
        ftsCount: ftsResults.length,
        topSim,
        spread,
        offset,
        limit,
      });

      // Visual-only: return pure CLIP results sorted by similarity
      if (type === "visual") {
        const sorted = [...clipResults].sort(
          (a, b) => Number(b.similarity ?? 0) - Number(a.similarity ?? 0)
        );
        return Response.json(sorted.slice(0, limit));
      }

      // Merge: overlap first, then adaptive CLIP/FTS interleaving
      const ftsIds = new Set(ftsResults.map((r: any) => r.id));
      const overlap: any[] = [];
      const clipOnly: any[] = [];
      for (const row of clipResults) {
        if (ftsIds.has(row.id)) {
          overlap.push(row);
        } else {
          clipOnly.push(row);
        }
      }

      const seenClip = new Set(clipResults.map((r: any) => r.id));
      const ftsOnly = ftsResults.filter((row: any) => !seenClip.has(row.id));
      const confidentClip = spread >= 0.03 && topSim >= 0.32;
      const clipBatch = visualIntent ? (confidentClip ? 3 : 2) : (confidentClip ? 2 : 1);
      const ftsBatch = visualIntent ? 1 : (confidentClip ? 1 : 2);
      logClipDebug("[CLIP api mix]", {
        q,
        type,
        visualIntent,
        overlap: overlap.length,
        clipOnly: clipOnly.length,
        ftsOnly: ftsOnly.length,
        clipBatch,
        ftsBatch,
      });
      let clipIndex = 0;
      let ftsIndex = 0;
      const merged = [...overlap];

      while (
        merged.length < limit &&
        (clipIndex < clipOnly.length || ftsIndex < ftsOnly.length)
      ) {
        for (let i = 0; i < clipBatch && merged.length < limit; i += 1) {
          const row = clipOnly[clipIndex++];
          if (!row) break;
          merged.push(row);
        }
        for (let i = 0; i < ftsBatch && merged.length < limit; i += 1) {
          const row = ftsOnly[ftsIndex++];
          if (!row) break;
          merged.push(row);
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
                COALESCE(a.sub_museum, m.name) as museum_name
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
              COALESCE(a.sub_museum, m.name) as museum_name
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
                COALESCE(a.sub_museum, m.name) as museum_name
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
