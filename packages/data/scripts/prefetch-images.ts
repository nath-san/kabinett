/**
 * Prefetch images through the Cloudflare R2 proxy to warm the cache.
 * Fetches thumbnails (400px) for the most important artworks.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const PROXY_URL = (process.env.KABINETT_IMAGE_PROXY_URL || "https://img.norrava.com").replace(/\/+$/, "");
const CONCURRENCY = 20;
const BATCH_SIZE = 200;

function buildExternalUrl(iiifUrl: string, width: number): string {
  const normalized = iiifUrl.replace("http://", "https://");
  if (normalized.includes("media.samlingar.shm.se")) {
    const target = width <= 200 ? "thumbnail" : "medium";
    return normalized.replace(/\/(thumb|thumbnail|medium|full)(\?.*)?$/, `/${target}$2`);
  }
  if (normalized.includes("ems.dimu.org")) {
    return normalized.replace(/dimension=\d+x\d+/, `dimension=${width}x${width}`);
  }
  const base = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${base}full/${width},/0/default.jpg`;
}

function proxyUrl(iiifUrl: string, width: number): string {
  const direct = buildExternalUrl(iiifUrl, width);
  return `${PROXY_URL}/?url=${encodeURIComponent(direct)}`;
}

async function prefetchOne(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function prefetchBatch(urls: string[]): Promise<{ ok: number; fail: number }> {
  let ok = 0, fail = 0;
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(prefetchOne));
    for (const r of results) r ? ok++ : fail++;
  }
  return { ok, fail };
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  
  // Get artworks that appear on the home feed + popular artists
  const rows = db.prepare(`
    SELECT DISTINCT a.iiif_url FROM artworks a
    WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
      AND a.id NOT IN (SELECT artwork_id FROM broken_images)
    ORDER BY a.id
    LIMIT ?
  `).all(5000) as { iiif_url: string }[];

  console.log(`Prefetching ${rows.length} thumbnails (400px) through proxy...`);

  const urls = rows.map(r => proxyUrl(r.iiif_url, 400));
  let totalOk = 0, totalFail = 0;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const { ok, fail } = await prefetchBatch(batch);
    totalOk += ok;
    totalFail += fail;
    console.log(`  ${i + batch.length}/${urls.length} — ${totalOk} cached, ${totalFail} failed`);
  }

  console.log(`\nDone! ${totalOk} images cached, ${totalFail} failed.`);
  db.close();
}

main().catch(console.error);
