import { useEffect, useMemo, useState } from "react";
import type { Route } from "./+types/compare";
import { getDb } from "../lib/db.server";

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

function formatDimensions(json: string | null): string {
  if (!json) return "";
  try {
    const parsed = JSON.parse(json);
    const candidate = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!candidate) return "";
    if (candidate.dimension_text) return candidate.dimension_text;
    const width = candidate.width || candidate.bredd || candidate.W;
    const height = candidate.height || candidate.hojd || candidate.H;
    if (width && height) return `${width} × ${height}`;
  } catch {}
  return "";
}

function mapArtwork(row: any) {
  if (!row) return null;
  const iiif = row.iiif_url.replace("http://", "https://");
  return {
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    imageUrl: iiif + "full/800,/0/default.jpg",
    color: row.dominant_color || "#D4CDC3",
    year: row.dating_text || row.year_start || "",
    yearStart: row.year_start || null,
    technique: row.technique_material || "",
    dimensions: formatDimensions(row.dimensions_json),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const aId = url.searchParams.get("a");
  const bId = url.searchParams.get("b");

  const db = getDb();
  const ids = [aId, bId]
    .map((v) => (v ? parseInt(v, 10) : 0))
    .filter((v) => Number.isFinite(v) && v > 0);

  let a = null;
  let b = null;

  if (ids.length > 0) {
    const rows = db
      .prepare(
        `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, technique_material, dimensions_json
         FROM artworks
         WHERE id IN (${ids.map(() => "?").join(",")})`
      )
      .all(...ids) as any[];

    const byId = new Map(rows.map((r) => [r.id, r]));
    if (aId) a = mapArtwork(byId.get(parseInt(aId, 10)));
    if (bId) b = mapArtwork(byId.get(parseInt(bId, 10)));
  }

  return { a, b };
}

type Artwork = NonNullable<Awaited<ReturnType<typeof loader>>["a"]>;

type SearchResult = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  heroUrl: string;
  color: string;
  year: string;
  yearStart: number | null;
  technique: string;
  dimensions: string;
};

