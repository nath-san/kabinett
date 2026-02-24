import type { Route } from "./+types/discover";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { getEnabledMuseums, sourceFilter } from "../lib/museums.server";

export function meta() {
  return [
    { title: "Upptäck — Kabinett" },
    { name: "description", content: "Utforska över en miljon verk från nio svenska samlingar." },
  ];
}

function buildIiif(url: string, width: number) {
  return buildImageUrl(url, width);
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; } catch { return "Okänd konstnär"; }
}

type Collection = {
  title: string;
  subtitle: string;
  query: string;
  clipQuery: string;
  imageUrl?: string;
  imageTitle?: string;
  imageArtist?: string;
  color?: string;
};

const COLLECTIONS: Collection[] = [
  { title: "Mörkt & dramatiskt", subtitle: "Skuggor och spänning", query: "mörk natt skugga", clipQuery: "dark dramatic painting shadows chiaroscuro" },
  { title: "Ljust & stilla", subtitle: "Sommar och ro", query: "ljus sommar äng", clipQuery: "bright calm peaceful summer meadow painting" },
  { title: "Stormigt hav", subtitle: "Vågor och vind", query: "hav storm sjö", clipQuery: "stormy sea waves ocean maritime painting" },
  { title: "Blommor", subtitle: "Natur i närbild", query: "blommor bukett ros", clipQuery: "flowers floral still life roses botanical" },
  { title: "Djur i konsten", subtitle: "Hästar, hundar och fåglar", query: "häst hund fågel djur", clipQuery: "animals horses dogs birds painting" },
  { title: "Porträtt", subtitle: "Ansikten genom tiderna", query: "porträtt", clipQuery: "portrait face person painting" },
  { title: "Landskap", subtitle: "Skog, berg och dal", query: "landskap skog berg", clipQuery: "landscape forest mountain scenic painting" },
  { title: "Mytologi", subtitle: "Gudar och hjältar", query: "gud gudinna venus", clipQuery: "mythology gods venus mars classical" },
  { title: "Vinter", subtitle: "Snö och is", query: "vinter snö is", clipQuery: "winter snow ice cold landscape" },
  { title: "Naket", subtitle: "Kroppen i konsten", query: "naken akt", clipQuery: "nude figure painting human body" },
  { title: "Barn", subtitle: "Barndomens porträtt", query: "barn flicka pojke", clipQuery: "children child girl boy painting" },
  { title: "Arkitektur", subtitle: "Slott och kyrkor", query: "kyrka slott byggnad", clipQuery: "architecture castle church building" },
];

