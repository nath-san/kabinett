/**
 * K-samsök sync for Statens historiska museer (SHM)
 *
 * Strategy:
 * 1. Fetch media records (have image URLs + visualizes→object reference)
 * 2. For each media record, resolve the linked object for metadata (title, class, dating)
 * 3. Store with source='shm'
 *
 * Usage:
 *   pnpm sync:shm
 *   pnpm sync:shm --limit=5000
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
const MEDIA_QUERY = "serviceOrganization=shm AND thumbnailExists=j";
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const MAX_ITEMS = LIMIT_ARG ? Math.max(0, parseInt(LIMIT_ARG.split("=")[1] || "0", 10)) : Number.POSITIVE_INFINITY;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
});

// --- helpers ---

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
  if (years.length === 0) return { start: null, end: null };
  return { start: Math.min(...years), end: Math.max(...years) };
}

function hashId(uuid: string): number {
  const buf = createHash("sha1").update(uuid).digest();
  // Negative to avoid collision with Nationalmuseum IDs (positive)
  return -(buf.readUIntBE(0, 6));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- K-samsök API ---

async function searchKsamsok(query: string, startRecord: number, hitsPerPage: number) {
  const params = new URLSearchParams({
    method: "search",
    query,
    startRecord: String(startRecord),
    hitsPerPage: String(hitsPerPage),
    "x-api": "kabinett",
  });

  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`K-samsök error ${res.status}`);
  return await res.text();
}

async function fetchObjectMetadata(objectUri: string): Promise<{
  title: string;
  className: string | null;
  collection: string | null;
  datingText: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  technique: string | null;
} | null> {
  try {
    // Use XML representation
    const xmlUrl = objectUri.replace("/object/", "/object/xml/");
    const res = await fetch(xmlUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const text = await res.text();
    const parsed = parser.parse(text);

    const title = getText(findFirst(parsed, "itemLabel")) || "Utan titel";
    const className = getText(findFirst(parsed, "itemClassName")) || null;
    const collection = getText(findFirst(parsed, "collection")) || null;
    
    // Dating from various fields
    const dateTexts: string[] = [];
    for (const key of ["eventDate", "displayDate", "fromTime", "toTime"]) {
      const vals = findAll(parsed, key);
      for (const v of vals) {
        const t = getText(v);
        if (t) dateTexts.push(t);
      }
    }
    const datingText = dateTexts[0] || null;
    const allDateText = dateTexts.join(" ");
    const { start: yearStart, end: yearEnd } = extractYears(allDateText);

    // Technique/material
    const techniques: string[] = [];
    for (const key of ["termMaterialsTech", "technique", "material"]) {
      const vals = findAll(parsed, key);
      for (const v of vals) {
        const t = getText(v);
        if (t) techniques.push(t);
      }
    }
    const technique = techniques.join(", ") || null;

    return { title, className, collection, datingText, yearStart, yearEnd, technique };
  } catch {
    return null;
  }
}

// --- DB ---

const upsert = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, category, technique_material, dating_text,
    year_start, year_end, iiif_url, source, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shm', datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    title_sv = excluded.title_sv,
    category = excluded.category,
    technique_material = excluded.technique_material,
    dating_text = excluded.dating_text,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    iiif_url = excluded.iiif_url,
    source = 'shm',
    synced_at = datetime('now')
`);

// --- main ---

async function main() {
  let startRecord = 1;
  let totalHits = Infinity;
  let processed = 0;
  let skipped = 0;
  let objectCache = new Map<string, Awaited<ReturnType<typeof fetchObjectMetadata>>>();

  console.log(`Synkar SHM via K-samsök (limit: ${MAX_ITEMS === Infinity ? "∞" : MAX_ITEMS})…`);

  while (startRecord <= totalHits && processed < MAX_ITEMS) {
    const xml = await searchKsamsok(MEDIA_QUERY, startRecord, HITS_PER_PAGE);
    const parsed = parser.parse(xml);

    if (totalHits === Infinity) {
      const th = getText(findFirst(parsed, "totalHits"));
      totalHits = parseInt(th, 10) || 0;
      console.log(`Totalt ${totalHits.toLocaleString()} mediaposter med bilder`);
    }

    // Extract records
    const records = findAll(parsed, "Entity");
    if (records.length === 0) break;

    for (const entity of records) {
      if (processed >= MAX_ITEMS) break;

      // Get media UUID from about attribute
      const about = entity?.["@_about"] || entity?.["@_rdf:about"] || "";
      const mediaUuid = about.split("/").pop() || "";
      if (!mediaUuid || mediaUuid.length < 10) { skipped++; continue; }

      // Get linked object URI
      const visualizes = entity?.visualizes;
      const objectUri = typeof visualizes === "string" 
        ? visualizes 
        : visualizes?.["@_resource"] || visualizes?.["@_rdf:resource"] || getText(visualizes) || null;

      if (!objectUri || !objectUri.includes("/object/")) {
        skipped++;
        continue;
      }

      const objectUuid = objectUri.split("/").pop() || "";

      // Fetch object metadata (with cache)
      let meta = objectCache.get(objectUri);
      if (meta === undefined) {
        meta = await fetchObjectMetadata(objectUri);
        objectCache.set(objectUri, meta);
        // Rate limit: be nice to their server
        if (objectCache.size % 20 === 0) await sleep(100);
      }

      if (!meta) { skipped++; continue; }

      const imageUrl = `https://media.samlingar.shm.se/item/${mediaUuid}/medium`;
      const id = hashId(objectUuid + mediaUuid);

      // Determine sub-museum from collection
      const subMuseum = meta.collection || "SHM";
      const inventoryNumber = `shm:${objectUuid}`;

      upsert.run(
        id,
        inventoryNumber,
        meta.title,
        meta.className,
        meta.technique,
        meta.datingText,
        meta.yearStart,
        meta.yearEnd,
        imageUrl,
      );
      processed++;
    }

    console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skippade (@ ${startRecord.toLocaleString()} / ${totalHits.toLocaleString()})`);
    startRecord += HITS_PER_PAGE;
  }

  console.log(`\nKlar — synkade ${processed.toLocaleString()} SHM-objekt (${skipped} skippade)`);
  console.log(`Object-cache: ${objectCache.size} unika objekt`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
