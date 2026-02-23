/**
 * K-samsök sync for Statens historiska museer (SHM)
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
const ORG_QUERY = "serviceOrganization=\"Statens historiska museer\" AND thumbnailExists=j";
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
  if (typeof node === "object") {
    if ("#text" in node) return String(node["#text"]);
  }
  return "";
}

function findFirst(obj: any, key: string): any {
  if (!obj || typeof obj !== "object") return null;
  if (key in obj) return obj[key];
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

function collectEntities(obj: any, acc: any[] = []): any[] {
  if (!obj || typeof obj !== "object") return acc;
  if ("Entity" in obj) {
    const entity = (obj as any).Entity;
    if (Array.isArray(entity)) acc.push(...entity);
    else acc.push(entity);
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) collectEntities(item, acc);
    } else if (typeof value === "object") {
      collectEntities(value, acc);
    }
  }
  return acc;
}

function collectTextsByKey(obj: any, matcher: RegExp, acc: string[] = []): string[] {
  if (!obj || typeof obj !== "object") return acc;
  for (const [key, value] of Object.entries(obj)) {
    if (matcher.test(key)) {
      const text = getText(value);
      if (text) acc.push(text);
    }
    if (Array.isArray(value)) {
      for (const item of value) collectTextsByKey(item, matcher, acc);
    } else if (typeof value === "object") {
      collectTextsByKey(value, matcher, acc);
    }
  }
  return acc;
}

function extractYears(values: string[]): { start: number | null; end: number | null } {
  const years = values
    .flatMap((v) => (v.match(/\d{4}/g) || []).map((y) => parseInt(y, 10)))
    .filter((y) => y >= 500 && y <= 2100);
  if (years.length === 0) return { start: null, end: null };
  return { start: Math.min(...years), end: Math.max(...years) };
}

function hashId(uuid: string): number {
  const buf = createHash("sha1").update(uuid).digest();
  const hash = buf.readUIntBE(0, 6);
  return hash > 0 ? -hash : -1;
}

const upsert = db.prepare(`
  INSERT INTO artworks (
    id, title_sv, category, technique_material, dating_text,
    year_start, year_end, iiif_url, material_tags, technique_tags, source, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shm', datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    title_sv = excluded.title_sv,
    category = excluded.category,
    technique_material = excluded.technique_material,
    dating_text = excluded.dating_text,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    iiif_url = excluded.iiif_url,
    material_tags = excluded.material_tags,
    technique_tags = excluded.technique_tags,
    source = 'shm',
    synced_at = datetime('now')
`);

async function fetchPage(startRecord: number) {
  const params = new URLSearchParams({
    method: "search",
    query: ORG_QUERY,
    startRecord: String(startRecord),
    hitsPerPage: String(HITS_PER_PAGE),
    "x-api": "kabinett",
  });

  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`K-samsök error ${res.status} at startRecord=${startRecord}`);
  const text = await res.text();
  const parsed = parser.parse(text);
  const totalHitsRaw = findFirst(parsed, "totalHits") || findFirst(parsed, "total") || "0";
  const totalHits = parseInt(getText(totalHitsRaw) || "0", 10) || 0;
  const entities = collectEntities(parsed);
  return { totalHits, entities };
}

function parseEntity(entity: any) {
  const about = entity?.["@_rdf:about"] || entity?.["@_about"] || "";
  const uuid = about.split("/").pop() || "";
  if (!uuid) return null;

  const title = getText(findFirst(entity, "itemLabel")) || "Utan titel";
  const category = getText(findFirst(entity, "itemClassName")) || null;
  const datingText =
    getText(findFirst(entity, "eventTime")) ||
    getText(findFirst(entity, "eventDate")) ||
    getText(findFirst(entity, "date")) ||
    null;

  const materialValues = collectTextsByKey(entity, /material/i);
  const techniqueValues = collectTextsByKey(entity, /technique/i);
  const materialTags = Array.from(new Set(materialValues.map((v) => v.trim()).filter(Boolean)));
  const techniqueTags = Array.from(new Set(techniqueValues.map((v) => v.trim()).filter(Boolean)));

  const { start, end } = extractYears([datingText || "", ...materialTags, ...techniqueTags]);
  const techniqueMaterial = [...materialTags, ...techniqueTags].join(", ") || null;

  return {
    id: hashId(uuid),
    uuid,
    title_sv: title,
    category,
    dating_text: datingText,
    year_start: start,
    year_end: end,
    iiif_url: `https://media.samlingar.shm.se/item/${uuid}/medium`,
    material_tags: materialTags.join(", ") || null,
    technique_tags: techniqueTags.join(", ") || null,
    technique_material: techniqueMaterial,
  };
}

async function main() {
  let startRecord = 1;
  let totalHits = Number.POSITIVE_INFINITY;
  let processed = 0;

  while (startRecord <= totalHits && processed < MAX_ITEMS) {
    const page = await fetchPage(startRecord);
    if (totalHits === Number.POSITIVE_INFINITY) {
      totalHits = page.totalHits;
      console.log(`🔎 Total hits: ${totalHits}`);
    }

    for (const entity of page.entities) {
      if (processed >= MAX_ITEMS) break;
      const parsed = parseEntity(entity);
      if (!parsed) continue;

      upsert.run(
        parsed.id,
        parsed.title_sv,
        parsed.category,
        parsed.technique_material,
        parsed.dating_text,
        parsed.year_start,
        parsed.year_end,
        parsed.iiif_url,
        parsed.material_tags,
        parsed.technique_tags
      );
      processed++;
    }

    console.log(`✅ Synkade ${Math.min(processed, totalHits)} / ${Math.min(totalHits, MAX_ITEMS)}…`);
    startRecord += HITS_PER_PAGE;
  }

  console.log(`🎉 Klar — synkade ${processed} objekt från SHM`);
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
