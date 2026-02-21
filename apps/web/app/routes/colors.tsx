import type { Route } from "./+types/colors";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selectedHue = url.searchParams.get("hue");

  const db = getDb();

  // Get a spread of colors across the spectrum
  // Group artworks by hue buckets
  const all = db
    .prepare(
      `SELECT id, title_sv, iiif_url, dominant_color, color_r, color_g, color_b
       FROM artworks
       WHERE color_r IS NOT NULL
       ORDER BY
         CASE
           WHEN color_r >= color_g AND color_r >= color_b THEN 0
           WHEN color_g >= color_r AND color_g >= color_b THEN 1
           ELSE 2
         END,
         color_r, color_g, color_b
       LIMIT 300`
    )
    .all() as any[];

  // If a hue is selected, get artworks matching that hue range
  let filtered: any[] = [];
  if (selectedHue) {
    const hueRanges: Record<string, [number, number, number, number, number, number]> = {
      red:    [150, 0, 0, 255, 100, 100],
      orange: [180, 100, 0, 255, 180, 100],
      yellow: [180, 180, 0, 255, 255, 100],
      green:  [0, 100, 0, 150, 255, 150],
      blue:   [0, 0, 100, 150, 150, 255],
      purple: [100, 0, 100, 255, 100, 255],
      brown:  [80, 40, 0, 180, 130, 80],
      gray:   [80, 80, 80, 180, 180, 180],
      light:  [200, 200, 200, 255, 255, 255],
      dark:   [0, 0, 0, 80, 80, 80],
    };

    const range = hueRanges[selectedHue];
    if (range) {
      filtered = db
        .prepare(
          `SELECT id, title_sv, iiif_url, dominant_color
           FROM artworks
           WHERE color_r BETWEEN ? AND ?
             AND color_g BETWEEN ? AND ?
             AND color_b BETWEEN ? AND ?
           ORDER BY RANDOM()
           LIMIT 40`
        )
        .all(range[0], range[3], range[1], range[4], range[2], range[5]) as any[];
    }
  }

  return { spectrum: all, filtered, selectedHue };
}

const HUE_BUTTONS = [
  { label: "Rött", value: "red", color: "#C4553A" },
  { label: "Orange", value: "orange", color: "#D4893A" },
  { label: "Gult", value: "yellow", color: "#D4C43A" },
  { label: "Grönt", value: "green", color: "#4A8C5C" },
  { label: "Blått", value: "blue", color: "#3A6BC4" },
  { label: "Lila", value: "purple", color: "#8C4AA0" },
  { label: "Brunt", value: "brown", color: "#8C6844" },
  { label: "Grått", value: "gray", color: "#9C9C9C" },
  { label: "Ljust", value: "light", color: "#E8E4DE" },
  { label: "Mörkt", value: "dark", color: "#2C2824" },
];

export default function Colors({ loaderData }: Route.ComponentProps) {
  const { spectrum, filtered, selectedHue } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-2">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Färger</h1>
        <p className="text-warm-gray text-sm mt-1">
          Utforska samlingen genom färg.
        </p>
      </div>

      {/* Color spectrum mosaic */}
      <div className="px-(--spacing-page) py-4">
        <div className="flex flex-wrap gap-0.5">
          {spectrum.map((s: any) => (
            <a
              key={s.id}
              href={`/artwork/${s.id}`}
              className="block hover:scale-150 hover:z-10 transition-transform duration-200"
              title={s.title_sv}
            >
              <div
                className="w-6 h-6 md:w-8 md:h-8 rounded-sm"
                style={{ backgroundColor: s.dominant_color || "#ccc" }}
              />
            </a>
          ))}
        </div>
      </div>

      {/* Hue picker */}
      <div
        className="px-(--spacing-page) py-4 flex gap-2 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {HUE_BUTTONS.map((h) => (
          <a
            key={h.value}
            href={`/colors?hue=${h.value}`}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              selectedHue === h.value
                ? "ring-2 ring-charcoal ring-offset-2 ring-offset-cream"
                : "hover:ring-1 hover:ring-stone"
            }`}
            style={{ backgroundColor: h.color + "20" }}
          >
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: h.color }}
            />
            {h.label}
          </a>
        ))}
      </div>

      {/* Filtered results */}
      {filtered.length > 0 && (
        <div className="px-(--spacing-page) pb-24">
          <p className="text-sm text-warm-gray mb-4">{filtered.length} verk</p>
          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
            {filtered.map((a: any) => (
              <a
                key={a.id}
                href={`/artwork/${a.id}`}
                className="block break-inside-avoid rounded-xl overflow-hidden bg-linen"
              >
                <div
                  style={{
                    backgroundColor: a.dominant_color || "#D4CDC3",
                    aspectRatio: "3/4",
                  }}
                  className="overflow-hidden"
                >
                  <img
                    src={
                      a.iiif_url.replace("http://", "https://") +
                      "full/400,/0/default.jpg"
                    }
                    alt={a.title_sv || ""}
                    width={400}
                    height={533}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                    {a.title_sv || "Utan titel"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {!selectedHue && (
        <div className="px-(--spacing-page) pb-24">
          <p className="text-warm-gray text-sm">Välj en färg ovan för att utforska.</p>
        </div>
      )}
    </div>
  );
}
