import { THEMES } from "../lib/themes";
import type { SpotlightCardData } from "../components/SpotlightCard";
import type { StatsCardData } from "../components/StatsSection";
import type { ThemeCardSection } from "../components/ThemeCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { getDb } from "../lib/db.server";
import { fetchFeed } from "../lib/feed.server";
import { buildDirectImageUrl, buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getCachedSiteStats } from "../lib/stats.server";

type FeedItemRow = Omit<ArtworkDisplayItem, "imageUrl">;

export type HomeLoaderData = {
  initialItems: ArtworkDisplayItem[];
  initialCursor: number | null;
  initialHasMore: boolean;
  preloadedThemes: ThemeCardSection[];
  showMuseumBadge: boolean;
  stats: StatsCardData;
  spotlight: SpotlightCardData | null;
  ogImageUrl: string | null;
  canonicalUrl: string;
  origin: string;
};



let homeCache: { data: HomeLoaderData; ts: number } | null = null;
const HOME_CACHE_TTL_MS = 300_000;

export async function homeLoader(request: Request): Promise<HomeLoaderData> {
  const url = new URL(request.url);
  const canonicalUrl = `${url.origin}${url.pathname}`;

  if (homeCache && Date.now() - homeCache.ts < HOME_CACHE_TTL_MS) {
    return { ...homeCache.data, canonicalUrl };
  }

  const enabledMuseums = getEnabledMuseums();
  const sourceA = sourceFilter("a");
  const db = getDb();

  // Pick curated artworks — only IDs that actually exist in DB
  const curatedRows = db.prepare(
    `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
            a.focal_x, a.focal_y,
            COALESCE(a.sub_museum, m.name) as museum_name
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE a.iiif_url IS NOT NULL
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}
     ORDER BY RANDOM()
     LIMIT 5`
  ).all(...sourceA.params) as FeedItemRow[];

  const curated = curatedRows.map((row) => ({
    ...row,
    imageUrl: buildImageUrl(row.iiif_url, 400),
  }));

  const ogImageUrl = curated[0]?.iiif_url ? buildDirectImageUrl(curated[0].iiif_url, 800) : null;

  const preloadThemes = THEMES.slice(0, 3);
  const [initial, ...themeResults] = await Promise.all([
    fetchFeed({ cursor: null, limit: 15, filter: "Alla" }),
    ...preloadThemes.map((theme) => fetchFeed({ cursor: null, limit: 8, filter: theme.filter })),
  ]);

  const curatedIds = new Set(curated.map((item) => item.id));
  const restItems = initial.items.filter((item) => !curatedIds.has(item.id));

  const siteStats = getCachedSiteStats(db);
  const stats: StatsCardData = {
    total: siteStats.totalWorks,
    museums: siteStats.museums,
    paintings: siteStats.paintings,
    yearsSpan: siteStats.yearsSpan,
  };

  const topArtists = db.prepare(
    `SELECT a.artists, COUNT(*) as cnt
     FROM artworks a
     WHERE a.artists IS NOT NULL
       AND a.artists != ''
       AND a.artists != '[]'
       AND a.artists != '[null]'
       AND a.artists NOT LIKE '%Okänd%'
       AND a.artists NOT LIKE '%okänd%'
       AND ${sourceA.sql}
     GROUP BY a.artists
     ORDER BY cnt DESC
     LIMIT 20`
  ).all(...sourceA.params) as Array<{ artists: string | null }>;

  let spotlight: SpotlightCardData | null = null;
  if (topArtists.length > 0) {
    const pickedArtist = topArtists[Math.floor(Math.random() * topArtists.length)]?.artists;
    if (pickedArtist) {
      const spotlightRows = db.prepare(
        `SELECT a.id, a.title_sv, a.artists, a.dating_text, a.iiif_url, a.dominant_color, a.category, a.technique_material,
                a.focal_x, a.focal_y,
                COALESCE(a.sub_museum, m.name) as museum_name
         FROM artworks a
         LEFT JOIN museums m ON m.id = a.source
         WHERE a.artists = ?
           AND a.iiif_url IS NOT NULL
           AND ${sourceA.sql}
         LIMIT 5`
      ).all(pickedArtist, ...sourceA.params) as FeedItemRow[];

      if (spotlightRows.length > 0) {
        spotlight = {
          artistName: parseArtist(pickedArtist),
          items: spotlightRows.map((row) => ({
            ...row,
            imageUrl: buildImageUrl(row.iiif_url, 200),
          })),
        };
      }
    }
  }

  const result: HomeLoaderData = {
    initialItems: [...curated, ...restItems],
    initialCursor: initial.nextCursor,
    initialHasMore: initial.hasMore,
    preloadedThemes: preloadThemes.map((theme, i) => ({ ...theme, items: themeResults[i].items })).filter((theme) => theme.items.length > 0),
    showMuseumBadge: enabledMuseums.length > 1,
    stats,
    spotlight,
    ogImageUrl,
    canonicalUrl,
    origin: url.origin,
  };

  homeCache = { data: result, ts: Date.now() };
  return result;
}
