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
    rows = db
      .prepare(
        `WITH ranked AS (
           SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                  m.name as museum_name,
                  bm25(artworks_fts) as relevance,
                  ROW_NUMBER() OVER (
                    PARTITION BY a.iiif_url
                    ORDER BY bm25(artworks_fts) ASC, a.id DESC
                  ) as dedupe_rank
           FROM artworks_fts
           JOIN artworks a ON a.id = artworks_fts.rowid
           LEFT JOIN museums m ON m.id = a.source
           WHERE artworks_fts MATCH ?
             AND a.iiif_url IS NOT NULL
             AND LENGTH(a.iiif_url) > 40
             AND a.id NOT IN (SELECT artwork_id FROM broken_images)
             AND ${sourceA.sql}
         )
         SELECT id, title_sv, title_en, artists, dating_text, iiif_url, dominant_color, category, technique_material, museum_name
         FROM ranked
         WHERE dedupe_rank = 1
         ORDER BY relevance ASC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(mood.fts, ...sourceA.params, limit, offset) as FeedItemRow[];
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
    sourceA.sql,
  ];
  const baseParams: Array<string | number> = [...sourceA.params];
  const cursorConditions: string[] = [];
  const cursorParams: Array<string | number> = [];
  let mode: "cursor" | "cursor_desc" = "cursor";
  const tablePrefix = "artworks a";
  let dedupeOrderBy = "a.id ASC";
  let finalOrderBy = "id ASC";
  let computedOrderSelect = "NULL as color_distance";

  if (filter === "Alla") {
    // Mix museums with deterministic hash to avoid NM-only feed
    // (NM has positive IDs, Nordiska negative — plain DESC shows only NM)
    dedupeOrderBy = "ABS(a.id) DESC";
    finalOrderBy = "ABS(id) DESC";
    mode = "cursor_desc";
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

  if (mode === "cursor" && cursor) {
    cursorConditions.push("id > ?");
    cursorParams.push(cursor);
  }

  if (mode === "cursor_desc" && cursor) {
    if (filter === "Alla") {
      cursorConditions.push("ABS(id) < ABS(?)");
    } else {
      cursorConditions.push("id < ?");
    }
    cursorParams.push(cursor);
  }

  const baseWhere = baseConditions.join(" AND ");
  const fromClause = mode === "cursor_desc" ? "artworks a NOT INDEXED" : tablePrefix;
  const cursorWhere = cursorConditions.length > 0 ? ` AND ${cursorConditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                m.name as museum_name,
                ${computedOrderSelect},
                ROW_NUMBER() OVER (
                  PARTITION BY a.iiif_url
                  ORDER BY ${dedupeOrderBy}
                ) as dedupe_rank
         FROM ${fromClause}
         LEFT JOIN museums m ON m.id = a.source
         WHERE ${baseWhere}
       )
       SELECT id, title_sv, title_en, artists, dating_text, iiif_url, dominant_color, category, technique_material, museum_name
       FROM ranked
       WHERE dedupe_rank = 1${cursorWhere}
       ORDER BY ${finalOrderBy}
       LIMIT ?`
    )
    .all(...baseParams, ...cursorParams, limit) as FeedItemRow[];

  const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;

  return {
    items: mapRows(rows),
    nextCursor,
    hasMore: rows.length === limit,
    mode: "cursor" as const,
  };
}