export async function loader() {
  const db = getDb();

  // Collection images
  const collections = COLLECTIONS.map((c) => {
    const terms = c.query.split(" ").join(" OR ");
    try {
      const rows = db.prepare(`
        SELECT a.iiif_url, a.dominant_color, a.title_sv, a.title_en, a.artists FROM artworks_fts
        JOIN artworks a ON a.id = artworks_fts.rowid
        WHERE artworks_fts MATCH ?
          AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 40
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
          AND (a.category LIKE '%Måleri%' OR a.category LIKE '%Teckningar%' OR a.category LIKE '%Skulptur%')
          AND ${sourceFilter("a")}
        ORDER BY RANDOM() LIMIT 1
      `).all(terms) as any[];
      const row = rows[0];
      return {
        ...c,
        imageUrl: row?.iiif_url ? buildIiif(row.iiif_url, 400) : undefined,
        imageTitle: row?.title_sv || row?.title_en || "Utan titel",
        imageArtist: parseArtist(row?.artists || null),
        color: row?.dominant_color || "#2B2A27",
      };
    } catch {
      return { ...c, color: "#2B2A27" };
    }
  });

  // Quiz image
  const quizImg = db.prepare(`
    SELECT iiif_url, title_sv, title_en, artists FROM artworks
    WHERE iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
      AND category LIKE '%Måleri%'
      AND id NOT IN (SELECT artwork_id FROM broken_images)
      AND ${sourceFilter()}
    ORDER BY RANDOM() LIMIT 1
  `).get() as any;

  // Top artists (excluding factories like Gustavsberg)
  const topArtists = db.prepare(`
    SELECT json_extract(artists, '$[0].name') as name, COUNT(*) as cnt
    FROM artworks
    WHERE artists IS NOT NULL
      AND json_extract(artists, '$[0].name') IS NOT NULL
      AND json_extract(artists, '$[0].name') NOT LIKE '%känd%'
      AND json_extract(artists, '$[0].name') NOT LIKE '%nonym%'
      AND json_extract(artists, '$[0].name') NOT IN ('Gustavsberg')
      AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
      AND ${sourceFilter()}
    GROUP BY name
    HAVING cnt >= 20
    ORDER BY cnt DESC
    LIMIT 12
  `).all() as any[];

  // Get a sample artwork for each top artist
  const artistsWithImages = topArtists.map((a: any) => {
    const row = db.prepare(`
      SELECT id, iiif_url, dominant_color, title_sv, title_en, artists FROM artworks
      WHERE json_extract(artists, '$[0].name') = ?
        AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 40
        AND id NOT IN (SELECT artwork_id FROM broken_images)
        AND ${sourceFilter()}
      ORDER BY RANDOM() LIMIT 1
    `).get(a.name) as any;
    return {
      name: a.name,
      count: a.cnt,
      imageUrl: row?.iiif_url ? buildIiif(row.iiif_url, 300) : undefined,
      imageTitle: row?.title_sv || row?.title_en || "Utan titel",
      imageArtist: parseArtist(row?.artists || null),
      color: row?.dominant_color || "#D4CDC3",
    };
  });

  // Stats
  const enabledMuseums = getEnabledMuseums();
  const stats = {
    totalWorks: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${sourceFilter()}`).get() as any).c,
    paintings: (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Måleri%' AND ${sourceFilter()}`).get() as any).c,
    museums: (db.prepare(`
      SELECT COUNT(*) as c FROM (
        SELECT DISTINCT COALESCE(sub_museum, m.name) as museum_name
        FROM artworks a LEFT JOIN museums m ON m.id = a.source
        WHERE ${sourceFilter("a")} AND COALESCE(sub_museum, m.name) IS NOT NULL AND COALESCE(sub_museum, m.name) != 'Statens historiska museer'
      )
    `).get() as any).c,
    oldestYear: (db.prepare(`SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0 AND ${sourceFilter()}`).get() as any).c,
  };
  const currentYear = new Date().getFullYear();
  const yearsSpan = stats.oldestYear ? Math.max(0, currentYear - stats.oldestYear) : 0;

  const museums = db.prepare(`
    SELECT COALESCE(a.sub_museum, m.name) as coll_name, COUNT(*) as count
    FROM artworks a
    LEFT JOIN museums m ON m.id = a.source
    WHERE ${sourceFilter("a")}
      AND COALESCE(a.sub_museum, m.name) IS NOT NULL
      AND COALESCE(a.sub_museum, m.name) != 'Statens historiska museer'
    GROUP BY coll_name
    ORDER BY count DESC
  `).all() as Array<{ coll_name: string; count: number }>;
  const museumList = museums.map((row: any) => ({
    id: row.coll_name,
    name: row.coll_name,
    count: row.count as number,
  }));

  return {
    collections,
    quizImage: quizImg?.iiif_url
      ? {
          url: buildIiif(quizImg.iiif_url, 600),
          title: quizImg?.title_sv || quizImg?.title_en || "Utan titel",
          artist: parseArtist(quizImg?.artists || null),
        }
      : undefined,
    topArtists: artistsWithImages,
    stats: { ...stats, yearsSpan },
    museums: museumList,
  };
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { collections, quizImage, topArtists, stats, museums } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-cream">
      <div className="md:max-w-4xl lg:max-w-5xl md:mx-auto md:px-4 lg:px-6">
        {/* Hero — Quiz CTA */}
        <a href="/quiz" className="block relative m-3 rounded-[18px] overflow-hidden h-48 lg:h-[22rem] no-underline focus-ring">
          {quizImage && (
            <img src={quizImage.url} alt={`${quizImage.title} — ${quizImage.artist}`} className="absolute inset-0 w-full h-full object-cover" />
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
          <h2 className="font-serif text-[1.3rem] text-ink mx-1 mb-3">Samlingar</h2>

          <div className="grid grid-cols-2 gap-[0.6rem] md:gap-3 lg:grid-cols-4 lg:gap-4">
            {collections.map((c, i) => (
              <a
                key={c.title}
                href={`/search?q=${encodeURIComponent(c.query)}`}
                className={[
                  "relative rounded-[14px] overflow-hidden no-underline focus-ring",
                  i < 2 ? "aspect-[4/3]" : "aspect-square",
                ].join(" ")}
                style={{ backgroundColor: c.color || "#2B2A27" }}
              >
                {c.imageUrl && (
                  <img
                    src={c.imageUrl}
                    alt={`${c.imageTitle || "Utan titel"} — ${c.imageArtist || "Okänd konstnär"}`}
                    loading="lazy"
                    width={400}
                    height={i < 2 ? 300 : 400}
                    className="absolute inset-0 w-full h-full object-cover"
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
          <h2 className="font-serif text-[1.3rem] text-ink mx-4 mb-3">Formgivare & konstnärer</h2>

          <div className="flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar lg:grid lg:grid-cols-4 xl:grid-cols-6 lg:gap-4 lg:overflow-visible lg:pb-0">
            {topArtists.map((a) => (
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
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <p className="text-[0.7rem] font-medium text-charcoal mt-[0.4rem] leading-[1.2] overflow-hidden line-clamp-2">
                  {a.name}
                </p>
                <p className="text-[0.6rem] text-warm-gray mt-[0.1rem]">
                  {a.count.toLocaleString("sv")} verk
                </p>
              </a>
            ))}
          </div>
        </section>

        {/* Verktyg */}
        <section className="pt-8 px-4">
          <h2 className="font-serif text-[1.3rem] text-ink mb-3">Verktyg</h2>
          <div className="flex flex-col gap-2">
            <ToolLink title="Färgmatch" desc="Matcha en färg med konstverk" href="/color-match" />
            <ToolLink title="Vandringar" desc="Tematiska resor genom samlingen" href="/walks" />
          </div>
        </section>

        {/* Museer */}
        {museums.length > 0 && (
          <section className="pt-8 px-4">
            <h2 className="font-serif text-[1.3rem] text-ink mb-3">Samlingar</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {museums.map((museum) => (
                <a
                  key={museum.id}
                  href={`/samling/${encodeURIComponent(museum.name)}`}
                  className="rounded-[14px] bg-linen p-4 no-underline hover:bg-[#E5E1DA] transition-colors focus-ring"
                >
                  <p className="text-[0.9rem] font-medium text-charcoal">{museum.name}</p>
                  <p className="text-[0.7rem] text-warm-gray mt-1">
                    {museum.count.toLocaleString("sv")} verk
                  </p>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Samlingen i siffror */}
        <section className="pt-8 px-4 pb-12">
          <h2 className="font-serif text-[1.3rem] text-ink mb-4">Samlingen i siffror</h2>

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
    <a href={href} className="flex items-center gap-[0.8rem] py-[0.9rem] px-4 rounded-[14px] bg-[#EDEAE4] no-underline focus-ring">
      <div className="flex-1">
        <p className="text-[0.88rem] font-medium text-ink m-0">{title}</p>
        <p className="text-[0.72rem] text-[#7A7268] mt-[0.1rem]">{desc}</p>
      </div>
      <span className="text-[#9C9488] text-[1rem]">→</span>
    </a>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div className="py-[0.8rem] px-[0.7rem] rounded-[12px] bg-[#EDEAE4] text-center">
      <p className="font-serif text-[1.3rem] font-semibold text-charcoal m-0 leading-[1.1]">{number}</p>
      <p className="text-[0.6rem] text-warm-gray mt-[0.2rem] uppercase tracking-[0.06em]">{label}</p>
    </div>
  );
}
