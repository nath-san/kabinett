import type { Route } from "./+types/walks";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Vandringar — Kabinett" },
    { name: "description", content: "Curaterade vandringar genom Nationalmuseums samling." },
  ];
}

type WalkPreview = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  previewUrl: string | null;
};

type WalkArtwork = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
  narrative_text: string | null;
  position: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("walk") || "";
  const db = getDb();

  const walkRows = db
    .prepare(
      `SELECT id, slug, title, subtitle, description, color
       FROM walks WHERE published = 1
       ORDER BY created_at DESC`
    )
    .all() as Array<Omit<WalkPreview, "previewUrl">>;

  const previewStmt = db.prepare(
    `SELECT a.iiif_url
     FROM walk_items wi
     JOIN artworks a ON a.id = wi.artwork_id
     WHERE wi.walk_id = ?
       AND a.iiif_url IS NOT NULL
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
     ORDER BY RANDOM()
     LIMIT 1`
  );

  const walkPreviews: WalkPreview[] = walkRows.map((w) => {
    let previewUrl: string | null = null;
    try {
      const row = previewStmt.get(w.id) as any;
      if (row?.iiif_url) {
        previewUrl = row.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg";
      }
    } catch {
      previewUrl = null;
    }
    return { ...w, previewUrl };
  });

  let artworks: WalkArtwork[] = [];
  let walkInfo: { title: string; subtitle: string; description: string; color: string } | null = null;
  if (selected) {
    const walk = db
      .prepare(
        `SELECT id, title, subtitle, description, color
         FROM walks WHERE slug = ? AND published = 1`
      )
      .get(selected) as any;

    if (walk) {
      walkInfo = {
        title: walk.title,
        subtitle: walk.subtitle,
        description: walk.description,
        color: walk.color,
      };

      artworks = db
        .prepare(
          `SELECT wi.position, wi.narrative_text,
                  a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
           FROM walk_items wi
           JOIN artworks a ON a.id = wi.artwork_id
           WHERE wi.walk_id = ?
           ORDER BY wi.position ASC`
        )
        .all(walk.id) as WalkArtwork[];
    }
  }

  return { walkPreviews, artworks, selected, walkInfo };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export default function Walks({ loaderData }: Route.ComponentProps) {
  const { walkPreviews, artworks, selected, walkInfo } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Header */}
      {!selected && (
        <div style={{ padding: "2.5rem 1rem 1.5rem" }}>
          <h1 className="font-serif" style={{ fontSize: "2rem", fontWeight: 700, color: "#3D3831" }}>
            Vandringar
          </h1>
          <p style={{ color: "#8C8478", fontSize: "0.9rem", marginTop: "0.5rem", lineHeight: 1.5 }}>
            Curaterade resor genom samlingen. Varje vandring har ett tema och en berättelse.
          </p>
        </div>
      )}

      {/* Walk cards */}
      {!selected && (
        <div style={{ padding: "0 1rem 4rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {walkPreviews.map((w) => (
            <a key={w.slug} href={"/walks?walk=" + w.slug}
              style={{
                display: "block", position: "relative", overflow: "hidden",
                borderRadius: "1rem", height: "10rem",
                backgroundColor: w.color, textDecoration: "none",
              }}>
              {w.previewUrl && (
                <img src={w.previewUrl} alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.6 }} />
              )}
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 60%)",
              }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "1.25rem" }}>
                <h2 className="font-serif" style={{
                  fontSize: "1.375rem", fontWeight: 700, color: "#fff",
                  textShadow: "0 1px 4px rgba(0,0,0,0.3)",
                }}>
                  {w.title}
                </h2>
                <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.7)", marginTop: "0.25rem" }}>
                  {w.subtitle}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Selected walk */}
      {selected && walkInfo && (
        <>
          {/* Walk hero */}
          <div style={{
            backgroundColor: walkInfo.color,
            padding: "3rem 1rem 2.5rem",
            position: "relative",
          }}>
            {artworks[0] && (
              <img
                src={artworks[0].iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
                alt="" style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  objectFit: "cover", opacity: 0.25,
                }}
              />
            )}
            <div style={{ position: "relative" }}>
              <a href="/walks" style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
                ← Alla vandringar
              </a>
              <h1 className="font-serif" style={{
                fontSize: "2rem", fontWeight: 700, color: "#fff", marginTop: "1rem", lineHeight: 1.2,
              }}>
                {walkInfo.title}
              </h1>
              <p className="font-serif" style={{
                fontSize: "1rem", color: "rgba(255,255,255,0.75)", marginTop: "0.5rem",
              }}>
                {walkInfo.subtitle}
              </p>
              <p style={{
                fontSize: "0.9rem", color: "rgba(255,255,255,0.7)", marginTop: "0.75rem",
                lineHeight: 1.6, maxWidth: "32rem",
              }}>
                {walkInfo.description}
              </p>
              <p style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.4)", marginTop: "1rem" }}>
                {artworks.length} verk
              </p>
            </div>
          </div>

          {/* Walk artworks — large, one per row for immersive feel */}
          <div style={{ padding: "1.5rem 1rem 4rem" }}>
            {artworks.map((a: WalkArtwork, i: number) => (
              <div key={a.id}>
                <a href={"/artwork/" + a.id}
                  style={{
                    display: "block", borderRadius: "1rem", overflow: "hidden",
                    backgroundColor: "#F0EBE3", marginBottom: "1rem",
                    textDecoration: "none",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                  }}>
                  <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", overflow: "hidden" }}>
                    <img src={a.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
                      alt={a.title_sv || ""} width={800} height={600}
                      onError={(e: any) => { e.target.style.display = "none"; }}
                      loading="lazy" style={{ width: "100%", display: "block" }} />
                  </div>
                  <div style={{ padding: "1rem" }}>
                    <p style={{ fontSize: "0.7rem", color: "#D4CDC3", marginBottom: "0.25rem" }}>{i + 1} / {artworks.length}</p>
                    <p className="font-serif" style={{
                      fontSize: "1.125rem", fontWeight: 600, color: "#3D3831", lineHeight: 1.3,
                    }}>
                      {a.title_sv || a.title_en || "Utan titel"}
                    </p>
                    <p style={{ fontSize: "0.8rem", color: "#8C8478", marginTop: "0.375rem" }}>
                      {parseArtist(a.artists)}
                    </p>
                    {a.dating_text && (
                      <p style={{ fontSize: "0.75rem", color: "#D4CDC3", marginTop: "0.25rem" }}>{a.dating_text}</p>
                    )}
                  </div>
                </a>
                {a.narrative_text && i < artworks.length - 1 && (
                  <div style={{
                    backgroundColor: "#F5F0E8",
                    borderRadius: "0.9rem",
                    padding: "0.9rem 1rem",
                    margin: "0 0 1.25rem",
                    color: "#6C6257",
                  }}>
                    <p className="font-serif" style={{ fontStyle: "italic", fontSize: "0.95rem", lineHeight: 1.6 }}>
                      {a.narrative_text}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
