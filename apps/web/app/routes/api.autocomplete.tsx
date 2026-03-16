import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { searchArtworksAutocomplete } from "../lib/text-search.server";
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
const AUTOCOMPLETE_CACHE_TTL_MS = 60_000;
const AUTOCOMPLETE_CACHE_MAX = 200;
const autocompleteCache = new Map<string, { payload: AutocompletePayload; ts: number }>();

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

type AutocompletePayload = {
  artworks: ArtworkSuggestion[];
  artists: ArtistSuggestion[];
  clips: ClipSuggestion[];
};

function emptyPayload(): AutocompletePayload {
  return {
    artworks: [],
    artists: [],
    clips: [],
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

function artistsTableExists(): boolean {
  if (hasArtistsTable !== null) return hasArtistsTable;
  const db = getDb();
  const row = db
    .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'artists' LIMIT 1")
    .get() as { ok?: number } | undefined;
  hasArtistsTable = row?.ok === 1;
  return hasArtistsTable;
}

function responseHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
  };
}

function cacheKeyForQuery(query: string, source: { sql: string; params: string[] }): string {
  return `${query.toLowerCase()}::${source.sql}::${source.params.join(",")}`;
}

function getCachedPayload(key: string): AutocompletePayload | null {
  const cached = autocompleteCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts >= AUTOCOMPLETE_CACHE_TTL_MS) {
    autocompleteCache.delete(key);
    return null;
  }
  return cached.payload;
}

function setCachedPayload(key: string, payload: AutocompletePayload): void {
  autocompleteCache.set(key, { payload, ts: Date.now() });

  if (autocompleteCache.size <= AUTOCOMPLETE_CACHE_MAX) {
    return;
  }

  const oldestKey = autocompleteCache.keys().next().value;
  if (oldestKey) {
    autocompleteCache.delete(oldestKey);
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 80);

  if (q.length < 1) return Response.json(emptyPayload(), { headers: responseHeaders() });

  const db = getDb();
  const sourceA = sourceFilter("a");
  const qLower = q.toLowerCase();
  const cacheKey = cacheKeyForQuery(qLower, sourceA);
  const cachedPayload = getCachedPayload(cacheKey);
  if (cachedPayload) {
    return Response.json(cachedPayload, { headers: responseHeaders() });
  }

  const payload = emptyPayload();

  try {
    const artworks = searchArtworksAutocomplete({
      db,
      query: q,
      source: sourceA,
      limit: 3,
    }) as Array<{
      id: number;
      title_sv: string | null;
      title_en: string | null;
      iiif_url: string | null;
      dominant_color: string | null;
      artists: string | null;
    }>;

    payload.artworks = artworks.map((artwork) => ({
      id: artwork.id,
      title: artwork.title_sv || artwork.title_en || "Utan titel",
      iiif_url: artwork.iiif_url,
      dominant_color: artwork.dominant_color,
      artist_name: firstArtistName(artwork.artists),
      imageUrl: buildImageUrl(artwork.iiif_url, 200),
    }));
  } catch {
    try {
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
    } catch {
      payload.artworks = [];
    }
  }

  // 1. Artist matches — prefer the precomputed artist table for instant suggestions
  if (q.length >= 2 && artistsTableExists()) {
    try {
      const artists = db.prepare(
        `SELECT name, artwork_count as count
         FROM artists
         WHERE name LIKE ?
           AND name NOT LIKE '%känd%'
         ORDER BY CASE
                    WHEN lower(name) LIKE ? THEN 0
                    ELSE 1
                  END,
                  artwork_count DESC,
                  LENGTH(name) ASC
         LIMIT 3`
      ).all(`%${q}%`, `${qLower}%`) as Array<{ name: string; count: number }>;

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

  setCachedPayload(cacheKey, payload);
  return Response.json(payload, { headers: responseHeaders() });
}
