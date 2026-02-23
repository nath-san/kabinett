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

async function fetchAndPrepImage(url: string): Promise<RawImage> {
  // Try RawImage.fromURL first, fall back to fetch+sharp
  try {
    return await RawImage.fromURL(url);
  } catch {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
}

async function main() {
  console.log("\n🎨 Kabinett CLIP Embeddings");
  console.log(`   Database: ${DB_PATH}`);

  const db = initDb();

  const totalWithImages = (
    db
      .prepare(`SELECT COUNT(*) as c FROM artworks WHERE iiif_url IS NOT NULL`)
      .get() as any
  ).c as number;

  const alreadyEmbedded = (
    db.prepare(`SELECT COUNT(*) as c FROM clip_embeddings`).get() as any
  ).c as number;

  const totalRemaining = Math.max(totalWithImages - alreadyEmbedded, 0);
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
    WHERE a.iiif_url IS NOT NULL AND c.artwork_id IS NULL AND a.id > ?
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
    const rows = selectBatch.all(lastId, BATCH_SIZE) as Array<{
      id: number;
      iiif_url: string;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.id;
      const iiifBase = row.iiif_url.replace("http://", "https://");
      // SHM = direct URLs, Nordiska = ems.dimu.org, NM = IIIF
      let imageUrl: string;
      if (iiifBase.includes("media.samlingar.shm.se")) {
        imageUrl = iiifBase;
      } else if (iiifBase.includes("ems.dimu.org")) {
        imageUrl = iiifBase.replace(/dimension=\d+x\d+/, "dimension=400x400");
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
        processed++;
      } catch (error: any) {
        failed++;
        if (failed <= 10) {
          console.warn(`   ⚠️  Failed ${row.id}: ${error.message}`);
        }
        continue;
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
}

main().catch((err) => {
  console.error("\n❌ Embedding generation failed.");
  console.error(err);
  process.exit(1);
});
