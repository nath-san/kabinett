import type { Route } from "./+types/timeline";
import { getDb } from "../lib/db.server";

function buildIiif(url: string, size: number) {
  return url.replace("http://", "https://") + `full/${size},/0/default.jpg`;
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Tidslinje — Kabinett" },
    {
      name: "description",
      content: "800 år av konst, decennium för decennium.",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selectedDecade = parseInt(url.searchParams.get("decade") || "0");

  const db = getDb();
  const rangeFrom = 1200;
  const rangeTo = 2000;

  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start
       FROM artworks
       WHERE year_start BETWEEN ? AND ?
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 90
       ORDER BY year_start ASC`
    )
    .all(rangeFrom, rangeTo) as any[];

  const byDecade = new Map<number, any[]>();
  const counts = new Map<number, number>();

  for (const row of rows) {
    if (!row.year_start) continue;
    const decade = Math.floor(row.year_start / 10) * 10;
    if (decade < rangeFrom || decade > rangeTo) continue;

    counts.set(decade, (counts.get(decade) || 0) + 1);
    const list = byDecade.get(decade) || [];
    if (list.length < 5) {
      list.push(row);
      byDecade.set(decade, list);
    }
  }

  const decades = Array.from({ length: (rangeTo - rangeFrom) / 10 + 1 }, (_, i) => {
    const decade = rangeFrom + i * 10;
    return {
      decade,
      label: `${decade}s`,
      count: counts.get(decade) || 0,
      samples: (byDecade.get(decade) || []).map((r) => ({
        id: r.id,
        title: r.title_sv || r.title_en || "Utan titel",
        imageUrl: buildIiif(r.iiif_url, 400),
        color: r.dominant_color || "#2B2A27",
        artist: parseArtist(r.artists),
        year: r.dating_text || r.year_start,
      })),
    };
  });

  let selectedWorks: any[] = [];
  let selectedLabel = "";
  if (selectedDecade >= rangeFrom && selectedDecade <= rangeTo) {
    const selectedRows = db
      .prepare(
        `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start
         FROM artworks
         WHERE year_start BETWEEN ? AND ?
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 90
         ORDER BY year_start ASC`
      )
      .all(selectedDecade, selectedDecade + 9) as any[];

    selectedLabel = `${selectedDecade}–${selectedDecade + 9}`;
    selectedWorks = selectedRows.map((r) => ({
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      imageUrl: buildIiif(r.iiif_url, 400),
      color: r.dominant_color || "#2B2A27",
      artist: parseArtist(r.artists),
      year: r.dating_text || r.year_start,
    }));
  }

  return { decades, selectedDecade, selectedLabel, selectedWorks };
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { decades, selectedDecade, selectedLabel, selectedWorks } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#1C1916", color: "#F5F0E8" }}>
      <style>{`
        .timeline-scroll {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(180px, 220px);
          gap: 1rem;
          overflow-x: auto;
          padding: 1rem 0 2rem;
          scroll-behavior: smooth;
          scroll-snap-type: x mandatory;
          scroll-padding-inline: 1.25rem;
          -webkit-overflow-scrolling: touch;
        }
        .timeline-column {
          scroll-snap-align: start;
          background: rgba(255,255,255,0.04);
          border-radius: 1rem;
          padding: 0.75rem;
          display: grid;
          gap: 0.6rem;
        }
        .timeline-column:first-child {
          margin-left: 1.25rem;
        }
        .timeline-column:last-child {
          margin-right: 1.25rem;
        }
        .timeline-label {
          position: sticky;
          top: 0;
          padding: 0.35rem 0.25rem;
          font-size: 1rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          background: #1C1916;
          z-index: 2;
        }
        .timeline-card {
          border-radius: 0.7rem;
          overflow: hidden;
          background: #252019;
          text-decoration: none;
          color: inherit;
          display: grid;
        }
        .timeline-card img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .timeline-card-meta {
          padding: 0.5rem 0.6rem 0.6rem;
          display: grid;
          gap: 0.2rem;
        }
        .timeline-expand {
          margin-top: 0.4rem;
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.75rem;
          color: rgba(245,240,232,0.75);
          text-decoration: none;
        }
        .timeline-grid {
          column-count: 2;
          column-gap: 0.75rem;
        }
        @media (min-width: 960px) {
          .timeline-grid {
            column-count: 3;
          }
        }
      `}</style>

      <header id="top" style={{ padding: "2.5rem 1.25rem 0" }}>
        <p style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.2em", color: "rgba(245,240,232,0.55)" }}>
          Tidslinje
        </p>
        <h1 className="font-serif" style={{ fontSize: "2.2rem", marginTop: "0.4rem" }}>
          800 år av konst
        </h1>
        <p style={{ marginTop: "0.6rem", maxWidth: "36rem", color: "rgba(245,240,232,0.7)" }}>
          Från medeltid till modernism, decennium för decennium.
        </p>
      </header>

      <div className="timeline-scroll no-scrollbar" aria-label="Tidslinje decennier">
        {decades.map((decade) => (
          <div key={decade.decade} className="timeline-column">
            <div className="timeline-label font-serif">{decade.decade}</div>
            {decade.samples.length === 0 && (
              <div style={{ fontSize: "0.75rem", color: "rgba(245,240,232,0.45)" }}>
                Inga verk hittades
              </div>
            )}
            {decade.samples.map((art) => (
              <a key={art.id} href={`/artwork/${art.id}`} className="timeline-card">
                <div style={{ backgroundColor: art.color, aspectRatio: "3/4" }}>
                  <img src={art.imageUrl} alt={art.title} loading="lazy" width={400} height={533} />
                </div>
                <div className="timeline-card-meta">
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>{art.title}</span>
                  <span style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)" }}>{art.artist}</span>
                  <span style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.45)" }}>{art.year}</span>
                </div>
              </a>
            ))}
            <a className="timeline-expand" href={`/timeline?decade=${decade.decade}#decade-${decade.decade}`}>
              Visa {decade.count} verk
            </a>
          </div>
        ))}
      </div>

      {selectedDecade > 0 && (
        <section id={`decade-${selectedDecade}`} style={{ padding: "1rem 1.25rem 4rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h2 className="font-serif" style={{ fontSize: "1.7rem" }}>
                {selectedLabel}
              </h2>
              <p style={{ color: "rgba(245,240,232,0.6)", fontSize: "0.8rem" }}>
                {selectedWorks.length} verk i urvalet
              </p>
            </div>
            <a
              href="#top"
              style={{ fontSize: "0.8rem", color: "rgba(245,240,232,0.7)", textDecoration: "none" }}
            >
              Tillbaka upp
            </a>
          </div>

          {selectedWorks.length > 0 ? (
            <div className="timeline-grid" style={{ marginTop: "1.2rem" }}>
              {selectedWorks.map((art) => (
                <a
                  key={art.id}
                  href={`/artwork/${art.id}`}
                  style={{
                    breakInside: "avoid",
                    display: "block",
                    borderRadius: "0.8rem",
                    overflow: "hidden",
                    backgroundColor: "#252019",
                    marginBottom: "0.8rem",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{ backgroundColor: art.color, aspectRatio: "3/4" }}>
                    <img src={art.imageUrl} alt={art.title} width={400} height={533} loading="lazy" />
                  </div>
                  <div style={{ padding: "0.6rem" }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 600 }}>{art.title}</p>
                    <p style={{ fontSize: "0.7rem", color: "rgba(245,240,232,0.6)", marginTop: "0.2rem" }}>
                      {art.artist}
                    </p>
                    <p style={{ fontSize: "0.65rem", color: "rgba(245,240,232,0.4)", marginTop: "0.15rem" }}>
                      {art.year}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p style={{ padding: "2rem 0", color: "rgba(245,240,232,0.55)" }}>
              Inga verk från denna period.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
