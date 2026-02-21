import type { Route } from "./+types/colors";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

const PALETTES = [
  { label: "Röda toner", slug: "red", bg: "#8B2500",
    sql: "color_r > color_g * 1.4 AND color_r > color_b * 1.4 AND color_r > 80 AND category LIKE '%Målningar%'" },
  { label: "Blå toner", slug: "blue", bg: "#1A3A5C",
    sql: "color_b > color_r * 1.3 AND color_b > color_g * 1.2 AND color_b > 80 AND category LIKE '%Målningar%'" },
  { label: "Gröna toner", slug: "green", bg: "#2D4A2D",
    sql: "color_g > color_r * 1.2 AND color_g > color_b * 1.2 AND color_g > 80" },
  { label: "Guld & gult", slug: "gold", bg: "#8B7420",
    sql: "color_r > 150 AND color_g > 120 AND color_b < color_r * 0.6" },
  { label: "Mörka verk", slug: "dark", bg: "#1A1815",
    sql: "(color_r + color_g + color_b) < 120 AND category LIKE '%Målningar%'" },
  { label: "Ljusa verk", slug: "light", bg: "#D4CDC3",
    sql: "(color_r + color_g + color_b) > 600 AND category LIKE '%Målningar%'" },
  { label: "Varma toner", slug: "warm", bg: "#8B5E3C",
    sql: "color_r > color_b * 1.5 AND color_g > color_b AND (color_r + color_g) > 200 AND category LIKE '%Målningar%'" },
  { label: "Kalla toner", slug: "cool", bg: "#3A5A6B",
    sql: "color_b > color_r AND color_g > color_r * 0.8 AND (color_g + color_b) > 200 AND category LIKE '%Målningar%'" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("palette") || "";
  const db = getDb();

  // One hero image per palette
  const paletteCards = PALETTES.map(p => {
    try {
      const hero = db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, artists FROM artworks
         WHERE color_r IS NOT NULL AND ${p.sql}
         ORDER BY RANDOM() LIMIT 1`
      ).get() as any;
      return { ...p, hero };
    } catch {
      return { ...p, hero: null };
    }
  });

  let artworks: any[] = [];
  let paletteLabel = "";
  if (selected) {
    const palette = PALETTES.find(p => p.slug === selected);
    if (palette) {
      paletteLabel = palette.label;
      try {
        artworks = db.prepare(
          `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
           FROM artworks WHERE color_r IS NOT NULL AND ${palette.sql}
           ORDER BY RANDOM() LIMIT 40`
        ).all() as any[];
      } catch {}
    }
  }

  return { paletteCards, artworks, selected, paletteLabel };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Colors({ loaderData }: Route.ComponentProps) {
  const { paletteCards, artworks, selected, paletteLabel } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-ink">
      {/* Header */}
      <div className="px-(--spacing-page) pt-10 pb-8">
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-white">Färger</h1>
        <p className="text-white/40 text-sm mt-2">
          Välj en färgvärld och låt konsten tala.
        </p>
      </div>

      {/* Palette strips — full-width horizontal scroll on mobile */}
      <div className="space-y-1">
        {paletteCards.map((p) => (
          <a
            key={p.slug}
            href={`/colors?palette=${p.slug}#results`}
            className={`group block relative overflow-hidden ${
              selected === p.slug ? "h-32 md:h-40" : "h-20 md:h-24"
            } transition-all duration-300`}
            style={{ backgroundColor: p.bg }}
          >
            {/* Background artwork */}
            {p.hero && (
              <img
                src={p.hero.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
                alt="" width={800} height={400}
                className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover:opacity-70 group-hover:scale-105 transition-all duration-700"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />

            {/* Label */}
            <div className="relative h-full flex items-center px-(--spacing-page)">
              <div>
                <h2 className={`font-serif font-semibold text-white ${
                  selected === p.slug ? "text-2xl md:text-3xl" : "text-lg md:text-xl"
                } transition-all duration-300`}>
                  {p.label}
                </h2>
                {selected === p.slug && (
                  <p className="text-white/50 text-xs mt-1">{artworks.length} verk</p>
                )}
              </div>
            </div>

            {/* Active indicator */}
            {selected === p.slug && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/60" />
            )}
          </a>
        ))}
      </div>

      {/* Results */}
      {selected && artworks.length > 0 && (
        <div id="results" className="bg-cream px-(--spacing-page) py-12">
          <div className="flex items-end justify-between mb-6">
            <h2 className="font-serif text-xl font-semibold text-charcoal">
              {paletteLabel}
            </h2>
            <a href={`/colors?palette=${selected}#results`}
              className="text-sm text-warm-gray hover:text-charcoal transition-colors">
              ✦ Slumpa nya
            </a>
          </div>

          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
            {artworks.map((a: any) => (
              <a key={a.id} href={`/artwork/${a.id}`}
                className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group">
                <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", aspectRatio: "3/4" }}
                  className="overflow-hidden">
                  <img src={a.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                    alt={a.title_sv || ""} width={400} height={533}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                    {a.title_sv || "Utan titel"}</p>
                  <p className="text-xs text-warm-gray mt-1">{parseArtist(a.artists)}</p>
                  {a.dating_text && <p className="text-xs text-stone mt-0.5">{a.dating_text}</p>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {!selected && (
        <div className="px-(--spacing-page) py-12 text-center">
          <p className="text-white/30 text-sm">Välj en färgvärld ovan.</p>
        </div>
      )}
    </div>
  );
}
