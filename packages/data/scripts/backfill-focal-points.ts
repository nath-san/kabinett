import Database from "better-sqlite3";
import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { externalImageUrl } from "../../../apps/web/app/lib/images";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");

const DEFAULT_CONCURRENCY = 24;
const DEFAULT_IMAGE_WIDTH = 400;
const FETCH_RETRIES = 2;
const FETCH_BACKOFF_MS = 500;
const LANDSCAPE_TARGET = { width: 150, height: 100 }; // 3:2
const PORTRAIT_TARGET = { width: 75, height: 100 }; // 3:4
const SQUARE_TARGET = { width: 100, height: 100 }; // 1:1

type ArtworkRow = {
  id: number;
  iiif_url: string;
};

type FocalPoint = {
  x: number;
  y: number;
};

type PendingWrite = {
  id: number;
  focal: FocalPoint;
};

type CliOptions = {
  all: boolean;
  limit: number | null;
  concurrency: number;
  imageWidth: number;
  ids: number[];
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
  const imageWidthArg = args.find((arg) => arg.startsWith("--image-width="));
  const idsArg = args.find((arg) => arg.startsWith("--ids="));

  const limit = parsePositiveInt(limitArg?.split("=")[1]) ?? null;
  const concurrency = parsePositiveInt(concurrencyArg?.split("=")[1]) ?? DEFAULT_CONCURRENCY;
  const imageWidth = parsePositiveInt(imageWidthArg?.split("=")[1]) ?? DEFAULT_IMAGE_WIDTH;
  const ids = parseIds(idsArg?.split("=")[1]);

  return {
    all,
    limit,
    concurrency,
    imageWidth,
    ids,
  };
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) return response;
      if (!shouldRetryStatus(response.status) || attempt === FETCH_RETRIES) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (attempt === FETCH_RETRIES) throw error;
    }

    await sleep(FETCH_BACKOFF_MS * 2 ** attempt);
  }

  throw new Error("Kunde inte hämta bild efter alla försök");
}

async function cropCenter(
  imageBuffer: Buffer,
  originalWidth: number,
  originalHeight: number,
  targetWidth: number,
  targetHeight: number,
  strategy: "attention" | "entropy"
): Promise<FocalPoint> {
  const { info } = await sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: "cover", position: strategy })
    .toBuffer({ resolveWithObject: true });

  const cropOffsetLeft = info.cropOffsetLeft || 0;
  const cropOffsetTop = info.cropOffsetTop || 0;
  const scale = Math.max(targetWidth / originalWidth, targetHeight / originalHeight);
  const cropWidth = targetWidth / scale;
  const cropHeight = targetHeight / scale;

  return {
    x: (cropOffsetLeft + cropWidth / 2) / originalWidth,
    y: (cropOffsetTop + cropHeight / 2) / originalHeight,
  };
}

async function computeFocalPoint(imageBuffer: Buffer): Promise<FocalPoint> {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width <= 0 || height <= 0) {
    return { x: 0.5, y: 0.5 };
  }

  const [landscape, portrait, squareEntropy] = await Promise.all([
    cropCenter(
      imageBuffer,
      width,
      height,
      LANDSCAPE_TARGET.width,
      LANDSCAPE_TARGET.height,
      "attention"
    ),
    cropCenter(
      imageBuffer,
      width,
      height,
      PORTRAIT_TARGET.width,
      PORTRAIT_TARGET.height,
      "attention"
    ),
    cropCenter(
      imageBuffer,
      width,
      height,
      SQUARE_TARGET.width,
      SQUARE_TARGET.height,
      "entropy"
    ),
  ]);

  // Blend multiple crop strategies to stay stable across card aspect ratios.
  let x = landscape.x * 0.5 + portrait.x * 0.25 + squareEntropy.x * 0.25;
  let y = landscape.y * 0.6 + portrait.y * 0.2 + squareEntropy.y * 0.2;

  // Portrait motifs often need a slightly higher anchor to avoid cutting faces.
  if (height > width * 1.2) {
    y -= 0.04;
  }

  return {
    x: clamp(x, 0.06, 0.94),
    y: clamp(y, 0.08, 0.92),
  };
}

