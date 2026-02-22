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

type Collection = {
  title: string;
  query: string;
  imageUrl?: string;
};

const COLLECTIONS: Collection[] = [
  { title: "Mörkt & dramatiskt", query: "mörk natt skugga dramatisk" },
  { title: "Ljust & stilla", query: "ljus sommar äng lugn" },
  { title: "Stormigt hav", query: "hav storm sjö vågor" },
  { title: "Blommor", query: "blommor bukett ros" },
  { title: "Djur i konsten", query: "häst hund fågel djur" },
  { title: "Porträtt", query: "porträtt kvinna man" },
  { title: "Landskap", query: "landskap skog berg" },
  { title: "Mytologi", query: "gud gudinna venus mars" },
  { title: "Vinter", query: "vinter snö is" },
  { title: "Naket", query: "naken akt nude" },
  { title: "Barn", query: "barn flicka pojke" },
  { title: "Arkitektur", query: "kyrka slott byggnad" },
];

export async function loader() {
  const db = getDb();

  // Get images for collections
  const collections = COLLECTIONS.map((c) => {
    const terms = c.query.split(" ").join(" OR ");
    try {
      const row = db.prepare(`
        SELECT a.iiif_url FROM artworks_fts f
        JOIN artworks a ON a.id = f.rowid
        WHERE artworks_fts MATCH ?
          AND a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 90
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
          AND (a.category LIKE '%Måleri%' OR a.category LIKE '%Teckningar%' OR a.category LIKE '%Skulptur%')
        ORDER BY RANDOM() LIMIT 1
      `).get(terms) as any;
      return { ...c, imageUrl: row?.iiif_url ? buildIiif(row.iiif_url, 400) : undefined };
    } catch {
      return c;
    }
  });

  // Get image for "Hitta ditt verk"
  const quizImg = db.prepare(`
    SELECT iiif_url FROM artworks
    WHERE iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
      AND category LIKE '%Måleri%'
      AND id NOT IN (SELECT artwork_id FROM broken_images)
    ORDER BY RANDOM() LIMIT 1
  `).get() as any;

  return {
    collections,
    quizImage: quizImg?.iiif_url ? buildIiif(quizImg.iiif_url, 600) : undefined,
  };
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { collections, quizImage } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "4.5rem", background: "#FAF7F2" }}>

      {/* Hitta ditt verk — hero CTA */}
      <a href="/quiz" style={{
        display: "block", position: "relative",
        margin: "0.75rem", borderRadius: "18px",
        overflow: "hidden", height: "13rem",
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
          background: "linear-gradient(to top, rgba(10,9,8,0.9) 0%, rgba(10,9,8,0.4) 50%, rgba(10,9,8,0.15) 100%)",
        }} />
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "1.2rem 1.3rem",
        }}>
          <p style={{
            fontSize: "0.6rem", fontWeight: 600,
            letterSpacing: "0.15em", textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)", marginBottom: "0.4rem",
          }}>Personligt</p>
          <h2 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: "1.6rem", color: "#fff",
            margin: 0, lineHeight: 1.15,
          }}>Hitta ditt verk</h2>
          <p style={{
            color: "rgba(255,255,255,0.55)",
            fontSize: "0.8rem", marginTop: "0.3rem",
          }}>Fem frågor — ett konstverk som matchar dig</p>
        </div>
      </a>

      {/* Samlingar */}
      <div style={{ padding: "1.5rem 0 0" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          margin: "0 1rem 0.75rem",
        }}>Samlingar</h2>

        <div style={{
          display: "flex", gap: "0.5rem",
          overflowX: "auto", padding: "0 0.75rem 0.5rem",
          scrollSnapType: "x mandatory",
        }} className="no-scrollbar">
          {collections.map((c) => (
            <a
              key={c.title}
              href={`/?q=${encodeURIComponent(c.query.split(" ")[0])}`}
              style={{
                flex: "0 0 auto",
                width: "9rem", height: "12rem",
                borderRadius: "14px",
                overflow: "hidden",
                position: "relative",
                textDecoration: "none",
                scrollSnapAlign: "start",
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
                background: "linear-gradient(to top, rgba(10,9,8,0.8) 0%, rgba(10,9,8,0.15) 60%, transparent 100%)",
              }} />
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0,
                padding: "0.8rem",
              }}>
                <p style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontSize: "1rem", color: "#fff",
                  margin: 0, lineHeight: 1.2,
                }}>{c.title}</p>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Verktyg */}
      <div style={{ padding: "1.5rem 1rem 4rem" }}>
        <h2 style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: "1.3rem", color: "#1A1815",
          marginBottom: "0.75rem",
        }}>Verktyg</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {[
            { title: "Färgmatch", desc: "Matcha en färg med konstverk", href: "/color-match" },
            { title: "Tidslinje", desc: "Scrolla genom 500 år", href: "/timeline" },
          ].map((tool) => (
            <a key={tool.href} href={tool.href} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "1rem 1.1rem",
              borderRadius: "12px",
              background: "#EDEAE4",
              textDecoration: "none",
            }}>
              <div>
                <p style={{
                  fontSize: "0.9rem", fontWeight: 500,
                  color: "#1A1815", margin: 0,
                }}>{tool.title}</p>
                <p style={{
                  fontSize: "0.75rem", color: "#7A7268",
                  margin: "0.15rem 0 0",
                }}>{tool.desc}</p>
              </div>
              <span style={{ color: "#9C9488", fontSize: "1.1rem" }}>→</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
