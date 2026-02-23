import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

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

function parseSize(dimensions: string): number | null {
  if (!dimensions) return null;
  const nums = dimensions.match(/\d+[\.,]?\d*/g);
  if (!nums) return null;
  const values = nums.map((n) => parseFloat(n.replace(",", "."))).filter((n) => !Number.isNaN(n));
  if (values.length === 0) return null;
  return Math.max(...values);
}

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
  const color = url.searchParams.get("color") || "";
  const epoch = url.searchParams.get("epoch") || "";
  const subject = url.searchParams.get("subject") || "";
  const size = url.searchParams.get("size") || "";

  const db = getDb();

  let where = `iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90 AND id NOT IN (SELECT artwork_id FROM broken_images)
               AND ${sourceFilter()}`;
  const params: any[] = [];

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

  let order = "ORDER BY RANDOM()";
  const colorRgb = parseHexColor(color);
  if (colorRgb) {
    order =
      "ORDER BY ((color_r - ?) * (color_r - ?) + (color_g - ?) * (color_g - ?) + (color_b - ?) * (color_b - ?)) ASC";
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
    .all(...params) as any[];

  if (rows.length === 0) {
    return Response.json({ result: null });
  }

  let candidates = rows.map((r) => ({
    row: r,
    dimensions: formatDimensions(r.dimensions_json),
  }));

  if (size) {
    const wanted = size === "large" ? "large" : "small";
    const filtered = candidates.filter((c) => {
      const maxDim = parseSize(c.dimensions || "");
      if (!maxDim) return false;
      return wanted === "large" ? maxDim >= 80 : maxDim <= 40;
    });
    if (filtered.length > 0) candidates = filtered;
  }

  const picked = candidates[0];
  const r = picked.row;
  return Response.json({
    result: {
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      artist: parseArtist(r.artists),
      imageUrl: buildImageUrl(r.iiif_url, 800),
      color: r.dominant_color || "#D4CDC3",
      year: r.dating_text || r.year_start || "",
      technique: r.technique_material || "",
      dimensions: picked.dimensions,
    },
  });
}
