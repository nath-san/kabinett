import { useRef, useCallback, useEffect, useState } from "react";
import type { Route } from "./+types/timeline";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tidslinje — Kabinett" },
    { name: "description", content: "Resa genom Nationalmuseums samling, sekel för sekel." },
  ];
}

export async function loader() {
  const db = getDb();

  // Get year distribution for the sparkline
  const decades = db.prepare(
    `SELECT (year_start / 50) * 50 as half_century, COUNT(*) as count
     FROM artworks
     WHERE year_start IS NOT NULL AND year_start >= 1400 AND year_start <= 1950 AND iiif_url IS NOT NULL
     GROUP BY half_century
     ORDER BY half_century`
  ).all() as any[];

  // Initial artworks: 1600s
  const initial = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text, year_start
     FROM artworks
     WHERE year_start >= 1600 AND year_start <= 1650 AND iiif_url IS NOT NULL
     ORDER BY year_start, RANDOM()
     LIMIT 24`
  ).all() as any[];

  return { decades, initial };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

const ERAS = [
  { year: 1400, label: "Senmedeltid" },
  { year: 1500, label: "Renässans" },
  { year: 1600, label: "Barock" },
  { year: 1650, label: "Senbarock" },
  { year: 1700, label: "Rokoko" },
  { year: 1750, label: "Nyklassicism" },
  { year: 1800, label: "Romantik" },
  { year: 1850, label: "Realism" },
  { year: 1875, label: "Impressionism" },
  { year: 1900, label: "Modernism" },
  { year: 1925, label: "Art Deco" },
];

function getEraLabel(year: number): string {
  let label = "";
  for (const era of ERAS) {
    if (year >= era.year) label = era.label;
  }
  return label;
}

function renderCard(a: any): string {
  return `<a href="/artwork/${a.id}" style="break-inside:avoid;display:block;border-radius:0.75rem;overflow:hidden;background:#F0EBE3;text-decoration:none;margin-bottom:0.75rem">
    <div style="background:${a.dominant_color || '#D4CDC3'};aspect-ratio:3/4;overflow:hidden">
      <img src="${a.iiif_url.replace('http://', 'https://')}full/400,/0/default.jpg"
        alt="${(a.title_sv || '').replace(/"/g, '&quot;')}" width="400" height="533"
        style="width:100%;height:100%;object-fit:cover" loading="lazy" />
    </div>
    <div style="padding:0.5rem">
      <p style="font-size:0.8rem;font-weight:500;color:#3D3831;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
        ${a.title_sv || 'Utan titel'}</p>
      <p style="font-size:0.7rem;color:#8C8478;margin-top:0.125rem">${parseArtist(a.artists)}</p>
      ${a.dating_text ? `<p style="font-size:0.65rem;color:#D4CDC3;margin-top:0.125rem">${a.dating_text}</p>` : ''}
    </div>
  </a>`;
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { decades, initial } = loaderData;
  const [year, setYear] = useState(1600);
  const [span, setSpan] = useState(50);
  const resultsRef = useRef<HTMLDivElement>(null);
  const yearLabelRef = useRef<HTMLDivElement>(null);
  const eraLabelRef = useRef<HTMLParagraphElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const mounted = useRef(false);

  // Render initial server data
  useEffect(() => {
    if (resultsRef.current && initial.length > 0 && !mounted.current) {
      mounted.current = true;
      resultsRef.current.innerHTML = initial.map(renderCard).join("");
    }
  }, [initial]);

  const fetchArtworks = useCallback((y: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const from = y;
      const to = y + span;
      if (eraLabelRef.current) eraLabelRef.current.textContent = getEraLabel(y);
      if (countRef.current) countRef.current.textContent = "Laddar...";
      try {
        const res = await fetch(`/api/timeline?from=${from}&to=${to}&limit=30`);
        const data = await res.json();
        if (countRef.current) countRef.current.textContent = `${data.total} verk`;
        if (resultsRef.current) {
          resultsRef.current.innerHTML = data.results.length > 0
            ? data.results.map(renderCard).join("")
            : '<p style="color:#8C8478;text-align:center;padding:2rem">Inga verk från denna period.</p>';
        }
      } catch {}
    }, 200);
  }, [span]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value);
    setYear(v);
    fetchArtworks(v);
  }, [fetchArtworks]);

  // Sparkline max for scaling
  const maxCount = Math.max(...decades.map((d: any) => d.count), 1);

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Header */}
      <div style={{ padding: "2rem 1rem 0" }}>
        <h1 className="font-serif" style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3D3831" }}>Tidslinje</h1>
        <p style={{ color: "#8C8478", fontSize: "0.875rem", marginTop: "0.25rem" }}>
          Dra reglaget och res genom konsthistorien.
        </p>
      </div>

      {/* Year display */}
      <div style={{ padding: "1.5rem 1rem 0", textAlign: "center" }}>
        <div ref={yearLabelRef} style={{
          fontFamily: '"Playfair Display", Georgia, serif',
          fontSize: "3.5rem",
          fontWeight: 700,
          color: "#3D3831",
          lineHeight: 1,
        }}>
          {year}–{year + span}
        </div>
        <p ref={eraLabelRef} style={{
          fontSize: "1rem",
          color: "#8C8478",
          marginTop: "0.5rem",
          fontStyle: "italic",
        }}>
          {getEraLabel(year)}
        </p>
        <p ref={countRef} style={{ fontSize: "0.75rem", color: "#D4CDC3", marginTop: "0.25rem" }}>
        </p>
      </div>

      {/* Sparkline visualization */}
      <div style={{
        display: "flex",
        alignItems: "flex-end",
        height: "3rem",
        padding: "0 1rem",
        gap: "2px",
        marginTop: "1rem",
      }}>
        {decades.map((d: any) => {
          const height = Math.max(2, (d.count / maxCount) * 40);
          const isActive = d.half_century >= year && d.half_century < year + span;
          return (
            <div key={d.half_century} style={{
              flex: 1,
              height: `${height}px`,
              backgroundColor: isActive ? "#3D3831" : "#E0D9CF",
              borderRadius: "2px",
              transition: "background-color 0.2s, height 0.2s",
            }} title={`${d.half_century}: ${d.count} verk`} />
          );
        })}
      </div>

      {/* Slider */}
      <div style={{ padding: "0.5rem 1rem 0" }}>
        <input
          type="range"
          min={1400}
          max={1920}
          step={10}
          value={year}
          onChange={handleSliderChange}
          style={{
            width: "100%",
            height: "2rem",
            cursor: "pointer",
            accentColor: "#3D3831",
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#D4CDC3" }}>
          <span>1400</span>
          <span>1500</span>
          <span>1600</span>
          <span>1700</span>
          <span>1800</span>
          <span>1900</span>
        </div>
      </div>

      {/* Span selector */}
      <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem", padding: "1rem 1rem 0" }}>
        {[25, 50, 100].map(s => (
          <button
            key={s}
            onClick={() => { setSpan(s); fetchArtworks(year); }}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "999px",
              border: "none",
              backgroundColor: span === s ? "#3D3831" : "#F0EBE3",
              color: span === s ? "#FAF7F2" : "#8C8478",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {s} år
          </button>
        ))}
      </div>

      {/* Results */}
      <div ref={resultsRef} style={{
        columnCount: 2,
        columnGap: "0.75rem",
        padding: "1.5rem 1rem 4rem",
      }} />
    </div>
  );
}
