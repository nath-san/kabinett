import { getDb } from "./db.server";
import { clipSearch } from "./clip-search.server";
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

const MOOD_QUERIES: Record<string, { clip: string; fts: string }> = {
  Djur: {
    clip: "animals, horses, dogs, cats, birds in paintings",
    fts: "djur OR hund OR katt OR fågel OR häst",
  },
  Havet: {
    clip: "seascape, ocean, coast, ships, water, maritime painting",
    fts: "hav OR sjö OR vatten OR kust OR strand OR flod",
  },
  Blommor: {
    clip: "flowers, floral still life, roses, botanical painting",
    fts: "blom* OR ros OR tulpan OR växt",
  },
  Natt: {
    clip: "night scene, moonlight, dark atmosphere, nocturnal painting",
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
    imageUrl: buildImageUrl(row.iiif_url, 800),
    museum_name: row.museum_name,
  }));
}

async function hasClipEmbeddings(db: ReturnType<typeof getDb>) {
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM clip_embeddings").get() as any;
    return (row?.count || 0) > 0;
  } catch {
    return false;
  }
}

export async function fetchFeed(options: {
  cursor?: number | null;
  limit: number;
  filter: string;
}) {
  const db = getDb();
  const limit = Math.max(1, Math.min(options.limit, 40));
  const filter = options.filter?.trim() || "Alla";
  const cursor = options.cursor ?? null;

  if (MOOD_QUERIES[filter]) {
    const mood = MOOD_QUERIES[filter];
    const offset = Math.max(0, cursor || 0);
    const useClip = await hasClipEmbeddings(db);

    if (useClip) {
      const cap = Math.min(offset + limit, 50);
      const data = await clipSearch(mood.clip, cap, 0);
      const slice = data.slice(offset, offset + limit);
      const ids = slice.map((item) => item.id).filter(Boolean);

      if (ids.length === 0) {
        return { items: [], nextCursor: offset, hasMore: false, mode: "offset" as const };
      }

      const order = `CASE a.id ${ids.map((id, index) => `WHEN ${id} THEN ${index}`).join(" ")} END`;
      const rows = db
        .prepare(
          `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                  m.name as museum_name
           FROM artworks a
           LEFT JOIN museums m ON m.id = a.source
           WHERE a.id IN (${ids.map(() => "?").join(",")})
             AND ${sourceFilter("a")}
           ORDER BY ${order}`
        )
        .all(...ids) as FeedItemRow[];

      return {
        items: mapRows(rows),
        nextCursor: offset + slice.length,
        hasMore: data.length > offset + slice.length,
        mode: "offset" as const,
      };
    }

    const rows = db
      .prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                m.name as museum_name
         FROM artworks_fts f
         JOIN artworks a ON a.id = f.rowid
         LEFT JOIN museums m ON m.id = a.source
         WHERE f MATCH ? AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 90
           AND ${sourceFilter("a")}
         ORDER BY bm25(f)
         LIMIT ? OFFSET ?`
      )
      .all(mood.fts, limit, offset) as FeedItemRow[];

    return {
      items: mapRows(rows),
      nextCursor: offset + rows.length,
      hasMore: rows.length === limit,
      mode: "offset" as const,
    };
  }

  const conditions: string[] = [
    "a.iiif_url IS NOT NULL",
    "LENGTH(a.iiif_url) > 90",
    "a.id NOT IN (SELECT artwork_id FROM broken_images)",
    sourceFilter("a"),
  ];
  const params: Array<string | number> = [];
  let orderBy = "a.id ASC";
  let mode: "cursor" | "offset" = "cursor";
  const tablePrefix = "artworks a";

  if (filter === "Alla") {
    // Weight towards paintings, drawings, sculpture — deprioritize ceramics
    // Include non-Nationalmuseum sources (SHM etc) that may have different categories
    conditions.push(`(
      a.source != 'nationalmuseum'
      OR a.category LIKE '%Måleri%'
      OR a.category LIKE '%Teckningar%'
      OR a.category LIKE '%Skulptur%'
      OR a.category LIKE '%Grafik%'
      OR a.category LIKE '%Fotografier%'
      OR a.category LIKE '%Miniatyrer%'
      OR a.category LIKE '%Textil%'
      OR (a.category LIKE '%Keramik%' AND RANDOM() % 8 = 0)
      OR (a.category LIKE '%Konsthtv%' AND RANDOM() % 6 = 0)
    )`);
    orderBy = "RANDOM()";
    mode = "offset";
  }

  if (CATEGORY_FILTERS.has(filter)) {
    conditions.push("a.category LIKE ?");
    params.push(`%${filter}%`);
  }

  if (filter === "Rött" || filter === "Blått") {
    const colorKey = filter === "Rött" ? "red" : "blue";
    const color = COLOR_TARGETS[colorKey];
    conditions.push("a.color_r IS NOT NULL");
    orderBy = `ABS(a.color_r - ${color.r}) + ABS(a.color_g - ${color.g}) + ABS(a.color_b - ${color.b})`;
  }

  const century = CENTURIES[filter];
  if (century) {
    conditions.push("a.year_start >= ? AND a.year_start <= ?");
    params.push(century.from, century.to);
  }

  if (mode === "cursor" && cursor) {
    conditions.push("a.id > ?");
    params.push(cursor);
  }

  const where = conditions.join(" AND ");

  let rows: FeedItemRow[] = [];
  if (mode === "offset") {
    const offset = Math.max(0, cursor || 0);
    rows = db
      .prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                m.name as museum_name
         FROM ${tablePrefix}
         LEFT JOIN museums m ON m.id = a.source
         WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as FeedItemRow[];

    return {
      items: mapRows(rows),
      nextCursor: offset + rows.length,
      hasMore: rows.length === limit,
      mode: "offset" as const,
    };
  }

  rows = db
    .prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
              m.name as museum_name
       FROM ${tablePrefix}
       LEFT JOIN museums m ON m.id = a.source
       WHERE ${where} ORDER BY ${orderBy} LIMIT ?`
    )
    .all(...params, limit) as FeedItemRow[];

  const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;

  return {
    items: mapRows(rows),
    nextCursor,
    hasMore: rows.length === limit,
    mode: "cursor" as const,
  };
}
