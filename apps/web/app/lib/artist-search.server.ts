import type Database from "better-sqlite3";
import type { SqlFragment } from "./text-search.server";

export type ArtistSearchRow = {
  name: string;
  artwork_count: number;
};

function normalizeArtistSearchTerm(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeLike(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function appendScopeFilters(source: SqlFragment, museum?: SqlFragment | null): { sql: string; params: string[] } {
  return {
    sql: [
      `AND ${source.sql}`,
      museum ? `AND ${museum.sql}` : "",
    ].filter(Boolean).join("\n           "),
    params: [...source.params, ...(museum ? museum.params : [])],
  };
}

export function searchArtistsByScope(args: {
  db: Database.Database;
  query: string;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
}): ArtistSearchRow[] {
  const { db, query, source, museum, limit } = args;
  const normalizedQuery = normalizeArtistSearchTerm(query);
  if (!normalizedQuery) return [];

  const scoped = appendScopeFilters(source, museum);
  const containsPattern = `%${escapeLike(normalizedQuery)}%`;
  const prefixPattern = `${escapeLike(normalizedQuery)}%`;

  return db.prepare(
    `SELECT MIN(aa.artist_name) as name,
            COUNT(DISTINCT aa.artwork_id) as artwork_count
     FROM artwork_artists aa
     JOIN artworks a ON a.id = aa.artwork_id
     WHERE aa.artist_name_norm LIKE ? ESCAPE '\\'
       AND aa.artist_name NOT LIKE '%känd%'
       AND aa.artist_name NOT LIKE '%nonym%'
       AND a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       ${scoped.sql}
     GROUP BY aa.artist_name_norm
     ORDER BY CASE
                WHEN aa.artist_name_norm = ? THEN 0
                WHEN aa.artist_name_norm LIKE ? ESCAPE '\\' THEN 1
                ELSE 2
              END,
              artwork_count DESC,
              LENGTH(name) ASC,
              name ASC
     LIMIT ?`
  ).all(
    containsPattern,
    ...scoped.params,
    normalizedQuery,
    prefixPattern,
    limit
  ) as ArtistSearchRow[];
}
