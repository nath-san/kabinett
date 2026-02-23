/**
 * K-samsök sync for SHM — FAST version with parallel object lookups
 *
 * Usage:
 *   pnpm sync:shm:fast
 *   pnpm sync:shm:fast --limit=100000
 *   pnpm sync:shm:fast --offset=40000
 */

import Database from "better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");

const API_BASE = "https://kulturarvsdata.se/ksamsok/api";
const HITS_PER_PAGE = 500;
const CONCURRENCY = 15;
const MEDIA_QUERY = "serviceOrganization=shm AND thumbnailExists=j";

const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const MAX_ITEMS = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1] || "0", 10) : Infinity;
const OFFSET_ARG = process.argv.find((arg) => arg.startsWith("--offset="));
const START_OFFSET = OFFSET_ARG ? parseInt(OFFSET_ARG.split("=")[1] || "1", 10) : 1;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

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

function findAll(obj: any, key: string, acc: any[] = []): any[] {
  if (!obj || typeof obj !== "object") return acc;
  if (key in obj) {
    const v = obj[key];
    if (Array.isArray(v)) acc.push(...v);
    else acc.push(v);
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) findAll(item, key, acc);
    } else if (typeof value === "object") {
      findAll(value, key, acc);
    }
  }
  return acc;
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

function extractYears(text: string): { start: number | null; end: number | null } {
  const years = (text.match(/\d{4}/g) || [])
    .map((y) => parseInt(y, 10))
    .filter((y) => y >= 500 && y <= 2100);
  if (!years.length) return { start: null, end: null };
  return { start: Math.min(...years), end: Math.max(...years) };
}

function hashId(s: string): number {
  return -(createHash("sha1").update(s).digest().readUIntBE(0, 6));
}

// --- Parallel fetch helper ---
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

// --- Object metadata cache (persisted across pages) ---
const objectCache = new Map<string, {
  title: string;
  className: string | null;
  collection: string | null;
  datingText: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  technique: string | null;
} | null>();

async function fetchObjectMeta(objectUri: string) {
  if (objectCache.has(objectUri)) return objectCache.get(objectUri)!;
  
  try {
    const xmlUrl = objectUri.replace("/object/", "/object/xml/");
    const res = await fetch(xmlUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { objectCache.set(objectUri, null); return null; }
    const text = await res.text();
    const parsed = parser.parse(text);

    const title = getText(findFirst(parsed, "itemLabel")) || "Utan titel";
    const className = getText(findFirst(parsed, "itemClassName")) || null;
    const collection = getText(findFirst(parsed, "collection")) || null;
    const dateTexts: string[] = [];
    for (const key of ["eventDate", "displayDate", "fromTime", "toTime"]) {
      for (const v of findAll(parsed, key)) {
        const t = getText(v); if (t) dateTexts.push(t);
      }
    }
    const { start, end } = extractYears(dateTexts.join(" "));
    const techniques = findAll(parsed, "termMaterialsTech").map(v => getText(v)).filter(Boolean);

    const meta = {
      title, className, collection,
      datingText: dateTexts[0] || null,
      yearStart: start, yearEnd: end,
      technique: techniques.join(", ") || null,
    };
    objectCache.set(objectUri, meta);
    return meta;
  } catch {
    objectCache.set(objectUri, null);
    return null;
  }
}

// --- DB ---
const upsert = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, category, technique_material, dating_text,
    year_start, year_end, iiif_url, source, sub_museum, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'shm', ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    title_sv=excluded.title_sv, category=excluded.category,
    technique_material=excluded.technique_material, dating_text=excluded.dating_text,
    year_start=excluded.year_start, year_end=excluded.year_end,
    iiif_url=excluded.iiif_url, source='shm', sub_museum=excluded.sub_museum, synced_at=datetime('now')
`);

// --- Main ---
async function main() {
  let startRecord = START_OFFSET;
  let totalHits = Infinity;
  let processed = 0;
  let skipped = 0;
  const startTime = Date.now();

  console.log(`SHM fast sync (concurrency: ${CONCURRENCY}, limit: ${MAX_ITEMS === Infinity ? "∞" : MAX_ITEMS}, offset: ${START_OFFSET})`);

  while (startRecord <= totalHits && processed < MAX_ITEMS) {
    const params = new URLSearchParams({
      method: "search", query: MEDIA_QUERY,
      startRecord: String(startRecord), hitsPerPage: String(HITS_PER_PAGE),
      "x-api": "kabinett",
    });
    const res = await fetch(`${API_BASE}?${params}`);
    if (!res.ok) { console.error(`HTTP ${res.status} at ${startRecord}`); break; }
    const xml = await res.text();
    const parsed = parser.parse(xml);

    if (totalHits === Infinity) {
      totalHits = parseInt(getText(findFirst(parsed, "totalHits")), 10) || 0;
      console.log(`Totalt ${totalHits.toLocaleString()} mediaposter`);
    }

    const entities = findAll(parsed, "Entity");
    if (!entities.length) break;

    // Extract media→object mappings
    type MediaItem = { mediaUuid: string; objectUri: string };
    const items: MediaItem[] = [];
    for (const e of entities) {
      const about = e?.["@_about"] || e?.["@_rdf:about"] || "";
      const mediaUuid = about.split("/").pop() || "";
      if (!mediaUuid || mediaUuid.length < 10) { skipped++; continue; }

      const vis = e?.visualizes;
      const objectUri = typeof vis === "string" ? vis
        : vis?.["@_resource"] || vis?.["@_rdf:resource"] || getText(vis) || null;
      if (!objectUri?.includes("/object/")) { skipped++; continue; }

      items.push({ mediaUuid, objectUri });
    }

    // Parallel object metadata fetches
    const metas = await pMap(items, (item) => fetchObjectMeta(item.objectUri), CONCURRENCY);

    // Batch insert
    const insertMany = db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        if (processed >= MAX_ITEMS) break;
        const meta = metas[i];
        if (!meta) { skipped++; continue; }

        const { mediaUuid, objectUri } = items[i];
        const objectUuid = objectUri.split("/").pop()!;
        upsert.run(
          hashId(objectUuid + mediaUuid),
          `shm:${objectUuid}`,
          meta.title,
          meta.className,
          meta.technique,
          meta.datingText,
          meta.yearStart,
          meta.yearEnd,
          `https://media.samlingar.shm.se/item/${mediaUuid}/medium`,
          meta.collection,
        );
        processed++;
      }
    });
    insertMany();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (processed / (Date.now() - startTime) * 1000).toFixed(0);
    console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skip (@ ${startRecord.toLocaleString()}) [${rate}/s, ${elapsed}s, cache: ${objectCache.size}]`);
    startRecord += HITS_PER_PAGE;
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nKlar — ${processed.toLocaleString()} SHM-objekt på ${totalTime} min (${skipped} skippade, ${objectCache.size} cachade objekt)`);
}

main().catch((err) => { console.error("Sync failed:", err); process.exit(1); });
