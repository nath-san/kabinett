import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import type { Route } from "./+types/api.autocomplete";

// CLIP-inspired suggestions — things that work great with semantic search
const CLIP_SUGGESTIONS = [
  "katter", "hundar", "hästar", "blommor", "solnedgång", "snö", "havet",
  "barn", "dans", "musik", "krig", "guld", "naket", "mat", "frukt",
  "skog", "berg", "båtar", "fåglar", "natt", "vinter", "sommar",
  "rött", "blått", "porträtt", "stilleben", "ruiner", "kaniner",
  "skulpturer", "hattar", "skepp", "telefoner", "trädgård", "kyrka",
  "äpple", "äng", "änglar", "öar", "öken", "älg", "älvar",
];

let hasArtistsTable: boolean | null = null;

type ArtworkSuggestion = {
  id: number;
  title: string;
  iiif_url: string | null;
  dominant_color: string | null;
  artist_name: string | null;
  imageUrl: string;
};

type ArtistSuggestion = {
  value: string;
  count: number;
};

type ClipSuggestion = {
  value: string;
};

function emptyPayload() {
  return {
    artworks: [] as ArtworkSuggestion[],
    artists: [] as ArtistSuggestion[],
    clips: [] as ClipSuggestion[],
  };
}

function firstArtistName(rawArtists: string | null): string | null {
  if (!rawArtists) return null;
  try {
    const parsed = JSON.parse(rawArtists) as Array<{ name?: string | null }> | { name?: string | null };
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const name = first?.name?.trim();
    return name || null;
  } catch {
    return null;
  }
}

function buildTitleFtsQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .map((word) => word.replace(/["'()]/g, "").trim())
    .filter(Boolean);

  if (terms.length === 0) return "";

  return terms
    .map((word) => `(title_sv : "${word}"* OR title_en : "${word}"*)`)
    .join(" AND ");
}

function artistsTableExists(): boolean {
  if (hasArtistsTable !== null) return hasArtistsTable;
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'artists' LIMIT 1")
    .get() as { ok?: number } | undefined;
  hasArtistsTable = row?.ok === 1;
  return hasArtistsTable;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);

  if (q.length < 1) return Response.json(emptyPayload());

  const db = getDb();
  const sourceA = sourceFilter("a");
  const payload = emptyPayload();

  const ftsQuery = buildTitleFtsQuery(q);
  if (ftsQuery) {
    try {
      const artworks = db.prepare(
        `SELECT a.id,
                COALESCE(NULLIF(a.title_sv, ''), NULLIF(a.title_en, ''), 'Utan titel') as title,
                a.iiif_url,
                a.dominant_color,
                a.artists
         FROM artworks_fts
         JOIN artworks a ON a.id = artworks_fts.rowid
         WHERE artworks_fts MATCH ?
           AND a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
         ORDER BY rank
         LIMIT 3`
      ).all(ftsQuery, ...sourceA.params) as Array<{
        id: number;
        title: string;
        iiif_url: string | null;
        dominant_color: string | null;
        artists: string | null;
      }>;

      payload.artworks = artworks.map((artwork) => ({
        id: artwork.id,
        title: artwork.title,
        iiif_url: artwork.iiif_url,
        dominant_color: artwork.dominant_color,
        artist_name: firstArtistName(artwork.artists),
        imageUrl: buildImageUrl(artwork.iiif_url, 200),
      }));
    } catch {
      const like = `%${q}%`;
      const fallback = db.prepare(
        `SELECT a.id,
                COALESCE(NULLIF(a.title_sv, ''), NULLIF(a.title_en, ''), 'Utan titel') as title,
                a.iiif_url,
                a.dominant_color,
                a.artists
         FROM artworks a
         WHERE (a.title_sv LIKE ? OR a.title_en LIKE ?)
           AND a.iiif_url IS NOT NULL
           AND LENGTH(a.iiif_url) > 40
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
         ORDER BY a.id DESC
         LIMIT 3`
      ).all(like, like, ...sourceA.params) as Array<{
        id: number;
        title: string;
        iiif_url: string | null;
        dominant_color: string | null;
        artists: string | null;
      }>;

      payload.artworks = fallback.map((artwork) => ({
        id: artwork.id,
        title: artwork.title,
        iiif_url: artwork.iiif_url,
        dominant_color: artwork.dominant_color,
        artist_name: firstArtistName(artwork.artists),
        imageUrl: buildImageUrl(artwork.iiif_url, 200),
      }));
    }
  }

  // 1. Artist matches — count only artworks matching the active source filter
  if (q.length >= 2 && artistsTableExists()) {
    try {
      const src = sourceFilter();
      const artists = db.prepare(
        `SELECT ar.name, COUNT(*) as count
         FROM artists ar
         JOIN artworks a ON json_extract(a.artists, '$[0].name') = ar.name
         WHERE ar.name LIKE ?
           AND ar.name NOT LIKE '%känd%'
           AND ${src.sql}
         GROUP BY ar.name
         ORDER BY count DESC
         LIMIT 3`
      ).all(`%${q}%`, ...src.params) as Array<{ name: string; count: number }>;

      for (const artist of artists) {
        payload.artists.push({
          value: artist.name,
          count: artist.count,
        });
      }
    } catch (_) {
      hasArtistsTable = false;
    }
  }

  // 2. CLIP suggestions that match what the user is typing
  const qLower = q.toLowerCase();
  const matchingClip = CLIP_SUGGESTIONS
    .filter((s) => s.startsWith(qLower) || s.includes(qLower))
    .slice(0, 3);

  for (const suggestion of matchingClip) {
    payload.clips.push({ value: suggestion });
  }

  // 3. Always offer the user's own query as a visual search option
  //    (unless it already matches one of the CLIP suggestions exactly)
  if (q.length >= 2 && !matchingClip.some((s) => s.toLowerCase() === qLower)) {
    payload.clips.unshift({ value: q.trim() });
  }

  return Response.json(payload);
}
