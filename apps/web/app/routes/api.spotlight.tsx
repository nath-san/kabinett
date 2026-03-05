import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

export function headers() {
  return { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const db = getDb();
  const source = sourceFilter("a");

  const topArtists = db.prepare(
    `SELECT json_extract(artists, '$[0].name') as name, COUNT(*) as cnt
     FROM artworks
     WHERE artists IS NOT NULL AND artists != '' AND artists != '[]'
       AND json_extract(artists, '$[0].name') NOT LIKE '%känd%'
       AND json_extract(artists, '$[0].name') NOT LIKE '%nonym%'
       AND source IN ('nationalmuseum', 'nordiska')
       AND ${source.sql}
     GROUP BY name ORDER BY cnt DESC LIMIT 20`
  ).all(...source.params) as { name: string }[];

  if (topArtists.length === 0) return Response.json(null);

  const picked = topArtists[Math.floor(Math.random() * topArtists.length)];
  const rows = db.prepare(
    `SELECT a.id, a.title_sv, a.artists, a.dating_text, a.iiif_url,
            a.dominant_color, a.category, a.technique_material,
            a.focal_x, a.focal_y,
            COALESCE(a.sub_museum, m.name) as museum_name
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE json_extract(a.artists, '$[0].name') = ?
       AND a.iiif_url IS NOT NULL AND ${source.sql}
     LIMIT 5`
  ).all(picked.name, ...source.params) as any[];

  if (rows.length === 0) return Response.json(null);

  return Response.json({
    artistName: parseArtist(rows[0].artists),
    items: rows.map((r: any) => ({ ...r, imageUrl: buildImageUrl(r.iiif_url, 200) })),
  });
}
