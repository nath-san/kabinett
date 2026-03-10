import { CURATED_IDS } from "../lib/curated-home";
import { THEMES } from "../lib/themes";
import { fetchFeed } from "../lib/feed.server";
import type { SpotlightCardData } from "../components/SpotlightCard";
import type { StatsCardData } from "../components/StatsSection";
import type { ThemeCardSection } from "../components/ThemeCard";
import type { ArtworkDisplayItem } from "../components/artwork-meta";
import { getCampaignConfig } from "../lib/campaign.server";
import { getDb } from "../lib/db.server";
import { buildDirectImageUrl, buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";
import { getCachedSiteStats } from "../lib/stats.server";

export type HomeLoaderData = {
  initialItems: ArtworkDisplayItem[];
  initialCursor: number | null;
  initialHasMore: boolean;
  preloadedThemes: ThemeCardSection[];
  showMuseumBadge: boolean;
  heroHeadline: string;
  heroSubline: string;
  heroIntro: string | null;
  stats: StatsCardData;
  spotlight: SpotlightCardData | null;
  ogImageUrl: string | null;
  metaTitle: string;
  metaDescription: string;
  noindex: boolean;
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
  const sourceA = sourceFilter("a");
  const campaign = getCampaignConfig();
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
       AND a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}`
  ).all(...pickedIds, ...sourceA.params) as any[];

  let initialItems: ArtworkDisplayItem[] = curatedRows.map((row: any) => ({
    ...row,
    title_sv: row.title_sv || row.title_en || "Utan titel",
    imageUrl: buildImageUrl(row.iiif_url, 400),
  }));

  if (initialItems.length < 12) {
    const fallback = await fetchFeed({ cursor: null, limit: 15, filter: "Alla" });
    const seen = new Set(initialItems.map((item) => item.id));
    for (const item of fallback.items) {
      if (seen.has(item.id)) continue;
      initialItems.push(item);
      seen.add(item.id);
      if (initialItems.length >= 15) break;
    }
  }

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
  const roundedTotal = stats.total >= 1000 ? Math.floor(stats.total / 1000) * 1000 : stats.total;
  const defaultMetaDescription = `Upptäck över ${roundedTotal} verk från ${stats.museums} svenska samlingar.`;
  const heroHeadline = campaign.museumName
    ? campaign.museumName
    : `${stats.total.toLocaleString("sv-SE")} konstverk.`;
  const metaTitle = campaign.metaTitle || "Kabinett — Utforska Sveriges kulturarv";
  const metaDescription = campaign.metaDescription
    || (campaign.museumName
      ? `Upptäck verk från ${campaign.museumName} i Kabinett.`
      : defaultMetaDescription);

  // 3. Preload first theme (lightweight — single FTS query)
  const firstTheme = THEMES[0];
  let preloadedThemes: ThemeCardSection[] = [];
  try {
    const themeResult = await fetchFeed({ cursor: null, limit: 8, filter: firstTheme.filter });
    if (themeResult.items.length > 0) {
      preloadedThemes = [{ ...firstTheme, items: themeResult.items }];
    }
  } catch { /* skip on error */ }

  return {
    initialItems,
    initialCursor: null,
    initialHasMore: true,
    preloadedThemes,
    showMuseumBadge: enabledMuseums.length > 1,
    heroHeadline,
    heroSubline: campaign.heroSubline,
    heroIntro: campaign.heroIntro,
    stats,
    spotlight: null,
    ogImageUrl,
    metaTitle,
    metaDescription,
    noindex: campaign.noindex,
    canonicalUrl,
    origin: url.origin,
  };
}
