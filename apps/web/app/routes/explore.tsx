import type { Route } from "./+types/explore";
import { getDb, type ArtworkRow } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Utforska — Kabinett" },
    { name: "description", content: "Utforska Nationalmuseums samling." },
  ];
}

const CATEGORIES = [
  { label: "Alla", value: "" },
  { label: "Målningar", value: "Målningar" },
  { label: "Skulptur", value: "Skulptur" },
  { label: "Grafik", value: "Grafik" },
  { label: "Teckningar", value: "Frihandsteckningar" },
  { label: "Miniatyrer", value: "Miniatyr" },
  { label: "Keramik", value: "Keramik" },
  { label: "Textil", value: "Textil" },
  { label: "Fotografier", value: "Fotografier" },
];

const PERIODS = [
  { label: "Alla tider", value: "" },
  { label: "1400–1500", from: 1400, to: 1599 },
  { label: "1600-tal", from: 1600, to: 1699 },
  { label: "1700-tal", from: 1700, to: 1799 },
  { label: "1800-tal", from: 1800, to: 1899 },
  { label: "1900-tal", from: 1900, to: 1970 },
];

const COLORS = [
  { label: "Alla färger", r: 0, g: 0, b: 0, value: "" },
  { label: "Röd", r: 160, g: 50, b: 40, value: "red" },
  { label: "Blå", r: 40, g: 60, b: 140, value: "blue" },
  { label: "Grön", r: 50, g: 120, b: 50, value: "green" },
  { label: "Guld", r: 180, g: 150, b: 60, value: "gold" },
  { label: "Mörk", r: 30, g: 28, b: 25, value: "dark" },
  { label: "Ljus", r: 220, g: 215, b: 200, value: "light" },
];

