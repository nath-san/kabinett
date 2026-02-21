import type { Route } from "./+types/api.explore-more";
import { getDb } from "../lib/db.server";

const COLORS: Record<string, { r: number; g: number; b: number }> = {
  red: { r: 160, g: 48, b: 40 },
  orange: { r: 192, g: 112, b: 48 },
  gold: { r: 184, g: 152, b: 48 },
  green: { r: 58, g: 120, b: 56 },
  blue: { r: 40, g: 80, b: 140 },
  purple: { r: 104, g: 64, b: 128 },
  pink: { r: 192, g: 120, b: 136 },
  dark: { r: 30, g: 28, b: 24 },
  light: { r: 224, g: 216, b: 200 },
};

const PERIODS: Record<string, { from: number; to: number }> = {
  "1400": { from: 1400, to: 1599 },
  "1600": { from: 1600, to: 1699 },
  "1700": { from: 1700, to: 1799 },
  "1800a": { from: 1800, to: 1849 },
  "1800b": { from: 1850, to: 1899 },
  "1900": { from: 1900, to: 1970 },
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("cat") || "";
  const periodVal = url.searchParams.get("period") || "";
  const color = url.searchParams.get("color") || "";
  const sort = url.searchParams.get("sort") || "random";
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 40);
  // Exclude already-loaded IDs to avoid duplicates on random sort
  const exclude = url.searchParams.get("exclude") || "";

  const db = getDb();

  const conditions: string[] = ["iiif_url IS NOT NULL", "LENGTH(iiif_url) > 90"];
  const params: any[] = [];

  if (category) {
    conditions.push("category LIKE ?");
    params.push(`%${category}%`);
  }

  const periodObj = PERIODS[periodVal];
  if (periodObj) {
    conditions.push("year_start >= ? AND year_start <= ?");
    params.push(periodObj.from, periodObj.to);
  }

  const colorObj = COLORS[color];
  let orderBy = "RANDOM()";
  if (colorObj) {
    conditions.push("color_r IS NOT NULL");
    if (sort === "random") {
      orderBy = `ABS(color_r - ${colorObj.r}) + ABS(color_g - ${colorObj.g}) + ABS(color_b - ${colorObj.b})`;
    }
  }

  if (exclude) {
    const ids = exclude.split(",").map(Number).filter(n => !isNaN(n)).slice(0, 200);
    if (ids.length > 0) {
      conditions.push(`id NOT IN (${ids.join(",")})`);
    }
  }

  if (sort === "oldest") orderBy = "year_start ASC NULLS LAST";
  if (sort === "newest") orderBy = "year_start DESC NULLS LAST";

  const where = conditions.join(" AND ");

  if (sort === "oldest" || sort === "newest") {
    params.push(limit, offset);
  } else {
    params.push(limit);
  }

  const sql = (sort === "oldest" || sort === "newest")
    ? `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text FROM artworks WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    : `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text FROM artworks WHERE ${where} ORDER BY ${orderBy} LIMIT ?`;

  const rows = db.prepare(sql).all(...params) as any[];

  const results = rows.map((r: any) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    artist: parseArtist(r.artists),
    imageUrl: r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    year: r.dating_text || "",
    color: r.dominant_color || "#D4CDC3",
  }));

  return Response.json(results);
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}
