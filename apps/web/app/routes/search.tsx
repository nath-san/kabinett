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
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
       FROM artworks
       WHERE title_sv LIKE ? OR title_en LIKE ? OR artists LIKE ?
          OR technique_material LIKE ? OR category LIKE ?
       LIMIT 60`
    )
    .all(like, like, like, like, like) as any[];

  const total = (
    db.prepare(
      `SELECT COUNT(*) as count FROM artworks
       WHERE title_sv LIKE ? OR title_en LIKE ? OR artists LIKE ?
          OR technique_material LIKE ? OR category LIKE ?`
    ).get(like, like, like, like, like) as any
  ).count;

  return { query, results, total };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, results, total } = loaderData;
  const [input, setInput] = useState(query);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (input.length < 2) { setSuggestions([]); setOpen(false); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(input)}`);
        const data = await r.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch { /* ignore */ }
    }, 200);
    return () => clearTimeout(timer.current);
  }, [input]);

  const go = (val: string) => {
    setOpen(false);
    window.location.href = `/search?q=${encodeURIComponent(val)}`;
  };

  const typeLabels: Record<string, string> = {
    artist: "Konstnär", title: "Verk", category: "Kategori",
  };

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Sök</h1>

        <form action="/search" method="get" className="mt-4">
          <div className="flex gap-2">
            <input
              type="search" name="q" value={input}
              onChange={e => setInput(e.target.value)}
              onFocus={() => suggestions.length > 0 && setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 200)}
              placeholder="Konstnär, titel, teknik..."
              autoFocus autoComplete="off"
              className="flex-1 px-4 py-3 rounded-xl bg-linen text-charcoal placeholder:text-stone
                         text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none"
            />
            <button type="submit"
              className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium hover:bg-ink shrink-0">
              Sök
            </button>
          </div>
        </form>

        {/* Autocomplete */}
        {open && (
          <div className="mt-1 bg-white rounded-xl shadow-lg border border-stone/20 overflow-hidden">
            {suggestions.map((s: any, i: number) => (
              <button key={i} type="button"
                onPointerDown={(e) => { e.preventDefault(); go(s.value); }}
                className={`w-full text-left px-4 py-3 text-sm flex justify-between
                  hover:bg-cream ${i > 0 ? "border-t border-stone/5" : ""}`}>
                <span className="text-charcoal truncate">{s.value}</span>
                <span className="text-xs text-stone ml-2 shrink-0">{typeLabels[s.type] || ""}</span>
              </button>
            ))}
          </div>
        )}

        {/* Quick suggestions - only when no query */}
        {!query && !open && (
          <div className="mt-6">
            <p className="text-xs text-warm-gray mb-3">Prova:</p>
            <div className="flex flex-wrap gap-2">
              {["Carl Larsson","Rembrandt","Olja på duk","Akvarell","Porträtt","Landskap","Skulptur","1700-tal","Guld","Vinter"].map(s => (
                <a key={s} href={`/search?q=${encodeURIComponent(s)}`}
                  className="px-3 py-1.5 rounded-full bg-linen text-warm-gray text-sm font-medium
                             hover:bg-stone hover:text-charcoal transition-colors">{s}</a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {query && (
        <div className="px-(--spacing-page) pb-24">
          <p className="text-sm text-warm-gray mb-6">
            {total > 0 ? `${total} träffar för "${query}"${total > 60 ? " (visar 60)" : ""}` : `Inga träffar för "${query}"`}
          </p>
          {results.length > 0 && (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
              {results.map((r: any) => (
                <a key={r.id} href={`/artwork/${r.id}`}
                  className="block break-inside-avoid rounded-xl overflow-hidden bg-linen group">
                  <div style={{ backgroundColor: r.dominant_color || "#D4CDC3", aspectRatio: "3/4" }}
                    className="overflow-hidden">
                    <img src={r.iiif_url.replace("http://","https://") + "full/400,/0/default.jpg"}
                      alt={r.title_sv || ""} width={400} height={533}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                      {r.title_sv || r.title_en || "Utan titel"}</p>
                    <p className="text-xs text-warm-gray mt-1">{parseArtist(r.artists)}</p>
                    {r.dating_text && <p className="text-xs text-stone mt-0.5">{r.dating_text}</p>}
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
