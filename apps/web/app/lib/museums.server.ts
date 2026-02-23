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

export function getEnabledMuseums(): string[] {
  const db = getDb();
  const rows = db.prepare("SELECT id FROM museums WHERE enabled = 1").all() as Array<{ id: string }>;
  const all = rows.map((r) => r.id);
  const envMuseums = parseEnvMuseums();
  if (!envMuseums) return all;
  const allowed = new Set(all);
  return envMuseums.filter((id) => allowed.has(id));
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

export function sourceFilter(prefix?: string): string {
  const museums = getEnabledMuseums();
  if (museums.length === 0) return "1 = 0";
  const col = prefix ? `${prefix}.source` : "source";
  return `${col} IN (${museums.map((m) => `'${m}'`).join(",")})`;
}
