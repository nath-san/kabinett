import type { Route } from "./+types/api.color-search";
import { getDb } from "../lib/db.server";
import { sourceFilter } from "../lib/museums.server";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const parseColorChannel = (value: string | null, fallback: number) => {
    const parsed = Number.parseInt(value || "", 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, 0), 255);
  };

  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "24", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 48) : 24;
  const r = parseColorChannel(url.searchParams.get("r"), 128);
  const g = parseColorChannel(url.searchParams.get("g"), 128);
  const b = parseColorChannel(url.searchParams.get("b"), 128);

  const db = getDb();
  try {
    const results = db.prepare(
      `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
       FROM artworks
       WHERE color_r IS NOT NULL AND iiif_url IS NOT NULL
         AND ${sourceFilter()}
       ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
       LIMIT ?`
    ).all(r, g, b, limit) as any[];

    return Response.json(results);
  } catch {
    return Response.json([]);
  }
}
