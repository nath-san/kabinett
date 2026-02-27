import { getDb } from "./db.server";
import { buildImageUrl } from "./images";
import { sourceFilter } from "./museums.server";

type FeedItemRow = {
  id: number;
  title_sv: string | null;
  title_en?: string | null;
  artists: string | null;
  dating_text: string | null;
  iiif_url: string;
  dominant_color: string | null;
  category: string | null;
  technique_material: string | null;
  museum_name: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

export type FeedItem = {
  id: number;
  title_sv: string | null;
  artists: string | null;
  dating_text: string | null;
  iiif_url: string;
  dominant_color: string | null;
  category: string | null;
  technique_material: string | null;
  imageUrl: string;
  museum_name: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

const COLOR_TARGETS: Record<string, { r: number; g: number; b: number }> = {
  red: { r: 160, g: 48, b: 40 },
  blue: { r: 40, g: 80, b: 140 },
};

const CENTURIES: Record<string, { from: number; to: number }> = {
  "1600-tal": { from: 1600, to: 1699 },
  "1700-tal": { from: 1700, to: 1799 },
  "1800-tal": { from: 1800, to: 1899 },
};

const CATEGORY_FILTERS = new Set(["Målningar", "Skulptur", "Porträtt", "Landskap"]);

const MOOD_QUERIES: Record<string, { fts: string }> = {
  Djur: {
    fts: "djur OR hund OR katt OR fågel OR häst",
  },
  Havet: {
    fts: "hav OR sjö OR vatten OR kust OR strand OR flod",
  },
  Blommor: {
    fts: "blom* OR ros OR tulpan OR växt",
  },
  Natt: {
    fts: "natt OR måne OR kväll OR skymning",
  },
};

function mapRows(rows: FeedItemRow[]): FeedItem[] {
  return rows.map((row) => ({
    id: row.id,
    title_sv: row.title_sv || row.title_en || "Utan titel",
    artists: row.artists,
    dating_text: row.dating_text || "",
    iiif_url: row.iiif_url,
    dominant_color: row.dominant_color || "#1A1815",
    category: row.category,
    technique_material: row.technique_material,
    imageUrl: buildImageUrl(row.iiif_url, 400),
    museum_name: row.museum_name,
    focal_x: row.focal_x,
    focal_y: row.focal_y,
  }));
}

export async function fetchFeed(options: {
  cursor?: number | null;
  limit: number;
  filter: string;
}) {
  const db = getDb();
  const sourceA = sourceFilter("a");
  const limit = Math.max(1, Math.min(options.limit, 40));
  const filter = options.filter?.trim() || "Alla";
  const cursor = options.cursor ?? null;

  if (MOOD_QUERIES[filter]) {
    const mood = MOOD_QUERIES[filter];
    const offset = Math.max(0, cursor || 0);
    let rows: FeedItemRow[];
    try {
    // Fetch extra rows and dedupe in JS to avoid expensive window function
    const overFetch = (limit + offset) * 3;
    const rawRows = db
      .prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                a.focal_x, a.focal_y,
                m.name as museum_name,
                artworks_fts.rank as relevance
         FROM artworks_fts
         JOIN artworks a ON a.id = artworks_fts.rowid
         LEFT JOIN museums m ON m.id = a.source
         WHERE artworks_fts MATCH ?
           AND a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
         ORDER BY artworks_fts.rank ASC, a.id DESC
         LIMIT ?`
      )
      .all(mood.fts, ...sourceA.params, overFetch) as (FeedItemRow & { relevance: number })[];
    const seen = new Set<string>();
    const deduped: FeedItemRow[] = [];
    for (const row of rawRows) {
      if (row.iiif_url && seen.has(row.iiif_url)) continue;
      if (row.iiif_url) seen.add(row.iiif_url);
      deduped.push(row);
    }
    rows = deduped.slice(offset, offset + limit);
    } catch (err) {
      console.error("FTS mood query failed (artworks_fts may be missing):", err);
      rows = [];
    }

    return {
      items: mapRows(rows),
      nextCursor: offset + rows.length,
      hasMore: rows.length === limit,
      mode: "offset" as const,
    };
  }

  const baseConditions: string[] = [
    "a.iiif_url IS NOT NULL",
    "LENGTH(a.iiif_url) > 40",
    "a.id NOT IN (SELECT artwork_id FROM broken_images)",
    "LENGTH(a.title_sv) < 60",
    sourceA.sql,
  ];
  const baseParams: Array<string | number> = [...sourceA.params];
  const cursorConditions: string[] = [];
  const cursorParams: Array<string | number> = [];
  const tablePrefix = "artworks a";
  let dedupeOrderBy = "a.id ASC";
  let finalOrderBy = "id ASC";
  let computedOrderSelect = "NULL as color_distance";

  if (filter === "Alla") {
    const overFetchLimit = limit * 4;
    const cursorSql = cursor ? "AND a.id < ?" : "";

    const rawRows = db.prepare(
      `WITH ranked AS (
         SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                a.focal_x, a.focal_y,
                m.name as museum_name,
                ROW_NUMBER() OVER (PARTITION BY a.source ORDER BY a.id DESC) as source_rank
         FROM artworks a
         LEFT JOIN museums m ON m.id = a.source
         WHERE a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND LENGTH(a.title_sv) < 60
           AND ${sourceA.sql}
           ${cursorSql}
       )
       SELECT id, title_sv, title_en, artists, dating_text, iiif_url, dominant_color, category, technique_material,
              focal_x, focal_y, museum_name
       FROM ranked
       ORDER BY source_rank ASC, id DESC
       LIMIT ?`
    ).all(...sourceA.params, ...(cursor ? [cursor] : []), overFetchLimit) as FeedItemRow[];

    const seen = new Set<string>();
    const rows: FeedItemRow[] = [];

    for (const row of rawRows) {
      if (row.iiif_url && seen.has(row.iiif_url)) continue;
      if (row.iiif_url) seen.add(row.iiif_url);
      rows.push(row);
      if (rows.length >= limit) break;
    }

    const nextCursor = rows.length > 0 ? Math.min(...rows.map(r => r.id)) : cursor;

    return {
      items: mapRows(rows),
      nextCursor,
      hasMore: rows.length === limit,
      mode: "cursor" as const,
    };
  }

  if (CATEGORY_FILTERS.has(filter)) {
    baseConditions.push("a.category LIKE ?");
    baseParams.push(`%${filter}%`);
  }

  if (filter === "Rött" || filter === "Blått") {
    const colorKey = filter === "Rött" ? "red" : "blue";
    const color = COLOR_TARGETS[colorKey];
    const colorDistance = `ABS(a.color_r - ${color.r}) + ABS(a.color_g - ${color.g}) + ABS(a.color_b - ${color.b})`;
    baseConditions.push("a.color_r IS NOT NULL");
    dedupeOrderBy = `${colorDistance} ASC, a.id DESC`;
    finalOrderBy = "color_distance ASC, id ASC";
    computedOrderSelect = `${colorDistance} as color_distance`;
  }

  const century = CENTURIES[filter];
  if (century) {
    baseConditions.push("a.year_start >= ? AND a.year_start <= ?");
    baseParams.push(century.from, century.to);
  }

  if (cursor) {
    cursorConditions.push("id > ?");
    cursorParams.push(cursor);
  }

  const baseWhere = baseConditions.join(" AND ");
  const fromClause = tablePrefix;
  const cursorWhere = cursorConditions.length > 0 ? ` AND ${cursorConditions.join(" AND ")}` : "";

  // Fetch more than needed, dedupe in JS to avoid expensive window function
  const overFetchLimit = limit * 3;
  const rawRows = db
    .prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
              a.focal_x, a.focal_y,
              m.name as museum_name
       FROM ${fromClause}
       LEFT JOIN museums m ON m.id = a.source
       WHERE ${baseWhere}${cursorWhere}
       ORDER BY ${dedupeOrderBy}
       LIMIT ?`
    )
    .all(...baseParams, ...cursorParams, overFetchLimit) as FeedItemRow[];

  // Deduplicate by iiif_url in JS
  const seen = new Set<string>();
  const rows: FeedItemRow[] = [];
  for (const row of rawRows) {
    if (row.iiif_url && seen.has(row.iiif_url)) continue;
    if (row.iiif_url) seen.add(row.iiif_url);
    rows.push(row);
    if (rows.length >= limit) break;
  }

  const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;

  return {
    items: mapRows(rows),
    nextCursor,
    hasMore: rows.length === limit,
    mode: "cursor" as const,
  };
}
