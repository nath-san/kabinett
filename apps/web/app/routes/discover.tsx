import type { Route } from "./+types/discover";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";
import { getSiteStats } from "../lib/stats.server";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

export function meta() {
  return [
    { title: "Upptäck — Kabinett" },
    { name: "description", content: "Utforska hundratusentals verk från Sveriges museer." },
  ];
}

type Collection = {
  title: string;
  subtitle: string;
  query?: string;
  imageIds?: number[];
  imageUrl?: string;
  imageTitle?: string;
  imageArtist?: string;
  color?: string;
  focalX?: number | null;
  focalY?: number | null;
};

type TopArtist = {
  name: string;
  count: number;
  imageUrl?: string;
  imageTitle: string;
  imageArtist: string;
  color: string;
  focalX?: number | null;
  focalY?: number | null;
};

type MuseumSummary = {
  id: string;
  name: string;
  count: number;
};

const COLLECTIONS: Collection[] = [
  { title: "Mörkt & dramatiskt", subtitle: "Skuggor och spänning", query: "mörker natt", imageIds: [24664, 20450, 15634] },
  { title: "Stormigt hav", subtitle: "Vågor och vind", query: "storm hav", imageIds: [18217, 20356, 17939] },
  { title: "Blommor", subtitle: "Natur i närbild", query: "blommor", imageIds: [-166319052559119, -179937114869368, 17457] },
  { title: "Hästar", subtitle: "Ädla djur genom tiderna", query: "häst", imageIds: [14802, -247833644771404, -69141112380166] },
  { title: "Porträtt", subtitle: "Ansikten genom tiderna", query: "porträtt ansikte", imageIds: [216852, 16308, 17096] },
  { title: "Landskap", subtitle: "Skog, berg och dal", query: "landskap skog", imageIds: [-202485135028962, -62777224500383, 17076] },
  { title: "Hattar", subtitle: "Huvudbonader genom historien", query: "hatt", imageIds: [-253468788019903, -256891764421414, -61674516346084] },
  { title: "Mytologi", subtitle: "Gudar och hjältar", query: "gud gudinna", imageIds: [71395, 177136, 17313] },
  { title: "Telefoner", subtitle: "Från vev till knappar", query: "telefon", imageIds: [-278306166813061, -62193254264396, -223649635814047] },
  { title: "Skepp & båtar", subtitle: "Till havs", query: "skepp båt fartyg", imageIds: [-139485473585279, -448520122533, -103198960131251] },
  { title: "Kaniner", subtitle: "Lurviga vänner", query: "kanin hare", imageIds: [-62346619720310, -132331838014998, -101957079536391] },
  { title: "Musik", subtitle: "Instrument och melodier", query: "musik instrument gitarr", imageIds: [-230629938287298, -87109461851263, -86518388012200] },
  { title: "Katter", subtitle: "Mjuka tassar", query: "katt", imageIds: [-189194491314296, 35597, -239926311302559] },
  { title: "Mat & frukt", subtitle: "Gastronomi i konsten", query: "mat frukt", imageIds: [-253717850327201, -5907047110556, -111000855806884] },
  { title: "Arkitektur", subtitle: "Slott och kyrkor", query: "slott kyrka", imageIds: [-129853437095252, -98579182221784, -45980371825152] },
  { title: "Barn", subtitle: "Barndomens porträtt", query: "barn", imageIds: [17996, 16051, 17093] },
];

let discoverCache: { expiresAt: number; data: any } | null = null;
const DISCOVER_CACHE_TTL_MS = 60 * 1000;

