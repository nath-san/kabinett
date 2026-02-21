import { useRef, useCallback } from "react";
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
  let results: any[];
  let total: number;
  try {
    const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(" ");
    results = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
       FROM artworks_fts f JOIN artworks a ON a.id = f.rowid
       WHERE artworks_fts MATCH ? ORDER BY rank LIMIT 60`
    ).all(ftsQuery);
    total = (db.prepare(
      `SELECT COUNT(*) as count FROM artworks_fts WHERE artworks_fts MATCH ?`
    ).get(ftsQuery) as any).count;
  } catch {
    const like = `%${query}%`;
    results = db.prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
       FROM artworks WHERE title_sv LIKE ? OR artists LIKE ? LIMIT 60`
    ).all(like, like);
    total = results.length;
  }
  return { query, results, total };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

const TYPE_LABELS: Record<string, string> = {
  artist: "Konstnär", title: "Verk", category: "Kategori",
};

function AutocompleteSearch({ defaultValue }: { defaultValue: string }) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const fetchSuggestions = useCallback((val: string) => {
    clearTimeout(timer.current);
    const dropdown = dropdownRef.current;
    if (!dropdown) return;

    if (val.length < 2) {
      dropdown.innerHTML = "";
      dropdown.style.display = "none";
      return;
    }

    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/autocomplete?q=${encodeURIComponent(val)}`);
        const data = await r.json();
        if (data.length === 0) {
          dropdown.style.display = "none";
          dropdown.innerHTML = "";
          return;
        }
        dropdown.style.display = "block";
        dropdown.innerHTML = data.map((s: any, i: number) =>
          `<div class="ac-item px-4 py-3 text-sm flex justify-between cursor-pointer hover:bg-cream ${i > 0 ? 'border-t border-stone/5' : ''}" data-value="${s.value.replace(/"/g, '&quot;')}">
            <span class="text-charcoal truncate">${s.value}</span>
            <span class="text-xs text-stone ml-2 shrink-0">${TYPE_LABELS[s.type] || ""}</span>
          </div>`
        ).join("");
      } catch {
        dropdown.style.display = "none";
      }
    }, 200);
  }, []);

  const handleDropdownClick = useCallback((e: React.PointerEvent) => {
    const item = (e.target as HTMLElement).closest(".ac-item") as HTMLElement;
    if (!item) return;
    e.preventDefault();
    const val = item.dataset.value || "";
    const dropdown = dropdownRef.current;
    if (dropdown) { dropdown.style.display = "none"; dropdown.innerHTML = ""; }
    if (formRef.current) {
      const inp = formRef.current.querySelector("input[name=q]") as HTMLInputElement;
      if (inp) inp.value = val;
      formRef.current.submit();
    }
  }, []);

  return (
    <>
      <form ref={formRef} action="/search" method="get" className="mt-4">
        <div className="flex gap-2">
          <input
            type="search" name="q"
            defaultValue={defaultValue}
            onInput={(e) => fetchSuggestions((e.target as HTMLInputElement).value)}
            placeholder="Konstnär, titel, teknik..."
            autoComplete="off"
            className="flex-1 px-4 py-3 rounded-xl bg-linen text-charcoal placeholder:text-stone
                       text-sm border border-stone/20 focus:border-charcoal/40 focus:outline-none"
          />
          <button type="submit"
            className="px-5 py-3 bg-charcoal text-cream rounded-xl text-sm font-medium hover:bg-ink shrink-0">
            Sök
          </button>
        </div>
      </form>
      <div
        ref={dropdownRef}
        onPointerDown={handleDropdownClick}
        style={{ display: "none" }}
        className="mt-1 bg-white rounded-xl shadow-lg border border-stone/20 overflow-hidden"
      />
    </>
  );
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, results, total } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-4">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Sök</h1>
        <AutocompleteSearch defaultValue={query} />

        {!query && (
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

      {query && (
        <div className="px-(--spacing-page) pb-24">
          <p className="text-sm text-warm-gray mb-6">
            {total > 0 ? `${total} träffar för "${query}"${total > 60 ? " (visar 60)" : ""}` : `Inga träffar för "${query}"`}
          </p>
          {results.length > 0 && (
            <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
              {results.map((r: any) => (
                <a key={r.id} href={`/artwork/${r.id}`}
                  className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group">
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
