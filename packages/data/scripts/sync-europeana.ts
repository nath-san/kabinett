/**
 * Europeana sync
 *
 * Usage:
 *   pnpm sync:europeana
 *   pnpm sync:europeana --limit=5000
 *   pnpm sync:europeana --provider='Rijksmuseum'
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { extractYears } from "./lib/ksamsok-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || resolve(__dirname, "../kabinett.db");

const API_BASE = "https://api.europeana.eu/record/v2/search.json";
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PAGE_RETRIES = 5;
const PAGE_DELAY_MS = 200;
const PROGRESS_INTERVAL = 1000;

function readFlagValue(flagName: string): string | null {
  const prefix = `--${flagName}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim().replace(/^['"]|['"]$/g, "") || null;

  const index = process.argv.indexOf(`--${flagName}`);
  if (index === -1) return null;

  const next = process.argv[index + 1]?.trim();
  if (!next) return null;
  return next.replace(/^['"]|['"]$/g, "") || null;
}

const LIMIT_ARG = readFlagValue("limit");
const MAX_ITEMS = LIMIT_ARG ? Math.max(0, parseInt(LIMIT_ARG, 10) || 0) : Number.POSITIVE_INFINITY;
const PROVIDER = readFlagValue("provider");
const API_KEY = process.env.EUROPEANA_API_KEY?.trim() || "";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

function hashId(value: string): number {
  const buf = createHash("sha1").update(value).digest();
  return -(buf.readUIntBE(0, 6));
}

const upsert = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, title_en, category,
    year_start, year_end, iiif_url, artists, source, sub_museum, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, 'europeana', ?, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    inventory_number = excluded.inventory_number,
    title_sv = excluded.title_sv,
    title_en = excluded.title_en,
    category = excluded.category,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    iiif_url = excluded.iiif_url,
    artists = excluded.artists,
    source = 'europeana',
    sub_museum = excluded.sub_museum,
    synced_at = datetime('now')
`);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCursor(cursor: string): string {
  if (cursor === "*") return cursor;
  return cursor.length > 24 ? `${cursor.slice(0, 24)}…` : cursor;
}

function getRetryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = retryAfterHeader ? Date.parse(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return Math.min(1000 * 2 ** (attempt - 1), 30000);
}

function getFirstString(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || null;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = getFirstString(entry);
      if (text) return text;
    }
    return null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["def", "#text", "$", "label"]) {
      const text = getFirstString(record[key]);
      if (text) return text;
    }
  }

  return null;
}

function getLangAwareTitle(value: unknown, lang: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return getFirstString(record[lang]);
}

function normalizeProviderName(value: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function buildArtistsJson(value: unknown): string | null {
  if (!Array.isArray(value)) return null;

  const artists: Array<{ name: string }> = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const name = getFirstString(candidate);
    if (!name) continue;

    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    artists.push({ name });
  }

  if (artists.length === 0) return null;
  return JSON.stringify(artists);
}

type EuropeanaItem = {
  id?: unknown;
  dcTitleLangAware?: unknown;
  title?: unknown;
  dcCreator?: unknown;
  edmIsShownBy?: unknown;
  type?: unknown;
  year?: unknown;
  dataProvider?: unknown;
};

type ParsedItem = {
  id: number;
  inventory_number: string;
  title_sv: string | null;
  title_en: string | null;
  category: string | null;
  year_start: number | null;
  year_end: number | null;
  iiif_url: string;
  artists: string | null;
  sub_museum: string | null;
};

type EuropeanaSearchResponse = {
  items?: EuropeanaItem[];
  nextCursor?: string | null;
  totalResults?: number;
};

function parseItem(item: EuropeanaItem): ParsedItem | null {
  const recordId = getFirstString(item.id);
  const imageUrl = getFirstString(item.edmIsShownBy);

  if (!recordId || !imageUrl) return null;

  const titleEn = getLangAwareTitle(item.dcTitleLangAware, "en") || getFirstString(item.title);
  const titleSv = getLangAwareTitle(item.dcTitleLangAware, "sv");
  const yearText = getFirstString(item.year);
  const years = yearText ? extractYears(yearText) : { start: null, end: null };

  return {
    id: hashId(`europeana:${recordId}`),
    inventory_number: recordId,
    title_sv: titleSv,
    title_en: titleEn,
    category: getFirstString(item.type),
    year_start: years.start,
    year_end: years.end,
    iiif_url: imageUrl,
    artists: buildArtistsJson(item.dcCreator),
    sub_museum: getFirstString(item.dataProvider),
  };
}

function processPage(
  items: EuropeanaItem[],
  processed: number,
  skipped: number,
  maxItems: number,
): { processed: number; skipped: number } {
  const insertBatch = db.transaction(() => {
    for (const item of items) {
      if (processed >= maxItems) break;

      const parsed = parseItem(item);
      if (!parsed) {
        skipped++;
        continue;
      }

      if (PROVIDER && normalizeProviderName(parsed.sub_museum) !== normalizeProviderName(PROVIDER)) {
        skipped++;
        continue;
      }

      upsert.run(
        parsed.id,
        parsed.inventory_number,
        parsed.title_sv,
        parsed.title_en,
        parsed.category,
        parsed.year_start,
        parsed.year_end,
        parsed.iiif_url,
        parsed.artists,
        parsed.sub_museum,
      );
      processed++;
    }
  });

  insertBatch();
  return { processed, skipped };
}

function buildSearchUrl(cursor: string): string {
  const params = new URLSearchParams();
  params.set("query", "*");
  params.set("media", "true");
  params.set("thumbnail", "true");
  params.append("qf", "TYPE:IMAGE");
  params.set("theme", "art");
  params.set("reusability", "open");
  params.set("rows", String(PAGE_SIZE));
  params.set("profile", "rich");
  params.set("cursor", cursor);

  if (PROVIDER) {
    const providerFilter = PROVIDER.replace(/"/g, "").trim();
    if (providerFilter) {
      params.append("qf", `DATA_PROVIDER:"${providerFilter}"`);
    }
  }

  return `${API_BASE}?${params.toString()}`;
}

async function fetchPage(cursor: string, attempt = 1): Promise<EuropeanaSearchResponse> {
  try {
    const res = await fetch(buildSearchUrl(cursor), {
      headers: {
        "X-Api-Key": API_KEY,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 429) {
      if (attempt >= MAX_PAGE_RETRIES) {
        throw new Error(`Europeana error ${res.status}`);
      }

      const backoffMs = getRetryDelayMs(res.headers.get("retry-after"), attempt);
      console.warn(
        `⚠️  Europeana begränsar hastigheten för cursor ${formatCursor(cursor)} (försök ${attempt}/${MAX_PAGE_RETRIES}). Försöker igen om ${backoffMs} ms…`
      );
      await sleep(backoffMs);
      return fetchPage(cursor, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`Europeana error ${res.status}`);
    }

    return await res.json() as EuropeanaSearchResponse;
  } catch (error) {
    if (attempt >= MAX_PAGE_RETRIES) {
      throw error;
    }

    const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10000);
    console.warn(
      `⚠️  Cursor ${formatCursor(cursor)} misslyckades (försök ${attempt}/${MAX_PAGE_RETRIES}). Försöker igen om ${backoffMs} ms…`
    );
    await sleep(backoffMs);
    return fetchPage(cursor, attempt + 1);
  }
}

async function main() {
  if (!API_KEY) {
    throw new Error("EUROPEANA_API_KEY saknas");
  }

  let cursor = "*";
  let processed = 0;
  let skipped = 0;
  let page = 0;
  let nextProgressLog = PROGRESS_INTERVAL;

  console.log(
    `Synkar Europeana${PROVIDER ? ` (${PROVIDER})` : ""} (limit: ${MAX_ITEMS === Infinity ? "alla" : MAX_ITEMS})…`
  );

  while (cursor && processed < MAX_ITEMS) {
    const response = await fetchPage(cursor);
    const items = Array.isArray(response.items) ? response.items : [];
    page += 1;

    if (page === 1 && Number.isFinite(response.totalResults)) {
      console.log(`Totalt ${Number(response.totalResults).toLocaleString()} poster`);
    }

    if (items.length === 0) break;

    ({ processed, skipped } = processPage(items, processed, skipped, MAX_ITEMS));

    while (processed >= nextProgressLog) {
      console.log(`  ${processed.toLocaleString()} synkade, ${skipped} skippade (sida ${page.toLocaleString()})`);
      nextProgressLog += PROGRESS_INTERVAL;
    }

    const nextCursor = typeof response.nextCursor === "string" && response.nextCursor.trim()
      ? response.nextCursor
      : null;

    if (!nextCursor || nextCursor === cursor || processed >= MAX_ITEMS) {
      break;
    }

    cursor = nextCursor;
    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\nKlar — synkade ${processed.toLocaleString()} Europeana-verk (${skipped} skippade)`);
}

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
