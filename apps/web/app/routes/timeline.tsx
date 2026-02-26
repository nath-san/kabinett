import type { Route } from "./+types/timeline";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

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
  const source = sourceFilter();
  const rangeFrom = 1200;
  const rangeTo = 2000;

  const countRows = db
    .prepare(
      `SELECT (year_start / 10) * 10 as decade, COUNT(*) as count
       FROM artworks
       WHERE year_start BETWEEN ? AND ?
         AND iiif_url IS NOT NULL
         AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${source.sql}
       GROUP BY decade
       ORDER BY decade ASC`
    )
    .all(rangeFrom, rangeTo, ...source.params) as Array<{ decade: number; count: number }>;

  const sampleRows = db
    .prepare(
      `WITH ranked AS (
         SELECT
           id,
           title_sv,
         title_en,
         iiif_url,
         dominant_color,
         artists,
          dating_text,
          year_start,
          (year_start / 10) * 10 as decade,
          ROW_NUMBER() OVER (PARTITION BY (year_start / 10) * 10 ORDER BY id DESC) as rn
         FROM artworks
         WHERE year_start BETWEEN ? AND ?
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${source.sql}
       )
       SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start, decade
       FROM ranked
       WHERE rn <= 5
       ORDER BY decade ASC, year_start ASC`
    )
    .all(rangeFrom, rangeTo, ...source.params) as Array<{
      id: number;
      title_sv: string | null;
      title_en: string | null;
      iiif_url: string;
      dominant_color: string | null;
      artists: string | null;
      dating_text: string | null;
      year_start: number | null;
      decade: number;
    }>;

  const samplesByDecade = new Map<number, Array<{
    id: number;
    title: string;
    imageUrl: string;
    color: string;
    artist: string;
    year: string | number;
  }>>();

  for (const row of sampleRows) {
    const list = samplesByDecade.get(row.decade) || [];
    list.push({
      id: row.id,
      title: row.title_sv || row.title_en || "Utan titel",
      imageUrl: buildImageUrl(row.iiif_url, 400),
      color: row.dominant_color || "#2B2A27",
      artist: parseArtist(row.artists),
      year: row.dating_text ?? (row.year_start ? String(row.year_start) : ""),
    });
    samplesByDecade.set(row.decade, list);
  }

  const decades = countRows.map((row) => ({
    decade: row.decade,
    label: `${row.decade}s`,
    count: row.count,
    samples: samplesByDecade.get(row.decade) || [],
  }));

  let selectedWorks: Array<{
    id: number;
    title: string;
    imageUrl: string;
    color: string;
    artist: string;
    year: string | number;
  }> = [];
  let selectedLabel = "";
  let selectedTotal = 0;
  if (selectedDecade >= rangeFrom && selectedDecade <= rangeTo) {
    selectedTotal = (
      db.prepare(
        `SELECT COUNT(*) as count
         FROM artworks
         WHERE year_start BETWEEN ? AND ?
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${source.sql}`
      ).get(selectedDecade, selectedDecade + 9, ...source.params) as { count: number }
    ).count;

    const selectedRows = db
      .prepare(
        `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, year_start
         FROM artworks
         WHERE year_start BETWEEN ? AND ?
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${source.sql}
         ORDER BY year_start ASC
         LIMIT 240`
      )
      .all(selectedDecade, selectedDecade + 9, ...source.params) as Array<{
        id: number;
        title_sv: string | null;
        title_en: string | null;
        iiif_url: string;
        dominant_color: string | null;
        artists: string | null;
        dating_text: string | null;
        year_start: number | null;
      }>;

    selectedLabel = `${selectedDecade}–${selectedDecade + 9}`;
    selectedWorks = selectedRows.map((r) => ({
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      imageUrl: buildImageUrl(r.iiif_url, 400),
      color: r.dominant_color || "#2B2A27",
      artist: parseArtist(r.artists),
      year: r.dating_text ?? (r.year_start ? String(r.year_start) : ""),
    }));
  }

  return { decades, selectedDecade, selectedLabel, selectedWorks, selectedTotal };
}

export default function Timeline({ loaderData }: Route.ComponentProps) {
  const { decades, selectedDecade, selectedLabel, selectedWorks, selectedTotal } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-[#1C1916] text-[#F5F0E8]">
      <div id="top" className="md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <h1 className="font-serif text-[2rem] text-[#F5F0E8] px-5 md:px-0 pt-6 md:pt-8 pb-1">Tidslinje</h1>
        <p className="px-5 md:px-0 pb-4 text-[0.9rem] text-[rgba(245,240,232,0.5)]">
          800 år av konst — från medeltid till modernism
        </p>
      </div>

      <div className="md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
        <div className="timeline-scroll no-scrollbar" aria-label="Tidslinje decennier">
          {decades.map((decade) => (
            <div key={decade.decade} className="timeline-column">
              <div className="timeline-label font-serif">{decade.decade}</div>
              {decade.samples.map((art) => (
                <a key={art.id} href={`/artwork/${art.id}`} className="timeline-card focus-ring">
                  <div className="aspect-[3/4]" style={{ backgroundColor: art.color }}>
                    <img
                      src={art.imageUrl}
                      alt={`${art.title} — ${art.artist}`}
                      loading="lazy"
                      width={400}
                      height={533}
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                    />
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
                {selectedTotal > selectedWorks.length
                  ? `${selectedTotal} verk i urvalet · visar första ${selectedWorks.length}`
                  : `${selectedWorks.length} verk i urvalet`}
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
                    <img
                      src={art.imageUrl}
                      alt={`${art.title} — ${art.artist}`}
                      width={400}
                      height={533}
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                    />
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
