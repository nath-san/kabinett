import type { Route } from "./+types/explore";
import { getDb } from "../lib/db.server";

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
  { label: "Teckningar", value: "Frihandsteckningar" },
  { label: "Grafik", value: "Grafik" },
  { label: "Miniatyrer", value: "Miniatyr" },
  { label: "Keramik", value: "Keramik" },
  { label: "Fotografier", value: "Fotografier" },
  { label: "Textil", value: "Textil" },
];

const PERIODS = [
  { label: "Alla", value: "", from: 0, to: 0 },
  { label: "1400–1500", value: "1400", from: 1400, to: 1599 },
  { label: "1600-tal", value: "1600", from: 1600, to: 1699 },
  { label: "1700-tal", value: "1700", from: 1700, to: 1799 },
  { label: "Tidigt 1800", value: "1800a", from: 1800, to: 1849 },
  { label: "Sent 1800", value: "1800b", from: 1850, to: 1899 },
  { label: "1900-tal", value: "1900", from: 1900, to: 1970 },
];

const COLORS = [
  { label: "Alla", value: "", hex: "", r: 0, g: 0, b: 0 },
  { label: "Röd", value: "red", hex: "#A03028", r: 160, g: 48, b: 40 },
  { label: "Orange", value: "orange", hex: "#C07030", r: 192, g: 112, b: 48 },
  { label: "Guld", value: "gold", hex: "#B89830", r: 184, g: 152, b: 48 },
  { label: "Grön", value: "green", hex: "#3A7838", r: 58, g: 120, b: 56 },
  { label: "Blå", value: "blue", hex: "#28508C", r: 40, g: 80, b: 140 },
  { label: "Lila", value: "purple", hex: "#684080", r: 104, g: 64, b: 128 },
  { label: "Rosa", value: "pink", hex: "#C07888", r: 192, g: 120, b: 136 },
  { label: "Mörk", value: "dark", hex: "#1E1C18", r: 30, g: 28, b: 24 },
  { label: "Ljus", value: "light", hex: "#E0D8C8", r: 224, g: 216, b: 200 },
];

const SORTS = [
  { label: "Slumpa", value: "random" },
  { label: "Äldst först", value: "oldest" },
  { label: "Nyast först", value: "newest" },
];

const PAGE_SIZE = 40;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("cat") || "";
  const periodVal = url.searchParams.get("period") || "";
  const color = url.searchParams.get("color") || "";
  const sort = url.searchParams.get("sort") || "random";

  const db = getDb();

  const conditions: string[] = ["iiif_url IS NOT NULL", "LENGTH(iiif_url) > 90"];
  const params: any[] = [];

  if (category) {
    conditions.push("category LIKE ?");
    params.push(`%${category}%`);
  }

  const periodObj = PERIODS.find(p => p.value === periodVal);
  if (periodObj && periodObj.from) {
    conditions.push("year_start >= ? AND year_start <= ?");
    params.push(periodObj.from, periodObj.to);
  }

  const colorObj = COLORS.find(c => c.value === color);
  let orderBy = "RANDOM()";
  if (colorObj && colorObj.value) {
    conditions.push("color_r IS NOT NULL");
    if (sort === "random") {
      // Sort by color proximity with some randomness
      orderBy = `ABS(color_r - ${colorObj.r}) + ABS(color_g - ${colorObj.g}) + ABS(color_b - ${colorObj.b})`;
    }
  }

  if (sort === "oldest") orderBy = "year_start ASC NULLS LAST";
  if (sort === "newest") orderBy = "year_start DESC NULLS LAST";
  if (sort === "random" && !colorObj?.value) orderBy = "RANDOM()";

  const where = conditions.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${where}`).get(...params) as any).c;

  params.push(PAGE_SIZE);
  const rows = db.prepare(
    `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text
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

  return { artworks, total, category, period: periodVal, color, sort };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

function buildUrl(cat: string, period: string, color: string, sort: string): string {
  const p = new URLSearchParams();
  if (cat) p.set("cat", cat);
  if (period) p.set("period", period);
  if (color) p.set("color", color);
  if (sort && sort !== "random") p.set("sort", sort);
  if (sort === "random") p.set("s", String(Math.random()).slice(2, 6));
  const qs = p.toString();
  return "/explore" + (qs ? "?" + qs : "");
}

// Chip styles
const chip = (active: boolean) => ({
  padding: "0.5rem 0.875rem",
  borderRadius: "999px",
  fontSize: "0.8rem",
  fontWeight: 500 as const,
  whiteSpace: "nowrap" as const,
  textDecoration: "none" as const,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: "0.375rem",
  backgroundColor: active ? "#3D3831" : "#fff",
  color: active ? "#FAF7F2" : "#3D3831",
  boxShadow: active ? "none" : "inset 0 0 0 1px rgba(212,205,195,0.5)",
  transition: "all 0.15s ease",
});

