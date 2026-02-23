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
    <div style={{ minHeight: "100vh", paddingTop: "4rem", background: "#FAF7F2" }}>

      {/* Hero — Quiz CTA */}
      <a href="/quiz" style={{
        display: "block", position: "relative",
        margin: "0.75rem", borderRadius: "18px",
        overflow: "hidden", height: "12rem",
        textDecoration: "none",
      }}>
        {quizImage && (
          <img src={quizImage} alt="" style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%", objectFit: "cover",
          }} />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(10,9,8,0.9) 0%, rgba(10,9,8,0.35) 55%, rgba(10,9,8,0.1) 100%)",
        }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "1.2rem 1.3rem" }}>
          <p style={{
            fontSize: "0.6rem", fontWeight: 600,
            letterSpacing: "0.15em", textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)", marginBottom: "0.35rem",
          }}>Personligt</p>
          <h2 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: "1.5rem", color: "#fff",
            margin: 0, lineHeight: 1.15,
          }}>Hitta ditt verk</h2>
          <p style={{
            color: "rgba(255,255,255,0.55)",
            fontSize: "0.78rem", marginTop: "0.25rem",
          }}>Fem frågor — ett konstverk som matchar dig</p>
        </div>
      </a>

      {/* Samlingar — 2-column grid */}
      <section style={{ padding: "1.5rem 0.75rem 0" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          margin: "0 0.25rem 0.75rem",
        }}>Samlingar</h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.6rem",
        }}>
          {collections.map((c, i) => (
            <a
              key={c.title}
              href={`/search?q=${encodeURIComponent(c.query.split(" ")[0])}`}
              style={{
                position: "relative",
                borderRadius: "14px",
                overflow: "hidden",
                aspectRatio: i < 2 ? "4/3" : "1/1",
                gridColumn: i < 2 ? "auto" : "auto",
                textDecoration: "none",
                backgroundColor: c.color || "#2B2A27",
              }}
            >
              {c.imageUrl && (
                <img src={c.imageUrl} alt="" loading="lazy" style={{
                  position: "absolute", inset: 0,
                  width: "100%", height: "100%", objectFit: "cover",
                }} />
              )}
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(to top, rgba(10,9,8,0.75) 0%, rgba(10,9,8,0.1) 60%, transparent 100%)",
              }} />
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "0.7rem 0.8rem",
              }}>
                <p style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontSize: "0.95rem", color: "#fff",
                  margin: 0, lineHeight: 1.2,
                }}>{c.title}</p>
                <p style={{
                  fontSize: "0.65rem", color: "rgba(255,255,255,0.5)",
                  margin: "0.1rem 0 0",
                }}>{c.subtitle}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Top artists */}
      <section style={{ padding: "2rem 0 0" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          margin: "0 1rem 0.75rem",
        }}>Formgivare & konstnärer</h2>

        <div style={{
          display: "flex", gap: "0.75rem",
          overflowX: "auto", padding: "0 1rem 0.5rem",
        }} className="no-scrollbar">
          {topArtists.map((a) => (
            <a
              key={a.name}
              href={`/artist/${encodeURIComponent(a.name)}`}
              style={{
                flex: "0 0 auto",
                width: "5.5rem",
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              <div style={{
                width: "5rem", height: "5rem",
                borderRadius: "50%",
                overflow: "hidden",
                margin: "0 auto",
                backgroundColor: a.color || "#D4CDC3",
              }}>
                {a.imageUrl && (
                  <img src={a.imageUrl} alt={a.name} loading="lazy" style={{
                    width: "100%", height: "100%", objectFit: "cover",
                  }} />
                )}
              </div>
              <p style={{
                fontSize: "0.7rem", fontWeight: 500,
                color: "#3D3831", marginTop: "0.4rem",
                lineHeight: 1.2,
                overflow: "hidden", display: "-webkit-box",
                WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              }}>{a.name}</p>
              <p style={{
                fontSize: "0.6rem", color: "#8C8478",
                marginTop: "0.1rem",
              }}>{a.count.toLocaleString("sv")} verk</p>
            </a>
          ))}
        </div>
      </section>

      {/* Verktyg */}
      <section style={{ padding: "2rem 1rem 0" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          marginBottom: "0.75rem",
        }}>Verktyg</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <ToolLink title="Färgmatch" desc="Matcha en färg med konstverk" href="/color-match" />
          <ToolLink title="Vandringar" desc="Tematiska resor genom samlingen" href="/walks" />
        </div>
      </section>

      {/* Samlingen i siffror */}
      <section style={{ padding: "2rem 1rem 3rem" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          marginBottom: "1rem",
        }}>Samlingen i siffror</h2>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: "0.5rem",
        }}>
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
    <a href={href} style={{
      display: "flex", alignItems: "center", gap: "0.8rem",
      padding: "0.9rem 1rem",
      borderRadius: "14px",
      background: "#EDEAE4",
      textDecoration: "none",
    }}>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: "0.88rem", fontWeight: 500, color: "#1A1815", margin: 0 }}>{title}</p>
        <p style={{ fontSize: "0.72rem", color: "#7A7268", margin: "0.1rem 0 0" }}>{desc}</p>
      </div>
      <span style={{ color: "#9C9488", fontSize: "1rem" }}>→</span>
    </a>
  );
}

function StatCard({ number, label }: { number: string; label: string }) {
  return (
    <div style={{
      padding: "0.8rem 0.7rem",
      borderRadius: "12px",
      background: "#EDEAE4",
      textAlign: "center",
    }}>
      <p style={{
        fontFamily: "'Instrument Serif', serif",
        fontSize: "1.3rem", fontWeight: 600,
        color: "#3D3831", margin: 0,
        lineHeight: 1.1,
      }}>{number}</p>
      <p style={{
        fontSize: "0.6rem", color: "#8C8478",
        marginTop: "0.2rem", textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>{label}</p>
    </div>
  );
}
