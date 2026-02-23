/**
 * K-samsök sync for Nordiska museet
 *
 * Nordiska has metadata directly on photo records — no extra object lookup needed.
 * Images via ems.dimu.org with flexible dimensions.
 *
 * Usage:
 *   pnpm sync:nordiska
 *   pnpm sync:nordiska --limit=5000
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
const QUERY = "serviceOrganization=nomu AND thumbnailExists=j";
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
    .filter((y) => y >= 1400 && y <= 2100);
  if (years.length === 0) return { start: null, end: null };
  return { start: Math.min(...years), end: Math.max(...years) };
}

function hashId(uuid: string): number {
  const buf = createHash("sha1").update("nordiska:" + uuid).digest();
  return -(buf.readUIntBE(0, 6));
}

const upsert = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, category, dating_text,
    year_start, year_end, iiif_url, source, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, 'nordiska', datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    title_sv = excluded.title_sv,
    category = excluded.category,
    dating_text = excluded.dating_text,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    iiif_url = excluded.iiif_url,
    source = 'nordiska',
    synced_at = datetime('now')
`);

async function fetchPage(startRecord: number) {
  const params = new URLSearchParams({
    method: "search",
    query: QUERY,
    startRecord: String(startRecord),
    hitsPerPage: String(HITS_PER_PAGE),
    "x-api": "kabinett",
  });

  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`K-samsök error ${res.status}`);
  const text = await res.text();
  return parser.parse(text);
}

function extractImageUrl(entity: any): string | null {
  // Find highres (1200x1200) or medium (600x600) dimu.org image
  const allSrc = findAll(entity, "src");
  for (const src of allSrc) {
    const url = getText(src);
    if (url.includes("dimu.org") && url.includes("1200x1200")) return url;
  }
  for (const src of allSrc) {
    const url = getText(src);
    if (url.includes("dimu.org") && url.includes("600x600")) return url;
  }
  // Fallback: any dimu.org URL
  for (const src of allSrc) {
    const url = getText(src);
    if (url.includes("dimu.org")) return url;
  }
  return null;
}

function parseEntity(entity: any) {
  const about = entity?.["@_about"] || entity?.["@_rdf:about"] || "";
  const entityId = about.split("/").pop() || "";
  if (!entityId) return null;

  const title = getText(findFirst(entity, "itemLabel"))?.trim();
  if (!title || title.length < 3) return null;

  const className = getText(findFirst(entity, "itemClassName"))?.trim() || null;

  // Dating from various fields
  const dateTexts: string[] = [];
  for (const key of ["eventDate", "displayDate", "fromTime", "toTime", "eventTime"]) {
    const vals = findAll(entity, key);
    for (const v of vals) {
      const t = getText(v)?.trim();
      if (t) dateTexts.push(t);
    }
  }
  const datingText = dateTexts[0] || null;
  const { start, end } = extractYears(dateTexts.join(" ") || title);

  const imageUrl = extractImageUrl(entity);
  if (!imageUrl) return null;

  return {
    id: hashId(entityId),
    inventory_number: `nordiska:${entityId}`,
    title_sv: title.length > 200 ? title.slice(0, 197) + "…" : title,
    category: className,
    dating_text: datingText,
    year_start: start,
    year_end: end,
    iiif_url: imageUrl,
  };
}

async function main() {
  let startRecord = 1;
  let totalHits = Infinity;
  let processed = 0;
  let skipped = 0;

  console.log(`Synkar Nordiska museet via K-samsök (limit: ${MAX_ITEMS === Infinity ? "alla" : MAX_ITEMS})…`);

  while (startRecord <= totalHits && processed < MAX_ITEMS) {
    const parsed = await fetchPage(startRecord);

    if (totalHits === Infinity) {
      const th = getText(findFirst(parsed, "totalHits"));
      totalHits = parseInt(th, 10) || 0;
      console.log(`Totalt ${totalHits.toLocaleString()} poster`);
    }

    const entities = findAll(parsed, "Entity");
    if (entities.length === 0) break;

    for (const entity of entities) {
      if (processed >= MAX_ITEMS) break;
      const item = parseEntity(entity);
      if (!item) { skipped++; continue; }

      upsert.run(
        item.id,
        item.inventory_number,
        item.title_sv,
        item.category,
        item.dating_text,
        item.year_start,
        item.year_end,
        item.iiif_url,
      );
      processed++;
    }

    console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skippade (@ ${startRecord.toLocaleString()} / ${totalHits.toLocaleString()})`);
    startRecord += HITS_PER_PAGE;
  }

  console.log(`\nKlar — synkade ${processed.toLocaleString()} objekt från Nordiska museet (${skipped} skippade)`);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
