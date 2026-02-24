import type { Route } from "./+types/timeline";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

function buildIiif(url: string, size: number) {
  return buildImageUrl(url, size);
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
  const parsedDecade = Number.parseInt(url.searchParams.get("decade") || "0", 10);
  const selectedDecade = Number.isFinite(parsedDecade) ? parsedDecade : 0;

  const db = getDb();
  const rangeFrom = 1200;
  const rangeTo = 2000;

  const rows = db
    .prepare(
      `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start
       FROM artworks
       WHERE year_start BETWEEN ? AND ?
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 40
         AND ${sourceFilter()}
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

  const allDecades = Array.from({ length: (rangeTo - rangeFrom) / 10 + 1 }, (_, i) => {
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
           AND LENGTH(iiif_url) > 40
           AND ${sourceFilter()}
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

  // Filter out empty decades
  const decades = allDecades.filter((d) => d.samples.length > 0);

  return { decades, selectedDecade, selectedLabel, selectedWorks };
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { decades, selectedDecade, selectedLabel, selectedWorks } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-[#1C1916] text-[#F5F0E8]">
      <style>{`
        .timeline-scroll {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(180px, 220px);
          gap: 1rem;
          overflow-x: auto;
          padding: 1rem 1.25rem 2rem;
          scroll-behavior: smooth;
          scroll-snap-type: x mandatory;
          scroll-padding-inline: 1.25rem;
          -webkit-overflow-scrolling: touch;
        }
        .timeline-column {
          scroll-snap-align: start;
          background: rgba(255,255,255,0.04);
          border-radius: 1rem;
          padding: 0.5rem 0.75rem 0.75rem;
          display: grid;
          gap: 0.35rem;
          align-content: start;
        }
        /* first/last margin removed — handled by scroll container padding */
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
        @media (min-width: 1024px) {
          .timeline-scroll {
            grid-auto-columns: minmax(220px, 280px);
            padding: 1.75rem 0 2.75rem;
          }
          .timeline-column {
            padding: 0.9rem;
          }
        }
        @media (min-width: 960px) {
          .timeline-grid {
            column-count: 3;
          }
        }
      `}</style>

      <header id="top" className="pt-10 px-5 pb-0 md:max-w-6xl md:mx-auto md:px-6 lg:pt-14 lg:px-8">
        <p className="text-[0.75rem] uppercase tracking-[0.2em] text-[rgba(245,240,232,0.55)]">
          Tidslinje
        </p>
        <h1 className="font-serif text-[2.2rem] mt-[0.4rem]">
          800 år av konst
        </h1>
        <p className="mt-[0.6rem] max-w-[36rem] text-[rgba(245,240,232,0.7)]">
          Från medeltid till modernism, decennium för decennium.
        </p>
      </header>

      <div className="md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <div className="timeline-scroll no-scrollbar" aria-label="Tidslinje decennier">
          {decades.map((decade) => (
            <div key={decade.decade} className="timeline-column">
              <div className="timeline-label font-serif">{decade.decade}</div>
              {decade.samples.map((art) => (
                <a key={art.id} href={`/artwork/${art.id}`} className="timeline-card focus-ring">
                  <div className="aspect-[3/4]" style={{ backgroundColor: art.color }}>
                    <img src={art.imageUrl} alt={`${art.title} — ${art.artist}`} loading="lazy" width={400} height={533} />
                  </div>
                  <div className="timeline-card-meta">
                    <span className="text-[0.8rem] font-semibold">{art.title}</span>
                    <span className="text-[0.7rem] text-[rgba(245,240,232,0.6)]">{art.artist}</span>
                    <span className="text-[0.65rem] text-[rgba(245,240,232,0.45)]">{art.year}</span>
                  </div>
                </a>
              ))}
              <a className="timeline-expand focus-ring" href={`/timeline?decade=${decade.decade}#decade-${decade.decade}`}>
                Visa {decade.count} verk
              </a>
            </div>
          ))}
        </div>
      </div>

      {selectedDecade > 0 && (
        <section id={`decade-${selectedDecade}`} className="pt-4 px-5 pb-16 md:max-w-6xl md:mx-auto md:px-6">
          <div className="flex items-baseline justify-between flex-wrap gap-4">
            <div>
              <h2 className="font-serif text-[1.7rem]">
                {selectedLabel}
              </h2>
              <p className="text-[0.8rem] text-[rgba(245,240,232,0.6)]">
                {selectedWorks.length} verk i urvalet
              </p>
            </div>
            <a
              href="#top"
              className="text-[0.8rem] text-[rgba(245,240,232,0.7)] no-underline focus-ring"
            >
              Tillbaka upp
            </a>
          </div>

          {selectedWorks.length > 0 ? (
            <div className="timeline-grid mt-[1.2rem]">
              {selectedWorks.map((art) => (
                <a
                  key={art.id}
                  href={`/artwork/${art.id}`}
                  className="break-inside-avoid block rounded-[0.8rem] overflow-hidden bg-[#252019] mb-[0.8rem] no-underline text-inherit focus-ring"
                >
                  <div className="aspect-[3/4]" style={{ backgroundColor: art.color }}>
                    <img src={art.imageUrl} alt={`${art.title} — ${art.artist}`} width={400} height={533} loading="lazy" />
                  </div>
                  <div className="p-[0.6rem]">
                    <p className="text-[0.85rem] font-semibold">{art.title}</p>
                    <p className="text-[0.7rem] text-[rgba(245,240,232,0.6)] mt-[0.2rem]">
                      {art.artist}
                    </p>
                    <p className="text-[0.65rem] text-[rgba(245,240,232,0.4)] mt-[0.15rem]">
                      {art.year}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="py-8 text-[rgba(245,240,232,0.55)]">
              Inga verk från denna period.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
