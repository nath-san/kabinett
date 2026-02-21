import type { Route } from "./+types/api.timeline";
import { getDb } from "../lib/db.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const yearFrom = parseInt(url.searchParams.get("from") || "1600");
  const yearTo = parseInt(url.searchParams.get("to") || "1650");
  const category = url.searchParams.get("cat") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30"), 60);

  const db = getDb();

  let where = "year_start IS NOT NULL AND year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL";
  const params: any[] = [yearFrom, yearTo];

  if (category) {
    where += " AND category LIKE ?";
    params.push(`%${category}%`);
  }

  params.push(limit);

  const results = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text, year_start
     FROM artworks
     WHERE ${where}
     ORDER BY year_start, RANDOM()
     LIMIT ?`
  ).all(...params) as any[];

  // Get a count for the period
  const countParams = category
    ? [yearFrom, yearTo, `%${category}%`]
    : [yearFrom, yearTo];
  const countWhere = category
    ? "year_start IS NOT NULL AND year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL AND category LIKE ?"
    : "year_start IS NOT NULL AND year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL";
  const total = (db.prepare(
    `SELECT COUNT(*) as c FROM artworks WHERE ${countWhere}`
  ).get(...countParams) as any).c;

  return Response.json({ results, total, yearFrom, yearTo });
}
