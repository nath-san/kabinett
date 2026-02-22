import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";

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

function mapArtwork(r: any) {
  const iiif = r.iiif_url.replace("http://", "https://");
  return {
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    artist: parseArtist(r.artists),
    imageUrl: iiif + "full/400,/0/default.jpg",
    heroUrl: iiif + "full/800,/0/default.jpg",
    color: r.dominant_color || "#D4CDC3",
    year: r.dating_text || r.year_start || "",
    yearStart: r.year_start || null,
    technique: r.technique_material || "",
    dimensions: formatDimensions(r.dimensions_json),
    category: r.category || "",
  };
}

export async function loader({}: LoaderFunctionArgs) {
  const db = getDb();

  const first = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json, category
       FROM artworks
       WHERE year_start IS NOT NULL
         AND category IS NOT NULL
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 90
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .get() as any;

  if (!first) return Response.json({ a: null, b: null });

  const firstCentury = Math.floor(first.year_start / 100);
  const second = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json, category
       FROM artworks
       WHERE category = ?
         AND year_start IS NOT NULL
         AND (year_start / 100) != ?
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 90
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .get(first.category, firstCentury) as any;

  let fallback = second;
  if (!fallback) {
    fallback = db
      .prepare(
        `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json, category
         FROM artworks
         WHERE iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 90
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any;
  }

  return Response.json({
    a: mapArtwork(first),
    b: fallback ? mapArtwork(fallback) : null,
  });
}
