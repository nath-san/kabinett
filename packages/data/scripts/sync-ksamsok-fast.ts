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
import {
  KSAMSOK_XML_PARSER_CONFIG,
  extractYears,
  findAll,
  findFirst,
  getText,
} from "./lib/ksamsok-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || resolve(__dirname, "../kabinett.db");

const API_BASE = "https://kulturarvsdata.se/ksamsok/api";
const HITS_PER_PAGE = 500;
const CONCURRENCY = 15;
const MEDIA_QUERY = "serviceOrganization=shm AND thumbnailExists=j";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGE_RETRIES = 5;

const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const MAX_ITEMS = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1] || "0", 10) : Infinity;
const OFFSET_ARG = process.argv.find((arg) => arg.startsWith("--offset="));
const START_OFFSET = OFFSET_ARG ? parseInt(OFFSET_ARG.split("=")[1] || "1", 10) : 1;
const ARTISTS_ONLY = process.argv.includes("--artists-only");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const parser = new XMLParser(KSAMSOK_XML_PARSER_CONFIG);

function hashId(s: string): number {
  return -(createHash("sha1").update(s).digest().readUIntBE(0, 6));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSearchPage(startRecord: number, attempt = 1): Promise<any> {
  const params = new URLSearchParams({
    method: "search",
    query: MEDIA_QUERY,
    startRecord: String(startRecord),
    hitsPerPage: String(HITS_PER_PAGE),
    "x-api": "kabinett",
  });

  try {
    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} at ${startRecord}`);
    const xml = await res.text();
    return parser.parse(xml);
  } catch (error) {
    if (attempt >= MAX_PAGE_RETRIES) {
      throw error;
    }
    const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10000);
    console.warn(
      `⚠️  Sida ${startRecord} misslyckades (försök ${attempt}/${MAX_PAGE_RETRIES}). Försöker igen om ${backoffMs} ms…`
    );
    await sleep(backoffMs);
    return fetchSearchPage(startRecord, attempt + 1);
  }
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
  artists: string | null;
} | null>();

type ArtistRow = {
  name: string;
  nationality: string | null;
  role: string | null;
};

function isUsableCreatorName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === "okänd") return false;
  if (normalized === "unknown") return false;
  if (normalized.includes("ingen uppgift")) return false;
  if (normalized.includes("anställd vid")) return false;
  if (normalized.includes("museum")) return false;
  if (normalized.includes("museet")) return false;
  if (normalized.includes("museer")) return false;
  return true;
}

function buildArtistsJson(artists: ArtistRow[]): string | null {
  if (artists.length === 0) return null;
  return JSON.stringify(artists);
}

function getNodeTextOrResource(node: any): string {
  const text = getText(node)?.trim();
  if (text) return text;
  if (node && typeof node === "object") {
    const resource = node["@_rdf:resource"] || node["@_resource"] || "";
    if (typeof resource === "string") return resource;
  }
  return "";
}

function extractArtistsFromContexts(contexts: any[]): string | null {
  const artists: ArtistRow[] = [];
  const seen = new Set<string>();

  for (const ctx of contexts) {
    const name = getText(findFirst(ctx, "name"))?.trim() || "";
    if (!isUsableCreatorName(name)) continue;

    const contextLabel = getNodeTextOrResource(findFirst(ctx, "contextLabel")) || "";
    const role = getNodeTextOrResource(findFirst(ctx, "title")) || contextLabel || null;
    const superType = getNodeTextOrResource(findFirst(ctx, "contextSuperType"));
    const contextType = getNodeTextOrResource(findFirst(ctx, "contextType"));
    const isCreatorContext = /create|produce/i.test(superType) || /create|produce/i.test(contextType)
      || /fotograf|tillverk|skap|konstnär|formgiv|design|gravör|målare|tecknare/i.test(role || "");
    if (!isCreatorContext) continue;

    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    artists.push({ name, nationality: null, role });
  }

  return buildArtistsJson(artists);
}

function extractArtists(parsed: any): string | null {
  return extractArtistsFromContexts(findAll(parsed, "Context"));
}

function extractMediaArtists(entity: any): string | null {
  return extractArtistsFromContexts(findAll(entity, "Context"));
}

async function fetchObjectMeta(objectUri: string) {
  if (objectCache.has(objectUri)) return objectCache.get(objectUri)!;
  
  try {
    // Use full object RDF, not /xml presentation wrapper, so creator fields are available.
    const res = await fetch(objectUri, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { objectCache.set(objectUri, null); return null; }
    const text = await res.text();
    const parsed = parser.parse(text);

    const title = getText(findFirst(parsed, "itemLabel")) || "Utan titel";
    const className = getText(findFirst(parsed, "itemClassName")) || null;
    const collection = getText(findFirst(parsed, "collection")) || null;
    // Dating — with context type tracking
    const PRODUCTION_LABELS = new Set([
      "produktion", "tillverkning", "skapande", "utförande",
      "datering", "tryckning",
    ]);
    const contexts = findAll(parsed, "Context");
    let productionDates: string[] = [];
    let photoDates: string[] = [];
    let datingType: string | null = null;

    for (const ctx of contexts) {
      const label = getText(findFirst(ctx, "contextLabel"))?.trim().toLowerCase() || "";
      const labelRaw = getText(findFirst(ctx, "contextLabel"))?.trim() || "";
      const superType = getText(findFirst(ctx, "contextSuperType")) || "";
      const isCreate = superType.includes("create") || superType.includes("produce");
      if (!isCreate) continue;

      const dates: string[] = [];
      for (const key of ["fromTime", "toTime"]) {
        const t = getText(findFirst(ctx, key))?.trim();
        if (t) dates.push(t);
      }
      if (dates.length === 0) continue;

      if (PRODUCTION_LABELS.has(label)) {
        productionDates.push(...dates);
        if (!datingType) datingType = labelRaw;
      } else if (label === "fotografering") {
        photoDates.push(...dates);
      }
    }

    let dateTexts = productionDates;
    if (dateTexts.length === 0 && photoDates.length > 0) {
      dateTexts = photoDates;
      datingType = "Fotografering";
    }
    if (dateTexts.length === 0) {
      for (const key of ["displayDate", "eventDate"]) {
        const t = getText(findFirst(parsed, key))?.trim();
        if (t) dateTexts.push(t);
      }
    }
    const { start, end } = dateTexts.length > 0
      ? extractYears(dateTexts.join(" "))
      : { start: null, end: null };
    const techniques = findAll(parsed, "termMaterialsTech").map(v => getText(v)).filter(Boolean);

    const meta = {
      title, className, collection,
      datingText: dateTexts[0] || null,
      datingType,
      yearStart: start, yearEnd: end,
      technique: techniques.join(", ") || null,
      artists: extractArtists(parsed),
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
    id, inventory_number, title_sv, category, technique_material, dating_text, dating_type,
    year_start, year_end, iiif_url, artists, source, sub_museum, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shm', ?, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    title_sv=excluded.title_sv, category=excluded.category,
    technique_material=excluded.technique_material, dating_text=excluded.dating_text,
    dating_type=excluded.dating_type,
    year_start=excluded.year_start, year_end=excluded.year_end,
    iiif_url=excluded.iiif_url, artists=excluded.artists, source='shm', sub_museum=excluded.sub_museum, synced_at=datetime('now')
`);

const updateArtists = db.prepare(`
  UPDATE artworks
  SET artists = ?, synced_at = datetime('now')
  WHERE id = ? AND source = 'shm'
`);

// --- Main ---
async function main() {
  let startRecord = START_OFFSET;
  let totalHits = Infinity;
  let processed = 0;
  let skipped = 0;
  const startTime = Date.now();

  const modeText = ARTISTS_ONLY ? "artists-only" : "full";
  console.log(`SHM fast sync (läge: ${modeText}, concurrency: ${CONCURRENCY}, limit: ${MAX_ITEMS === Infinity ? "∞" : MAX_ITEMS}, offset: ${START_OFFSET})`);

  while (startRecord <= totalHits && processed < MAX_ITEMS) {
    let parsed: any;
    try {
      parsed = await fetchSearchPage(startRecord);
    } catch (error) {
      console.error(`❌ Kunde inte hämta sida ${startRecord} efter ${MAX_PAGE_RETRIES} försök:`, error);
      break;
    }

    if (totalHits === Infinity) {
      totalHits = parseInt(getText(findFirst(parsed, "totalHits")), 10) || 0;
      console.log(`Totalt ${totalHits.toLocaleString()} mediaposter`);
    }

    const entities = findAll(parsed, "Entity");
    if (!entities.length) break;

    // Extract media→object mappings
    type MediaItem = { mediaUuid: string; objectUri: string; mediaArtists: string | null };
    const items: MediaItem[] = [];
    for (const e of entities) {
      const about = e?.["@_about"] || e?.["@_rdf:about"] || "";
      const mediaUuid = about.split("/").pop() || "";
      if (!mediaUuid || mediaUuid.length < 10) { skipped++; continue; }

      const vis = e?.visualizes;
      const objectUri = typeof vis === "string" ? vis
        : vis?.["@_resource"] || vis?.["@_rdf:resource"] || getText(vis) || null;
      if (!objectUri?.includes("/object/")) { skipped++; continue; }

      items.push({ mediaUuid, objectUri, mediaArtists: extractMediaArtists(e) });
    }

    // For artists-only mode we can use media-level contexts directly.
    const metas = ARTISTS_ONLY
      ? new Array(items.length).fill(null)
      : await pMap(items, (item) => fetchObjectMeta(item.objectUri), CONCURRENCY);

    // Batch insert
    const insertMany = db.transaction(() => {
      for (let i = 0; i < items.length; i++) {
        if (processed >= MAX_ITEMS) break;
        const meta = metas[i];
        const { mediaUuid, objectUri } = items[i];
        const objectUuid = objectUri.split("/").pop()!;
        const rowId = hashId(objectUuid + mediaUuid);
        if (ARTISTS_ONLY) {
          updateArtists.run(items[i].mediaArtists, rowId);
        } else {
          if (!meta) { skipped++; continue; }
          upsert.run(
            rowId,
            `shm:${objectUuid}`,
            meta.title,
            meta.className,
            meta.technique,
            meta.datingText,
            meta.datingType,
            meta.yearStart,
            meta.yearEnd,
            `https://media.samlingar.shm.se/item/${mediaUuid}/medium`,
            meta.artists || items[i].mediaArtists,
            meta.collection || "SHM",
          );
        }
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

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
