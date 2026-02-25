import Database from "better-sqlite3";
import sharp from "sharp";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const CONCURRENCY = 10;
const RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

type ArtworkRow = {
  id: number | string;
  iiif_url: string;
  source: string | null;
};

type ColorResult = {
  hex: string;
  r: number;
  g: number;
  b: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeIiifBase(url: string): string {
  return url.replace("http://", "https://");
}

function buildImageUrl(iiifUrl: string, source: string | null): string {
  const normalized = normalizeIiifBase(iiifUrl);

  if (source === "nationalmuseum") {
    return normalized.endsWith("/")
      ? `${normalized}full/100,/0/default.jpg`
      : `${normalized}/full/100,/0/default.jpg`;
  }

  return normalized;
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) {
        return response;
      }

      if (!shouldRetryStatus(response.status) || attempt === RETRIES) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (attempt === RETRIES) {
        throw error;
      }
    }

    await sleep(RETRY_BACKOFF_MS * 2 ** attempt);
  }

  throw new Error("Kunde inte hämta bild efter alla försök");
}

async function extractDominantColor(imageUrl: string): Promise<ColorResult> {
  const response = await fetchWithRetry(imageUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  const { dominant } = await sharp(buffer).resize(1, 1).stats();

  if (!dominant) {
    throw new Error("Saknar dominant färg i bildstatistik");
  }

  const r = dominant.r;
  const g = dominant.g;
  const b = dominant.b;
  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();

  return { hex, r, g, b };
}

async function processArtwork(
  row: ArtworkRow
): Promise<{ ok: true } | { ok: false; id: string | number; message: string }> {
  const imageUrl = buildImageUrl(row.iiif_url, row.source);

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const color = await extractDominantColor(imageUrl);
      updateColorStmt.run(color.hex, color.r, color.g, color.b, row.id);
      return { ok: true };
    } catch (error: any) {
      if (attempt === RETRIES) {
        return {
          ok: false,
          id: row.id,
          message: error?.message || "Okänt fel",
        };
      }

      await sleep(RETRY_BACKOFF_MS * 2 ** attempt);
    }
  }

  return { ok: false, id: row.id, message: "Okänt fel" };
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const rows = db
  .prepare(
    `SELECT id, iiif_url, source
     FROM artworks
     WHERE dominant_color IS NULL
       AND iiif_url IS NOT NULL
     ORDER BY id ASC`
  )
  .all() as ArtworkRow[];

const updateColorStmt = db.prepare(
  `UPDATE artworks
   SET dominant_color = ?,
       color_r = ?,
       color_g = ?,
       color_b = ?
   WHERE id = ?`
);

async function main() {
  console.log("Färgextraktion startar…");
  console.log(`Databas: ${DB_PATH}`);
  console.log(`Antal verk att behandla: ${rows.length}`);

  if (rows.length === 0) {
    console.log("Inga verk saknar dominant färg.");
    db.close();
    return;
  }

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failedItems: Array<{ id: string | number; message: string }> = [];

  for (let index = 0; index < rows.length; index += CONCURRENCY) {
    const batch = rows.slice(index, index + CONCURRENCY);
    const results = await Promise.all(batch.map((row) => processArtwork(row)));

    for (const result of results) {
      processed++;
      if (result.ok) {
        succeeded++;
      } else {
        failed++;
        failedItems.push({ id: result.id, message: result.message });
      }
    }

    const progress = ((processed / rows.length) * 100).toFixed(1);
    console.log(
      `Framsteg: ${processed}/${rows.length} (${progress} %) — ${succeeded} klara, ${failed} fel`
    );
  }

  console.log("\nKlar.");
  console.log(`Uppdaterade färger: ${succeeded}`);
  console.log(`Misslyckade: ${failed}`);

  if (failedItems.length > 0) {
    console.log("De första misslyckade verken:");
    for (const item of failedItems.slice(0, 20)) {
      console.log(`- ${item.id}: ${item.message}`);
    }
  }

  db.close();
}

main().catch((error) => {
  console.error("Skriptet avbröts:", error);
  db.close();
  process.exit(1);
});
