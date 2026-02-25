import type Database from "better-sqlite3";
import { sourceFilter } from "./museums.server";

export type SiteStats = {
  totalWorks: number;
  museums: number;
  paintings: number;
  minYear: number | null;
  maxYear: number | null;
  yearsSpan: number;
};

let cachedStats: SiteStats | null = null;

function querySiteStats(db: Database.Database): SiteStats {
  const minYear = (db.prepare(`SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0 AND ${sourceFilter()}`).get() as any).c as number | null;
  const maxYear = (db.prepare(`SELECT MAX(COALESCE(year_end, year_start)) as c FROM artworks WHERE year_start > 0 AND ${sourceFilter()}`).get() as any).c as number | null;
  const currentYear = new Date().getFullYear();

  return {
    totalWorks: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${sourceFilter()}`).get() as any).c as number,
    museums: (db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT DISTINCT COALESCE(sub_museum, m.name) as museum_name
        FROM artworks a
        LEFT JOIN museums m ON m.id = a.source
        WHERE ${sourceFilter("a")} AND COALESCE(sub_museum, m.name) IS NOT NULL AND COALESCE(sub_museum, m.name) != 'Statens historiska museer'
      )
    `).get() as any).c as number,
    paintings: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Måleri%' AND ${sourceFilter()}`).get() as any).c as number,
    minYear,
    maxYear,
    yearsSpan: minYear ? Math.max(0, currentYear - minYear) : 0,
  };
}

export function getSiteStats(db: Database.Database): SiteStats {
  return querySiteStats(db);
}

export function getCachedSiteStats(db: Database.Database): SiteStats {
  if (!cachedStats) {
    cachedStats = querySiteStats(db);
  }
  return cachedStats;
}
