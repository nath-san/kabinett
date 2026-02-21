import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kabinett — Discover Swedish Art" },
    { name: "description", content: "Utforska Nationalmuseums samling på ett nytt sätt." },
  ];
}

export async function loader() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as count FROM artworks").get() as any).count;

  // Hero: a striking painting
  const hero = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
     FROM artworks
     WHERE category LIKE '%Målningar%'
       AND color_r IS NOT NULL
       AND (color_r + color_g + color_b) BETWEEN 150 AND 500
     ORDER BY RANDOM() LIMIT 1`
  ).get() as any;

  // Featured paintings
  const featured = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
     FROM artworks
     WHERE category LIKE '%Målningar%'
     ORDER BY RANDOM() LIMIT 8`
  ).all() as any[];

  // A few colorful works for the color teaser
  const colorful = db.prepare(
    `SELECT id, iiif_url, dominant_color
     FROM artworks
     WHERE color_r IS NOT NULL
       AND NOT (ABS(color_r - color_g) < 20 AND ABS(color_g - color_b) < 20)
     ORDER BY RANDOM() LIMIT 12`
  ).all() as any[];

  return { total, hero, featured, colorful };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { total, hero, featured, colorful } = loaderData;

  return (
    <div className="min-h-screen">
      {/* Full-bleed hero */}
      <section className="relative h-[85vh] min-h-[500px] flex items-end">
        {hero && (
          <>
            <img
              src={hero.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
              alt={hero.title_sv || ""}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
          </>
        )}
        <div className="relative z-10 px-(--spacing-page) pb-12 md:pb-16 max-w-2xl">
          <h1 className="font-serif text-4xl md:text-6xl font-bold text-white leading-tight">
            Upptäck svensk konst
          </h1>
          <p className="mt-4 text-base md:text-lg text-white/70">
            {total.toLocaleString("sv-SE")} verk från Nationalmuseums samling.
            Utforska efter färg, tid eller nyfikenhet.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/explore"
              className="px-6 py-3 bg-white text-charcoal rounded-full text-sm font-medium
                         hover:bg-cream transition-colors">
              Börja utforska
            </a>
            <a href="/colors"
              className="px-6 py-3 bg-white/15 text-white border border-white/25 rounded-full text-sm font-medium
                         hover:bg-white/25 transition-colors backdrop-blur-sm">
              Utforska färger
            </a>
          </div>
          {hero && (
            <a href={`/artwork/${hero.id}`}
              className="inline-block mt-6 text-xs text-white/50 hover:text-white/80 transition-colors">
              {hero.title_sv} — {parseArtist(hero.artists)}
            </a>
          )}
        </div>
      </section>

      {/* Featured */}
      <section className="px-(--spacing-page) py-16 md:py-20">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-serif text-2xl md:text-3xl font-semibold text-charcoal">
              Ur samlingen
            </h2>
            <p className="text-sm text-warm-gray mt-1">Slumpmässigt urval av målningar</p>
          </div>
          <a href="/explore" className="text-sm text-warm-gray hover:text-charcoal transition-colors">
            Visa alla →
          </a>
        </div>
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
          {featured.map((work: any) => (
            <a key={work.id} href={`/artwork/${work.id}`}
              className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group">
              <div className="overflow-hidden"
                style={{ backgroundColor: work.dominant_color || "#D4CDC3", aspectRatio: "3/4" }}>
                <img
                  src={work.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                  alt={work.title_sv || ""} width={400} height={533}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                  {work.title_sv || "Utan titel"}</p>
                <p className="text-xs text-warm-gray mt-1">{parseArtist(work.artists)}</p>
                {work.dating_text && <p className="text-xs text-stone mt-0.5">{work.dating_text}</p>}
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Color teaser */}
      <section className="px-(--spacing-page) py-16 md:py-20 bg-charcoal">
        <div className="max-w-2xl mb-8">
          <h2 className="font-serif text-2xl md:text-3xl font-semibold text-white">
            Utforska genom färg
          </h2>
          <p className="text-sm text-white/50 mt-2">
            Varje verk har en dominant färg. Vilken färg lockar dig?
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-4">
          {colorful.map((c: any) => (
            <a key={c.id} href={`/artwork/${c.id}`}
              className="shrink-0 w-28 h-36 md:w-36 md:h-44 rounded-xl overflow-hidden group">
              <img
                src={c.iiif_url.replace("http://", "https://") + "full/200,/0/default.jpg"}
                alt="" width={200} height={250}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
            </a>
          ))}
        </div>
        <a href="/colors"
          className="inline-block mt-6 px-6 py-3 bg-white/10 text-white border border-white/20 rounded-full text-sm font-medium
                     hover:bg-white/20 transition-colors">
          Utforska färger →
        </a>
      </section>

      {/* Footer */}
      <footer className="px-(--spacing-page) py-12 text-center">
        <p className="text-xs text-stone">
          Data från <a href="https://api.nationalmuseum.se" target="_blank" rel="noopener" className="underline hover:text-warm-gray">Nationalmuseums öppna API</a>.
          Metadata CC0, bilder Public Domain.
        </p>
        <p className="text-xs text-stone/60 mt-2">
          Kabinett är inte affilierat med Nationalmuseum.
        </p>
      </footer>
    </div>
  );
}
