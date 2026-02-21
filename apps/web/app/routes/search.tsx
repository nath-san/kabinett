import type { Route } from "./+types/search";
import { getDb } from "../lib/db.server";

export function meta({ data }: Route.MetaArgs) {
  const q = data?.query || "";
  return [
    { title: q ? `"${q}" — Kabinett` : "Sök — Kabinett" },
    { name: "description", content: "Sök i Nationalmuseums samling." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";

  if (!query) return { query, results: [], total: 0 };

  const db = getDb();
  const like = `%${query}%`;

  const results = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, category
       FROM artworks
       WHERE title_sv LIKE ?
          OR title_en LIKE ?
          OR artists LIKE ?
          OR technique_material LIKE ?
          OR category LIKE ?
       LIMIT 60`
    )
    .all(like, like, like, like, like) as any[];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM artworks
         WHERE title_sv LIKE ?
            OR title_en LIKE ?
            OR artists LIKE ?
            OR technique_material LIKE ?
            OR category LIKE ?`
      )
      .get(like, like, like, like, like) as any
  ).count;

  return { query, results, total };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, results, total } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Sök</h1>

        {/* Search form */}
        <form action="/search" method="get" className="mt-4">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={query}
              placeholder="Konstnär, titel, teknik..."
              autoFocus
              className="flex-1 px-4 py-3 rounded-xl bg-linen text-charcoal placeholder:text-stone
                         text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none
                         transition-colors"
            />
            <button
              type="submit"
              className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium
                         hover:bg-ink transition-colors"
            >
              Sök
            </button>
          </div>
        </form>

        {/* Quick suggestions */}
        {!query && (
          <div className="mt-6 flex flex-wrap gap-2">
            {["Carl Larsson", "Rembrandt", "Olja på duk", "Akvarell", "Porträtt", "Landskap", "1700-tal"].map(
              (s) => (
                <a
                  key={s}
                  href={`/search?q=${encodeURIComponent(s)}`}
                  className="px-3 py-1.5 rounded-full bg-linen text-warm-gray text-xs font-medium
                             hover:bg-stone hover:text-charcoal transition-colors"
                >
                  {s}
                </a>
              )
            )}
          </div>
        )}
      </div>

      {/* Results */}
      {query && (
        <div className="px-(--spacing-page) pb-24">
          <p className="text-sm text-warm-gray mb-6">
            {total > 0
              ? `${total} träffar för "${query}"${total > 60 ? " (visar 60)" : ""}`
              : `Inga träffar för "${query}"`}
          </p>

          {results.length > 0 && (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
              {results.map((r: any) => (
                <a
                  key={r.id}
                  href={`/artwork/${r.id}`}
                  className="block break-inside-avoid rounded-xl overflow-hidden bg-linen group"
                >
                  <div
                    style={{
                      backgroundColor: r.dominant_color || "#D4CDC3",
                      aspectRatio: "3/4",
                    }}
                    className="overflow-hidden"
                  >
                    <img
                      src={r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                      alt={r.title_sv || ""}
                      width={400}
                      height={533}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    />
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                      {r.title_sv || r.title_en || "Utan titel"}
                    </p>
                    <p className="text-xs text-warm-gray mt-1">{parseArtist(r.artists)}</p>
                    {r.dating_text && (
                      <p className="text-xs text-stone mt-0.5">{r.dating_text}</p>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
