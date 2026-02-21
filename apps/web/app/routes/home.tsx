import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kabinett — Discover Swedish Art" },
    {
      name: "description",
      content:
        "Utforska Nationalmuseums samling på ett nytt sätt. Sök efter färg, stämning eller nyfikenhet.",
    },
  ];
}

export async function loader() {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as count FROM artworks").get() as any).count;

  const featured = db
    .prepare(
      `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text, category
       FROM artworks
       WHERE category LIKE '%Målningar%'
       ORDER BY RANDOM()
       LIMIT 8`
    )
    .all() as any[];

  // Pick a hero image - a painting with good colors
  const hero = db
    .prepare(
      `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
       FROM artworks
       WHERE category LIKE '%Målningar%'
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .get() as any;

  return { total, featured, hero };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    const arr = JSON.parse(json);
    return arr[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { total, featured, hero } = loaderData;

  return (
    <div className="min-h-screen pt-14">
      {/* Hero */}
      <section className="relative">
        {hero && (
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage: `url(${hero.iiif_url.replace("http://", "https://")}full/1200,/0/default.jpg)`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        )}
        <div className="relative flex flex-col items-center justify-center px-(--spacing-page) py-20 md:py-28 text-center">
          <h1 className="font-serif text-5xl md:text-7xl font-bold text-charcoal leading-tight">
            Upptäck svensk konst
          </h1>
          <p className="mt-6 text-lg md:text-xl text-warm-gray max-w-xl">
            {total.toLocaleString("sv-SE")} verk från Nationalmuseums samling.
            <br />
            Utforska efter färg, tid eller nyfikenhet.
          </p>
          <div className="mt-10 flex gap-4">
            <a
              href="/explore"
              className="px-6 py-3 bg-charcoal text-cream rounded-full text-sm font-medium hover:bg-ink transition-colors"
            >
              Börja utforska
            </a>
            <a
              href="/colors"
              className="px-6 py-3 border border-stone text-charcoal rounded-full text-sm font-medium hover:bg-linen transition-colors"
            >
              Utforska färger
            </a>
          </div>
        </div>
      </section>

      {/* Featured grid */}
      <section className="px-(--spacing-page) pb-24">
        <h2 className="font-serif text-2xl font-semibold text-charcoal mb-8">
          Ur samlingen
        </h2>
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
          {featured.map((work: any) => (
            <a
              key={work.id}
              href={`/artwork/${work.id}`}
              className="block break-inside-avoid rounded-xl overflow-hidden bg-linen group"
            >
              <div
                className="overflow-hidden"
                style={{
                  backgroundColor: work.dominant_color || "#D4CDC3",
                  aspectRatio: "3/4",
                }}
              >
                <img
                  src={
                    work.iiif_url.replace("http://", "https://") +
                    "full/400,/0/default.jpg"
                  }
                  alt={work.title_sv || ""}
                  width={400}
                  height={533}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                  {work.title_sv || "Utan titel"}
                </p>
                <p className="text-xs text-warm-gray mt-1">
                  {parseArtist(work.artists)}
                </p>
                {work.dating_text && (
                  <p className="text-xs text-stone mt-0.5">{work.dating_text}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
