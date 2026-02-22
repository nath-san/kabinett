import type { Route } from "./+types/home";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kabinett — Upptäck svensk konst" },
    { name: "description", content: "Utforska Nationalmuseums samling på ett nytt sätt." },
  ];
}

export async function loader() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as count FROM artworks").get() as any).count;

  // Hero: pick a painting with good colors
  const heroCandidates = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
     FROM artworks
     WHERE category LIKE '%Målningar%'
       AND color_r IS NOT NULL
       AND (color_r + color_g + color_b) BETWEEN 150 AND 500
       AND LENGTH(iiif_url) > 90
     ORDER BY RANDOM() LIMIT 5`
  ).all() as any[];
  const hero = heroCandidates[0] || null;

  const featured = db.prepare(
    `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
     FROM artworks WHERE category LIKE '%Målningar%' AND LENGTH(iiif_url) > 90
     ORDER BY RANDOM() LIMIT 8`
  ).all() as any[];

  const colorful = db.prepare(
    `SELECT id, iiif_url, dominant_color
     FROM artworks
     WHERE color_r IS NOT NULL AND LENGTH(iiif_url) > 90
       AND NOT (ABS(color_r - color_g) < 20 AND ABS(color_g - color_b) < 20)
     ORDER BY RANDOM() LIMIT 12`
  ).all() as any[];

  return { total, hero, featured, colorful };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

function iiif(url: string, size: number): string {
  return url.replace("http://", "https://") + `full/${size},/0/default.jpg`;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { total, hero, featured, colorful } = loaderData;

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Full-bleed hero */}
      <section style={{
        position: "relative",
        height: "85vh",
        minHeight: "500px",
        display: "flex",
        alignItems: "flex-end",
        backgroundColor: hero?.dominant_color || "#3D3831",
      }}>
        {hero && (
          <img
            src={iiif(hero.iiif_url, 800)}
            alt={hero.title_sv || ""}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(26,24,21,0.8) 0%, rgba(26,24,21,0.2) 40%, transparent 70%)",
        }} />
        <div style={{ position: "relative", zIndex: 10, padding: "0 1rem 3rem", maxWidth: "36rem" }}>
          <h1 className="font-serif" style={{
            fontSize: "2.5rem", fontWeight: 700, color: "#fff", lineHeight: 1.15,
          }}>
            Upptäck svensk konst
          </h1>
          <p style={{ marginTop: "1rem", fontSize: "1rem", color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
            {total.toLocaleString("sv-SE")} verk från Nationalmuseums samling.
            Utforska efter färg, tid eller nyfikenhet.
          </p>
          <div style={{ marginTop: "1.5rem", display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <a href="/explore" style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#fff", color: "#3D3831",
              borderRadius: "999px", fontSize: "0.875rem", fontWeight: 500,
              textDecoration: "none",
            }}>
              Börja utforska
            </a>
            <a href="/discover" style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "rgba(255,255,255,0.15)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "999px", fontSize: "0.875rem", fontWeight: 500,
              textDecoration: "none", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            }}>
              Upptäck
            </a>
            <a href="/walks" style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "rgba(255,255,255,0.15)", color: "#fff",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "999px", fontSize: "0.875rem", fontWeight: 500,
              textDecoration: "none", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            }}>
              Vandringar
            </a>
          </div>
          {hero && (
            <a href={"/artwork/" + hero.id} style={{
              display: "inline-block", marginTop: "1.5rem",
              fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", textDecoration: "none",
            }}>
              {hero.title_sv} — {parseArtist(hero.artists)}
            </a>
          )}
        </div>
      </section>

      {/* Featured */}
      <section style={{ padding: "3rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
          <div>
            <h2 className="font-serif" style={{ fontSize: "1.5rem", fontWeight: 600, color: "#3D3831" }}>
              Ur samlingen
            </h2>
            <p style={{ fontSize: "0.875rem", color: "#8C8478", marginTop: "0.25rem" }}>Slumpmässigt urval</p>
          </div>
          <a href="/explore" style={{ fontSize: "0.875rem", color: "#8C8478", textDecoration: "none" }}>
            Visa alla →
          </a>
        </div>
        <div style={{ columnCount: 2, columnGap: "0.75rem" }}>
          {featured.map((work: any) => (
            <a key={work.id} href={"/artwork/" + work.id}
              style={{
                breakInside: "avoid", display: "block", borderRadius: "0.75rem",
                overflow: "hidden", backgroundColor: "#F0EBE3", marginBottom: "0.75rem",
                textDecoration: "none",
              }}>
              <div style={{ backgroundColor: work.dominant_color || "#D4CDC3", aspectRatio: "3/4", overflow: "hidden" }}>
                <img src={iiif(work.iiif_url, 400)} alt={work.title_sv || ""} width={400} height={533}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ padding: "0.75rem" }}>
                <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.3 }}>
                  {work.title_sv || "Utan titel"}</p>
                <p style={{ fontSize: "0.75rem", color: "#8C8478", marginTop: "0.25rem" }}>{parseArtist(work.artists)}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* Color teaser */}
      <section style={{ padding: "3rem 1rem", backgroundColor: "#3D3831" }}>
        <h2 className="font-serif" style={{ fontSize: "1.5rem", fontWeight: 600, color: "#fff" }}>
          Utforska genom färg
        </h2>
        <p style={{ fontSize: "0.875rem", color: "rgba(255,255,255,0.4)", marginTop: "0.5rem" }}>
          Varje verk har en dominant färg. Vilken lockar dig?
        </p>
        <div style={{
          display: "flex", gap: "0.5rem", overflowX: "auto",
          paddingTop: "1rem", paddingBottom: "0.5rem",
        }} className="no-scrollbar">
          {colorful.map((c: any) => (
            <a key={c.id} href={"/artwork/" + c.id} style={{
              flexShrink: 0, width: "7rem", height: "9rem",
              borderRadius: "0.75rem", overflow: "hidden",
            }}>
              <img src={iiif(c.iiif_url, 200)} alt="" width={200} height={250}
                loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </a>
          ))}
        </div>
        <a href="/explore?color=blue" style={{
          display: "inline-block", marginTop: "1rem",
          padding: "0.75rem 1.5rem",
          backgroundColor: "rgba(255,255,255,0.1)", color: "#fff",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "999px", fontSize: "0.875rem", fontWeight: 500,
          textDecoration: "none",
        }}>
          Utforska efter färg →
        </a>
      </section>

      {/* Footer */}
      <footer style={{ padding: "2.5rem 1rem", textAlign: "center", backgroundColor: "#FAF7F2" }}>
        <p style={{ fontSize: "0.75rem", color: "#D4CDC3" }}>
          Data från <a href="https://api.nationalmuseum.se" target="_blank" rel="noopener"
            style={{ textDecoration: "underline", color: "inherit" }}>Nationalmuseums öppna API</a>.
          Metadata CC0, bilder Public Domain.
        </p>
        <p style={{ fontSize: "0.7rem", color: "rgba(212,205,195,0.6)", marginTop: "0.5rem" }}>
          Kabinett är inte affilierat med Nationalmuseum.
        </p>
      </footer>
    </div>
  );
}
