/**
 * Generate CLIP embeddings for Kabinett artworks.
 *
 * Uses CLIPVisionModelWithProjection for proper image embeddings.
 *
 * Usage:
 *   pnpm embeddings:generate
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from "@xenova/transformers";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const BATCH_SIZE = 50;
const CONCURRENCY = 8;
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = 500;

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS clip_embeddings (
      artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id),
      embedding BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
  `);

  return db;
}

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const denom = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / denom;
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  retries = FETCH_RETRIES
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { redirect: "follow", ...init });
    } catch (error: any) {
      if (attempt === retries) throw error;
      await sleep(FETCH_BACKOFF_MS * 2 ** attempt);
      continue;
    }

    if (res.ok) {
      return res;
    }

    if (!shouldRetryStatus(res.status)) {
      throw new Error(`HTTP ${res.status}`);
    }

    if (attempt === retries) {
      throw new Error(`HTTP ${res.status}`);
    }

    await sleep(FETCH_BACKOFF_MS * 2 ** attempt);
  }

  throw new Error("fetchWithRetry: all retries failed");
}

async function fetchAndPrepImage(url: string): Promise<RawImage> {
  const res = await fetchWithRetry(url);
  const arrayBuf = await res.arrayBuffer();
  const { data, info } = await sharp(Buffer.from(arrayBuf))
    .resize(224, 224, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return new RawImage(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    info.channels
  );
}

async function main() {
  console.log("\n🎨 Kabinett CLIP Embeddings");
  console.log(`   Database: ${DB_PATH}`);

  const db = initDb();
  const sourceFilter = process.env.EMBED_SOURCE || "";

  try {
    const totalWithImages = (
      db.prepare(
        `SELECT COUNT(*) as c
         FROM artworks a
         WHERE a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND (? = '' OR a.source = ?)`
      ).get(sourceFilter, sourceFilter) as any
    ).c as number;

    const alreadyEmbedded = (
      db.prepare(
        `SELECT COUNT(*) as c
         FROM artworks a
         JOIN clip_embeddings c ON c.artwork_id = a.id
         WHERE a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND (? = '' OR a.source = ?)`
      ).get(sourceFilter, sourceFilter) as any
    ).c as number;

    const totalRemaining = Math.max(totalWithImages - alreadyEmbedded, 0);
    console.log(`   Source filter: ${sourceFilter || "(all)"}`);
    console.log(`   Total images: ${totalWithImages}`);
    console.log(`   Already embedded: ${alreadyEmbedded}`);
    console.log(`   Remaining: ${totalRemaining}\n`);

    if (totalRemaining === 0) {
      console.log("✅ All artworks already have embeddings.");
      return;
    }

    console.log("   Loading CLIP vision model...");
    const processor = await AutoProcessor.from_pretrained(
      "Xenova/clip-vit-base-patch32"
    );
    const visionModel = await CLIPVisionModelWithProjection.from_pretrained(
      "Xenova/clip-vit-base-patch32"
    );
    console.log("   Model loaded!\n");

    const selectBatch = db.prepare(`
    SELECT a.id, a.iiif_url
    FROM artworks a
    LEFT JOIN clip_embeddings c ON c.artwork_id = a.id
    WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40 AND c.artwork_id IS NULL
      AND a.id NOT IN (SELECT artwork_id FROM broken_images)
      AND (? = '' OR a.source = ?)
      AND a.id > ?
    ORDER BY a.id ASC
    LIMIT ?
  `);

    const insert = db.prepare(
      `INSERT OR REPLACE INTO clip_embeddings (artwork_id, embedding) VALUES (?, ?)`
    );

    let processed = 0;
    let failed = 0;
    let lastId = -Number.MAX_SAFE_INTEGER;

    while (true) {
      const rows = selectBatch.all(
        sourceFilter,
        sourceFilter,
        lastId,
        BATCH_SIZE
      ) as Array<{
        id: number;
        iiif_url: string;
      }>;
      if (rows.length === 0) break;

      lastId = rows[rows.length - 1].id;

      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        const chunk = rows.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (row) => {
            const iiifBase = row.iiif_url.replace("http://", "https://");
            // SHM = direct URLs, Nordiska = ems.dimu.org, NM = IIIF
            let imageUrl: string;
            if (iiifBase.includes("media.samlingar.shm.se")) {
              imageUrl = iiifBase;
            } else if (iiifBase.includes("ems.dimu.org")) {
              imageUrl = iiifBase.replace(
                /dimension=\d+x\d+/,
                "dimension=400x400"
              );
            } else {
              imageUrl = `${iiifBase}full/400,/0/default.jpg`;
            }

            try {
              const image = await fetchAndPrepImage(imageUrl);
              const inputs = await processor(image);
              const { image_embeds } = await visionModel(inputs);
              const embedding = new Float32Array(image_embeds.data);
              const normalized = normalize(embedding);
              const buffer = Buffer.from(normalized.buffer);
              insert.run(row.id, buffer);
              return { ok: true };
            } catch (error: any) {
              return {
                ok: false,
                id: row.id,
                message: error?.message || "Unknown error",
              };
            }
          })
        );

        for (const result of results) {
          if (result.ok) {
            processed++;
            continue;
          }

          failed++;
          if (failed <= 10) {
            console.warn(`   ⚠️  Failed ${result.id}: ${result.message}`);
          }
        }
      }

      const pct =
        totalRemaining > 0
          ? ((processed / totalRemaining) * 100).toFixed(1)
          : "100";
      console.log(
        `   Batch complete — ${processed}/${totalRemaining} (${pct}%) [${failed} failed]`
      );
    }

    console.log(`\n✅ Done. Embedded ${processed} artworks. (${failed} failed)`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Embedding generation failed.");
  console.error(err);
  process.exit(1);
});
