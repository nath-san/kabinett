import { getDb } from "./db.server";
import { sourceFilter } from "./museums.server";

export type CachedEmbedding = {
  id: number;
  embedding: Float32Array;
};

let cache: CachedEmbedding[] | null = null;
let cachePromise: Promise<CachedEmbedding[]> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

export async function loadClipCache(): Promise<CachedEmbedding[]> {
  const now = Date.now();
  if (cache && now - cacheTime < CACHE_TTL) return cache;
  if (cachePromise && now - cacheTime < CACHE_TTL) return cachePromise;
  cache = null;
  cachePromise = null;

  cachePromise = (async () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT c.artwork_id, c.embedding
         FROM clip_embeddings c
         JOIN artworks a ON a.id = c.artwork_id
         WHERE ${sourceFilter("a")}
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)`
      )
      .all() as any[];

    const mapped = rows.map((r) => {
      const buf: Buffer = r.embedding;
      const view = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      return { id: r.artwork_id, embedding: new Float32Array(view) } as CachedEmbedding;
    });

    cache = mapped;
    cacheTime = Date.now();
    return mapped;
  })();

  return cachePromise;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
