import type { Route } from "./+types/colors";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

interface PaletteConfig {
  label: string;
  slug: string;
  bg: string;
  sql: string;
}

const PALETTES: PaletteConfig[] = [
  { label: "Röda toner", slug: "red", bg: "#8B2500",
    sql: "color_r > color_g * 1.4 AND color_r > color_b * 1.4 AND color_r > 80 AND category LIKE '%Målningar%'" },
  { label: "Blå toner", slug: "blue", bg: "#1A3A5C",
    sql: "color_b > color_r * 1.3 AND color_b > color_g * 1.2 AND color_b > 80 AND category LIKE '%Målningar%'" },
  { label: "Gröna toner", slug: "green", bg: "#2D4A2D",
    sql: "color_g > color_r * 1.2 AND color_g > color_b * 1.2 AND color_g > 80" },
  { label: "Guld & gult", slug: "gold", bg: "#8B7420",
    sql: "color_r > 150 AND color_g > 120 AND color_b < color_r * 0.6" },
  { label: "Mörka verk", slug: "dark", bg: "#1A1815",
    sql: "(color_r + color_g + color_b) < 120 AND category LIKE '%Målningar%'" },
  { label: "Ljusa verk", slug: "light", bg: "#D4CDC3",
    sql: "(color_r + color_g + color_b) > 600 AND category LIKE '%Målningar%'" },
  { label: "Varma toner", slug: "warm", bg: "#8B5E3C",
    sql: "color_r > color_b * 1.5 AND color_g > color_b AND (color_r + color_g) > 200 AND category LIKE '%Målningar%'" },
  { label: "Kalla toner", slug: "cool", bg: "#3A5A6B",
    sql: "color_b > color_r AND color_g > color_r * 0.8 AND (color_g + color_b) > 200 AND category LIKE '%Målningar%'" },
];

function getSql(slug: string): string | null {
  return PALETTES.find(p => p.slug === slug)?.sql || null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("palette") || "";
  const db = getDb();

  // One hero image per palette — only send safe data to client
  const paletteCards: Array<{ label: string; slug: string; bg: string; heroUrl: string | null }> = [];
  for (const p of PALETTES) {
    let heroUrl: string | null = null;
    try {
      const hero = db.prepare(
        `SELECT iiif_url FROM artworks
         WHERE color_r IS NOT NULL AND iiif_url IS NOT NULL AND ${p.sql}
         ORDER BY RANDOM() LIMIT 1`
      ).get() as any;
      if (hero?.iiif_url) {
        heroUrl = hero.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg";
      }
    } catch {}
    paletteCards.push({ label: p.label, slug: p.slug, bg: p.bg, heroUrl });
  }

  let artworks: Array<{ id: number; title_sv: string; iiif_url: string; dominant_color: string; artists: string; dating_text: string }> = [];
  let paletteLabel = "";
  const sql = getSql(selected);
  if (sql) {
    paletteLabel = PALETTES.find(p => p.slug === selected)!.label;
    try {
      artworks = db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
         FROM artworks WHERE color_r IS NOT NULL AND ${sql}
         ORDER BY RANDOM() LIMIT 40`
      ).all() as any[];
    } catch {}
  }

  return { paletteCards, artworks, selected, paletteLabel };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Colors({ loaderData }: Route.ComponentProps) {
  const { paletteCards, artworks, selected, paletteLabel } = loaderData;

  return (
    <div className="min-h-screen pt-14" style={{ backgroundColor: "#FAF7F2" }}>
      <div style={{ padding: "2.5rem 1rem 1.5rem" }}>
        <h1 className="font-serif text-3xl font-bold" style={{ color: "#3D3831" }}>Färger</h1>
        <p style={{ color: "#8C8478", fontSize: "0.875rem", marginTop: "0.5rem" }}>
          Välj en färgvärld och låt konsten tala.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", padding: "0 1rem" }}>
        {paletteCards.map((p) => (
          <a
            key={p.slug}
            href={"/colors?palette=" + p.slug + "#results"}
            style={{
              display: "block",
              position: "relative",
              overflow: "hidden",
              borderRadius: "1rem",
              aspectRatio: "4/3",
              backgroundColor: p.bg,
              boxShadow: selected === p.slug ? "0 0 0 2px #3D3831, 0 0 0 4px #FAF7F2" : "none",
            }}
          >
            {p.heroUrl && (
              <img
                src={p.heroUrl}
                alt=""
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            )}
            <div style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 60%)",
            }} />
            <div style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: "0.75rem",
            }}>
              <h2 className="font-serif font-semibold" style={{
                color: "#fff",
                fontSize: "1rem",
                textShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }}>
                {p.label}
              </h2>
            </div>
          </a>
        ))}
      </div>

      {selected && artworks.length > 0 && (
        <div id="results" style={{ backgroundColor: "#FAF7F2", padding: "3rem 1rem 6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
            <h2 className="font-serif text-xl font-semibold" style={{ color: "#3D3831" }}>
              {paletteLabel}
            </h2>
            <a href={"/colors?palette=" + selected + "#results"}
              style={{ fontSize: "0.875rem", color: "#8C8478" }}>
              ✦ Slumpa nya
            </a>
          </div>

          <div className="columns-2 gap-3 space-y-3">
            {artworks.map((a) => (
              <a key={a.id} href={"/artwork/" + a.id}
                className="art-card block break-inside-avoid rounded-xl overflow-hidden group"
                style={{ backgroundColor: "#F0EBE3" }}>
                <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", aspectRatio: "3/4" }}
                  className="overflow-hidden">
                  <img src={a.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                    alt={a.title_sv || ""} width={400} height={533}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "0.75rem" }}>
                  <p style={{ fontSize: "0.875rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.4 }}>
                    {a.title_sv || "Utan titel"}</p>
                  <p style={{ fontSize: "0.75rem", color: "#8C8478", marginTop: "0.25rem" }}>{parseArtist(a.artists)}</p>
                  {a.dating_text && <p style={{ fontSize: "0.75rem", color: "#D4CDC3", marginTop: "0.125rem" }}>{a.dating_text}</p>}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {!selected && (
        <div style={{ padding: "2rem 1rem", textAlign: "center" }}>
          <p style={{ color: "#D4CDC3", fontSize: "0.875rem" }}>Tryck på en färg för att utforska.</p>
        </div>
      )}
    </div>
  );
}
