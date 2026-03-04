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
  similarity: number;
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

type EmbeddingLoadRow = {
  artwork_id: number;
  embedding: Buffer;
  source: string | null;
  sub_museum: string | null;
  is_broken: number;
};

type EmbeddingStore = {
  embeddings: Float32Array;
  artworkIds: Int32Array;
  sources: Array<string | null>;
  subMuseums: Array<string | null>;
  brokenFlags: Uint8Array;
  count: number;
};

type ScoredIndex = {
  index: number;
  score: number;
};

const EMBEDDING_DIM = 512;

let textExtractorPromise: Promise<any> | null = null;
let queryCacheInitAttempted = false;
let queryCacheWritable = false;
let queryCacheWarningShown = false;
let embeddingStore: EmbeddingStore | null = null;

function loadEmbeddingStore(): EmbeddingStore {
  const db = getDb();
  const startedAt = performance.now();
  const countRow = db.prepare("SELECT COUNT(*) as c FROM clip_embeddings").get() as { c: number };
  const count = countRow.c;

  const embeddings = new Float32Array(count * EMBEDDING_DIM);
  const artworkIds = new Int32Array(count);
  const sources = new Array<string | null>(count);
  const subMuseums = new Array<string | null>(count);
  const brokenFlags = new Uint8Array(count);

  const stmt = db.prepare(
    `SELECT
       c.artwork_id,
       c.embedding,
       a.source,
       a.sub_museum,
       CASE WHEN b.artwork_id IS NULL THEN 0 ELSE 1 END AS is_broken
     FROM clip_embeddings c
     JOIN artworks a ON a.id = c.artwork_id
     LEFT JOIN broken_images b ON b.artwork_id = c.artwork_id
     ORDER BY c.artwork_id`
  );

  let loaded = 0;
  for (const row of stmt.iterate() as Iterable<EmbeddingLoadRow>) {
    if (row.embedding.byteLength < EMBEDDING_DIM * Float32Array.BYTES_PER_ELEMENT) {
      continue;
    }

    const sourceEmbedding = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      EMBEDDING_DIM
    );

    let sum = 0;
    const baseOffset = loaded * EMBEDDING_DIM;
    for (let dim = 0; dim < EMBEDDING_DIM; dim += 1) {
      const value = sourceEmbedding[dim] ?? 0;
      embeddings[baseOffset + dim] = value;
      sum += value * value;
    }

    const norm = Math.sqrt(sum) || 1;
    for (let dim = 0; dim < EMBEDDING_DIM; dim += 1) {
      embeddings[baseOffset + dim] /= norm;
    }

    artworkIds[loaded] = row.artwork_id;
    sources[loaded] = row.source;
    subMuseums[loaded] = row.sub_museum;
    brokenFlags[loaded] = row.is_broken ? 1 : 0;
    loaded += 1;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  console.log(`[CLIP] In-memory embeddings loaded: ${loaded} vectors in ${durationMs}ms`);

  if (loaded !== count) {
    console.warn(`[CLIP] Expected ${count} vectors, loaded ${loaded}`);
  }

  return { embeddings, artworkIds, sources, subMuseums, brokenFlags, count: loaded };
}

function getEmbeddingStore(): EmbeddingStore {
  if (!embeddingStore) {
    embeddingStore = loadEmbeddingStore();
  }
  return embeddingStore;
}

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

function siftUp(heap: ScoredIndex[], index: number): void {
  let i = index;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent]!.score <= heap[i]!.score) return;
    [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
    i = parent;
  }
}

function siftDown(heap: ScoredIndex[], index: number): void {
  let i = index;
  while (true) {
    const left = i * 2 + 1;
    const right = left + 1;
    let smallest = i;

    if (left < heap.length && heap[left]!.score < heap[smallest]!.score) {
      smallest = left;
    }
    if (right < heap.length && heap[right]!.score < heap[smallest]!.score) {
      smallest = right;
    }
    if (smallest === i) return;
    [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
    i = smallest;
  }
}

function runKnnQuery(
  vectorBlob: Buffer,
  k: number,
  allowedSource: { sql: string; params: string[] },
  effectiveSource: string | null,
  subMuseumName: string | null
): VectorRow[] {
  if (k <= 0) return [];
  if (allowedSource.sql === "1 = 0") return [];

  const store = getEmbeddingStore();
  const queryVector = new Float32Array(
    vectorBlob.buffer,
    vectorBlob.byteOffset,
    vectorBlob.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  if (queryVector.length !== EMBEDDING_DIM) return [];

  const allowedSources = new Set(allowedSource.params);
  const heap: ScoredIndex[] = [];

  for (let idx = 0; idx < store.count; idx += 1) {
    if (store.brokenFlags[idx]) continue;

    const source = store.sources[idx];
    if (!source || !allowedSources.has(source)) continue;

    if (subMuseumName) {
      if (source !== "shm" || store.subMuseums[idx] !== subMuseumName) continue;
    } else if (effectiveSource && source !== effectiveSource) {
      continue;
    }

    let score = 0;
    const baseOffset = idx * EMBEDDING_DIM;
    for (let dim = 0; dim < EMBEDDING_DIM; dim += 1) {
      score += queryVector[dim]! * store.embeddings[baseOffset + dim]!;
    }

    if (heap.length < k) {
      heap.push({ index: idx, score });
      siftUp(heap, heap.length - 1);
      continue;
    }

    if (score <= heap[0]!.score) continue;
    heap[0] = { index: idx, score };
    siftDown(heap, 0);
  }

  if (heap.length === 0) return [];

  heap.sort((a, b) => b.score - a.score);
  const rankedArtworkIds = heap.map((entry) => store.artworkIds[entry.index]!);
  const db = getDb();
  const metadataById = new Map<number, Omit<VectorRow, "similarity">>();

  for (let start = 0; start < rankedArtworkIds.length; start += 800) {
    const chunk = rankedArtworkIds.slice(start, start + 800);
    const placeholders = chunk.map(() => "?").join(",");
    const sql = `
      SELECT
        a.id,
        a.title_sv,
        a.title_en,
        a.iiif_url,
        a.dominant_color,
        a.artists,
        a.dating_text,
        a.source,
        a.sub_museum,
        COALESCE(a.sub_museum, m.name) as museum_name,
        a.focal_x,
        a.focal_y
      FROM artworks a
      LEFT JOIN museums m ON m.id = a.source
      WHERE a.id IN (${placeholders})
    `;
    const metadataRows = db.prepare(sql).all(...chunk) as Omit<VectorRow, "similarity">[];

    for (const row of metadataRows) {
      metadataById.set(row.id, row);
    }
  }

  const mergedRows: VectorRow[] = [];
  for (const entry of heap) {
    const artworkId = store.artworkIds[entry.index]!;
    const metadata = metadataById.get(artworkId);
    if (!metadata) continue;
    mergedRows.push({
      ...metadata,
      similarity: entry.score,
    });
  }

  return mergedRows;
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
  const filteredRows = runKnnQuery(
    queryBuffer,
    desiredCount,
    allowedSource,
    effectiveSource,
    subMuseumName
  );

  return filteredRows.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    imageUrl: buildImageUrl(row.iiif_url, 400),
    heroUrl: buildImageUrl(row.iiif_url, 800),
    year: row.dating_text || "",
    color: row.dominant_color || "#D4CDC3",
    similarity: row.similarity,
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
if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
  getEmbeddingStore();
  warmupClip();
}
