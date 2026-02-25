import { getDb } from "./db.server";

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
  const parsed = raw
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : null;
}

function sanitizeMuseumId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

let enabledMuseumsCache: string[] | null = null;
let enabledMuseumsCacheTime = 0;
const ENABLED_MUSEUMS_TTL_MS = 60 * 1000;

export function getEnabledMuseums(): string[] {
  const now = Date.now();
  if (enabledMuseumsCache && now - enabledMuseumsCacheTime < ENABLED_MUSEUMS_TTL_MS) {
    return enabledMuseumsCache;
  }

  const db = getDb();
  const rows = db.prepare("SELECT id FROM museums WHERE enabled = 1").all() as Array<{ id: string }>;
  const all = rows
    .map((r) => sanitizeMuseumId(r.id))
    .filter((id): id is string => Boolean(id));
  const envMuseums = parseEnvMuseums();
  if (!envMuseums) {
    enabledMuseumsCache = all;
    enabledMuseumsCacheTime = now;
    return all;
  }

  const sanitizedEnvMuseums = envMuseums
    .map((id) => sanitizeMuseumId(id))
    .filter((id): id is string => Boolean(id));
  const allowed = new Set(all);
  const filtered = sanitizedEnvMuseums.filter((id) => allowed.has(id));
  enabledMuseumsCache = filtered;
  enabledMuseumsCacheTime = now;
  return filtered;
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
  if (museums.length === 0) return { sql: "1 = 0", params: [] };
  const col = prefix ? `${prefix}.source` : "source";
  return {
    sql: `${col} IN (${museums.map(() => "?").join(",")})`,
    params: museums,
  };
}
