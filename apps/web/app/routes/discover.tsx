import type { Route } from "./+types/discover";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getCachedSiteStats as getSiteStats } from "../lib/stats.server";
import { getCampaignConfig } from "../lib/campaign.server";

export function headers() {
  return { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" };
}

export function meta() {
  return [
    { title: "Upptäck — Kabinett" },
    { name: "description", content: "Utforska hundratusentals verk från Sveriges museer." },
  ];
}

type Collection = {
  title: string;
  subtitle: string;
  query?: string;
  imageIds?: number[];
  imageUrl?: string;
  imageTitle?: string;
  imageArtist?: string;
  color?: string;
  focalX?: number | null;
  focalY?: number | null;
};

type TopArtist = {
  name: string;
  count: number;
  imageUrl?: string;
  imageTitle: string;
  imageArtist: string;
  color: string;
  focalX?: number | null;
  focalY?: number | null;
};

type MuseumSummary = {
  id: string;
  name: string;
  count: number;
};

type ThemeImageRow = {
  iiif_url: string;
  dominant_color: string | null;
  title_sv: string | null;
  title_en: string | null;
  artists: string | null;
  focal_x: number | null;
  focal_y: number | null;
};

type ToolItem = {
  title: string;
  desc: string;
  href: string;
  mobileOnly?: boolean;
};

const COLLECTIONS: Collection[] = [
  { title: "Mörkt & dramatiskt", subtitle: "Skuggor och spänning", query: "mörker natt", imageIds: [24664, 20450, 15634] },
  { title: "Stormigt hav", subtitle: "Vågor och vind", query: "storm hav", imageIds: [18217, 20356, 17939] },
  { title: "Blommor", subtitle: "Natur i närbild", query: "blommor", imageIds: [-166319052559119, -179937114869368, 17457] },
  { title: "Hästar", subtitle: "Ädla djur genom tiderna", query: "häst", imageIds: [14802, -247833644771404, -69141112380166] },
  { title: "Porträtt", subtitle: "Ansikten genom tiderna", query: "porträtt ansikte", imageIds: [216852, 16308, 17096] },
  { title: "Landskap", subtitle: "Skog, berg och dal", query: "landskap skog", imageIds: [-202485135028962, -62777224500383, 17076] },
  { title: "Hattar", subtitle: "Huvudbonader genom historien", query: "hatt", imageIds: [-253468788019903, -256891764421414, -61674516346084] },
  { title: "Mytologi", subtitle: "Gudar och hjältar", query: "gud gudinna", imageIds: [71395, 177136, 17313] },
  { title: "Telefoner", subtitle: "Från vev till knappar", query: "telefon", imageIds: [-278306166813061, -62193254264396, -223649635814047] },
  { title: "Skepp & båtar", subtitle: "Till havs", query: "skepp båt fartyg", imageIds: [-139485473585279, -448520122533, -103198960131251] },
  { title: "Kaniner", subtitle: "Lurviga vänner", query: "kanin hare", imageIds: [-62346619720310, -132331838014998, -101957079536391] },
  { title: "Musik", subtitle: "Instrument och melodier", query: "musik instrument gitarr", imageIds: [-230629938287298, -87109461851263, -86518388012200] },
  { title: "Katter", subtitle: "Mjuka tassar", query: "katt", imageIds: [-189194491314296, 35597, -239926311302559] },
  { title: "Mat & frukt", subtitle: "Gastronomi i konsten", query: "mat frukt", imageIds: [-253717850327201, -5907047110556, -111000855806884] },
  { title: "Arkitektur", subtitle: "Slott och kyrkor", query: "slott kyrka", imageIds: [-129853437095252, -98579182221784, -45980371825152] },
  { title: "Barn", subtitle: "Barndomens porträtt", query: "barn", imageIds: [17996, 16051, 17093] },
];

const discoverCacheMap = new Map<string, { expiresAt: number; data: any }>();
const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function pickSeeded<T>(items: T[], seed: number): T | undefined {
  if (items.length === 0) return undefined;
  const idx = Math.abs(seed) % items.length;
  return items[idx];
}

function tokenizeSearch(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export async function loader() {
  const now = Date.now();
  const randomSeed = Math.floor(now / 60_000);
  const campaign = getCampaignConfig();
  const cacheKey = campaign.id;
  const cached = discoverCacheMap.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const db = getDb();
  const source = sourceFilter();
  const sourceA = sourceFilter("a");

  const themeByIdStmt = db.prepare(
    `SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists, a.focal_x, a.focal_y
     FROM artworks a
     WHERE a.id = ?
       AND a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}`
  );

  const themeFtsStmt = db.prepare(
    `SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists, a.focal_x, a.focal_y
     FROM artworks_fts
     JOIN artworks a ON a.id = artworks_fts.rowid
     WHERE artworks_fts MATCH ?
       AND a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}
     ORDER BY artworks_fts.rank ASC
     LIMIT 36`
  );

  const themeFallbackPool = db.prepare(
    `SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists, a.focal_x, a.focal_y
     FROM artworks a
     WHERE a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
       AND ${sourceA.sql}
     ORDER BY a.id DESC
     LIMIT 500`
  ).all(...sourceA.params) as ThemeImageRow[];

  const usedThemeImages = new Set<string>();

  // Collection images
  const collections = COLLECTIONS.map((c, index) => {
    try {
      let row: ThemeImageRow | undefined;

      if (c.imageIds?.length) {
        for (let offset = 0; offset < c.imageIds.length; offset += 1) {
          const pickedId = c.imageIds[(randomSeed + index + offset) % c.imageIds.length];
          const candidate = themeByIdStmt.get(pickedId, ...sourceA.params) as ThemeImageRow | undefined;
          if (!candidate) continue;
          if (!usedThemeImages.has(candidate.iiif_url)) {
            row = candidate;
            break;
          }
          if (!row) row = candidate;
        }
      }

      if (!row) {
        const terms = tokenizeSearch(c.query || c.title);
        const ftsQuery = terms.map((term) => `${term.replaceAll("\"", "")}*`).join(" OR ");
        if (ftsQuery) {
          try {
            const rows = themeFtsStmt.all(ftsQuery, ...sourceA.params) as ThemeImageRow[];
            const available = rows.filter((candidate) => !usedThemeImages.has(candidate.iiif_url));
            row = pickSeeded(available, randomSeed + index) || pickSeeded(rows, randomSeed + index);
          } catch {
            // FTS can be sparse/uneven across sources; fall through to LIKE fallback.
          }
        }
      }

      if (!row) {
        const terms = tokenizeSearch(c.query || c.title);
        if (terms.length > 0) {
          const likeClauses = terms.map(
            () =>
              "(LOWER(a.title_sv) LIKE ? OR LOWER(COALESCE(a.category, '')) LIKE ? OR LOWER(COALESCE(a.technique_material, '')) LIKE ?)"
          );
          const likeParams = terms.flatMap((term) => {
            const pattern = `%${term}%`;
            return [pattern, pattern, pattern];
          });
          const rows = db.prepare(
            `SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists, a.focal_x, a.focal_y
             FROM artworks a
             WHERE a.iiif_url IS NOT NULL
               AND LENGTH(a.iiif_url) > 40
               AND a.id NOT IN (SELECT artwork_id FROM broken_images)
               AND ${sourceA.sql}
               AND (${likeClauses.join(" OR ")})
             ORDER BY a.id DESC
             LIMIT 72`
          ).all(...sourceA.params, ...likeParams) as ThemeImageRow[];
          const available = rows.filter((candidate) => !usedThemeImages.has(candidate.iiif_url));
          row = pickSeeded(available, randomSeed + index) || pickSeeded(rows, randomSeed + index);
        }
      }

      if (!row && themeFallbackPool.length > 0) {
        const available = themeFallbackPool.filter((candidate) => !usedThemeImages.has(candidate.iiif_url));
        row = pickSeeded(available, randomSeed + index * 13) || pickSeeded(themeFallbackPool, randomSeed + index * 13);
      }

      if (row?.iiif_url) {
        usedThemeImages.add(row.iiif_url);
      }

      return {
        ...c,
        imageUrl: row?.iiif_url ? buildImageUrl(row.iiif_url, 400) : undefined,
        imageTitle: row?.title_sv || row?.title_en || "Utan titel",
        imageArtist: parseArtist(row?.artists || null),
        color: row?.dominant_color || "#2B2A27",
        focalX: row?.focal_x ?? null,
        focalY: row?.focal_y ?? null,
      };
    } catch {
      return { ...c, color: "#2B2A27" };
    }
  });

  // Top artists (excluding factories like Gustavsberg)
  const artistsWithImages = db.prepare(`
    WITH top_artists AS (
      SELECT json_extract(artists, '$[0].name') as name, COUNT(*) as cnt
      FROM artworks
      WHERE artists IS NOT NULL
        AND json_extract(artists, '$[0].name') IS NOT NULL
        AND json_extract(artists, '$[0].name') NOT LIKE '%känd%'
        AND json_extract(artists, '$[0].name') NOT LIKE '%nonym%'
        AND json_extract(artists, '$[0].name') NOT IN ('Gustavsberg')
        AND category NOT LIKE '%Keramik%'
        AND category NOT LIKE '%Porslin%'
        AND category NOT LIKE '%Glas%'
        AND category NOT LIKE '%Formgivning%'
        AND iiif_url IS NOT NULL
        AND LENGTH(iiif_url) > 40
        AND ${source.sql}
      GROUP BY name
      HAVING cnt >= 20
      ORDER BY cnt DESC
      LIMIT 12
    ), artist_samples AS (
      SELECT
        json_extract(artists, '$[0].name') as name,
        MAX(id) as sample_id
      FROM artworks
      WHERE artists IS NOT NULL
        AND json_extract(artists, '$[0].name') IN (SELECT name FROM top_artists)
        AND category NOT LIKE '%Keramik%'
        AND category NOT LIKE '%Porslin%'
        AND category NOT LIKE '%Glas%'
        AND category NOT LIKE '%Formgivning%'
        AND iiif_url IS NOT NULL
        AND LENGTH(iiif_url) > 40
        AND id NOT IN (SELECT artwork_id FROM broken_images)
        AND ${source.sql}
      GROUP BY name
    )
    SELECT
      ta.name,
      ta.cnt,
      a.iiif_url,
      a.dominant_color,
      a.title_sv,
      a.title_en,
      a.artists,
      a.focal_x,
      a.focal_y
    FROM top_artists ta
    JOIN artist_samples s ON s.name = ta.name
    JOIN artworks a ON a.id = s.sample_id
    ORDER BY ta.cnt DESC
  `).all(...source.params, ...source.params) as Array<{
    name: string;
    cnt: number;
    iiif_url: string | null;
    dominant_color: string | null;
    title_sv: string | null;
    title_en: string | null;
    artists: string | null;
    focal_x: number | null;
    focal_y: number | null;
  }>;

  const mappedArtists: TopArtist[] = artistsWithImages.map((artistRow) => ({
    name: artistRow.name,
    count: artistRow.cnt,
    imageUrl: artistRow.iiif_url ? buildImageUrl(artistRow.iiif_url, 300) : undefined,
    imageTitle: artistRow.title_sv || artistRow.title_en || "Utan titel",
    imageArtist: parseArtist(artistRow.artists || null),
    color: artistRow.dominant_color || "#D4CDC3",
    focalX: artistRow.focal_x,
    focalY: artistRow.focal_y,
  }));

  // Stats
  const siteStats = getSiteStats(db);
  const stats = {
    totalWorks: siteStats.totalWorks,
    paintings: siteStats.paintings,
    museums: siteStats.museums,
    yearsSpan: siteStats.yearsSpan,
  };

  const museums = db.prepare(`
    SELECT COALESCE(a.sub_museum, m.name) as coll_name, COUNT(*) as count
    FROM artworks a
    LEFT JOIN museums m ON m.id = a.source
    WHERE ${sourceA.sql}
      AND COALESCE(a.sub_museum, m.name) IS NOT NULL
      AND COALESCE(a.sub_museum, m.name) != 'Statens historiska museer'
    GROUP BY coll_name
    ORDER BY count DESC
  `).all(...sourceA.params) as Array<{ coll_name: string; count: number }>;
  const museumList: MuseumSummary[] = museums.map((row: any) => ({
    id: row.coll_name,
    name: row.coll_name,
    count: row.count as number,
  }));

  const payload = {
    collections,
    topArtists: mappedArtists,
    stats,
    museums: museumList,
    isCampaign: campaign.id !== "default",
    museumName: campaign.museumName,
  };

  discoverCacheMap.set(cacheKey, {
    expiresAt: now + DISCOVER_CACHE_TTL_MS,
    data: payload,
  });

  return payload;
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { collections, topArtists, stats, museums } = loaderData;

  const tools: ToolItem[] = [
    { title: "Färgmatch", desc: "Matcha en färg med konstverk", href: "/color-match", mobileOnly: true },
    { title: "Vandringar", desc: "Tematiska resor genom samlingen", href: "/vandringar" },
  ];
  const mobileToolCount = tools.length;
  const desktopToolCount = tools.filter((tool) => !tool.mobileOnly).length;
  const showToolHeadingOnMobile = mobileToolCount > 1;
  const showToolHeadingOnDesktop = desktopToolCount > 1;
  const showToolHeading = showToolHeadingOnMobile || showToolHeadingOnDesktop;
  const toolHeadingClass = [
    "font-serif text-[1.3rem] text-dark-text mb-4",
    showToolHeadingOnMobile && !showToolHeadingOnDesktop
      ? "md:hidden"
      : !showToolHeadingOnMobile && showToolHeadingOnDesktop
        ? "hidden md:block"
        : "",
  ].join(" ").trim();

  return (
    <div className="min-h-screen pt-16 bg-dark-base text-dark-text">
      <div className="md:max-w-6xl md:mx-auto md:px-4 lg:px-6">
        <h1 className="font-serif text-[2rem] text-dark-text px-5 pt-6 pb-2">Upptäck</h1>
        {/* Teman — 2-column grid */}
        <section className="pt-6 px-5">
          <h2 className="font-serif text-[1.3rem] text-dark-text mb-4">Teman</h2>

          <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4 lg:gap-3.5">
            {collections.map((c: Collection) => (
              <a
                key={c.title}
                href={`/search?q=${encodeURIComponent(c.query || c.title)}`}
                className={[
                  "relative rounded-card overflow-hidden no-underline group/coll focus-ring",
                  "aspect-square",
                ].join(" ")}
                style={{ backgroundColor: c.color || "#2B2A27" }}
              >
                {c.imageUrl && (
                  <img
                    src={c.imageUrl}
                    alt={`${c.imageTitle || "Utan titel"} — ${c.imageArtist || "Okänd konstnär"}`}
                    loading="lazy"
                    width={400}
                    height={400}
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
                    className="absolute inset-0 w-full h-full object-cover group-hover/coll:scale-[1.05] transition-transform duration-500"
                    style={{ objectPosition: `${(c.focalX ?? 0.5) * 100}% ${(c.focalY ?? 0.5) * 100}%` }}
                  />
                )}
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,9,8,0.75)_0%,rgba(10,9,8,0.1)_60%,transparent_100%)]" />
                <div className="absolute bottom-0 left-0 right-0 py-3 px-3.5">
                  <p className="font-serif text-[0.95rem] text-white m-0 leading-[1.2]">{c.title}</p>
                  <p className="text-[0.62rem] text-[rgba(255,255,255,0.50)] mt-[0.15rem]">{c.subtitle}</p>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Top artists */}
        {topArtists.length > 0 && (
          <section className="pt-10">
            <h2 className="font-serif text-[1.3rem] text-dark-text px-5 mb-4">Formgivare & konstnärer</h2>

            <div className="flex gap-3 overflow-x-auto px-5 pb-2 no-scrollbar lg:grid lg:grid-cols-4 xl:grid-cols-6 lg:gap-4 lg:overflow-visible lg:pb-0">
              {topArtists.map((a: TopArtist) => (
                <a
                  key={a.name}
                  href={`/artist/${encodeURIComponent(a.name)}`}
                  className="shrink-0 w-[5.5rem] lg:w-auto no-underline text-center focus-ring"
                >
                  <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-full overflow-hidden mx-auto" style={{ backgroundColor: a.color || "#D4CDC3" }}>
                    {a.imageUrl && (
                      <img
                        src={a.imageUrl}
                        alt={`${a.imageTitle || "Utan titel"} — ${a.imageArtist || a.name}`}
                        loading="lazy"
                        width={300}
                        height={300}
                        onError={(event) => {
                          event.currentTarget.classList.add("is-broken");
                        }}
                        className="w-full h-full object-cover"
                        style={{ objectPosition: `${(a.focalX ?? 0.5) * 100}% ${(a.focalY ?? 0.5) * 100}%` }}
                      />
                    )}
                  </div>
                  <p className="text-[0.7rem] font-medium text-dark-text mt-[0.4rem] leading-[1.2] overflow-hidden line-clamp-2">
                    {a.name}
                  </p>
                  <p className="text-[0.6rem] text-dark-text-secondary mt-[0.1rem]">
                    {a.count.toLocaleString("sv")} verk
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Verktyg */}
        {tools.length > 0 && (
          <section className="pt-10 px-5">
            {showToolHeading && <h2 className={toolHeadingClass}>Verktyg</h2>}
            <div className="flex flex-col gap-2">
              {tools.map((tool) => (
                <div key={tool.title} className={tool.mobileOnly ? "md:hidden" : ""}>
                  <ToolLink title={tool.title} desc={tool.desc} href={tool.href} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Samlingar */}
        {museums.length > 0 && (
          <section className="pt-10 px-5">
            <h2 className="font-serif text-[1.3rem] text-dark-text mb-4">Samlingar</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {museums.map((museum: MuseumSummary) => (
                <a
                  key={museum.id}
                  href={`/samling/${encodeURIComponent(museum.name)}`}
                  className="rounded-card bg-dark-raised p-4 no-underline hover:bg-dark-hover transition-colors focus-ring"
                >
                  <p className="text-[0.9rem] font-medium text-dark-text">{museum.name}</p>
                  <p className="text-[0.7rem] text-dark-text-secondary mt-1">
                    {museum.count.toLocaleString("sv")} verk
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Samlingen i siffror */}
        <section className="pt-10 px-5 pb-16">
          <h2 className="font-serif text-[1.3rem] text-dark-text mb-4">Samlingen i siffror</h2>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
            <StatCard number={stats.totalWorks.toLocaleString("sv")} label="verk" />
            <StatCard number={stats.museums.toLocaleString("sv")} label="samlingar" />
            <StatCard number={`${stats.yearsSpan} år`} label="av historia" />
            <StatCard number={stats.paintings.toLocaleString("sv")} label="målningar" />
          </div>
        </section>
      </div>
    </div>
  );
}

function ToolLink({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a href={href} className="flex items-center gap-[0.8rem] py-[0.9rem] px-4 min-h-11 rounded-card bg-dark-raised no-underline hover:bg-dark-hover focus-ring">
      <div className="flex-1">
        <p className="text-[0.88rem] font-medium text-dark-text m-0">{title}</p>
        <p className="text-[0.72rem] text-dark-text-muted mt-[0.1rem]">{desc}</p>
      </div>
      <span className="text-dark-text-muted text-[1rem]">→</span>
    </a>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="py-4 px-3 rounded-card bg-dark-raised text-center">
      <p className="font-serif text-[1.4rem] font-semibold text-dark-text m-0 leading-[1.1]">{number}</p>
      <p className="text-[0.6rem] text-dark-text-secondary mt-1 uppercase tracking-[0.08em]">{label}</p>
    </div>
  );
}
