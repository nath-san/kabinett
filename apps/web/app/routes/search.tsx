import { useState, useEffect, useRef } from "react";
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

const TYPE_LABELS: Record<string, string> = {
  artist: "Konstnär",
  title: "Verk",
  category: "Kategori",
};

function SearchInput({ defaultValue }: { defaultValue: string }) {
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<
    Array<{ value: string; type: string }>
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/autocomplete?q=${encodeURIComponent(query)}`
        );
        const data = await res.json();
        setSuggestions(data);
        setShowSuggestions(true);
        setSelectedIndex(-1);
      } catch {}
    }, 150);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  function submit(value: string) {
    setQuery(value);
    setShowSuggestions(false);
    // Navigate via form
    window.location.href = `/search?q=${encodeURIComponent(value)}`;
  }

  return (
    <form ref={formRef} action="/search" method="get" className="mt-4 relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) =>
                  Math.min(i + 1, suggestions.length - 1)
                );
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, -1));
              } else if (e.key === "Enter" && selectedIndex >= 0) {
                e.preventDefault();
                submit(suggestions[selectedIndex].value);
              }
            }}
            placeholder="Konstnär, titel, teknik..."
            autoFocus
            autoComplete="off"
            className="w-full px-4 py-3 rounded-xl bg-linen text-charcoal placeholder:text-stone
                       text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none
                       transition-colors"
          />

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-stone/10 overflow-hidden z-50">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.type}-${s.value}`}
                  type="button"
                  onMouseDown={() => submit(s.value)}
                  className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between
                    ${i === selectedIndex ? "bg-linen" : "hover:bg-cream"}
                    ${i > 0 ? "border-t border-stone/5" : ""}
                    transition-colors`}
                >
                  <span className="text-charcoal truncate">{s.value}</span>
                  <span className="text-xs text-stone ml-2 shrink-0">
                    {TYPE_LABELS[s.type] || s.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium
                     hover:bg-ink transition-colors"
        >
          Sök
        </button>
      </div>
    </form>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, results, total } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Sök</h1>

        <SearchInput defaultValue={query} />

        {/* Quick suggestions */}
        {!query && (
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              "Carl Larsson",
              "Rembrandt",
              "Olja på duk",
              "Akvarell",
              "Porträtt",
              "Landskap",
              "1700-tal",
            ].map((s) => (
              <a
                key={s}
                href={`/search?q=${encodeURIComponent(s)}`}
                className="px-3 py-1.5 rounded-full bg-linen text-warm-gray text-xs font-medium
                           hover:bg-stone hover:text-charcoal transition-colors"
              >
                {s}
              </a>
            ))}
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
                      src={
                        r.iiif_url.replace("http://", "https://") +
                        "full/400,/0/default.jpg"
                      }
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
                    <p className="text-xs text-warm-gray mt-1">
                      {parseArtist(r.artists)}
                    </p>
                    {r.dating_text && (
                      <p className="text-xs text-stone mt-0.5">
                        {r.dating_text}
                      </p>
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
