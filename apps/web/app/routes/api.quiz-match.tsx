import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { formatDimensions, parseArtist } from "../lib/parsing";

function parseHexColor(hex: string) {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

const EPOCHS: Record<string, { from: number; to: number }> = {
  "1500s": { from: 1500, to: 1599 },
  "1600s": { from: 1600, to: 1699 },
  "1700s": { from: 1700, to: 1799 },
  "1800s": { from: 1800, to: 1899 },
};

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const mood = url.searchParams.get("mood") || "";
  const color = (url.searchParams.get("color") || "").trim();
  const epoch = url.searchParams.get("epoch") || "";
  const subject = url.searchParams.get("subject") || "";
  const size = url.searchParams.get("size") || "";

  const db = getDb();
  const source = sourceFilter();
  const randomSeed = Math.floor(Date.now() / 60_000);

  let where = `iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40 AND id NOT IN (SELECT artwork_id FROM broken_images)
               AND ${source.sql}`;
  const params: Array<string | number> = [];

  if (epoch && EPOCHS[epoch]) {
    where += " AND year_start BETWEEN ? AND ?";
    params.push(EPOCHS[epoch].from, EPOCHS[epoch].to);
  }

  // Subject filter: search in title since category doesn't contain subject info
  const subjectKeywords: Record<string, string> = {
    landskap: "landskap OR skog OR sjö OR berg OR natur OR utsikt",
    "porträtt": "porträtt OR portrait OR man OR kvinna OR flicka OR pojke",
    stilleben: "stilleben OR blommor OR frukt OR vas OR bord",
    abstrakt: "abstrakt OR komposition OR geometrisk",
  };
  if (subject && subjectKeywords[subject]) {
    // Use a subquery via FTS
    where += ` AND id IN (SELECT rowid FROM artworks_fts WHERE artworks_fts MATCH ?)`;
    params.push(subjectKeywords[subject]);
  }

  if (mood === "dark") {
    where += " AND (color_r + color_g + color_b) / 3 < 90";
  }

  if (mood === "light") {
    where += " AND (color_r + color_g + color_b) / 3 > 170";
  }

  if (mood === "dramatic") {
    where += " AND (max(color_r, color_g, color_b) - min(color_r, color_g, color_b)) > 80";
  }

  if (mood === "calm") {
    where += " AND (max(color_r, color_g, color_b) - min(color_r, color_g, color_b)) < 55";
  }

  if (size === "large") {
    where += `
      AND dimensions_json IS NOT NULL
      AND json_valid(dimensions_json)
      AND EXISTS (
        SELECT 1
        FROM json_each(dimensions_json) d
        WHERE max(
          CAST(replace(COALESCE(json_extract(d.value, '$.width'), json_extract(d.value, '$.bredd'), json_extract(d.value, '$.W'), '0'), ',', '.') AS REAL),
          CAST(replace(COALESCE(json_extract(d.value, '$.height'), json_extract(d.value, '$.hojd'), json_extract(d.value, '$.H'), '0'), ',', '.') AS REAL)
        ) >= 80
      )`;
  }

  if (size === "small") {
    where += `
      AND dimensions_json IS NOT NULL
      AND json_valid(dimensions_json)
      AND EXISTS (
        SELECT 1
        FROM json_each(dimensions_json) d
        WHERE max(
          CAST(replace(COALESCE(json_extract(d.value, '$.width'), json_extract(d.value, '$.bredd'), json_extract(d.value, '$.W'), '0'), ',', '.') AS REAL),
          CAST(replace(COALESCE(json_extract(d.value, '$.height'), json_extract(d.value, '$.hojd'), json_extract(d.value, '$.H'), '0'), ',', '.') AS REAL)
        ) BETWEEN 1 AND 40
      )`;
  }

  let order = "ORDER BY ((rowid * 1103515245 + ?) & 2147483647)";
  params.push(randomSeed);
  const colorRgb = parseHexColor(color);
  if (colorRgb) {
    order =
      "ORDER BY ((color_r - ?) * (color_r - ?) + (color_g - ?) * (color_g - ?) + (color_b - ?) * (color_b - ?)) ASC";
    params.pop();
    params.push(colorRgb.r, colorRgb.r, colorRgb.g, colorRgb.g, colorRgb.b, colorRgb.b);
  }

  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json
       FROM artworks
       WHERE ${where}
       ${order}
       LIMIT 80`
    )
    .all(...source.params, ...params) as any[];

  if (rows.length === 0) {
    return Response.json({ result: null });
  }

  const picked = rows[0];
  const r = picked;
  return Response.json({
    result: {
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      artist: parseArtist(r.artists),
      imageUrl: buildImageUrl(r.iiif_url, 800),
      color: r.dominant_color || "#D4CDC3",
      year: r.dating_text || r.year_start || "",
      technique: r.technique_material || "",
      dimensions: formatDimensions(r.dimensions_json),
    },
  });
}
