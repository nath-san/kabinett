import type Database from "better-sqlite3";

export type SqlFragment = {
  sql: string;
  params: string[];
};

export type ArtworkTextSearchRow = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string | null;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
  technique_material: string | null;
  descriptions_sv: string | null;
  focal_x: number | null;
  focal_y: number | null;
  museum_name: string | null;
};

export type ArtworkAutocompleteRow = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string | null;
  dominant_color: string | null;
  artists: string | null;
};

type LikeField = {
  column: string;
  weight: number;
};

type SearchScope = "title" | "broad";

const TITLE_FIELDS: LikeField[] = [
  { column: "a.title_sv", weight: 90 },
  { column: "a.title_en", weight: 84 },
];

const BROAD_FIELDS: LikeField[] = [
  ...TITLE_FIELDS,
  { column: "a.artists", weight: 52 },
  { column: "a.technique_material", weight: 44 },
  { column: "a.category", weight: 34 },
  { column: "a.object_type_sv", weight: 32 },
  { column: "a.material_tags", weight: 28 },
  { column: "a.technique_tags", weight: 28 },
  { column: "a.style_sv", weight: 24 },
  { column: "a.dating_text", weight: 20 },
  { column: "a.signature", weight: 14 },
  { column: "a.inscription", weight: 14 },
  { column: "a.descriptions_sv", weight: 10 },
];

