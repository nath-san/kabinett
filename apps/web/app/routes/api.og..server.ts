import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

function parseArtist(json: string | null): string {
  if (!json) return "Okand konstnar";
  try {
    return JSON.parse(json)[0]?.name || "Okand konstnar";
  } catch {
    return "Okand konstnar";
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export async function loader({ params }: LoaderFunctionArgs) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return new Response("Invalid id", { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, title_sv, title_en, artists, iiif_url, dominant_color, dating_text
       FROM artworks WHERE id = ? AND ${sourceFilter()}`
    )
    .get(id) as any;

  if (!row) return new Response("Not found", { status: 404 });

  const title = row.title_sv || row.title_en || "Utan titel";
  const artist = parseArtist(row.artists);
  const imageUrl = buildImageUrl(row.iiif_url, 1200);

  let base = sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 3,
      background: row.dominant_color || "#0B0A09",
    },
  });

  try {
    const response = await fetch(imageUrl);
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      base = sharp(buffer).resize(1200, 630, {
        fit: "contain",
        background: "#0B0A09",
      });
    }
  } catch {
    // keep fallback background
  }

  const safeTitle = escapeXml(truncate(title, 72));
  const safeArtist = escapeXml(truncate(artist, 48));

  const overlay = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="55%" stop-color="rgba(0,0,0,0)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.78)" />
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#fade)" />
    <text x="60" y="520" fill="#F5F0E8" font-size="54" font-family="Instrument Serif, Georgia, serif" font-weight="600">
      ${safeTitle}
    </text>
    <text x="60" y="575" fill="rgba(245,240,232,0.85)" font-size="28" font-family="DM Sans, Arial, sans-serif">
      ${safeArtist}
    </text>
    <text x="1130" y="585" fill="rgba(245,240,232,0.7)" font-size="22" font-family="DM Sans, Arial, sans-serif" text-anchor="end">
      Kabinett
    </text>
  </svg>`;

  const output = await base
    .composite([{ input: Buffer.from(overlay), top: 0, left: 0 }])
    .png()
    .toBuffer();

  return new Response(output, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
