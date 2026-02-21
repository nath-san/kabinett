import type { Route } from "./+types/timeline";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tidslinje — Kabinett" },
    { name: "description", content: "Resa genom Nationalmuseums samling, sekel för sekel." },
  ];
}

const ERAS = [
  { from: 1400, to: 1499, label: "1400-tal", era: "Senmedeltid" },
  { from: 1500, to: 1599, label: "1500-tal", era: "Renässans" },
  { from: 1600, to: 1649, label: "1600–1649", era: "Tidig barock" },
  { from: 1650, to: 1699, label: "1650–1699", era: "Senbarock" },
  { from: 1700, to: 1749, label: "1700–1749", era: "Rokoko" },
  { from: 1750, to: 1799, label: "1750–1799", era: "Nyklassicism" },
  { from: 1800, to: 1849, label: "1800–1849", era: "Romantik" },
  { from: 1850, to: 1874, label: "1850–1874", era: "Realism" },
  { from: 1875, to: 1899, label: "1875–1899", era: "Impressionism" },
  { from: 1900, to: 1924, label: "1900–1924", era: "Modernism" },
  { from: 1925, to: 1960, label: "1925–1960", era: "Art Deco / Modernism" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selectedFrom = parseInt(url.searchParams.get("from") || "0");
  const selectedTo = parseInt(url.searchParams.get("to") || "0");
  const db = getDb();

  // Count per era
  const eraCounts = ERAS.map(e => {
    const count = (db.prepare(
      `SELECT COUNT(*) as c FROM artworks
       WHERE year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL`
    ).get(e.from, e.to) as any).c;
    return { ...e, count };
  });

  const maxCount = Math.max(...eraCounts.map(e => e.count), 1);

  // Artworks for selected era
  let artworks: any[] = [];
  let selectedLabel = "";
  let selectedEra = "";
  let total = 0;
  if (selectedFrom > 0) {
    const era = ERAS.find(e => e.from === selectedFrom);
    if (era) {
      selectedLabel = era.label;
      selectedEra = era.era;
      artworks = db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text, year_start
         FROM artworks
         WHERE year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
         ORDER BY RANDOM()
         LIMIT 30`
      ).all(era.from, era.to) as any[];
      total = (db.prepare(
        `SELECT COUNT(*) as c FROM artworks
         WHERE year_start >= ? AND year_start <= ? AND iiif_url IS NOT NULL`
      ).get(era.from, era.to) as any).c;
    }
  }

  return { eraCounts, maxCount, artworks, selectedFrom, selectedLabel, selectedEra, total };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { eraCounts, maxCount, artworks, selectedFrom, selectedLabel, selectedEra, total } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      <div style={{ padding: "2rem 1rem 0.5rem" }}>
        <h1 className="font-serif" style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3D3831" }}>Tidslinje</h1>
        <p style={{ color: "#8C8478", fontSize: "0.875rem", marginTop: "0.25rem" }}>
          Res genom konsthistorien. Välj en epok.
        </p>
      </div>

      {/* Era cards */}
      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {eraCounts.map((e) => {
          const isActive = e.from === selectedFrom;
          const barWidth = Math.max(8, (e.count / maxCount) * 100);
          return (
            <a
              key={e.from}
              href={"/timeline?from=" + e.from + "&to=" + e.to + "#results"}
              style={{
                display: "block",
                padding: "0.875rem 1rem",
                borderRadius: "0.75rem",
                backgroundColor: isActive ? "#3D3831" : "#fff",
                textDecoration: "none",
                transition: "background-color 0.2s",
                boxShadow: isActive ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span className="font-serif" style={{
                    fontSize: "1rem", fontWeight: 600,
                    color: isActive ? "#fff" : "#3D3831",
                  }}>
                    {e.label}
                  </span>
                  <span style={{
                    fontSize: "0.75rem",
                    color: isActive ? "rgba(255,255,255,0.5)" : "#8C8478",
                    marginLeft: "0.5rem",
                  }}>
                    {e.era}
                  </span>
                </div>
                <span style={{
                  fontSize: "0.75rem",
                  color: isActive ? "rgba(255,255,255,0.5)" : "#D4CDC3",
                }}>
                  {e.count.toLocaleString("sv-SE")}
                </span>
              </div>
              {/* Bar */}
              <div style={{
                marginTop: "0.5rem",
                height: "3px",
                borderRadius: "2px",
                backgroundColor: isActive ? "rgba(255,255,255,0.15)" : "#F0EBE3",
                overflow: "hidden",
              }}>
                <div style={{
                  width: barWidth + "%",
                  height: "100%",
                  borderRadius: "2px",
                  backgroundColor: isActive ? "rgba(255,255,255,0.6)" : "#D4CDC3",
                }} />
              </div>
            </a>
          );
        })}
      </div>

      {/* Results */}
      {selectedFrom > 0 && (
        <div id="results" style={{ padding: "1.5rem 1rem 4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
            <div>
              <h2 className="font-serif" style={{ fontSize: "1.5rem", fontWeight: 600, color: "#3D3831" }}>
                {selectedLabel}
              </h2>
              <p style={{ fontSize: "0.75rem", color: "#8C8478", marginTop: "0.125rem" }}>
                {selectedEra} · {total.toLocaleString("sv-SE")} verk
              </p>
            </div>
            <a href={"/timeline?from=" + selectedFrom + "&to=" + (ERAS.find(e => e.from === selectedFrom)?.to || selectedFrom + 50) + "#results"}
              style={{ fontSize: "0.875rem", color: "#8C8478", textDecoration: "none" }}>
              ✦ Slumpa
            </a>
          </div>

          {artworks.length > 0 ? (
            <div style={{ columnCount: 2, columnGap: "0.75rem" }}>
              {artworks.map((a: any) => (
                <a key={a.id} href={"/artwork/" + a.id}
                  style={{
                    breakInside: "avoid", display: "block", borderRadius: "0.75rem",
                    overflow: "hidden", backgroundColor: "#F0EBE3", marginBottom: "0.75rem",
                    textDecoration: "none",
                  }}>
                  <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", aspectRatio: "3/4", overflow: "hidden" }}>
                    <img src={a.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                      alt={a.title_sv || ""} width={400} height={533}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                  <div style={{ padding: "0.5rem" }}>
                    <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {a.title_sv || "Utan titel"}</p>
                    <p style={{ fontSize: "0.7rem", color: "#8C8478", marginTop: "0.125rem" }}>{parseArtist(a.artists)}</p>
                    {a.dating_text && <p style={{ fontSize: "0.65rem", color: "#D4CDC3", marginTop: "0.125rem" }}>{a.dating_text}</p>}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p style={{ color: "#8C8478", textAlign: "center", padding: "2rem" }}>Inga verk från denna period.</p>
          )}
        </div>
      )}
    </div>
  );
}
