import { getDb } from "../lib/db.server";
import type { Route } from "./+types/api.autocomplete";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";

  if (q.length < 2) return Response.json([]);

  const db = getDb();
  const like = `%${q}%`;

  // Get matching titles
  const titles = db
    .prepare(
      `SELECT DISTINCT title_sv as value, 'title' as type
       FROM artworks WHERE title_sv LIKE ? LIMIT 5`
    )
    .all(like) as any[];

  // Get matching artists
  const artists = db
    .prepare(
      `SELECT DISTINCT json_extract(value, '$.name') as value, 'artist' as type
       FROM artworks, json_each(artworks.artists)
       WHERE json_extract(value, '$.name') LIKE ?
         AND json_extract(value, '$.name') IS NOT NULL
       LIMIT 5`
    )
    .all(like) as any[];

  // Get matching categories
  const categories = db
    .prepare(
      `SELECT DISTINCT category as value, 'category' as type
       FROM artworks WHERE category LIKE ? LIMIT 3`
    )
    .all(like) as any[];

  const results = [...artists, ...titles.slice(0, 3), ...categories]
    .filter((r) => r.value)
    .slice(0, 8);

  return Response.json(results);
}