function loadRows(db: Database.Database, options: CliOptions): ArtworkRow[] {
  const whereClauses = [
    "iiif_url IS NOT NULL",
    "LENGTH(iiif_url) > 40",
    "id NOT IN (SELECT artwork_id FROM broken_images)",
  ];
  const params: Array<number> = [];

  if (options.ids.length > 0) {
    whereClauses.push(`id IN (${options.ids.map(() => "?").join(", ")})`);
    params.push(...options.ids);
  } else if (!options.all) {
    whereClauses.push(
      "(focal_x IS NULL OR focal_y IS NULL OR (focal_x = 0.5 AND focal_y = 0.5))"
    );
  }

  const limitClause = options.limit ? "LIMIT ?" : "";
  if (options.limit) params.push(options.limit);

  const sql = `
    SELECT id, iiif_url
    FROM artworks
    WHERE ${whereClauses.join(" AND ")}
    ORDER BY id ASC
    ${limitClause}
  `;

  return db.prepare(sql).all(...params) as ArtworkRow[];
}

async function processRow(row: ArtworkRow, imageWidth: number): Promise<PendingWrite> {
  const url = externalImageUrl(row.iiif_url, imageWidth);
  const response = await fetchWithRetry(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const focal = await computeFocalPoint(buffer);

  return { id: row.id, focal };
}

async function main() {
  const options = parseArgs();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const rows = loadRows(db, options);
  const updateFocal = db.prepare(
    "UPDATE artworks SET focal_x = ?, focal_y = ? WHERE id = ?"
  );
  const insertBroken = db.prepare(
    "INSERT OR IGNORE INTO broken_images (artwork_id) VALUES (?)"
  );
  const writeBatch = db.transaction((writes: PendingWrite[]) => {
    for (const write of writes) {
      updateFocal.run(write.focal.x, write.focal.y, write.id);
    }
  });

  console.log("Fokalpunkt-backfill startar…");
  console.log(`Databas: ${DB_PATH}`);
  console.log(`Läge: ${options.all ? "alla bilder" : "saknade/default fokuspunkter"}`);
  if (options.ids.length > 0) {
    console.log(`Urval: ${options.ids.length} specifika id`);
  }
  console.log(`Koncurrency: ${options.concurrency}`);
  console.log(`Bildbredd: ${options.imageWidth}`);
  console.log(`Antal verk att behandla: ${rows.length}`);

  if (rows.length === 0) {
    console.log("Inga verk att uppdatera.");
    db.close();
    return;
  }

  const startTime = Date.now();
  let processed = 0;
  let updated = 0;
  let failed = 0;
  const failedItems: Array<{ id: number; message: string }> = [];

  for (let offset = 0; offset < rows.length; offset += options.concurrency) {
    const chunk = rows.slice(offset, offset + options.concurrency);
    const results = await Promise.all(
      chunk.map(async (row) => {
        try {
          const write = await processRow(row, options.imageWidth);
          return { ok: true as const, write };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Okänt fel";
          return { ok: false as const, id: row.id, message };
        }
      })
    );

    const pendingWrites: PendingWrite[] = [];
    for (const result of results) {
      processed += 1;
      if (result.ok) {
        pendingWrites.push(result.write);
        updated += 1;
      } else {
        failed += 1;
        insertBroken.run(result.id);
        if (failedItems.length < 25) {
          failedItems.push({ id: result.id, message: result.message });
        }
      }
    }

    if (pendingWrites.length > 0) {
      writeBatch(pendingWrites);
    }

    const progress = ((processed / rows.length) * 100).toFixed(1);
    const elapsedMs = Date.now() - startTime;
    const rate = processed / (elapsedMs / 1000);
    const remaining = rows.length - processed;
    const etaSeconds = Math.round(remaining / rate);
    const etaH = Math.floor(etaSeconds / 3600);
    const etaM = Math.floor((etaSeconds % 3600) / 60);
    const etaStr = etaH > 0 ? `${etaH}h ${etaM}m` : `${etaM}m`;
    const now = new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    console.log(
      `[${now}] ${processed}/${rows.length} (${progress}%) — ${updated} ok, ${failed} fel — ${rate.toFixed(1)} verk/s — ETA ${etaStr}`
    );
  }

  console.log("\nKlar.");
  console.log(`Uppdaterade fokuspunkter: ${updated}`);
  console.log(`Misslyckade: ${failed}`);

  if (failedItems.length > 0) {
    console.log("Exempel på misslyckade verk:");
    for (const item of failedItems) {
      console.log(`- ${item.id}: ${item.message}`);
    }
  }

  db.close();
}

main().catch((error) => {
  console.error("Skriptet avbröts:", error);
  process.exit(1);
});
