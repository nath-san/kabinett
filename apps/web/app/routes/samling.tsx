import type { Route } from "./+types/samling";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

type FeaturedRow = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
};

const FEATURED_CACHE_TTL_MS = 60 * 1000;
const collectionFeaturedCache = new Map<string, { expiresAt: number; rows: FeaturedRow[] }>();

function formatRange(minYear: number | null, maxYear: number | null): string {
  if (!minYear || !maxYear) return "Okänt";
  if (minYear === maxYear) return String(minYear);
  return `${minYear}–${maxYear}`;
}

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data?.name) return [{ title: "Samling — Kabinett" }];
  const title = `${data.name} — Kabinett`;
  return [
    { title },
    { name: "description", content: `Utforska ${data.stats.totalWorks.toLocaleString("sv")} verk från ${data.name} i Kabinett.` },
    { property: "og:title", content: title },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    ...(data.ogImageUrl
      ? [
          { property: "og:image", content: data.ogImageUrl },
          { name: "twitter:image", content: data.ogImageUrl },
        ]
      : []),
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  let slug = "";
  try {
    slug = decodeURIComponent(params.name || "");
  } catch (error) {
    if (error instanceof URIError) {
      throw new Response("Ogiltig URL-kodning", { status: 400 });
    }
    throw error;
  }
  const db = getDb();
  const sourceA = sourceFilter("a");

  // Find the collection — match sub_museum or museum name
  const check = db.prepare(`
    SELECT COUNT(*) as c FROM artworks a
    LEFT JOIN museums m ON m.id = a.source
    WHERE ${sourceA.sql}
      AND (a.sub_museum = ? OR (a.sub_museum IS NULL AND m.name = ?))
  `).get(...sourceA.params, slug, slug) as any;

  if (!check || check.c === 0) throw new Response("Inte hittat", { status: 404 });

  const whereClause = `${sourceA.sql} AND (a.sub_museum = ? OR (a.sub_museum IS NULL AND m.name = ?))`;

  const totalWorks = check.c as number;

  const dateRow = db.prepare(`
    SELECT MIN(a.year_start) as minYear, MAX(COALESCE(a.year_end, a.year_start)) as maxYear
    FROM artworks a LEFT JOIN museums m ON m.id = a.source
    WHERE ${whereClause} AND a.year_start > 0
  `).get(...sourceA.params, slug, slug) as { minYear: number | null; maxYear: number | null };

  const rawCategories = db.prepare(`
    SELECT a.category, COUNT(*) as c
    FROM artworks a LEFT JOIN museums m ON m.id = a.source
    WHERE ${whereClause} AND a.category IS NOT NULL AND a.category != ''
    GROUP BY a.category
  `).all(...sourceA.params, slug, slug) as Array<{ category: string; c: number }>;

  const categoryMap = new Map<string, number>();
  for (const row of rawCategories) {
    const label = row.category.split(" (")[0].trim();
    if (!label) continue;
    categoryMap.set(label, (categoryMap.get(label) || 0) + row.c);
  }
  const categories = Array.from(categoryMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const now = Date.now();
  const cachedFeatured = collectionFeaturedCache.get(slug);
  const featuredRows = cachedFeatured && cachedFeatured.expiresAt > now
    ? cachedFeatured.rows
    : (db.prepare(`
        SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
        FROM artworks a LEFT JOIN museums m ON m.id = a.source
        WHERE ${whereClause}
          AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        ORDER BY ((a.rowid * 1103515245 + ?) & 2147483647)
        LIMIT 8
      `).all(...sourceA.params, slug, slug, Math.floor(now / 60_000)) as FeaturedRow[]);

  if (!cachedFeatured || cachedFeatured.expiresAt <= now) {
    collectionFeaturedCache.set(slug, {
      expiresAt: now + FEATURED_CACHE_TTL_MS,
      rows: featuredRows,
    });
  }

  const featured = featuredRows.map((row: any) => ({
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    datingText: row.dating_text || null,
    imageUrl: buildImageUrl(row.iiif_url, 400),
    color: row.dominant_color || "#D4CDC3",
  }));

  const ogImageUrl = featuredRows[0]?.iiif_url ? buildImageUrl(featuredRows[0].iiif_url, 800) : null;

  return { name: slug, stats: { totalWorks, dateRange: formatRange(dateRow?.minYear || null, dateRow?.maxYear || null), categories }, featured, ogImageUrl };
}

export default function Samling({ loaderData }: Route.ComponentProps) {
  const { name, stats, featured } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-cream">
      <div className="max-w-5xl mx-auto px-4 lg:px-6">
        <div className="pt-6">
          <p className="text-[0.7rem] tracking-[0.2em] uppercase text-warm-gray">Samling</p>
          <h1 className="font-serif text-[2.2rem] lg:text-[2.6rem] text-charcoal m-0">{name}</h1>
        </div>

        <section className="pt-8">
          <h2 className="sr-only">Nyckeltal</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Verk</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">{stats.totalWorks.toLocaleString("sv")}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Tidsomfång</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">{stats.dateRange}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Kategorier</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.categories.length > 0 ? (
                  stats.categories.map((c) => (
                    <span key={c.name} className="text-[0.75rem] px-2 py-[0.2rem] rounded-full bg-linen text-ink">
                      {c.name} · {c.count.toLocaleString("sv")}
                    </span>
                  ))
                ) : (
                  <span className="text-[0.8rem] text-warm-gray">Inga kategorier</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="pt-10 pb-10">
          <h2 className="font-serif text-[1.4rem] text-charcoal">Utvalda verk</h2>
          {featured.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {featured.map((item) => (
                <a
                  key={item.id}
                  href={`/artwork/${item.id}`}
                  className="block rounded-[14px] overflow-hidden bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] no-underline contain-[layout_paint] focus-ring"
                >
                  <div className="relative aspect-[3/4]" style={{ backgroundColor: item.color }}>
                    <img
                      src={item.imageUrl}
                      alt={`${item.title} — ${item.artist}`}
                      loading="lazy"
                      width={400}
                      height={533}
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,9,8,0.55)_0%,rgba(10,9,8,0.05)_60%,transparent_100%)]" />
                  </div>
                  <div className="p-3">
                    <p className="font-serif text-[0.95rem] text-charcoal m-0 leading-[1.2]">{item.title}</p>
                    <p className="text-[0.7rem] text-warm-gray mt-1">
                      {item.artist}{item.datingText ? ` · ${item.datingText}` : ""}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-warm-gray mt-4">Inga verk att visa just nu.</p>
          )}
        </section>
      </div>
    </div>
  );
}
