import type { LoaderFunctionArgs } from "react-router";
import sharp from "sharp";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

const IMAGE_FETCH_TIMEOUT_MS = 5_000;
const ALLOWED_OG_IMAGE_HOSTS = new Set([
  "media.nationalmuseum.se",
  "ems.dimu.org",
  "media.samlingar.shm.se",
  "iiif.nationalmuseum.se",
]);

function isAllowedOgImageHost(hostname: string): boolean {
  if (ALLOWED_OG_IMAGE_HOSTS.has(hostname)) return true;
  if (!hostname.includes("iiif")) return false;
  return hostname.endsWith(".nationalmuseum.se") || hostname.endsWith(".samlingar.shm.se");
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
    return new Response("Ogiltigt id", { status: 400 });
  }

  const db = getDb();
  const source = sourceFilter();
  const row = db
    .prepare(
      `SELECT id, title_sv, title_en, artists, iiif_url, dominant_color, dating_text
       FROM artworks WHERE id = ? AND ${source.sql}`
    )
    .get(id, ...source.params) as {
      id: number;
      title_sv: string | null;
      title_en: string | null;
      artists: string | null;
      iiif_url: string;
      dominant_color: string | null;
      dating_text: string | null;
    } | undefined;

  if (!row) return new Response("Hittades inte", { status: 404 });

  const title = row.title_sv || row.title_en || "Utan titel";
  const artist = parseArtist(row.artists);
  const imageUrl = buildImageUrl(row.iiif_url, 1200);
  const imageHost = (() => {
    try {
      return new URL(imageUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  let base = sharp({
    create: {
      width: 1200,
      height: 630,
      channels: 3,
      background: row.dominant_color || "#0B0A09",
    },
  });

  if (imageHost && isAllowedOgImageHost(imageHost)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        base = sharp(buffer).resize(1200, 630, {
          fit: "contain",
          background: "#0B0A09",
        });
      }
    } catch {
      // keep fallback background
    } finally {
      clearTimeout(timeout);
    }
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
