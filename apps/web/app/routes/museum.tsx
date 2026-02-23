import type { Route } from "./+types/museum";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { getEnabledMuseums, getMuseumInfo } from "../lib/museums.server";

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

function formatRange(minYear: number | null, maxYear: number | null): string {
  if (!minYear || !maxYear) return "Okänt";
  if (minYear === maxYear) return String(minYear);
  return `${minYear}–${maxYear}`;
}

export function meta({ data }: Route.MetaArgs) {
  if (!data?.museum) return [{ title: "Museum — Kabinett" }];
  const title = `${data.museum.name} — Kabinett`;
  const description = data.museum.description || "";
  const tags = [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
  if (data.ogImageUrl) {
    tags.push(
      { property: "og:image", content: data.ogImageUrl },
      { name: "twitter:image", content: data.ogImageUrl }
    );
  }
  return tags;
}

type FeaturedItem = {
  id: number;
  title: string;
  artist: string;
  datingText: string | null;
  imageUrl: string;
  color: string;
};

type CategoryStat = { name: string; count: number };

export async function loader({ params }: Route.LoaderArgs) {
  const id = (params.id || "").toLowerCase();
  const enabled = getEnabledMuseums();
  if (!id || !enabled.includes(id)) {
    throw new Response("Inte hittat", { status: 404 });
  }

  const museum = getMuseumInfo(id);
  if (!museum) throw new Response("Inte hittat", { status: 404 });

  const db = getDb();

  const totalWorks = (db
    .prepare("SELECT COUNT(*) as c FROM artworks WHERE source = ?")
    .get(id) as any).c as number;

  const dateRow = db
    .prepare(
      `SELECT MIN(year_start) as minYear, MAX(COALESCE(year_end, year_start)) as maxYear
       FROM artworks WHERE source = ? AND year_start > 0`
    )
    .get(id) as { minYear: number | null; maxYear: number | null };

  const rawCategories = db
    .prepare(
      `SELECT category, COUNT(*) as c
       FROM artworks
       WHERE source = ? AND category IS NOT NULL AND category != ''
       GROUP BY category`
    )
    .all(id) as Array<{ category: string; c: number }>;

  const categoryMap = new Map<string, number>();
  for (const row of rawCategories) {
    const label = row.category.split(" (")[0].trim();
    if (!label) continue;
    categoryMap.set(label, (categoryMap.get(label) || 0) + row.c);
  }

  const categories: CategoryStat[] = Array.from(categoryMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const featuredRows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
       FROM artworks
       WHERE source = ?
         AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
       ORDER BY RANDOM() LIMIT 8`
    )
    .all(id) as any[];

  const featured: FeaturedItem[] = featuredRows.map((row) => ({
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    datingText: row.dating_text || null,
    imageUrl: buildImageUrl(row.iiif_url, 400),
    color: row.dominant_color || "#D4CDC3",
  }));

  const ogImageUrl = featuredRows[0]?.iiif_url
    ? (id === "nationalmuseum" ? buildImageUrl(featuredRows[0].iiif_url, 800) : featuredRows[0].iiif_url)
    : null;

  return {
    museum: {
      id: museum.id,
      name: museum.name,
      description: museum.description,
      url: museum.url,
    },
    stats: {
      totalWorks,
      dateRange: formatRange(dateRow?.minYear || null, dateRow?.maxYear || null),
      categories,
    },
    featured,
    ogImageUrl,
  };
}

export default function Museum({ loaderData }: Route.ComponentProps) {
  const { museum, stats, featured } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-cream">
      <div className="max-w-5xl mx-auto px-4 lg:px-6">
        <div className="pt-6">
          <p className="text-[0.7rem] tracking-[0.2em] uppercase text-warm-gray">Museum</p>
          <h1 className="font-serif text-[2.2rem] lg:text-[2.6rem] text-charcoal m-0">
            {museum.name}
          </h1>
          {museum.description && (
            <p className="mt-3 text-[1rem] lg:text-[1.05rem] text-warm-gray max-w-3xl">
              {museum.description}
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`/search?museum=${encodeURIComponent(museum.id)}`}
              className="inline-flex items-center justify-center px-5 h-[2.6rem] rounded-full bg-ink text-cream text-[0.85rem] no-underline font-medium focus-ring"
            >
              Utforska
            </a>
            {museum.url && (
              <a
                href={museum.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center px-5 h-[2.6rem] rounded-full border border-stone text-ink text-[0.85rem] no-underline font-medium focus-ring"
              >
                Besök webbplats
              </a>
            )}
          </div>
        </div>

        <section className="pt-8">
          <h2 className="sr-only">Nyckeltal</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Verk</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">
                {stats.totalWorks.toLocaleString("sv")}
              </p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Tidsomfång</p>
              <p className="text-[1.6rem] font-serif text-charcoal mt-2">
                {stats.dateRange}
              </p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-warm-gray m-0">Kategorier</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {stats.categories.length > 0 ? (
                  stats.categories.map((c) => (
                    <span
                      key={c.name}
                      className="text-[0.75rem] px-2 py-[0.2rem] rounded-full bg-linen text-ink"
                    >
                      {c.name} · {c.count.toLocaleString("sv")}
                    </span>
                  ))
                ) : (
                  <span className="text-[0.8rem] text-warm-gray">Inga kategorier hittades</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="pt-10 pb-10">
          <div className="flex items-end justify-between">
            <h2 className="font-serif text-[1.4rem] text-charcoal">Utvalda verk</h2>
            <a
              href={`/search?museum=${encodeURIComponent(museum.id)}`}
              className="text-[0.8rem] text-warm-gray no-underline focus-ring"
            >
              Se fler
            </a>
          </div>

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
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,9,8,0.55)_0%,rgba(10,9,8,0.05)_60%,transparent_100%)]" />
                  </div>
                  <div className="p-3">
                    <p className="font-serif text-[0.95rem] text-charcoal m-0 leading-[1.2]">
                      {item.title}
                    </p>
                    <p className="text-[0.7rem] text-warm-gray mt-1">
                      {item.artist}
                      {item.datingText ? ` · ${item.datingText}` : ""}
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