function sanitizeFtsTerm(word: string): string {
  return word.replace(/["'()]/g, "").trim();
}

function tokenizeQuery(query: string): string[] {
  return query
    .split(/\s+/)
    .map(sanitizeFtsTerm)
    .filter(Boolean);
}

export function buildFtsQuery(query: string): string {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return "";
  return terms.map((word) => `"${word}"*`).join(" AND ");
}

export function buildTitleOnlyFtsQuery(query: string): string {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return "";
  return terms
    .map((word) => `(title_sv:"${word}"* OR title_en:"${word}"*)`)
    .join(" AND ");
}

function normalizeLikeTerm(term: string): string {
  return term
    .toLowerCase()
    .trim();
}

function likeTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map(normalizeLikeTerm)
    .filter(Boolean);
}

function escapeLike(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function fieldsForScope(scope: SearchScope): LikeField[] {
  return scope === "title" ? TITLE_FIELDS : BROAD_FIELDS;
}

function whereSqlForTerms(scope: SearchScope, terms: string[]): SqlFragment {
  const fields = fieldsForScope(scope);
  const params: string[] = [];

  if (terms.length === 0) {
    return { sql: "1 = 0", params };
  }

  const sql = terms.map((term) => {
    const pattern = `%${escapeLike(term)}%`;
    const clauses = fields.map((field) => {
      params.push(pattern);
      return `lower(coalesce(${field.column}, '')) LIKE ? ESCAPE '\\'`;
    });
    return `(${clauses.join(" OR ")})`;
  }).join(" AND ");

  return { sql, params };
}

function scoreSqlForQuery(scope: SearchScope, query: string): SqlFragment {
  const fields = fieldsForScope(scope);
  const fullPattern = `%${escapeLike(normalizeLikeTerm(query))}%`;
  const params: string[] = [];
  const sql = fields.map((field) => {
    params.push(fullPattern);
    return `CASE WHEN lower(coalesce(${field.column}, '')) LIKE ? ESCAPE '\\' THEN ${field.weight} ELSE 0 END`;
  }).join(" + ");

  return { sql, params };
}

function selectSql(): string {
  return `SELECT a.id,
                 a.title_sv,
                 a.title_en,
                 a.iiif_url,
                 a.dominant_color,
                 a.artists,
                 a.dating_text,
                 a.technique_material,
                 a.descriptions_sv,
                 a.focal_x,
                 a.focal_y,
                 COALESCE(a.sub_museum, m.name) as museum_name`;
}

function fromSql(): string {
  return `FROM artworks a
          LEFT JOIN museums m ON m.id = a.source
          WHERE a.iiif_url IS NOT NULL
            AND LENGTH(a.iiif_url) > 40
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)`;
}

function ftsFromSql(): string {
  return `FROM artworks_fts
          JOIN artworks a ON a.id = artworks_fts.rowid
          LEFT JOIN museums m ON m.id = a.source
          WHERE a.iiif_url IS NOT NULL
            AND LENGTH(a.iiif_url) > 40
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)`;
}

function autocompleteSelectSql(): string {
  return `SELECT a.id,
                 a.title_sv,
                 a.title_en,
                 a.iiif_url,
                 a.dominant_color,
                 a.artists`;
}

function autocompleteFromSql(): string {
  return `FROM artworks a
          WHERE a.iiif_url IS NOT NULL
            AND LENGTH(a.iiif_url) > 40
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)`;
}

function autocompleteFtsFromSql(): string {
  return `FROM artworks_fts
          JOIN artworks a ON a.id = artworks_fts.rowid
          WHERE a.iiif_url IS NOT NULL
            AND LENGTH(a.iiif_url) > 40
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)`;
}

function appendScopeFilters(source: SqlFragment, museum?: SqlFragment | null): { sql: string; params: string[] } {
  return {
    sql: [
      `AND ${source.sql}`,
      museum ? `AND ${museum.sql}` : "",
    ].filter(Boolean).join("\n            "),
    params: [...source.params, ...(museum ? museum.params : [])],
  };
}

function hasAnyFtsHits(args: {
  db: Database.Database;
  query: string;
  scope: SearchScope;
  source: SqlFragment;
  museum?: SqlFragment | null;
}): boolean {
  const { db, query, scope, source, museum } = args;
  const ftsQuery = scope === "title" ? buildTitleOnlyFtsQuery(query) : buildFtsQuery(query);
  if (!ftsQuery) return false;

  const scoped = appendScopeFilters(source, museum);

  try {
    const row = db.prepare(
      `SELECT a.id
       ${ftsFromSql()}
       AND artworks_fts MATCH ?
       ${scoped.sql}
       LIMIT 1`
    ).get(ftsQuery, ...scoped.params) as { id?: number } | undefined;
    return typeof row?.id === "number";
  } catch {
    return false;
  }
}

function searchByFts(args: {
  db: Database.Database;
  query: string;
  scope: SearchScope;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
  offset: number;
}): ArtworkTextSearchRow[] {
  const { db, query, scope, source, museum, limit, offset } = args;
  const ftsQuery = scope === "title" ? buildTitleOnlyFtsQuery(query) : buildFtsQuery(query);
  if (!ftsQuery) return [];

  const scoped = appendScopeFilters(source, museum);

  return db.prepare(
    `${selectSql()}
     ${ftsFromSql()}
     AND artworks_fts MATCH ?
     ${scoped.sql}
     ORDER BY rank
     LIMIT ? OFFSET ?`
  ).all(ftsQuery, ...scoped.params, limit, offset) as ArtworkTextSearchRow[];
}

function searchByLike(args: {
  db: Database.Database;
  query: string;
  scope: SearchScope;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
  offset: number;
}): ArtworkTextSearchRow[] {
  const { db, query, scope, source, museum, limit, offset } = args;
  const terms = likeTerms(query);
  if (terms.length === 0) return [];

  const where = whereSqlForTerms(scope, terms);
  const score = scoreSqlForQuery(scope, query);
  const scoped = appendScopeFilters(source, museum);

  return db.prepare(
    `${selectSql()},
            (${score.sql}) as lexical_score
     ${fromSql()}
       AND ${where.sql}
       ${scoped.sql}
     ORDER BY lexical_score DESC,
              LENGTH(COALESCE(NULLIF(a.title_sv, ''), NULLIF(a.title_en, ''), '')) ASC,
              a.id DESC
     LIMIT ? OFFSET ?`
  ).all(...score.params, ...where.params, ...scoped.params, limit, offset) as ArtworkTextSearchRow[];
}

function searchAutocompleteByFts(args: {
  db: Database.Database;
  query: string;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
}): ArtworkAutocompleteRow[] {
  const { db, query, source, museum, limit } = args;
  const ftsQuery = buildTitleOnlyFtsQuery(query);
  if (!ftsQuery) return [];

  const scoped = appendScopeFilters(source, museum);

  return db.prepare(
    `${autocompleteSelectSql()}
     ${autocompleteFtsFromSql()}
     AND artworks_fts MATCH ?
     ${scoped.sql}
     ORDER BY rank,
              LENGTH(COALESCE(NULLIF(a.title_sv, ''), NULLIF(a.title_en, ''), '')) ASC,
              a.id DESC
     LIMIT ?`
  ).all(ftsQuery, ...scoped.params, limit) as ArtworkAutocompleteRow[];
}

function searchAutocompleteByLike(args: {
  db: Database.Database;
  query: string;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
}): ArtworkAutocompleteRow[] {
  const { db, query, source, museum, limit } = args;
  const terms = likeTerms(query);
  if (terms.length === 0) return [];

  const where = whereSqlForTerms("title", terms);
  const score = scoreSqlForQuery("title", query);
  const scoped = appendScopeFilters(source, museum);

  return db.prepare(
    `${autocompleteSelectSql()},
            (${score.sql}) as lexical_score
     ${autocompleteFromSql()}
       AND ${where.sql}
       ${scoped.sql}
     ORDER BY lexical_score DESC,
              LENGTH(COALESCE(NULLIF(a.title_sv, ''), NULLIF(a.title_en, ''), '')) ASC,
              a.id DESC
     LIMIT ?`
  ).all(...score.params, ...where.params, ...scoped.params, limit) as ArtworkAutocompleteRow[];
}

function minReliableFtsHits(scope: SearchScope, limit: number): number {
  if (scope === "title") return Math.max(limit, 5);
  return Math.max(Math.min(limit, 12), 8);
}

export function searchArtworksText(args: {
  db: Database.Database;
  query: string;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
  offset?: number;
  scope?: SearchScope;
}): ArtworkTextSearchRow[] {
  const {
    db,
    query,
    source,
    museum,
    limit,
    offset = 0,
    scope = "broad",
  } = args;

  if (hasAnyFtsHits({ db, query, scope, source, museum })) {
    const ftsRows = searchByFts({ db, query, scope, source, museum, limit, offset });
    if (ftsRows.length >= minReliableFtsHits(scope, limit)) {
      return ftsRows;
    }
  }

  return searchByLike({ db, query, scope, source, museum, limit, offset });
}

export function searchArtworksAutocomplete(args: {
  db: Database.Database;
  query: string;
  source: SqlFragment;
  museum?: SqlFragment | null;
  limit: number;
}): ArtworkAutocompleteRow[] {
  const { db, query, source, museum, limit } = args;

  try {
    const ftsRows = searchAutocompleteByFts({ db, query, source, museum, limit });
    if (ftsRows.length > 0) {
      return ftsRows;
    }
  } catch {
    // Fall through to a cheaper lexical fallback when FTS is unavailable.
  }

  return searchAutocompleteByLike({ db, query, source, museum, limit });
}

export function buildArtworkSnippet(
  result: {
    technique_material?: string | null;
    descriptions_sv?: string | null;
  },
  query: string
): string | null {
  if (!query) return null;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;

  const fields = [
    result.technique_material,
    result.descriptions_sv,
  ].filter(Boolean) as string[];

  for (const field of fields) {
    const lower = field.toLowerCase();
    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(field.length, idx + term.length + 50);
        let snippet = field.slice(start, end).trim();
        if (start > 0) snippet = "…" + snippet;
        if (end < field.length) snippet += "…";
        return snippet;
      }
    }
  }

  if (result.technique_material) {
    const trimmed = result.technique_material.slice(0, 80);
    return trimmed.length < result.technique_material.length ? `${trimmed}…` : trimmed;
  }

  return null;
}
