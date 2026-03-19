import { getDb } from "./db.server";
import { getRequestContext } from "./request-context.server";

export type MuseumRow = {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  image_base_url: string | null;
  source_type: string | null;
  enabled: number | null;
};

function parseEnvMuseums(): string[] | null {
  const raw = process.env.MUSEUMS?.trim();
  if (!raw) return null;
  return sanitizeMuseumList(raw
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean));
}

function sanitizeMuseumId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function sanitizeMuseumList(values: string[] | null | undefined): string[] | null {
  if (!values) return null;

  const sanitized = values
    .map((value) => sanitizeMuseumId(value))
    .filter((id): id is string => Boolean(id));

  if (sanitized.length === 0) return null;
  return [...new Set(sanitized)];
}

let enabledMuseumsCache: string[] | null = null;
let enabledMuseumsCacheTime = 0;
const ENABLED_MUSEUMS_TTL_MS = 60 * 1000;
const sourceFilterCache = new Map<string, { sql: string; params: string[] }>();
let hasMediaLicenseColumnCache: boolean | null = null;
const COLLECTION_OPTIONS_TTL_MS = 60 * 1000;
let collectionOptionsCache:
  | {
      key: string;
      ts: number;
      data: Array<{ id: string; name: string; count: number }>;
    }
  | null = null;

export function getEnabledMuseums(): string[] {
  const now = Date.now();
  const allEnabledMuseums = getDbEnabledMuseums(now);
  const context = getRequestContext();

  if (context) {
    const contextMuseums = sanitizeMuseumList(context.museums);
    if (!contextMuseums) {
      return allEnabledMuseums;
    }

    const allowed = new Set(allEnabledMuseums);
    return contextMuseums.filter((id) => allowed.has(id));
  }

  const requestedMuseums = parseEnvMuseums();

  if (!requestedMuseums) {
    return allEnabledMuseums;
  }

  const allowed = new Set(allEnabledMuseums);
  return requestedMuseums.filter((id) => allowed.has(id));
}

function getDbEnabledMuseums(now: number): string[] {
  if (enabledMuseumsCache && now - enabledMuseumsCacheTime < ENABLED_MUSEUMS_TTL_MS) {
    return enabledMuseumsCache;
  }

  const db = getDb();
  const rows = db.prepare("SELECT id FROM museums WHERE enabled = 1").all() as Array<{ id: string }>;
  const all = rows
    .map((r) => sanitizeMuseumId(r.id))
    .filter((id): id is string => Boolean(id));

  enabledMuseumsCache = all;
  enabledMuseumsCacheTime = now;
  return all;
}

export function isMuseumEnabled(source: string): boolean {
  return getEnabledMuseums().includes(source);
}

export function getMuseumInfo(source: string): MuseumRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, description, url, image_base_url, source_type, enabled
       FROM museums WHERE id = ?`
    )
    .get(source) as MuseumRow | undefined;
  return row || null;
}

export function sourceFilter(prefix?: string): { sql: string; params: string[] } {
  const museums = getEnabledMuseums();
  const prefixKey = prefix || "";
  const hasMediaLicenseColumn = getHasMediaLicenseColumn();
  const cacheKey = `${museums.join(",")}::${prefixKey}::lic:${hasMediaLicenseColumn ? "1" : "0"}`;
  const cached = sourceFilterCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (museums.length === 0) {
    const empty = { sql: "1 = 0", params: [] };
    sourceFilterCache.set(cacheKey, empty);
    return empty;
  }

  const col = prefix ? `${prefix}.source` : "source";
  const licCol = prefix ? `${prefix}.media_license` : "media_license";
  const result = {
    sql: hasMediaLicenseColumn
      ? `${col} IN (${museums.map(() => "?").join(",")}) AND (${licCol} IS NULL OR ${licCol} NOT IN ('In Copyright', '© Bildupphovsrätt i Sverige'))`
      : `${col} IN (${museums.map(() => "?").join(",")})`,
    params: museums,
  };
  sourceFilterCache.set(cacheKey, result);
  return result;
}

function getHasMediaLicenseColumn(): boolean {
  if (hasMediaLicenseColumnCache !== null) {
    return hasMediaLicenseColumnCache;
  }

  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(artworks)").all() as Array<{ name?: string }>;
  hasMediaLicenseColumnCache = columns.some((column) => column.name === "media_license");
  return hasMediaLicenseColumnCache;
}

/**
 * Returns collection options for search filter chips.
 * SHM is expanded into its sub-museums; others are single entries.
 */
export function getCollectionOptions(): Array<{ id: string; name: string; count: number }> {
  const enabled = getEnabledMuseums();
  const cacheKey = enabled.join(",");
  const now = Date.now();

  if (
    collectionOptionsCache
    && collectionOptionsCache.key === cacheKey
    && now - collectionOptionsCache.ts < COLLECTION_OPTIONS_TTL_MS
  ) {
    return collectionOptionsCache.data;
  }

  const db = getDb();
  const options: Array<{ id: string; name: string; count: number }> = [];

  for (const museumId of enabled) {
    if (museumId === "shm") {
      const subs = db.prepare(
        `SELECT sub_museum, COUNT(*) as count FROM artworks
         WHERE source = 'shm' AND sub_museum IS NOT NULL AND sub_museum != ''
           AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)
         GROUP BY sub_museum ORDER BY count DESC`
      ).all() as Array<{ sub_museum: string; count: number }>;
      for (const sub of subs) {
        options.push({ id: `shm:${sub.sub_museum}`, name: sub.sub_museum, count: sub.count });
      }
    } else {
      const info = getMuseumInfo(museumId);
      const countRow = db.prepare(
        `SELECT COUNT(*) as count FROM artworks
         WHERE source = ? AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)`
      ).get(museumId) as { count: number };
      options.push({ id: museumId, name: info?.name || museumId, count: countRow.count });
    }
  }

  collectionOptionsCache = { key: cacheKey, ts: now, data: options };
  return options;
}

/**
 * Returns WHERE clause for a museum filter param.
 * Handles "nationalmuseum", "nordiska", or "shm:Livrustkammaren" etc.
 */
export function museumFilterSql(museumParam: string, prefix?: string): { sql: string; params: string[] } | null {
  if (!museumParam) return null;
  const col = prefix ? `${prefix}.source` : "source";
  const subCol = prefix ? `${prefix}.sub_museum` : "sub_museum";

  if (museumParam.startsWith("shm:")) {
    const subMuseum = museumParam.slice(4);
    return { sql: `${col} = 'shm' AND ${subCol} = ?`, params: [subMuseum] };
  }

  if (isMuseumEnabled(museumParam)) {
    return { sql: `${col} = ?`, params: [museumParam] };
  }
  return null;
}

export function isValidMuseumFilter(param: string): boolean {
  if (!param) return false;
  if (param.startsWith("shm:")) return true;
  return isMuseumEnabled(param);
}
