/**
 * Generate CLIP image embeddings and focal points for artworks.
 *
 * Usage:
 *   pnpm embeddings:generate
 *   pnpm embeddings:generate --clean
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
import { buildImageUrl } from "../../../apps/web/app/lib/images";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const BATCH_SIZE = 50;
const CONCURRENCY = 8;
const FETCH_RETRIES = 3;
const FETCH_BACKOFF_MS = 500;
const IMAGE_WIDTH = 400;

type ArtworkRow = {
  id: number;
  iiif_url: string;
};

type FocalPoint = {
  x: number;
  y: number;
};

function ensureArtworkColumn(db: Database.Database, column: string, definition: string) {
  try {
    db.exec(`ALTER TABLE artworks ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }
}

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  ensureArtworkColumn(db, "focal_x", "REAL DEFAULT 0.5");
  ensureArtworkColumn(db, "focal_y", "REAL DEFAULT 0.5");

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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
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
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(FETCH_BACKOFF_MS * 2 ** attempt);
      continue;
    }

    if (res.ok) {
      return res;
    }

    if (!shouldRetryStatus(res.status) || attempt === retries) {
      throw new Error(`HTTP ${res.status}`);
    }

    await sleep(FETCH_BACKOFF_MS * 2 ** attempt);
  }

  throw new Error("fetchWithRetry: all retries failed");
}

async function computeFocalPoint(imageBuffer: Buffer): Promise<FocalPoint> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width <= 0 || height <= 0) {
    return { x: 0.5, y: 0.5 };
  }

  const { info } = await sharp(imageBuffer)
    .resize(100, 100, { fit: "cover", position: "attention" })
    .toBuffer({ resolveWithObject: true });

  const cropOffsetLeft = info.cropOffsetLeft || 0;
  const cropOffsetTop = info.cropOffsetTop || 0;
  const scale = Math.max(100 / width, 100 / height);
  const cropWidth = 100 / scale;
  const cropHeight = 100 / scale;

  const centerX = (cropOffsetLeft + cropWidth / 2) / width;
  const centerY = (cropOffsetTop + cropHeight / 2) / height;

  return {
    x: clamp01(centerX),
    y: clamp01(centerY),
  };
}

async function prepareClipInput(imageBuffer: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(imageBuffer)
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

function parseCleanFlag(): boolean {
  return process.argv.includes("--clean");
}

async function main() {
  const cleanStart = parseCleanFlag();

  console.log("\n🎨 Kabinett CLIP + Focal Point Generation");
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Mode: ${cleanStart ? "clean" : "incremental"}`);

  const db = initDb();

  try {
    if (cleanStart) {
      db.exec(`
        DROP TABLE IF EXISTS clip_embeddings;
        CREATE TABLE clip_embeddings (
          artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id),
          embedding BLOB
        );
        CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
      `);

      db.prepare("UPDATE artworks SET focal_x = 0.5, focal_y = 0.5").run();
    }

    const totalWithImages = (
      db.prepare(
        `SELECT COUNT(*) as c
         FROM artworks a
         WHERE a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)`
      ).get() as { c: number }
    ).c;

    const alreadyEmbedded = (
      db.prepare(
        `SELECT COUNT(*) as c
         FROM artworks a
         JOIN clip_embeddings c ON c.artwork_id = a.id
         WHERE a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)`
      ).get() as { c: number }
    ).c;

    const totalRemaining = Math.max(totalWithImages - alreadyEmbedded, 0);

    console.log(`   Total images: ${totalWithImages}`);
    console.log(`   Already embedded: ${alreadyEmbedded}`);
    console.log(`   Remaining: ${totalRemaining}\n`);

    if (totalRemaining === 0) {
      console.log("✅ All artworks already have embeddings.");
      return;
    }

    console.log("   Loading CLIP vision model...");
    const processor = await AutoProcessor.from_pretrained("Xenova/clip-vit-base-patch32");
    const visionModel = await CLIPVisionModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32");
    console.log("   Model loaded!\n");

    const selectBatch = db.prepare(`
      SELECT a.id, a.iiif_url
      FROM artworks a
      LEFT JOIN clip_embeddings c ON c.artwork_id = a.id
      WHERE a.iiif_url IS NOT NULL
        AND LENGTH(a.iiif_url) > 40
        AND c.artwork_id IS NULL
        AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        AND a.id > ?
      ORDER BY a.id ASC
      LIMIT ?
    `);

    const upsertEmbedding = db.prepare(
      `INSERT OR REPLACE INTO clip_embeddings (artwork_id, embedding) VALUES (?, ?)`
    );
    const updateFocal = db.prepare(
      `UPDATE artworks SET focal_x = ?, focal_y = ? WHERE id = ?`
    );

    let processed = 0;
    let failed = 0;
    let lastId = 0;

    while (true) {
      const rows = selectBatch.all(lastId, BATCH_SIZE) as ArtworkRow[];
      if (rows.length === 0) break;

      lastId = rows[rows.length - 1].id;

      for (let index = 0; index < rows.length; index += CONCURRENCY) {
        const chunk = rows.slice(index, index + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (row) => {
            const imageUrl = buildImageUrl(row.iiif_url, IMAGE_WIDTH);

            try {
              const response = await fetchWithRetry(imageUrl);
              const arrayBuffer = await response.arrayBuffer();
              const imageBuffer = Buffer.from(arrayBuffer);

              const focalPoint = await computeFocalPoint(imageBuffer);
              const clipImage = await prepareClipInput(imageBuffer);
              const inputs = await processor(clipImage);
              const { image_embeds } = await visionModel(inputs);

              const embedding = normalize(new Float32Array(image_embeds.data));
              const embeddingBuffer = Buffer.from(
                embedding.buffer,
                embedding.byteOffset,
                embedding.byteLength
              );

              upsertEmbedding.run(row.id, embeddingBuffer);
              updateFocal.run(focalPoint.x, focalPoint.y, row.id);

              return { ok: true as const };
            } catch (error) {
              const message = error instanceof Error ? error.message : "Unknown error";
              return { ok: false as const, id: row.id, message };
            }
          })
        );

        for (const result of results) {
          if (result.ok) {
            processed += 1;
          } else {
            failed += 1;
            if (failed <= 10) {
              console.warn(`   ⚠️  Failed ${result.id}: ${result.message}`);
            }
          }
        }

        const pct = totalRemaining > 0
          ? ((processed / totalRemaining) * 100).toFixed(1)
          : "100.0";
        console.log(`   ${processed}/${totalRemaining} (${pct}%) [${failed} failed]`);
      }
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
