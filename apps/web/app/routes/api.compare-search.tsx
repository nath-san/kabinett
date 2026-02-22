import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

function formatDimensions(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json);
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!candidate) return "";
    if (candidate.dimension_text) return candidate.dimension_text;
    const width = candidate.width || candidate.bredd || candidate.W;
    const height = candidate.height || candidate.hojd || candidate.H;
    if (width && height) return `${width} × ${height}`;
  } catch {}
  return "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "8"), 20);

  if (q.length < 2) return Response.json([]);

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json
       FROM artworks
       WHERE (title_sv LIKE ? OR title_en LIKE ? OR artists LIKE ?)
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 90
       ORDER BY year_start ASC NULLS LAST
       LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, limit) as any[];

  const results = rows.map((r) => {
    const iiif = r.iiif_url.replace("http://", "https://");
    return {
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      artist: parseArtist(r.artists),
      imageUrl: iiif + "full/400,/0/default.jpg",
      heroUrl: iiif + "full/800,/0/default.jpg",
      color: r.dominant_color || "#D4CDC3",
      year: r.dating_text || r.year_start || "",
      yearStart: r.year_start || null,
      technique: r.technique_material || "",
      dimensions: formatDimensions(r.dimensions_json),
    };
  });

  return Response.json(results);
}