const sectionLabel = {
  fontSize: "0.7rem",
  color: "#8C8478",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  fontWeight: 500 as const,
  marginBottom: "0.5rem",
};

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { artworks, total, category, period, color, sort } = loaderData;
  const activeFilters = [category, period, color].filter(Boolean).length;

  // Surprise combos
  const surprises = [
    { cat: "Målningar", period: "1800b", color: "blue", label: "Blåa 1800-talsmålningar" },
    { cat: "Skulptur", period: "", color: "dark", label: "Mörka skulpturer" },
    { cat: "Målningar", period: "1700", color: "gold", label: "Gyllene 1700-tal" },
    { cat: "Målningar", period: "1800b", color: "green", label: "Gröna landskap" },
    { cat: "Fotografier", period: "1900", color: "", label: "Fotografier 1900-tal" },
  ];
  const surprise = surprises[Math.floor(Date.now() / 60000) % surprises.length];

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Header */}
      <div style={{ padding: "2rem 1rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 className="font-serif" style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3D3831" }}>
              Utforska
            </h1>
            <p style={{ fontSize: "0.8rem", color: "#8C8478", marginTop: "0.25rem" }}>
              {total.toLocaleString("sv-SE")} verk
            </p>
          </div>
          {activeFilters > 0 && (
            <a href="/explore" style={{
              fontSize: "0.75rem", color: "#8C8478", textDecoration: "none",
              padding: "0.375rem 0.75rem", borderRadius: "999px",
              backgroundColor: "#F0EBE3",
            }}>
              Rensa alla
            </a>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ padding: "0 1rem" }}>
        {/* Category */}
        <div style={{ marginBottom: "1rem" }}>
          <p style={sectionLabel}>Kategori</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {CATEGORIES.map(f => (
              <a key={f.value} href={buildUrl(f.value, period, color, sort)} style={chip(category === f.value)}>
                {f.label}
              </a>
            ))}
          </div>
        </div>

        {/* Period */}
        <div style={{ marginBottom: "1rem" }}>
          <p style={sectionLabel}>Tidsperiod</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {PERIODS.map(f => (
              <a key={f.value} href={buildUrl(category, f.value, color, sort)} style={chip(period === f.value)}>
                {f.label}
              </a>
            ))}
          </div>
        </div>

        {/* Color */}
        <div style={{ marginBottom: "1rem" }}>
          <p style={sectionLabel}>Färg</p>
          <div style={{ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.25rem" }} className="no-scrollbar">
            {COLORS.map(f => (
              <a key={f.value} href={buildUrl(category, period, f.value, sort)}
                style={{
                  ...chip(color === f.value),
                  ...(f.value === "light" && color !== f.value ? { boxShadow: "inset 0 0 0 1px #D4CDC3" } : {}),
                }}>
                {f.hex && (
                  <span style={{
                    width: "0.75rem", height: "0.75rem", borderRadius: "50%",
                    backgroundColor: f.hex,
                    border: f.value === "light" ? "1px solid #C4BDB0" : "none",
                    flexShrink: 0,
                  }} />
                )}
                {f.label}
              </a>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div style={{ marginBottom: "0.75rem" }}>
          <p style={sectionLabel}>Sortering</p>
          <div style={{ display: "flex", gap: "0.375rem" }}>
            {SORTS.map(s => (
              <a key={s.value} href={buildUrl(category, period, color, s.value)}
                style={chip(sort === s.value)}>
                {s.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Quick suggestion */}
      {activeFilters === 0 && (
        <div style={{ padding: "0.5rem 1rem 0" }}>
          <a href={buildUrl(surprise.cat, surprise.period, surprise.color, "random")}
            style={{
              display: "inline-block",
              padding: "0.5rem 1rem",
              borderRadius: "0.75rem",
              backgroundColor: "#F0EBE3",
              fontSize: "0.8rem",
              color: "#3D3831",
              textDecoration: "none",
              fontStyle: "italic",
            }}>
            Prova: {surprise.label} →
          </a>
        </div>
      )}

      {/* Results */}
      <div style={{ padding: "1.25rem 1rem 4rem" }}>
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
          <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
            <p style={{ fontSize: "1.25rem", color: "#D4CDC3" }}>Inga träffar</p>
            <p style={{ fontSize: "0.875rem", color: "#8C8478", marginTop: "0.5rem" }}>Prova en annan kombination.</p>
            <a href="/explore" style={{
              display: "inline-block", marginTop: "1rem",
              padding: "0.625rem 1.25rem", borderRadius: "999px",
              backgroundColor: "#3D3831", color: "#FAF7F2",
              fontSize: "0.8rem", fontWeight: 500, textDecoration: "none",
            }}>
              Rensa filter
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
