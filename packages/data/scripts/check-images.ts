/**
 * Check which IIIF images return 501 and mark them as broken.
 * Quick scan — only checks HTTP status, doesn't download.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const BATCH = 100;
const CONCURRENCY = 20;
const RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

const SIZE_MAP = [
  { max: 200, shm: "thumbnail" },
  { max: 400, shm: "medium" },
  { max: Infinity, shm: "full" },
];

function buildImageUrl(iiifOrDirect: string, width: number): string {
  const normalized = iiifOrDirect.replace("http://", "https://");

  const shmMatch = normalized.match(/\/(thumb|thumbnail|medium|full)(\?.*)?$/);
  if (shmMatch) {
    const target = SIZE_MAP.find((s) => width <= s.max)?.shm || "full";
    return normalized.replace(/\/(thumb|thumbnail|medium|full)(\?.*)?$/, `/${target}$2`);
  }

  if (normalized.includes("ems.dimu.org")) {
    return normalized.replace(/dimension=\d+x\d+/, `dimension=${width}x${width}`);
  }

  return normalized + `full/${width},/0/default.jpg`;
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function resolveCheckUrl(iiifUrl: string, source: string | null): string {
  const normalized = iiifUrl.replace("http://", "https://");

  if (source === "shm" || normalized.includes("media.samlingar.shm.se")) {
    return buildImageUrl(normalized, 800);
  }

  if (source === "nordiska" || normalized.includes("ems.dimu.org")) {
    return buildImageUrl(normalized, 800);
  }

  if (source === "nationalmuseum") {
    return buildImageUrl(normalized, 800);
  }

  return buildImageUrl(normalized, 800);
}

async function checkImageWithRetry(url: string): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (response.ok) return true;
    } catch {
      // Retry below
    }

    if (attempt < RETRIES) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  return false;
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`CREATE TABLE IF NOT EXISTS broken_images (artwork_id INTEGER PRIMARY KEY)`);

  const alreadyChecked = (db.prepare("SELECT COUNT(*) as c FROM broken_images").get() as any).c;
  
  // Get all artwork IDs not yet checked
  const rows = db.prepare(`
    SELECT a.id, a.iiif_url, a.source FROM artworks a
    WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 90
    ORDER BY a.id
  `).all() as Array<{ id: number; iiif_url: string; source: string | null }>;

  console.log(`\n🔍 Checking ${rows.length} images (${alreadyChecked} already marked broken)`);

  const insertBroken = db.prepare("INSERT OR IGNORE INTO broken_images (artwork_id) VALUES (?)");
  let checked = 0;
  let broken = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    
    // Check in parallel chunks
    for (let j = 0; j < batch.length; j += CONCURRENCY) {
      const chunk = batch.slice(j, j + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (row) => {
          const url = resolveCheckUrl(row.iiif_url, row.source);
          const ok = await checkImageWithRetry(url);
          return { id: row.id, ok };
        })
      );

      for (const r of results) {
        if (!r.ok) {
          insertBroken.run(r.id);
          broken++;
        }
      }
      checked += chunk.length;
    }

    const pct = ((checked / rows.length) * 100).toFixed(1);
    console.log(`   ${checked}/${rows.length} (${pct}%) — ${broken} broken`);
  }

  console.log(`\n✅ Done. ${broken} broken images marked.`);
}

main().catch(console.error);
