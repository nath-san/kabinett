import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") || "";
  const ids = raw
    .split(",")
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, 60);

  if (ids.length === 0) return Response.json([]);

  const order = `CASE id ${ids.map((id, index) => `WHEN ${id} THEN ${index}`).join(" ")} END`;
  const db = getDb();
  const source = sourceFilter();
  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
       FROM artworks
       WHERE id IN (${ids.map(() => "?").join(",")})
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${source.sql}
       ORDER BY ${order}`
    )
    .all(...ids, ...source.params) as Array<{
      id: number;
      title_sv: string | null;
      title_en: string | null;
      iiif_url: string | null;
      dominant_color: string | null;
      artists: string | null;
      dating_text: string | null;
    }>;

  const results = rows.map((row) => {
    return {
      id: row.id,
      title: row.title_sv || row.title_en || "Utan titel",
      artists: row.artists,
      dating_text: row.dating_text || "",
      dominant_color: row.dominant_color || "#D4CDC3",
      imageUrl: row.iiif_url ? buildImageUrl(row.iiif_url, 400) : "",
    };
  });

  return Response.json(results);
}
