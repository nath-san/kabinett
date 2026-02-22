import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") || "";
  const ids = raw
    .split(",")
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id))
    .slice(0, 60);

  if (ids.length === 0) return Response.json([]);

  const order = `CASE id ${ids.map((id, index) => `WHEN ${id} THEN ${index}`).join(" ")} END`;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
       FROM artworks WHERE id IN (${ids.map(() => "?").join(",")})
       ORDER BY ${order}`
    )
    .all(...ids) as any[];

  const results = rows.map((row) => {
    const iiif = row.iiif_url.replace("http://", "https://");
    return {
      id: row.id,
      title: row.title_sv || row.title_en || "Utan titel",
      artists: row.artists,
      dating_text: row.dating_text || "",
      dominant_color: row.dominant_color || "#D4CDC3",
      imageUrl: iiif + "full/400,/0/default.jpg",
    };
  });

  return Response.json(results);
}
