import type { Route } from "./+types/walks";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Vandringar — Kabinett" },
    { name: "description", content: "Curaterade vandringar genom Nationalmuseums samling." },
  ];
}

interface Walk {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  query: string;
  limit: number;
}

const WALKS: Walk[] = [
  {
    slug: "karlek",
    title: "Kärlekens konst",
    subtitle: "Venus, Amor och begär genom seklerna",
    description: "Från renässansens Venus till 1700-talets kärlekslektioner. Kärlek har alltid varit konstens favoritämne — här är bevisen.",
    color: "#8B2500",
    query: "(title_sv LIKE '%kärlek%' OR title_sv LIKE '%Venus%' OR title_sv LIKE '%Amor %' OR title_sv LIKE '%kyss%' OR title_sv LIKE '%älskande%') AND category LIKE '%Målningar%'",
    limit: 20,
  },
  {
    slug: "morker",
    title: "I mörkret",
    subtitle: "De mörkaste verken i samlingen",
    description: "Porträtt som stirrar ut ur svärtan. Scener som knappt syns. Vad gömmer sig i skuggorna?",
    color: "#1A1815",
    query: "color_r IS NOT NULL AND (color_r+color_g+color_b) < 100 AND category LIKE '%Målningar%'",
    limit: 20,
  },
  {
    slug: "blatt",
    title: "Den blå timmen",
    subtitle: "Skymning, hav och melankoli",
    description: "Blått har alltid betytt djup, längtan och oändlighet. En vandring genom samlingens blåaste verk.",
    color: "#1A3A5C",
    query: "color_r IS NOT NULL AND color_b > color_r * 1.3 AND color_b > color_g AND color_b > 80 AND category LIKE '%Målningar%'",
    limit: 20,
  },
  {
    slug: "guld",
    title: "Allt som glimmar",
    subtitle: "Gyllene ljus, höstfärger och rikedom",
    description: "Solnedgångar, guldramar, höstlöv. Den varma glöden som löper genom fyra sekel av svensk konst.",
    color: "#8B7420",
    query: "color_r IS NOT NULL AND color_r > 160 AND color_g > 130 AND color_b < 80 AND category LIKE '%Målningar%'",
    limit: 20,
  },
  {
    slug: "ansikten",
    title: "Ansikten genom tiden",
    subtitle: "500 år av blickar",
    description: "Från stela 1500-talsporträtt till expressionistiska ansikten. Hur vi avbildar varandra förändras — men blicken består.",
    color: "#5C4A3A",
    query: "(title_sv LIKE '%porträtt%' OR title_sv LIKE '%Porträtt%') AND category LIKE '%Målningar%' AND year_start IS NOT NULL",
    limit: 24,
  },
  {
    slug: "vatten",
    title: "Vid vattnet",
    subtitle: "Hav, sjöar och stilla floder",
    description: "Sverige är ett land av vatten. Här är konstnärernas tolkningar — från stormiga kuster till spegelblanka insjöar.",
    color: "#3A5A6B",
    query: "(title_sv LIKE '%hav%' OR title_sv LIKE '%sjö%' OR title_sv LIKE '%vatten%' OR title_sv LIKE '%kust%' OR title_sv LIKE '%strand%' OR title_sv LIKE '%flod%') AND category LIKE '%Målningar%'",
    limit: 20,
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("walk") || "";
  const db = getDb();

  // Get a preview image for each walk
  const walkPreviews = WALKS.map(w => {
    let previewUrl: string | null = null;
    try {
      const row = db.prepare(
        `SELECT iiif_url FROM artworks WHERE ${w.query} AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90 ORDER BY RANDOM() LIMIT 1`
      ).get() as any;
      if (row?.iiif_url) previewUrl = row.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg";
    } catch {}
    return { slug: w.slug, title: w.title, subtitle: w.subtitle, color: w.color, previewUrl };
  });

  // If a walk is selected, get the artworks
  let artworks: any[] = [];
  let walkInfo: { title: string; description: string; color: string } | null = null;
  if (selected) {
    const walk = WALKS.find(w => w.slug === selected);
    if (walk) {
      walkInfo = { title: walk.title, description: walk.description, color: walk.color };
      try {
        const orderBy = walk.slug === "ansikten" ? "year_start ASC" : "RANDOM()";
        artworks = db.prepare(
          `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
           FROM artworks WHERE ${walk.query} AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
           ORDER BY ${orderBy} LIMIT ${walk.limit}`
        ).all() as any[];
      } catch {}
    }
  }

  return { walkPreviews, artworks, selected, walkInfo };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
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
            {artworks.map((a: any, i: number) => (
              <a key={a.id} href={"/artwork/" + a.id}
                style={{
                  display: "block", borderRadius: "1rem", overflow: "hidden",
                  backgroundColor: "#F0EBE3", marginBottom: "1.25rem",
                  textDecoration: "none",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                }}>
                <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", overflow: "hidden" }}>
                  <img src={a.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
                    alt={a.title_sv || ""} width={800} height={600}
                    onError={(e: any) => { e.target.style.display = "none"; }}
                    style={{ width: "100%", display: "block" }} />
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
            ))}
          </div>
        </>
      )}
    </div>
  );
}
