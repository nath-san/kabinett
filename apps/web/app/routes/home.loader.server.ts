import { CURATED_IDS } from "../lib/curated-home";
import type { SpotlightCardData } from "../components/SpotlightCard";
import type { StatsCardData } from "../components/StatsSection";
import type { ThemeCardSection } from "../components/ThemeCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { getDb } from "../lib/db.server";
import { buildDirectImageUrl, buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getCachedSiteStats } from "../lib/stats.server";

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

/** Pick n random items from an array (Fisher-Yates partial shuffle). */
function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  const result: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    result.push(copy[idx]);
    copy[idx] = copy[copy.length - 1];
    copy.pop();
  }
  return result;
}

export async function homeLoader(request: Request): Promise<HomeLoaderData> {
  const url = new URL(request.url);
  const canonicalUrl = `${url.origin}${url.pathname}`;
  const enabledMuseums = getEnabledMuseums();
  const db = getDb();

  // 1. Curated initial items — fast lookup by ID
  const pickedIds = pickRandom(CURATED_IDS, 15);
  const placeholders = pickedIds.map(() => "?").join(",");
  const curatedRows = db.prepare(
    `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.iiif_url,
            a.dominant_color, a.category, a.technique_material,
            a.focal_x, a.focal_y,
            COALESCE(a.sub_museum, m.name) as museum_name
     FROM artworks a
     LEFT JOIN museums m ON m.id = a.source
     WHERE a.id IN (${placeholders})
       AND a.iiif_url IS NOT NULL`
  ).all(...pickedIds) as any[];

  const initialItems: ArtworkDisplayItem[] = curatedRows.map((row: any) => ({
    ...row,
    title_sv: row.title_sv || row.title_en || "Utan titel",
    imageUrl: buildImageUrl(row.iiif_url, 400),
  }));

  const ogImageUrl = initialItems[0]?.iiif_url
    ? buildDirectImageUrl(initialItems[0].iiif_url, 800)
    : null;

  // 2. Stats (already cached in-memory by stats.server)
  const siteStats = getCachedSiteStats(db);
  const stats: StatsCardData = {
    total: siteStats.totalWorks,
    museums: siteStats.museums,
    paintings: siteStats.paintings,
    yearsSpan: siteStats.yearsSpan,
  };

  // 3. Themes and spotlight loaded client-side now — send empty
  return {
    initialItems,
    initialCursor: null,
    initialHasMore: true,
    preloadedThemes: [],
    showMuseumBadge: enabledMuseums.length > 1,
    stats,
    spotlight: null,
    ogImageUrl,
    canonicalUrl,
    origin: url.origin,
  };
}
