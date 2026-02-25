/**
 * Backfill sub_museum (collection) for SHM artworks
 * Reads object UUID from inventory_number, fetches collection from K-samsök
 * 
 * Usage: pnpm backfill:collection
 */

import Database from "better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const CONCURRENCY = 20;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
});

function getText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return getText(node[0]);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function findFirst(obj: any, key: string): any {
  if (!obj || typeof obj !== "object") return null;
  if (key in obj) return Array.isArray(obj[key]) ? obj[key][0] : obj[key];
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirst(item, key);
        if (found != null) return found;
      }
    } else if (typeof value === "object") {
      const found = findFirst(value, key);
      if (found != null) return found;
    }
  }
  return null;
}

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const collectionCache = new Map<string, string | null>();

async function fetchCollection(objectUuid: string): Promise<string | null> {
  if (collectionCache.has(objectUuid)) return collectionCache.get(objectUuid)!;
  try {
    const url = `https://kulturarvsdata.se/shm/object/rdf/${objectUuid}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { collectionCache.set(objectUuid, null); return null; }
    const text = await res.text();
    const parsed = parser.parse(text);
    let collection = getText(findFirst(parsed, "collection"))?.trim() || null;
    // Normalize duplicates
    if (collection === "Skoklosters slotts boksamling") collection = "Skoklosters slott";
    if (collection === "Tumba bruksmuseum Rekvisita") collection = "Tumba bruksmuseum";
    collectionCache.set(objectUuid, collection);
    return collection;
  } catch {
    collectionCache.set(objectUuid, null);
    return null;
  }
}

const update = db.prepare("UPDATE artworks SET sub_museum = ? WHERE id = ?");

async function main() {
  const rows = db.prepare(
    "SELECT id, inventory_number FROM artworks WHERE source = 'shm' AND sub_museum IS NULL AND inventory_number LIKE 'shm:%'"
  ).all() as Array<{ id: number; inventory_number: string }>;

  console.log(`Backfilling collection for ${rows.length.toLocaleString()} SHM artworks (concurrency: ${CONCURRENCY})…`);

  const BATCH = 200;
  let updated = 0;
  const startTime = Date.now();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const uuids = batch.map(r => r.inventory_number.replace("shm:", ""));
    
    const collections = await pMap(uuids, fetchCollection, CONCURRENCY);
    
    const tx = db.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        if (collections[j]) {
          update.run(collections[j], batch[j].id);
          updated++;
        }
      }
    });
    tx();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (updated / (Date.now() - startTime) * 1000).toFixed(0);
    console.log(`  ${updated.toLocaleString()} / ${rows.length.toLocaleString()} (${rate}/s, ${elapsed}s, cache: ${collectionCache.size})`);
  }

  // Show distribution
  const dist = db.prepare(
    "SELECT sub_museum, COUNT(*) as cnt FROM artworks WHERE source='shm' AND sub_museum IS NOT NULL GROUP BY sub_museum ORDER BY cnt DESC"
  ).all() as Array<{ sub_museum: string; cnt: number }>;
  
  console.log("\nSub-museer:");
  for (const { sub_museum, cnt } of dist) {
    console.log(`  ${cnt.toLocaleString().padStart(8)}  ${sub_museum}`);
  }
  console.log(`\nKlar — ${updated.toLocaleString()} uppdaterade`);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
