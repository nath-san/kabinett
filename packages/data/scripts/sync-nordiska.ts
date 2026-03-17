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
const PAGE_CONCURRENCY = 5;
const QUERY = "serviceOrganization=nomu AND thumbnailExists=j";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGE_RETRIES = 5;
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const MAX_ITEMS = LIMIT_ARG ? Math.max(0, parseInt(LIMIT_ARG.split("=")[1] || "0", 10)) : Number.POSITIVE_INFINITY;
const ARTISTS_ONLY = process.argv.includes("--artists-only");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const parser = new XMLParser(KSAMSOK_XML_PARSER_CONFIG);

function hashId(uuid: string): number {
  const buf = createHash("sha1").update("nordiska:" + uuid).digest();
  return -(buf.readUIntBE(0, 6));
}

const upsert = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, category, dating_text, dating_type,
    year_start, year_end, iiif_url, artists, source, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nordiska', datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    title_sv = excluded.title_sv,
    category = excluded.category,
    dating_text = excluded.dating_text,
    dating_type = excluded.dating_type,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    iiif_url = excluded.iiif_url,
    artists = excluded.artists,
    source = 'nordiska',
    synced_at = datetime('now')
`);

const updateArtists = db.prepare(`
  UPDATE artworks
  SET artists = ?, synced_at = datetime('now')
  WHERE id = ? AND source = 'nordiska'
`);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(startRecord: number, attempt = 1): Promise<any> {
  const params = new URLSearchParams({
    method: "search",
    query: QUERY,
    startRecord: String(startRecord),
    hitsPerPage: String(HITS_PER_PAGE),
    "x-api": "kabinett",
  });

  try {
    const res = await fetch(`${API_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`K-samsök error ${res.status}`);
    const text = await res.text();
    return parser.parse(text);
  } catch (error) {
    if (attempt >= MAX_PAGE_RETRIES) {
      throw error;
    }
    const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10000);
    console.warn(
      `⚠️  Sida ${startRecord} misslyckades (försök ${attempt}/${MAX_PAGE_RETRIES}). Försöker igen om ${backoffMs} ms…`
    );
    await sleep(backoffMs);
    return fetchPage(startRecord, attempt + 1);
  }
}

async function pMap<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });

  await Promise.all(workers);
  return results;
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

function extractArtists(entity: any): string | null {
  const contexts = findAll(entity, "Context");
  const artists: ArtistRow[] = [];
  const seen = new Set<string>();

  for (const ctx of contexts) {
    const name = getText(findFirst(ctx, "name"))?.trim() || "";
    if (!isUsableCreatorName(name)) continue;

    const contextLabel = getNodeTextOrResource(findFirst(ctx, "contextLabel")) || "";
    const role = getNodeTextOrResource(findFirst(ctx, "title")) || contextLabel || null;
    const superType = getNodeTextOrResource(findFirst(ctx, "contextSuperType"));
    const contextType = getNodeTextOrResource(findFirst(ctx, "contextType"));
    const isCreatorContext = /create|produce/i.test(superType)
      || /create|produce/i.test(contextType)
      || /fotograf|tillverk|skap|konstnär|formgiv|design|gravör|målare|tecknare/i.test(role || "");
    if (!isCreatorContext) continue;

    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    artists.push({ name, nationality: null, role });
  }

  const byline = getText(findFirst(entity, "byline"))?.trim() || "";
  if (isUsableCreatorName(byline)) {
    const dedupeKey = byline.toLowerCase();
    if (!seen.has(dedupeKey)) {
      artists.unshift({ name: byline, nationality: null, role: "Byline" });
    }
  }

  return buildArtistsJson(artists);
}

function parseEntity(entity: any) {
  const about = entity?.["@_about"] || entity?.["@_rdf:about"] || "";
  const entityId = about.split("/").pop() || "";
  if (!entityId) return null;

  const title = getText(findFirst(entity, "itemLabel"))?.trim();
  if (!title || title.length < 3) return null;

  const className = getText(findFirst(entity, "itemClassName"))?.trim() || null;

  // Dating — uses K-samsök context blocks with priority:
  // 1. "Produktion"/"Tillverkning" (create) = actual object creation date
  // 2. "Fotografering" (create) = when photo was taken
  //    - For itemType=photo: the photo IS the work → always use
  //    - For itemType=object: photo of object → digitization, skip
  // 3. Nothing → no reliable date
  const PRODUCTION_LABELS = new Set(["produktion", "tillverkning", "skapande", "utförande", "datering", "tryckning"]);
  const contexts = findAll(entity, "Context");
  const itemTypeRaw = getText(findFirst(entity, "itemType")) || "";
  const isPhotoType = itemTypeRaw.includes("photo");

  let productionDates: string[] = [];
  let photoDates: string[] = [];

  for (const ctx of contexts) {
    const label = getText(findFirst(ctx, "contextLabel"))?.trim().toLowerCase() || "";
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
    } else if (label === "fotografering") {
      photoDates.push(...dates);
    }
  }

  // Use production dates first (best signal), then photo dates
  let dateTexts: string[] = [];
  let datingType: string | null = null;

  if (productionDates.length > 0) {
    dateTexts = productionDates;
    // Find the actual production label used
    for (const ctx of contexts) {
      const label = getText(findFirst(ctx, "contextLabel"))?.trim() || "";
      if (PRODUCTION_LABELS.has(label.toLowerCase())) {
        datingType = label; // e.g. "Produktion", "Tillverkning"
        break;
      }
    }
  } else if (photoDates.length > 0) {
    dateTexts = photoDates;
    datingType = "Fotografering";
  }

  const datingText = dateTexts[0] || null;
  const { start, end } = dateTexts.length > 0
    ? extractYears(dateTexts.join(" "), { minYear: 1200 })
    : { start: null, end: null };

  const imageUrl = extractImageUrl(entity);
  if (!imageUrl) return null;

  return {
    id: hashId(entityId),
    inventory_number: `nordiska:${entityId}`,
    title_sv: title.length > 200 ? title.slice(0, 197) + "…" : title,
    category: className,
    dating_text: datingText,
    dating_type: datingType,
    year_start: start,
    year_end: end,
    iiif_url: imageUrl,
    artists: extractArtists(entity),
  };
}

