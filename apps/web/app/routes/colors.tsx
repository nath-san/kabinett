import type { Route } from "./+types/colors";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

const PALETTES = [
  { label: "Röda toner", slug: "red", gradient: "from-red-900 via-red-500 to-rose-300",
    sql: "color_r > color_g * 1.4 AND color_r > color_b * 1.4 AND color_r > 80" },
  { label: "Blå toner", slug: "blue", gradient: "from-blue-900 via-blue-500 to-sky-300",
    sql: "color_b > color_r * 1.3 AND color_b > color_g * 1.2 AND color_b > 80" },
  { label: "Gröna toner", slug: "green", gradient: "from-emerald-900 via-green-500 to-lime-300",
    sql: "color_g > color_r * 1.2 AND color_g > color_b * 1.2 AND color_g > 80" },
  { label: "Guld & gult", slug: "gold", gradient: "from-yellow-800 via-amber-400 to-yellow-200",
    sql: "color_r > 150 AND color_g > 120 AND color_b < color_r * 0.6" },
  { label: "Mörka verk", slug: "dark", gradient: "from-gray-950 via-gray-800 to-gray-600",
    sql: "(color_r + color_g + color_b) < 120" },
  { label: "Ljusa verk", slug: "light", gradient: "from-amber-50 via-stone-100 to-white",
    sql: "(color_r + color_g + color_b) > 600" },
  { label: "Varma toner", slug: "warm", gradient: "from-orange-900 via-orange-400 to-amber-200",
    sql: "color_r > color_b * 1.5 AND color_g > color_b AND (color_r + color_g) > 200" },
  { label: "Kalla toner", slug: "cool", gradient: "from-slate-800 via-cyan-500 to-teal-200",
    sql: "color_b > color_r AND color_g > color_r * 0.8 AND (color_g + color_b) > 200" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("palette") || "";

  const db = getDb();

  // Get a sample image for each palette as preview
  const palettePreviews = PALETTES.map(p => {
    const sample = db.prepare(
      `SELECT id, iiif_url, dominant_color FROM artworks
       WHERE color_r IS NOT NULL AND ${p.sql}
       ORDER BY RANDOM() LIMIT 4`
    ).all() as any[];
    return { ...p, samples: sample };
  });

  // If a palette is selected, get artworks
  let artworks: any[] = [];
  let paletteLabel = "";
  if (selected) {
    const palette = PALETTES.find(p => p.slug === selected);
    if (palette) {
      paletteLabel = palette.label;
      artworks = db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
         FROM artworks
         WHERE color_r IS NOT NULL AND ${palette.sql}
         ORDER BY RANDOM()
         LIMIT 40`
      ).all() as any[];
    }
  }

  return { palettePreviews, artworks, selected, paletteLabel };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Colors({ loaderData }: Route.ComponentProps) {
  const { palettePreviews, artworks, selected, paletteLabel } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Färger</h1>
        <p className="text-warm-gray text-sm mt-1">
          Utforska samlingen genom färg.
        </p>
      </div>

      {/* Palette cards */}
      <div className="px-(--spacing-page) pb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {palettePreviews.map((p) => (
            <a
              key={p.slug}
              href={`/colors?palette=${p.slug}#results`}
              className={`relative rounded-2xl overflow-hidden group ${
                selected === p.slug ? "ring-2 ring-charcoal ring-offset-2 ring-offset-cream" : ""
              }`}
            >
              {/* Image mosaic background */}
              <div className="grid grid-cols-2 aspect-[4/3]">
                {p.samples.length > 0 ? p.samples.map((s: any, i: number) => (
                  <div key={i} className="overflow-hidden" style={{ backgroundColor: s.dominant_color || "#888" }}>
                    <img
                      src={s.iiif_url.replace("http://", "https://") + "full/200,/0/default.jpg"}
                      alt="" width={200} height={150}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    />
                  </div>
                )) : (
                  <div className={`col-span-2 row-span-2 bg-gradient-to-br ${p.gradient}`} />
                )}
              </div>
              {/* Label overlay */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
                <p className="text-white text-sm font-medium">{p.label}</p>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Selected palette results */}
      {selected && artworks.length > 0 && (
        <div id="results" className="px-(--spacing-page) pb-24">
          <h2 className="font-serif text-xl font-semibold text-charcoal mb-1">
            {paletteLabel}
          </h2>
          <p className="text-sm text-warm-gray mb-6">{artworks.length} verk</p>

          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
            {artworks.map((a: any) => (
              <a
                key={a.id}
                href={`/artwork/${a.id}`}
                className="block break-inside-avoid rounded-xl overflow-hidden bg-linen group"
              >
                <div
                  style={{ backgroundColor: a.dominant_color || "#D4CDC3", aspectRatio: "3/4" }}
                  className="overflow-hidden"
                >
                  <img
                    src={a.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                    alt={a.title_sv || ""} width={400} height={533}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                    {a.title_sv || "Utan titel"}
                  </p>
                  <p className="text-xs text-warm-gray mt-1">{parseArtist(a.artists)}</p>
                  {a.dating_text && <p className="text-xs text-stone mt-0.5">{a.dating_text}</p>}
                </div>
              </a>
            ))}
          </div>

          <div className="flex justify-center pt-8">
            <a href={`/colors?palette=${selected}#results`}
              className="px-5 py-2.5 bg-charcoal text-cream rounded-full text-sm font-medium hover:bg-ink transition-colors">
              ✦ Visa andra
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
