import type { Route } from "./+types/artwork";
import { getDb, type ArtworkRow } from "../lib/db.server";

export function meta({ data }: Route.MetaArgs) {
  if (!data?.artwork) return [{ title: "Konstverk — Kabinett" }];
  const { artwork } = data;
  const artist = artwork.artists?.[0]?.name || "Okänd konstnär";
  const desc = `${artwork.title} av ${artist}${artwork.datingText ? `, ${artwork.datingText}` : ""}. Ur Nationalmuseums samling.`;
  return [
    { title: `${artwork.title} — Kabinett` },
    { name: "description", content: desc },
    // OG tags
    { property: "og:title", content: artwork.title },
    { property: "og:description", content: `${artist}${artwork.datingText ? ` · ${artwork.datingText}` : ""}` },
    { property: "og:image", content: artwork.imageUrl },
    { property: "og:type", content: "article" },
    // Twitter card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: artwork.title },
    { name: "twitter:description", content: `${artist} — Nationalmuseum` },
    { name: "twitter:image", content: artwork.imageUrl },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM artworks WHERE id = ?")
    .get(params.id) as ArtworkRow | undefined;

  if (!row) throw new Response("Inte hittat", { status: 404 });

  let artists: Array<{ name: string; nationality: string; role: string }> = [];
  try {
    artists = JSON.parse(row.artists || "[]");
  } catch {}

  const iiifBase = row.iiif_url.replace("http://", "https://");
  const artwork = {
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    titleEn: row.title_en,
    category: row.category?.split(" (")?.[0] || "",
    techniqueMaterial: row.technique_material,
    artists,
    datingText: row.dating_text,
    yearStart: row.year_start,
    acquisitionYear: row.acquisition_year,
    imageUrl: iiifBase + "full/800,/0/default.jpg",
    thumbUrl: iiifBase + "full/400,/0/default.jpg",
    color: row.dominant_color || "#D4CDC3",
    colorR: row.color_r,
    colorG: row.color_g,
    colorB: row.color_b,
    iiifBase,
    nmUrl: `https://collection.nationalmuseum.se/eMP/eMuseumPlus?service=ExternalInterface&module=collection&viewType=detailView&objectId=${row.id}`,
  };

  // Similar by color
  const similar = row.color_r != null
    ? (db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
         FROM artworks
         WHERE id != ? AND color_r IS NOT NULL
         ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
         LIMIT 8`
      ).all(row.id, row.color_r, row.color_g, row.color_b) as any[])
    : [];

  // Same artist
  const artistName = artists[0]?.name;
  const sameArtist = artistName
    ? (db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, dating_text
         FROM artworks
         WHERE id != ? AND artists LIKE ? AND iiif_url IS NOT NULL
         ORDER BY RANDOM() LIMIT 6`
      ).all(row.id, `%${artistName}%`) as any[])
    : [];

  return { artwork, similar, sameArtist, artistName };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Artwork({ loaderData }: Route.ComponentProps) {
  const { artwork, similar, sameArtist, artistName } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Hero image with color bg */}
      <div style={{
        backgroundColor: artwork.color,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "1.5rem 1rem",
        minHeight: "50vh",
      }}>
        <img
          src={artwork.imageUrl}
          alt={artwork.title}
          style={{
            maxHeight: "70vh",
            maxWidth: "100%",
            objectFit: "contain",
            borderRadius: "0.25rem",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
          }}
        />
      </div>

      {/* Info card — overlapping the image slightly */}
      <div style={{
        margin: "-2rem 1rem 0",
        padding: "1.5rem",
        backgroundColor: "#fff",
        borderRadius: "1rem",
        position: "relative",
        zIndex: 10,
        boxShadow: "0 2px 20px rgba(0,0,0,0.06)",
        maxWidth: "40rem",
        marginLeft: "auto",
        marginRight: "auto",
      }}>
        <h1 className="font-serif" style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          color: "#3D3831",
          lineHeight: 1.3,
        }}>
          {artwork.title}
        </h1>

        {artwork.artists.length > 0 && (
          <p style={{ marginTop: "0.5rem", fontSize: "1rem" }}>
            {artwork.artists.map((a: any, i: number) => (
              <span key={i}>
                {i > 0 && ", "}
                <a href={"/artist/" + encodeURIComponent(a.name)}
                  style={{ color: "#8C8478", textDecoration: "none", borderBottom: "1px solid #D4CDC3" }}>
                  {a.name}
                </a>
              </span>
            ))}
            {artwork.artists[0]?.nationality && (
              <span style={{ fontSize: "0.875rem", color: "#D4CDC3" }}>
                {" "}· {artwork.artists[0].nationality}
              </span>
            )}
          </p>
        )}

        {/* Details grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1rem",
          marginTop: "1.25rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid #F0EBE3",
        }}>
          {artwork.datingText && <Detail label="Datering" value={artwork.datingText} />}
          {artwork.category && <Detail label="Kategori" value={artwork.category} />}
          {artwork.techniqueMaterial && <Detail label="Teknik" value={artwork.techniqueMaterial} />}
          {artwork.acquisitionYear && <Detail label="Förvärvad" value={String(artwork.acquisitionYear)} />}
        </div>

        {/* Color + link row */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "1.25rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid #F0EBE3",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{
              width: "1.5rem",
              height: "1.5rem",
              borderRadius: "50%",
              backgroundColor: artwork.color,
              border: "1px solid rgba(212,205,195,0.4)",
            }} />
            <span style={{ fontSize: "0.75rem", color: "#D4CDC3", fontFamily: "monospace" }}>{artwork.color}</span>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button
              onClick={() => {
                const artist = artwork.artists?.[0]?.name || "Okänd konstnär";
                const text = `${artwork.title} av ${artist}`;
                const url = window.location.href;
                if (navigator.share) {
                  navigator.share({ title: artwork.title, text, url });
                } else {
                  navigator.clipboard.writeText(url);
                  alert("Länk kopierad!");
                }
              }}
              style={{
                padding: "0.5rem 1rem", borderRadius: "999px",
                border: "1px solid #F0EBE3", backgroundColor: "#fff",
                fontSize: "0.8rem", color: "#3D3831", cursor: "pointer",
                fontWeight: 500,
              }}>
              Dela
            </button>
            <a href={artwork.nmUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: "0.8rem", color: "#8C8478", textDecoration: "none" }}>
              Nationalmuseum →
            </a>
          </div>
        </div>
      </div>

      {/* Same artist section */}
      {sameArtist.length > 0 && (
        <section style={{ padding: "2.5rem 1rem 0", maxWidth: "50rem", margin: "0 auto" }}>
          <h2 className="font-serif" style={{ fontSize: "1.25rem", fontWeight: 600, color: "#3D3831" }}>
            Mer av {artistName}
          </h2>
          <div style={{
            display: "flex",
            gap: "0.75rem",
            overflowX: "auto",
            paddingTop: "1rem",
            paddingBottom: "0.5rem",
          }} className="no-scrollbar">
            {sameArtist.map((s: any) => (
              <a key={s.id} href={"/artwork/" + s.id} style={{
                flexShrink: 0,
                width: "8rem",
                borderRadius: "0.75rem",
                overflow: "hidden",
                backgroundColor: "#F0EBE3",
                textDecoration: "none",
              }}>
                <div style={{ aspectRatio: "3/4", overflow: "hidden", backgroundColor: s.dominant_color || "#D4CDC3" }}>
                  <img src={s.iiif_url.replace("http://", "https://") + "full/200,/0/default.jpg"}
                    alt={s.title_sv || ""} width={200} height={267}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "0.5rem" }}>
                  <p style={{ fontSize: "0.75rem", color: "#3D3831", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {s.title_sv || "Utan titel"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Similar colors */}
      {similar.length > 0 && (
        <section style={{ padding: "2.5rem 1rem 0", maxWidth: "50rem", margin: "0 auto" }}>
          <h2 className="font-serif" style={{ fontSize: "1.25rem", fontWeight: 600, color: "#3D3831" }}>
            Liknande färger
          </h2>
          <div style={{
            display: "flex",
            gap: "0.75rem",
            overflowX: "auto",
            paddingTop: "1rem",
            paddingBottom: "0.5rem",
          }} className="no-scrollbar">
            {similar.map((s: any) => (
              <a key={s.id} href={"/artwork/" + s.id} style={{
                flexShrink: 0,
                width: "8rem",
                borderRadius: "0.75rem",
                overflow: "hidden",
                backgroundColor: "#F0EBE3",
                textDecoration: "none",
              }}>
                <div style={{ aspectRatio: "3/4", overflow: "hidden", backgroundColor: s.dominant_color || "#D4CDC3" }}>
                  <img src={s.iiif_url.replace("http://", "https://") + "full/200,/0/default.jpg"}
                    alt={s.title_sv || ""} width={200} height={267}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "0.5rem" }}>
                  <p style={{ fontSize: "0.75rem", color: "#3D3831", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {s.title_sv || "Utan titel"}
                  </p>
                  <p style={{ fontSize: "0.65rem", color: "#8C8478", marginTop: "0.125rem" }}>{parseArtist(s.artists)}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Back */}
      <div style={{ padding: "2.5rem 1rem 3rem", textAlign: "center" }}>
        <a href="/explore" style={{ fontSize: "0.875rem", color: "#8C8478", textDecoration: "none" }}>
          ← Tillbaka
        </a>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: "0.65rem", color: "#8C8478", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</p>
      <p style={{ fontSize: "0.875rem", color: "#3D3831", marginTop: "0.125rem" }}>{value}</p>
    </div>
  );
}
