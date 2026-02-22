import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/mood-search";
import { useNavigate } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Stämningssök — Kabinett" },
    { name: "description", content: "Sök efter känsla och stämning i Nationalmuseums samling." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() || "";
  return { query };
}

const EXAMPLES = [
  "Djur",
  "Blommor",
  "Havet",
  "Porträtt",
  "Vinter",
  "Fest och glädje",
];

type ClipResult = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  year: string;
  color: string;
  similarity: number;
};

export default function MoodSearch({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState(loaderData.query);
  const [query, setQuery] = useState(loaderData.query);
  const [results, setResults] = useState<ClipResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEmpty = useMemo(() => query.trim().length === 0, [query]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    fetch(`/api/clip-search?q=${encodeURIComponent(query)}&limit=40`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setResults(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setError("Kunde inte söka just nu.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [query]);

  function submit(next: string) {
    const trimmed = next.trim();
    setInputValue(trimmed);
    setQuery(trimmed);
    navigate(trimmed ? `/mood-search?q=${encodeURIComponent(trimmed)}` : "/mood-search", { replace: true });
  }

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-10 pb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-stone">Stämningssök</p>
        <h1 className="font-serif text-4xl md:text-5xl font-bold text-charcoal mt-3">
          Beskriv känslan du vill se
        </h1>
        <p className="text-warm-gray mt-3 max-w-xl">
          Låt modellen hitta målningar, skulpturer och fotografier som matchar stämningen du beskriver.
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(inputValue);
          }}
        >
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="search"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Beskriv vad du vill se..."
              className="flex-1 px-5 py-4 rounded-2xl bg-linen text-charcoal placeholder:text-stone
                         text-base border border-stone/30 focus:border-charcoal/50 focus:outline-none"
            />
            <button
              type="submit"
              className="px-6 py-4 bg-charcoal text-cream rounded-2xl text-sm font-medium hover:bg-ink"
            >
              Sök stämning
            </button>
          </div>
        </form>

        {isEmpty && (
          <div className="mt-6">
            <p className="text-xs text-warm-gray mb-3">Prova:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="px-3 py-1.5 rounded-full bg-linen text-warm-gray text-sm font-medium
                             hover:bg-stone hover:text-charcoal transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-(--spacing-page) pb-24">
        {loading && (
          <p className="text-sm text-warm-gray">Söker efter stämning...</p>
        )}
        {error && (
          <p className="text-sm text-accent">{error}</p>
        )}

        {!loading && !error && !isEmpty && (
          <p className="text-sm text-warm-gray mb-6">
            {results.length > 0 ? `${results.length} träffar för "${query}"` : `Inga träffar för "${query}"`}
          </p>
        )}

        {results.length > 0 && (
          <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
            {results.map((r) => (
              <a
                key={r.id}
                href={`/artwork/${r.id}`}
                className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group"
              >
                <div
                  style={{ backgroundColor: r.color || "#D4CDC3", aspectRatio: "3/4" }}
                  className="overflow-hidden"
                >
                  <img
                    src={r.imageUrl}
                    alt={r.title}
                    width={400}
                    height={533}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                    {r.title}
                  </p>
                  <p className="text-xs text-warm-gray mt-1">{r.artist}</p>
                  {r.year && <p className="text-xs text-stone mt-0.5">{r.year}</p>}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