const PAGE_SIZE = 40;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("cat") || "";
  const period = url.searchParams.get("period") || "";
  const color = url.searchParams.get("color") || "";
  const shuffle = url.searchParams.get("shuffle") || "";

  const db = getDb();

  const conditions: string[] = ["iiif_url IS NOT NULL", "LENGTH(iiif_url) > 90"];
  const params: any[] = [];

  if (category) {
    conditions.push("category LIKE ?");
    params.push(`%${category}%`);
  }

  const periodObj = PERIODS.find(p => p.label === period);
  if (periodObj && periodObj.from) {
    conditions.push("year_start >= ? AND year_start <= ?");
    params.push(periodObj.from, periodObj.to);
  }

  let orderBy = "RANDOM()";
  const colorObj = COLORS.find(c => c.value === color);
  if (colorObj && colorObj.value) {
    conditions.push("color_r IS NOT NULL");
    orderBy = `ABS(color_r - ${colorObj.r}) + ABS(color_g - ${colorObj.g}) + ABS(color_b - ${colorObj.b})`;
  }

  const where = conditions.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${where}`).get(...params) as any).c;

  params.push(PAGE_SIZE);
  const rows = db.prepare(
    `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, category
     FROM artworks WHERE ${where} ORDER BY ${orderBy} LIMIT ?`
  ).all(...params) as any[];

  const artworks = rows.map((r: any) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    artist: parseArtist(r.artists),
    imageUrl: r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    year: r.dating_text || "",
    color: r.dominant_color || "#D4CDC3",
  }));

  return { artworks, total, category, period, color };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

function buildUrl(cat: string, period: string, color: string): string {
  const p = new URLSearchParams();
  if (cat) p.set("cat", cat);
  if (period) p.set("period", period);
  if (color) p.set("color", color);
  p.set("shuffle", String(Math.random()).slice(2, 8));
  const qs = p.toString();
  return "/explore" + (qs ? "?" + qs : "");
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { artworks, total, category, period, color } = loaderData;

  const activeFilters = [category, period, color].filter(Boolean).length;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Header */}
      <div style={{ padding: "2rem 1rem 0" }}>
        <h1 className="font-serif" style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3D3831" }}>
          Utforska
        </h1>
        <p style={{ fontSize: "0.875rem", color: "#8C8478", marginTop: "0.25rem" }}>
          {total.toLocaleString("sv-SE")} verk
          {activeFilters > 0 && " matchar"}
        </p>
      </div>

      {/* Filter sections */}
      <div style={{ padding: "1rem 1rem 0" }}>
        {/* Category */}
        <div style={{ marginBottom: "0.75rem" }}>
          <p style={{ fontSize: "0.65rem", color: "#8C8478", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Kategori</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {CATEGORIES.map(f => (
              <a key={f.value} href={buildUrl(f.value, period, color)}
                style={{
                  padding: "0.5rem 0.875rem",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  backgroundColor: category === f.value ? "#3D3831" : "#fff",
                  color: category === f.value ? "#FAF7F2" : "#8C8478",
                  boxShadow: category === f.value ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                }}>
                {f.label}
              </a>
            ))}
          </div>
        </div>

        {/* Period */}
        <div style={{ marginBottom: "0.75rem" }}>
          <p style={{ fontSize: "0.65rem", color: "#8C8478", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Tidsperiod</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {PERIODS.map(f => (
              <a key={f.label} href={buildUrl(category, f.label === "Alla tider" ? "" : f.label, color)}
                style={{
                  padding: "0.5rem 0.875rem",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  backgroundColor: period === f.label ? "#3D3831" : "#fff",
                  color: period === f.label ? "#FAF7F2" : "#8C8478",
                  boxShadow: period === f.label ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                }}>
                {f.label}
              </a>
            ))}
          </div>
        </div>

        {/* Color */}
        <div style={{ marginBottom: "0.75rem" }}>
          <p style={{ fontSize: "0.65rem", color: "#8C8478", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>Färg</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {COLORS.map(f => (
              <a key={f.value} href={buildUrl(category, period, f.value)}
                style={{
                  padding: "0.5rem 0.875rem",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  backgroundColor: color === f.value ? "#3D3831" : "#fff",
                  color: color === f.value ? "#FAF7F2" : "#8C8478",
                  boxShadow: color === f.value ? "none" : "0 1px 2px rgba(0,0,0,0.04)",
                }}>
                {f.value && (
                  <span style={{
                    width: "0.625rem", height: "0.625rem", borderRadius: "50%",
                    backgroundColor: `rgb(${f.r},${f.g},${f.b})`,
                    border: f.value === "light" ? "1px solid #D4CDC3" : "none",
                  }} />
                )}
                {f.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Shuffle button */}
      <div style={{ padding: "0.5rem 1rem 1rem", display: "flex", gap: "0.5rem" }}>
        <a href={buildUrl(category, period, color)}
          style={{
            padding: "0.625rem 1.25rem",
            borderRadius: "999px",
            backgroundColor: "#3D3831",
            color: "#FAF7F2",
            fontSize: "0.8rem",
            fontWeight: 500,
            textDecoration: "none",
          }}>
          ✦ Slumpa nya
        </a>
        {activeFilters > 0 && (
          <a href="/explore"
            style={{
              padding: "0.625rem 1.25rem",
              borderRadius: "999px",
              backgroundColor: "#F0EBE3",
              color: "#8C8478",
              fontSize: "0.8rem",
              fontWeight: 500,
              textDecoration: "none",
            }}>
            Rensa filter
          </a>
        )}
      </div>

      {/* Results */}
      <div style={{ padding: "0 1rem 4rem" }}>
        {artworks.length > 0 ? (
          <div style={{ columnCount: 2, columnGap: "0.75rem" }}>
            {artworks.map((a: any) => (
              <a key={a.id} href={"/artwork/" + a.id}
                style={{
                  breakInside: "avoid", display: "block", borderRadius: "0.75rem",
                  overflow: "hidden", backgroundColor: "#F0EBE3", marginBottom: "0.75rem",
                  textDecoration: "none",
                }}>
                <div style={{ backgroundColor: a.color, aspectRatio: "3/4", overflow: "hidden" }}>
                  <img src={a.imageUrl} alt={a.title} width={400} height={533}
                    onError={(e: any) => { e.target.style.display = "none"; }}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "0.625rem" }}>
                  <p style={{
                    fontSize: "0.8rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.3,
                    overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {a.title}</p>
                  <p style={{ fontSize: "0.7rem", color: "#8C8478", marginTop: "0.25rem" }}>{a.artist}</p>
                  {a.year && <p style={{ fontSize: "0.65rem", color: "#D4CDC3", marginTop: "0.125rem" }}>{a.year}</p>}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p style={{ textAlign: "center", color: "#8C8478", padding: "3rem 0" }}>
            Inga verk matchar dina filter. Prova en annan kombination.
          </p>
        )}
      </div>
    </div>
  );
}
