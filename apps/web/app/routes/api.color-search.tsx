import type { Route } from "./+types/api.color-search";
import { getDb } from "../lib/db.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const r = parseInt(url.searchParams.get("r") || "128");
  const g = parseInt(url.searchParams.get("g") || "128");
  const b = parseInt(url.searchParams.get("b") || "128");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "24"), 48);

  const db = getDb();
  const results = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
     FROM artworks
     WHERE color_r IS NOT NULL AND iiif_url IS NOT NULL
     ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
     LIMIT ?`
  ).all(r, g, b, limit) as any[];

  return Response.json(results);
}
