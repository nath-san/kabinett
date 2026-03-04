import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { getDb } from "./db.server";
import { buildImageUrl } from "./images";
import { sourceFilter } from "./museums.server";
import { parseArtist } from "./parsing";
import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false;

export const MULTILINGUAL_CLIP_TEXT_MODEL = "sentence-transformers/clip-ViT-B-32-multilingual-v1";

// Pre-bundled Dense projection matrix (512 x 768, float32)
// Converts 768-dim multilingual text embeddings to 512-dim CLIP space
const __dirname_local = dirname(fileURLToPath(import.meta.url));
const PROJECTION_MATRIX = new Float32Array(
  readFileSync(resolve(__dirname_local, "clip-projection.bin")).buffer
);

export type ClipResult = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  heroUrl: string;
  year: string;
  color: string;
  similarity: number;
  museum_name: string | null;
  source: string | null;
  sub_museum: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

type VectorRow = {
  id: number;
  distance: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
  museum_name: string | null;
  source: string | null;
  sub_museum: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

type QueryEmbeddingRow = {
  embedding: Buffer;
};

let textExtractorPromise: Promise<any> | null = null;
let queryCacheInitAttempted = false;
let queryCacheWritable = false;
let queryCacheWarningShown = false;

function logQueryCacheWarning(error: unknown): void {
  if (queryCacheWarningShown) return;
  queryCacheWarningShown = true;
  console.warn("[CLIP] Query embedding cache unavailable:", error);
}

function initQueryEmbeddingCache(): void {
  if (queryCacheInitAttempted) return;
  queryCacheInitAttempted = true;
  const db = getDb();

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS query_embeddings (
        query TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    queryCacheWritable = true;
  } catch (error) {
    queryCacheWritable = false;
    logQueryCacheWarning(error);
  }
}

function getCachedQueryEmbedding(query: string): Buffer | null {
  const db = getDb();

  try {
    const row = db
      .prepare("SELECT embedding FROM query_embeddings WHERE query = ?")
      .get(query) as QueryEmbeddingRow | undefined;

    return row?.embedding ?? null;
  } catch {
    return null;
  }
}

function storeQueryEmbedding(query: string, embedding: Buffer): void {
  initQueryEmbeddingCache();
  if (!queryCacheWritable) return;

  const db = getDb();

  try {
    db
      .prepare("INSERT OR REPLACE INTO query_embeddings (query, embedding) VALUES (?, ?)")
      .run(query, embedding);
  } catch (error) {
    queryCacheWritable = false;
    logQueryCacheWarning(error);
  }
}

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const denom = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / denom;
  return out;
}

/** Project 768-dim vector to 512-dim using pre-loaded weight matrix */
function projectTo512(vec768: Float32Array): Float32Array {
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    let sum = 0;
    const base = i * 768;
    for (let j = 0; j < 768; j++) {
      sum += PROJECTION_MATRIX[base + j] * vec768[j];
    }
    out[i] = sum;
  }
  return out;
}

async function getTextExtractor() {
  if (!textExtractorPromise) {
    textExtractorPromise = pipeline(
      "feature-extraction",
      MULTILINGUAL_CLIP_TEXT_MODEL,
      { quantized: false }
    ).catch((error) => {
      textExtractorPromise = null;
      throw error;
    });
  }
  return textExtractorPromise;
}

const FAISS_URL = process.env.FAISS_URL || "http://127.0.0.1:5555";

function clampSimilarity(distance: number): number {
  if (distance > 1) return 1;
  if (distance < -1) return -1;
  return distance;
}

async function runKnnQuery(
  vectorBlob: Buffer,
  k: number,
  allowedSource: { sql: string; params: string[] },
  filterSource?: string | null,
  filterSubMuseum?: string | null,
): Promise<VectorRow[]> {
  const queryVector = Array.from(new Float32Array(
    vectorBlob.buffer,
    vectorBlob.byteOffset,
    vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
  ));

  const body: Record<string, unknown> = {
    vector: queryVector,
    k,
    allowed_sources: allowedSource.params,
  };
  if (filterSubMuseum) {
    body.filter_sub_museum = filterSubMuseum;
  } else if (filterSource) {
    body.filter_source = filterSource;
  }

  const res = await fetch(`${FAISS_URL}/knn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`[CLIP] FAISS server error: ${res.status}`);
    return [];
  }

  const data = await res.json() as { results: Array<{ artwork_id: number; distance: number }> };
  const artworkIds = data.results.map((r) => r.artwork_id);
  if (artworkIds.length === 0) return [];

  const db = getDb();
  const placeholders = artworkIds.map(() => "?").join(",");
  const metaRows = db.prepare(
    `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
            a.source, a.sub_museum, COALESCE(a.sub_museum, m.name) as museum_name,
            a.focal_x, a.focal_y
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE a.id IN (${placeholders})`
  ).all(...artworkIds) as Array<Omit<VectorRow, "distance">>;

  const metaMap = new Map(metaRows.map((r) => [r.id, r]));
  const distanceMap = new Map(data.results.map((r) => [r.artwork_id, r.distance]));

  return artworkIds
    .map((id) => {
      const meta = metaMap.get(id);
      if (!meta) return null;
      return { ...meta, distance: distanceMap.get(id) ?? 0 } as VectorRow;
    })
    .filter((r): r is VectorRow => r !== null);
}

export async function clipSearch(q: string, limit = 60, offset = 0, source?: string): Promise<ClipResult[]> {
  initQueryEmbeddingCache();
  const queryKey = q.trim().toLowerCase();
  let queryBuffer = getCachedQueryEmbedding(queryKey);

  if (!queryBuffer) {
    const textExtractor = await getTextExtractor();
    const extracted = await textExtractor(q, { pooling: "mean", normalize: false });
    const vec768 = new Float32Array(extracted.data);
    const projected = projectTo512(vec768);
    const queryEmbedding = normalize(projected);
    queryBuffer = Buffer.from(
      queryEmbedding.buffer,
      queryEmbedding.byteOffset,
      queryEmbedding.byteLength
    );
    storeQueryEmbedding(queryKey, queryBuffer);
  }

  const effectiveFilter = source?.trim() || null;
  const isSubMuseum = effectiveFilter?.startsWith("shm:");
  const subMuseumName = isSubMuseum ? effectiveFilter!.slice(4) : null;
  const effectiveSource = isSubMuseum ? "shm" : effectiveFilter;
  const desiredCount = offset + limit;
  const allowedSource = sourceFilter("a");
  const desiredK = Math.max(120, desiredCount);
  const filteredRows = await runKnnQuery(queryBuffer, desiredK, allowedSource, effectiveSource, subMuseumName);

  return filteredRows.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    imageUrl: buildImageUrl(row.iiif_url, 400),
    heroUrl: buildImageUrl(row.iiif_url, 800),
    year: row.dating_text || "",
    color: row.dominant_color || "#D4CDC3",
    similarity: clampSimilarity(row.distance),
    museum_name: row.museum_name ?? null,
    source: row.source ?? null,
    sub_museum: row.sub_museum ?? null,
    focal_x: row.focal_x ?? null,
    focal_y: row.focal_y ?? null,
  }));
}

/** Pre-load the CLIP text model so the first search is instant */
export function warmupClip(): void {
  getTextExtractor()
    .then(() => console.log("[CLIP] Model loaded and ready"))
    .catch((err) => console.error("[CLIP] Warmup failed:", err));
}

// Auto-warmup on module import
warmupClip();