export async function loader() {
  const now = Date.now();
  const randomSeed = Math.floor(now / 60_000);
  if (discoverCache && discoverCache.expiresAt > now) {
    return discoverCache.data;
  }

  const db = getDb();
  const source = sourceFilter();
  const sourceA = sourceFilter("a");

  // Collection images
  const collections = COLLECTIONS.map((c, index) => {
    try {
      let row: any;
      if (c.imageIds?.length) {
        const pickedId = c.imageIds[Math.floor((randomSeed + index) % c.imageIds.length)];
        row = db.prepare(
          `SELECT iiif_url, dominant_color, title_sv, title_en, artists, focal_x, focal_y FROM artworks WHERE id = ?`
        ).get(pickedId);
      }
      if (!row) {
        const searchText = c.query || c.title;
        const terms = searchText.split(" ").join(" OR ");
        const rows = db.prepare(`
          SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists, a.focal_x, a.focal_y FROM artworks_fts
          JOIN artworks a ON a.id = artworks_fts.rowid
          WHERE artworks_fts MATCH ?
            AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)
            AND (a.category LIKE '%Måleri%' OR a.category LIKE '%Teckningar%' OR a.category LIKE '%Skulptur%')
            AND ${sourceA.sql}
          ORDER BY ((a.rowid * 1103515245 + ?) & 2147483647)
          LIMIT 1
        `).all(terms, ...sourceA.params, randomSeed + index) as any[];
        row = rows[0];
      }
      return {
        ...c,
        imageUrl: row?.iiif_url ? buildImageUrl(row.iiif_url, 400) : undefined,
        imageTitle: row?.title_sv || row?.title_en || "Utan titel",
        imageArtist: parseArtist(row?.artists || null),
        color: row?.dominant_color || "#2B2A27",
        focalX: row?.focal_x ?? null,
        focalY: row?.focal_y ?? null,
      };
    } catch {
      return { ...c, color: "#2B2A27" };
    }
  });

  // Quiz image
  const quizImg = db.prepare(`
    SELECT iiif_url, title_sv, title_en, artists, focal_x, focal_y FROM artworks
    WHERE iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
      AND category LIKE '%Måleri%'
      AND id NOT IN (SELECT artwork_id FROM broken_images)
      AND ${source.sql}
    ORDER BY ((rowid * 1103515245 + ?) & 2147483647)
    LIMIT 1
  `).get(...source.params, randomSeed + 100) as any;

  // Top artists (excluding factories like Gustavsberg)
  const artistsWithImages = db.prepare(`
    WITH top_artists AS (
      SELECT json_extract(artists, '$[0].name') as name, COUNT(*) as cnt
      FROM artworks
      WHERE artists IS NOT NULL
        AND json_extract(artists, '$[0].name') IS NOT NULL
        AND json_extract(artists, '$[0].name') NOT LIKE '%känd%'
        AND json_extract(artists, '$[0].name') NOT LIKE '%nonym%'
        AND json_extract(artists, '$[0].name') NOT IN ('Gustavsberg')
        AND category NOT LIKE '%Keramik%'
        AND category NOT LIKE '%Porslin%'
        AND category NOT LIKE '%Glas%'
        AND category NOT LIKE '%Formgivning%'
        AND iiif_url IS NOT NULL
        AND LENGTH(iiif_url) > 40
        AND ${source.sql}
      GROUP BY name
      HAVING cnt >= 20
      ORDER BY cnt DESC
      LIMIT 12
    ), ranked AS (
      SELECT
        ta.name,
        ta.cnt,
        a.iiif_url,
        a.dominant_color,
        a.title_sv,
        a.title_en,
        a.artists,
        a.focal_x,
        a.focal_y,
        ROW_NUMBER() OVER (
          PARTITION BY ta.name
          ORDER BY ((a.rowid * 1103515245 + ?) & 2147483647)
        ) AS rn
      FROM top_artists ta
      JOIN artworks a ON json_extract(a.artists, '$[0].name') = ta.name
      WHERE a.iiif_url IS NOT NULL
        AND LENGTH(a.iiif_url) > 40
        AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        AND ${sourceA.sql}
    )
    SELECT name, cnt, iiif_url, dominant_color, title_sv, title_en, artists, focal_x, focal_y
    FROM ranked
    WHERE rn = 1
    ORDER BY cnt DESC
  `).all(...source.params, randomSeed + 200, ...sourceA.params) as Array<{
    name: string;
    cnt: number;
    iiif_url: string | null;
    dominant_color: string | null;
    title_sv: string | null;
    title_en: string | null;
    artists: string | null;
    focal_x: number | null;
    focal_y: number | null;
  }>;

  const mappedArtists: TopArtist[] = artistsWithImages.map((artistRow) => ({
    name: artistRow.name,
    count: artistRow.cnt,
    imageUrl: artistRow.iiif_url ? buildImageUrl(artistRow.iiif_url, 300) : undefined,
    imageTitle: artistRow.title_sv || artistRow.title_en || "Utan titel",
    imageArtist: parseArtist(artistRow.artists || null),
    color: artistRow.dominant_color || "#D4CDC3",
    focalX: artistRow.focal_x,
    focalY: artistRow.focal_y,
  }));

  // Stats
  const siteStats = getSiteStats(db);
  const stats = {
    totalWorks: siteStats.totalWorks,
    paintings: siteStats.paintings,
    museums: siteStats.museums,
    yearsSpan: siteStats.yearsSpan,
  };

  const museums = db.prepare(`
    SELECT COALESCE(a.sub_museum, m.name) as coll_name, COUNT(*) as count
    FROM artworks a
    LEFT JOIN museums m ON m.id = a.source
    WHERE ${sourceA.sql}
      AND COALESCE(a.sub_museum, m.name) IS NOT NULL
      AND COALESCE(a.sub_museum, m.name) != 'Statens historiska museer'
    GROUP BY coll_name
    ORDER BY count DESC
  `).all(...sourceA.params) as Array<{ coll_name: string; count: number }>;
  const museumList: MuseumSummary[] = museums.map((row: any) => ({
    id: row.coll_name,
    name: row.coll_name,
    count: row.count as number,
  }));

  const payload = {
    collections,
    quizImage: quizImg?.iiif_url
      ? {
          url: buildImageUrl(quizImg.iiif_url, 600),
          title: quizImg?.title_sv || quizImg?.title_en || "Utan titel",
          artist: parseArtist(quizImg?.artists || null),
          focalX: quizImg?.focal_x ?? null,
          focalY: quizImg?.focal_y ?? null,
        }
      : undefined,
    topArtists: mappedArtists,
    stats,
    museums: museumList,
  };

  discoverCache = {
    expiresAt: now + DISCOVER_CACHE_TTL_MS,
    data: payload,
  };

  return payload;
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { collections, quizImage, topArtists, stats, museums } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-[#1C1916] text-[#F5F0E8]">
      <div className="md:max-w-6xl lg:max-w-6xl md:mx-auto md:px-4 lg:px-6">
        <h1 className="font-serif text-[2rem] text-[#F5F0E8] px-3 pt-4 pb-2">Upptäck</h1>
        {/* Hero — Quiz CTA */}
        <a href="/quiz" className="block relative m-3 rounded-[18px] overflow-hidden h-48 lg:h-[22rem] no-underline focus-ring">
          {quizImage && (
            <img src={quizImage.url} alt={`${quizImage.title} — ${quizImage.artist}`} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: `${(quizImage.focalX ?? 0.5) * 100}% ${(quizImage.focalY ?? 0.5) * 100}%` }} />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,9,8,0.9)_0%,rgba(10,9,8,0.35)_55%,rgba(10,9,8,0.1)_100%)]" />
          <div className="absolute bottom-0 left-0 right-0 py-[1.2rem] px-[1.3rem]">
            <p className="text-[0.6rem] font-semibold tracking-[0.15em] uppercase text-[rgba(255,255,255,0.45)] mb-[0.35rem]">
              Personligt
            </p>
            <h2 className="font-serif text-[1.5rem] text-white m-0 leading-[1.15]">Hitta ditt verk</h2>
            <p className="text-[0.78rem] text-[rgba(255,255,255,0.55)] mt-1">
              Fem frågor — ett konstverk som matchar dig
            </p>
          </div>
        </a>

        {/* Samlingar — 2-column grid */}
        <section className="pt-6 px-3">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8] mx-1 mb-3">Samlingar</h2>

          <div className="grid grid-cols-2 gap-[0.6rem] md:gap-3 lg:grid-cols-4 lg:gap-4">
            {collections.map((c: Collection, i: number) => (
              <a
                key={c.title}
                href={`/search?q=${encodeURIComponent(c.query || c.title)}`}
                className={[
                  "relative rounded-[14px] overflow-hidden no-underline focus-ring",
                  "aspect-square",
                ].join(" ")}
                style={{ backgroundColor: c.color || "#2B2A27" }}
              >
                {c.imageUrl && (
                  <img
                    src={c.imageUrl}
                    alt={`${c.imageTitle || "Utan titel"} — ${c.imageArtist || "Okänd konstnär"}`}
                    loading="lazy"
                    width={400}
                    height={400}
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ objectPosition: `${(c.focalX ?? 0.5) * 100}% ${(c.focalY ?? 0.5) * 100}%` }}
                  />
                )}
                <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,9,8,0.75)_0%,rgba(10,9,8,0.1)_60%,transparent_100%)]" />
                <div className="absolute bottom-0 left-0 right-0 py-[0.7rem] px-[0.8rem]">
                  <p className="font-serif text-[0.95rem] text-white m-0 leading-[1.2]">{c.title}</p>
                  <p className="text-[0.65rem] text-[rgba(255,255,255,0.5)] mt-[0.1rem]">{c.subtitle}</p>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* Top artists */}
        <section className="pt-8">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8] mx-4 mb-3">Formgivare & konstnärer</h2>

          <div className="flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar lg:grid lg:grid-cols-4 xl:grid-cols-6 lg:gap-4 lg:overflow-visible lg:pb-0">
            {topArtists.map((a: TopArtist) => (
              <a
                key={a.name}
                href={`/artist/${encodeURIComponent(a.name)}`}
                className="shrink-0 w-[5.5rem] lg:w-auto no-underline text-center focus-ring"
              >
                <div className="w-20 h-20 lg:w-24 lg:h-24 rounded-full overflow-hidden mx-auto" style={{ backgroundColor: a.color || "#D4CDC3" }}>
                  {a.imageUrl && (
                    <img
                      src={a.imageUrl}
                      alt={`${a.imageTitle || "Utan titel"} — ${a.imageArtist || a.name}`}
                      loading="lazy"
                      width={300}
                      height={300}
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                      className="w-full h-full object-cover"
                      style={{ objectPosition: `${(a.focalX ?? 0.5) * 100}% ${(a.focalY ?? 0.5) * 100}%` }}
                    />
                  )}
                </div>
                <p className="text-[0.7rem] font-medium text-[#F5F0E8] mt-[0.4rem] leading-[1.2] overflow-hidden line-clamp-2">
                  {a.name}
                </p>
                <p className="text-[0.6rem] text-[rgba(245,240,232,0.55)] mt-[0.1rem]">
                  {a.count.toLocaleString("sv")} verk
                </p>
              </a>
            ))}
          </div>
        </section>

        {/* Verktyg */}
        <section className="pt-8 px-4">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8] mb-3">Verktyg</h2>
          <div className="flex flex-col gap-2">
            <ToolLink title="Färgmatch" desc="Matcha en färg med konstverk" href="/color-match" />
            <ToolLink title="Vandringar" desc="Tematiska resor genom samlingen" href="/walks" />
          </div>
        </section>

        {/* Samlingar */}
        {museums.length > 0 && (
          <section className="pt-8 px-4">
            <h2 className="font-serif text-[1.3rem] text-[#F5F0E8] mb-3">Samlingar</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {museums.map((museum: MuseumSummary) => (
                <a
                  key={museum.id}
                  href={`/samling/${encodeURIComponent(museum.name)}`}
                  className="rounded-[14px] bg-[#252019] p-4 no-underline hover:bg-[#2E2820] transition-colors focus-ring"
                >
                  <p className="text-[0.9rem] font-medium text-[#F5F0E8]">{museum.name}</p>
                  <p className="text-[0.7rem] text-[rgba(245,240,232,0.55)] mt-1">
                    {museum.count.toLocaleString("sv")} verk
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Samlingen i siffror */}
        <section className="pt-8 px-4 pb-12">
          <h2 className="font-serif text-[1.3rem] text-[#F5F0E8] mb-4">Samlingen i siffror</h2>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-4">
            <StatCard number={stats.totalWorks.toLocaleString("sv")} label="verk" />
            <StatCard number={stats.museums.toLocaleString("sv")} label="samlingar" />
            <StatCard number={`${stats.yearsSpan} år`} label="år av historia" />
            <StatCard number={stats.paintings.toLocaleString("sv")} label="målningar" />
          </div>
        </section>
      </div>
    </div>
  );
}

function ToolLink({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a href={href} className="flex items-center gap-[0.8rem] py-[0.9rem] px-4 min-h-11 rounded-[14px] bg-[#252019] no-underline hover:bg-[#2E2820] focus-ring">
      <div className="flex-1">
        <p className="text-[0.88rem] font-medium text-[#F5F0E8] m-0">{title}</p>
        <p className="text-[0.72rem] text-[rgba(245,240,232,0.45)] mt-[0.1rem]">{desc}</p>
      </div>
      <span className="text-[rgba(245,240,232,0.4)] text-[1rem]">→</span>
    </a>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="py-[0.8rem] px-[0.7rem] rounded-[12px] bg-[#252019] text-center">
      <p className="font-serif text-[1.3rem] font-semibold text-[#F5F0E8] m-0 leading-[1.1]">{number}</p>
      <p className="text-[0.6rem] text-[rgba(245,240,232,0.55)] mt-[0.2rem] uppercase tracking-[0.06em]">{label}</p>
    </div>
  );
}
