import { getDb } from "../lib/db.server";
import { sourceFilter } from "../lib/museums.server";
import type { Route } from "./+types/api.autocomplete";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);

  if (q.length < 2) return Response.json([]);

  const db = getDb();

  try {
    const ftsQuery = q.split(/\s+/).map(w => `"${w}"*`).join(" ");

    // Get matching artworks with context
    const rows = db
      .prepare(
        `SELECT a.title_sv as title, a.artists, a.category
         FROM artworks_fts
         JOIN artworks a ON a.id = artworks_fts.rowid
         WHERE artworks_fts MATCH ?
           AND ${sourceFilter("a")}
         ORDER BY rank
         LIMIT 20`
      )
      .all(ftsQuery) as any[];

    // Extract unique artists and categories
    const seen = new Set<string>();
    const results: Array<{ value: string; type: string }> = [];

    for (const row of rows) {
      // Artists
      try {
        const artists = JSON.parse(row.artists || "[]");
        const name = artists[0]?.name;
        if (name && name.toLowerCase().includes(q.toLowerCase()) && !seen.has(`a:${name}`)) {
          seen.add(`a:${name}`);
          results.push({ value: name, type: "artist" });
        }
      } catch {}

      // Titles
      if (row.title && !seen.has(`t:${row.title}`) && results.filter(r => r.type === "title").length < 4) {
        seen.add(`t:${row.title}`);
        results.push({ value: row.title, type: "title" });
      }
    }

    // Categories
    const cats = db.prepare(
      `SELECT DISTINCT category as value
       FROM artworks
       WHERE category LIKE ?
         AND ${sourceFilter()}
       LIMIT 2`
    ).all(`%${q}%`) as any[];
    for (const c of cats) {
      if (c.value && !seen.has(`c:${c.value}`)) {
        seen.add(`c:${c.value}`);
        results.push({ value: c.value.split(" (")[0], type: "category" });
      }
    }

    return Response.json(results.slice(0, 8));
  } catch {
    return Response.json([]);
  }
}