export default function Compare({ loaderData }: Route.ComponentProps) {
  const [selectedA, setSelectedA] = useState<Artwork | null>(loaderData.a || null);
  const [selectedB, setSelectedB] = useState<Artwork | null>(loaderData.b || null);
  const [queryA, setQueryA] = useState("");
  const [queryB, setQueryB] = useState("");
  const [resultsA, setResultsA] = useState<SearchResult[]>([]);
  const [resultsB, setResultsB] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!queryA.trim()) {
      setResultsA([]);
      return;
    }
    let active = true;
    fetch(`/api/compare-search?q=${encodeURIComponent(queryA)}&limit=8`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setResultsA(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setResultsA([]);
      });
    return () => {
      active = false;
    };
  }, [queryA]);

  useEffect(() => {
    if (!queryB.trim()) {
      setResultsB([]);
      return;
    }
    let active = true;
    fetch(`/api/compare-search?q=${encodeURIComponent(queryB)}&limit=8`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setResultsB(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!active) return;
        setResultsB([]);
      });
    return () => {
      active = false;
    };
  }, [queryB]);

  const differences = useMemo(() => {
    if (!selectedA || !selectedB) return { year: false, technique: false, dimensions: false };
    return {
      year: Boolean(selectedA.year && selectedB.year && selectedA.year !== selectedB.year),
      technique:
        Boolean(selectedA.technique && selectedB.technique && selectedA.technique !== selectedB.technique),
      dimensions:
        Boolean(selectedA.dimensions && selectedB.dimensions && selectedA.dimensions !== selectedB.dimensions),
    };
  }, [selectedA, selectedB]);

  function pickResult(result: SearchResult, slot: "a" | "b") {
    const mapped: Artwork = {
      id: result.id,
      title: result.title,
      artist: result.artist,
      imageUrl: result.heroUrl,
      color: result.color,
      year: result.year,
      yearStart: result.yearStart,
      technique: result.technique,
      dimensions: result.dimensions,
    };

    if (slot === "a") {
      setSelectedA(mapped);
      setQueryA("");
      setResultsA([]);
    } else {
      setSelectedB(mapped);
      setQueryB("");
      setResultsB([]);
    }

    const url = new URL(window.location.href);
    url.searchParams.set(slot, String(result.id));
    window.history.replaceState({}, "", url.toString());
  }

  async function randomize() {
    setLoading(true);
    try {
      const res = await fetch("/api/compare-random");
      const data = await res.json();
      if (data?.a) setSelectedA(data.a);
      if (data?.b) setSelectedB(data.b);
      const url = new URL(window.location.href);
      if (data?.a?.id) url.searchParams.set("a", String(data.a.id));
      if (data?.b?.id) url.searchParams.set("b", String(data.b.id));
      window.history.replaceState({}, "", url.toString());
    } finally {
      setLoading(false);
    }
  }

  const cards = [
    { slot: "a" as const, selected: selectedA, query: queryA, setQuery: setQueryA, results: resultsA },
    { slot: "b" as const, selected: selectedB, query: queryB, setQuery: setQueryB, results: resultsB },
  ];

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-stone">Jämför</p>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mt-3">
          <div>
            <h1 className="font-serif text-4xl md:text-5xl text-charcoal">Två verk, en dialog</h1>
            <p className="text-warm-gray mt-2 max-w-xl">
              Välj två konstverk och se skillnader i teknik, tid och format.
            </p>
          </div>
          <button
            type="button"
            onClick={randomize}
            className="px-5 py-3 rounded-full bg-charcoal text-cream text-sm font-medium hover:bg-ink"
          >
            {loading ? "Slumpar..." : "Slumpa"}
          </button>
        </div>
      </div>

      <div className="px-(--spacing-page) pb-24">
        <div className="md:grid md:grid-cols-2 md:gap-6">
          <div className="flex md:hidden gap-4 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-4">
            {cards.map((card) => (
              <div key={card.slot} className="snap-center min-w-[85vw]">
                <CompareSlot
                  slot={card.slot}
                  selected={card.selected}
                  query={card.query}
                  setQuery={card.setQuery}
                  results={card.results}
                  onPick={pickResult}
                  differences={differences}
                />
              </div>
            ))}
          </div>

          <div className="hidden md:grid md:grid-cols-2 md:gap-6">
            {cards.map((card) => (
              <CompareSlot
                key={card.slot}
                slot={card.slot}
                selected={card.selected}
                query={card.query}
                setQuery={card.setQuery}
                results={card.results}
                onPick={pickResult}
                differences={differences}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type SlotProps = {
  slot: "a" | "b";
  selected: Artwork | null;
  query: string;
  setQuery: (value: string) => void;
  results: SearchResult[];
  onPick: (result: SearchResult, slot: "a" | "b") => void;
  differences: { year: boolean; technique: boolean; dimensions: boolean };
};

function CompareSlot({ slot, selected, query, setQuery, results, onPick, differences }: SlotProps) {
  return (
    <div className="bg-linen rounded-3xl p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-2xl text-charcoal">{slot === "a" ? "Verk A" : "Verk B"}</h2>
        <span className="text-xs uppercase tracking-[0.2em] text-stone">{slot === "a" ? "A" : "B"}</span>
      </div>

      <div className="mt-4">
        <label className="text-xs text-stone">Sök konstverk</label>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titel eller konstnär"
          className="mt-2 w-full px-4 py-3 rounded-2xl bg-cream text-charcoal placeholder:text-stone border border-stone/30 focus:border-charcoal/50 focus:outline-none"
        />
      </div>

      {results.length > 0 && (
        <div className="mt-3 grid gap-2">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r, slot)}
              className="flex items-center gap-3 p-2 rounded-2xl bg-cream hover:bg-white text-left"
            >
              <div className="w-12 h-16 rounded-xl overflow-hidden" style={{ backgroundColor: r.color }}>
                <img src={r.imageUrl} alt={r.title} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div>
                <p className="text-sm font-medium text-charcoal line-clamp-1">{r.title}</p>
                <p className="text-xs text-warm-gray">{r.artist}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div className="mt-4">
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: selected.color }}>
            <img src={selected.imageUrl} alt={selected.title} className="w-full h-[320px] object-cover" />
          </div>
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-charcoal">{selected.title}</h3>
            <p className="text-sm text-warm-gray">{selected.artist}</p>
            <div className="mt-4 grid gap-2 text-sm">
              <MetadataRow label="År" value={selected.year} highlight={differences.year} />
              <MetadataRow label="Teknik" value={selected.technique} highlight={differences.technique} />
              <MetadataRow label="Mått" value={selected.dimensions} highlight={differences.dimensions} />
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 text-sm text-warm-gray">Välj ett verk för att börja jämföra.</div>
      )}
    </div>
  );
}

type MetadataRowProps = {
  label: string;
  value: string | number | null;
  highlight: boolean;
};

function MetadataRow({ label, value, highlight }: MetadataRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs uppercase tracking-[0.15em] text-stone">{label}</span>
      <span className={`text-right ${highlight ? "text-accent font-semibold" : "text-charcoal"}`}>
        {value || "–"}
      </span>
    </div>
  );
}