function processPage(
  entities: any[],
  processed: number,
  skipped: number,
  maxItems: number,
): { processed: number; skipped: number } {
  const insertBatch = db.transaction(() => {
    for (const entity of entities) {
      if (processed >= maxItems) break;
      const item = parseEntity(entity);
      if (!item) {
        skipped++;
        continue;
      }

      if (ARTISTS_ONLY) {
        updateArtists.run(item.artists, item.id);
      } else {
        upsert.run(
          item.id,
          item.inventory_number,
          item.title_sv,
          item.category,
          item.dating_text,
          item.dating_type,
          item.year_start,
          item.year_end,
          item.iiif_url,
          item.artists,
        );
      }
      processed++;
    }
  });

  insertBatch();
  return { processed, skipped };
}

async function main() {
  let totalHits = 0;
  let processed = 0;
  let skipped = 0;

  const modeText = ARTISTS_ONLY ? "artists-only" : "full";
  console.log(`Synkar Nordiska museet via K-samsök (läge: ${modeText}, sidkonkurrens: ${PAGE_CONCURRENCY}, limit: ${MAX_ITEMS === Infinity ? "alla" : MAX_ITEMS})…`);

  const firstStartRecord = 1;
  const firstPage = await fetchPage(firstStartRecord);
  const th = getText(findFirst(firstPage, "totalHits"));
  totalHits = parseInt(th, 10) || 0;
  console.log(`Totalt ${totalHits.toLocaleString()} poster`);

  const firstEntities = findAll(firstPage, "Entity");
  if (firstEntities.length > 0) {
    ({ processed, skipped } = processPage(firstEntities, processed, skipped, MAX_ITEMS));
    console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skippade (@ ${firstStartRecord.toLocaleString()} / ${totalHits.toLocaleString()})`);
  }

  if (processed >= MAX_ITEMS) {
    console.log(`\nKlar — synkade ${processed.toLocaleString()} objekt från Nordiska museet (${skipped} skippade)`);
    return;
  }

  const remainingStartRecords: number[] = [];
  for (let startRecord = firstStartRecord + HITS_PER_PAGE; startRecord <= totalHits; startRecord += HITS_PER_PAGE) {
    remainingStartRecords.push(startRecord);
  }

  const cappedStartRecords = Number.isFinite(MAX_ITEMS)
    ? remainingStartRecords.slice(0, Math.ceil((MAX_ITEMS - processed) / HITS_PER_PAGE))
    : remainingStartRecords;

  for (let offset = 0; offset < cappedStartRecords.length; offset += PAGE_CONCURRENCY) {
    if (processed >= MAX_ITEMS) break;
    const startRecordsChunk = cappedStartRecords.slice(offset, offset + PAGE_CONCURRENCY);
    const chunkResults = await pMap(startRecordsChunk, async (startRecord) => {
      try {
        const parsed = await fetchPage(startRecord);
        return { startRecord, parsed };
      } catch (error) {
        console.error(`❌ Kunde inte hämta sida ${startRecord} efter ${MAX_PAGE_RETRIES} försök:`, error);
        return { startRecord, parsed: null as any };
      }
    }, PAGE_CONCURRENCY);

    for (const result of chunkResults) {
      if (processed >= MAX_ITEMS) break;
      if (!result.parsed) continue;
      const entities = findAll(result.parsed, "Entity");
      if (entities.length === 0) continue;

      ({ processed, skipped } = processPage(entities, processed, skipped, MAX_ITEMS));
      console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skippade (@ ${result.startRecord.toLocaleString()} / ${totalHits.toLocaleString()})`);
    }
  }

  console.log(`\nKlar — synkade ${processed.toLocaleString()} objekt från Nordiska museet (${skipped} skippade)`);
}

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
