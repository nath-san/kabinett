import type { Route } from "./+types/discover";
import { getDb } from "../lib/db.server";

export function meta() {
  return [
    { title: "Upptäck — Kabinett" },
    { name: "description", content: "Utforska Nationalmuseums samling på nya sätt." },
  ];
}

function buildIiif(url: string, width: number) {
  return url.replace("http://", "https://") + `full/${width},/0/default.jpg`;
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
        SELECT a.iiif_url, a.dominant_color FROM artworks_fts f
        JOIN artworks a ON a.id = f.rowid
        WHERE artworks_fts MATCH ?
          AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 90
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
          AND (a.category LIKE '%Måleri%' OR a.category LIKE '%Teckningar%' OR a.category LIKE '%Skulptur%')
        ORDER BY RANDOM() LIMIT 1
      `).all(terms) as any[];
      const row = rows[0];
      return { ...c, imageUrl: row?.iiif_url ? buildIiif(row.iiif_url, 400) : undefined, color: row?.dominant_color || "#2B2A27" };
    } catch {
      return { ...c, color: "#2B2A27" };
    }
  });

  // Quiz image
  const quizImg = db.prepare(`
    SELECT iiif_url FROM artworks
    WHERE iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
      AND category LIKE '%Måleri%'
      AND id NOT IN (SELECT artwork_id FROM broken_images)
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
      AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
    GROUP BY name
    HAVING cnt >= 20
    ORDER BY cnt DESC
    LIMIT 12
  `).all() as any[];

  // Get a sample artwork for each top artist
  const artistsWithImages = topArtists.map((a: any) => {
    const row = db.prepare(`
      SELECT id, iiif_url, dominant_color FROM artworks
      WHERE json_extract(artists, '$[0].name') = ?
        AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
        AND id NOT IN (SELECT artwork_id FROM broken_images)
      ORDER BY RANDOM() LIMIT 1
    `).get(a.name) as any;
    return {
      name: a.name,
      count: a.cnt,
      imageUrl: row?.iiif_url ? buildIiif(row.iiif_url, 300) : undefined,
      color: row?.dominant_color || "#D4CDC3",
    };
  });

  // Stats
  const stats = {
    totalWorks: (db.prepare("SELECT COUNT(*) as c FROM artworks").get() as any).c,
    paintings: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Måleri%'").get() as any).c,
    drawings: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Teckningar%'").get() as any).c,
    sculptures: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Skulptur%'").get() as any).c,
    ceramics: (db.prepare("SELECT COUNT(*) as c FROM artworks WHERE category LIKE '%Keramik%'").get() as any).c,
    artists: (db.prepare("SELECT COUNT(DISTINCT json_extract(artists, '$[0].name')) as c FROM artworks WHERE artists IS NOT NULL").get() as any).c,
    oldestYear: (db.prepare("SELECT MIN(year_start) as c FROM artworks WHERE year_start > 0").get() as any).c,
  };

  return {
    collections,
    quizImage: quizImg?.iiif_url ? buildIiif(quizImg.iiif_url, 600) : undefined,
    topArtists: artistsWithImages,
    stats,
  };
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { collections, quizImage, topArtists, stats } = loaderData;

  return (
    <div className="min-h-screen pt-16 bg-cream">

      {/* Hero — Quiz CTA */}
      <a href="/quiz" className="block relative m-3 rounded-[18px] overflow-hidden h-48 no-underline">
        {quizImage && (
          <img src={quizImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
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

        <div className="grid grid-cols-2 gap-[0.6rem]">
          {collections.map((c, i) => (
            <a
              key={c.title}
              href={`/search?q=${encodeURIComponent(c.query.split(" ")[0])}`}
              className={[
                "relative rounded-[14px] overflow-hidden no-underline",
                i < 2 ? "aspect-[4/3]" : "aspect-square",
              ].join(" ")}
              style={{ backgroundColor: c.color || "#2B2A27" }}
            >
              {c.imageUrl && (
                <img src={c.imageUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
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

        <div className="flex gap-3 overflow-x-auto px-4 pb-2 no-scrollbar">
          {topArtists.map((a) => (
            <a
              key={a.name}
              href={`/artist/${encodeURIComponent(a.name)}`}
              className="shrink-0 w-[5.5rem] no-underline text-center"
            >
              <div className="w-20 h-20 rounded-full overflow-hidden mx-auto" style={{ backgroundColor: a.color || "#D4CDC3" }}>
                {a.imageUrl && (
                  <img src={a.imageUrl} alt={a.name} loading="lazy" className="w-full h-full object-cover" />
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

      {/* Samlingen i siffror */}
      <section className="pt-8 px-4 pb-12">
        <h2 className="font-serif text-[1.3rem] text-ink mb-4">Samlingen i siffror</h2>

        <div className="grid grid-cols-3 gap-2">
          <StatCard number={stats.totalWorks.toLocaleString("sv")} label="verk totalt" />
          <StatCard number={stats.artists.toLocaleString("sv")} label="konstnärer" />
          <StatCard number={`${stats.oldestYear}`} label="äldsta verket" />
          <StatCard number={stats.paintings.toLocaleString("sv")} label="målningar" />
          <StatCard number={stats.drawings.toLocaleString("sv")} label="teckningar" />
          <StatCard number={stats.sculptures.toLocaleString("sv")} label="skulpturer" />
          <StatCard number={stats.ceramics.toLocaleString("sv")} label="keramik" />
        </div>
      </section>
    </div>
  );
}

function ToolLink({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a href={href} className="flex items-center gap-[0.8rem] py-[0.9rem] px-4 rounded-[14px] bg-[#EDEAE4] no-underline">
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
