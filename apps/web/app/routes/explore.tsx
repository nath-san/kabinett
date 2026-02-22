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
  { label: "1400-1500", value: "1400", from: 1400, to: 1599 },
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
  { label: "Äldst", value: "oldest" },
  { label: "Nyast", value: "newest" },
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

  if (category) { conditions.push("category LIKE ?"); params.push(`%${category}%`); }
  const periodObj = PERIODS.find(p => p.value === periodVal);
  if (periodObj?.from) { conditions.push("year_start >= ? AND year_start <= ?"); params.push(periodObj.from, periodObj.to); }

  const colorObj = COLORS.find(c => c.value === color);
  let orderBy = "RANDOM()";
  if (colorObj?.value) {
    conditions.push("color_r IS NOT NULL");
    if (sort === "random") orderBy = `ABS(color_r - ${colorObj.r}) + ABS(color_g - ${colorObj.g}) + ABS(color_b - ${colorObj.b})`;
  }
  if (sort === "oldest") orderBy = "year_start ASC NULLS LAST";
  if (sort === "newest") orderBy = "year_start DESC NULLS LAST";

  const where = conditions.join(" AND ");
  const total = (db.prepare(`SELECT COUNT(*) as c FROM artworks WHERE ${where}`).get(...params) as any).c;
  params.push(PAGE_SIZE);
  const rows = db.prepare(
    `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text FROM artworks WHERE ${where} ORDER BY ${orderBy} LIMIT ?`
  ).all(...params) as any[];

  const artworks = rows.map((r: any) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    artist: parseArtist(r.artists),
    imageUrl: r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    heroUrl: r.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg",
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
  return "/explore" + (p.toString() ? "?" + p.toString() : "");
}

const chip = (active: boolean) => ({
  padding: "0.4rem 0.75rem",
  borderRadius: "999px",
  fontSize: "0.75rem",
  fontWeight: 500 as const,
  whiteSpace: "nowrap" as const,
  textDecoration: "none" as const,
  display: "inline-flex" as const,
  alignItems: "center" as const,
  gap: "0.3rem",
  backgroundColor: active ? "#3D3831" : "#fff",
  color: active ? "#FAF7F2" : "#3D3831",
  boxShadow: active ? "none" : "inset 0 0 0 1px rgba(212,205,195,0.5)",
});

const sLabel = {
  fontSize: "0.65rem", color: "#8C8478",
  textTransform: "uppercase" as const, letterSpacing: "0.06em",
  fontWeight: 500 as const, marginBottom: "0.375rem",
};

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { artworks, total, category, period, color, sort } = loaderData;
  const activeFilters = [category, period, color].filter(Boolean).length;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Compact header */}
      <div style={{ padding: "0.875rem 1rem 0.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          <h1 className="font-serif" style={{ fontSize: "1.375rem", fontWeight: 700, color: "#3D3831" }}>Utforska</h1>
          <span style={{ fontSize: "0.75rem", color: "#D4CDC3" }}>{total.toLocaleString("sv-SE")}</span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {activeFilters > 0 && (
            <a href="/explore" style={{ fontSize: "0.7rem", color: "#8C8478", textDecoration: "none" }}>Rensa</a>
          )}
          <button id="filter-toggle" style={{
            padding: "0.375rem 0.75rem", borderRadius: "999px",
            border: "1px solid " + (activeFilters > 0 ? "#3D3831" : "#D4CDC3"),
            backgroundColor: activeFilters > 0 ? "#3D3831" : "transparent",
            color: activeFilters > 0 ? "#FAF7F2" : "#3D3831",
            fontSize: "0.75rem", fontWeight: 500, cursor: "pointer",
            display: "flex", alignItems: "center", gap: "0.25rem",
          }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
            {activeFilters > 0 ? `Filter (${activeFilters})` : "Filter"}
          </button>
        </div>
      </div>

      {/* Active filter tags */}
      {activeFilters > 0 && (
        <div style={{ padding: "0 1rem 0.5rem", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {category && <a href={buildUrl("", period, color, sort)} style={{ ...chip(true), fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}>{CATEGORIES.find(c=>c.value===category)?.label} ×</a>}
          {period && <a href={buildUrl(category, "", color, sort)} style={{ ...chip(true), fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}>{PERIODS.find(p=>p.value===period)?.label} ×</a>}
          {color && <a href={buildUrl(category, period, "", sort)} style={{ ...chip(true), fontSize: "0.65rem", padding: "0.25rem 0.5rem" }}>{COLORS.find(c=>c.value===color)?.label} ×</a>}
        </div>
      )}

      {/* Collapsible filter panel */}
      <div id="filter-panel" style={{ display: "none", padding: "0.5rem 1rem 0.75rem", borderBottom: "1px solid #F0EBE3" }}>
        <div style={{ marginBottom: "0.625rem" }}>
          <p style={sLabel}>Kategori</p>
          <div style={{ display: "flex", gap: "0.25rem", overflowX: "auto" }} className="no-scrollbar">
            {CATEGORIES.map(f => <a key={f.value} href={buildUrl(f.value, period, color, sort)} style={chip(category === f.value)}>{f.label}</a>)}
          </div>
        </div>
        <div style={{ marginBottom: "0.625rem" }}>
          <p style={sLabel}>Tidsperiod</p>
          <div style={{ display: "flex", gap: "0.25rem", overflowX: "auto" }} className="no-scrollbar">
            {PERIODS.map(f => <a key={f.value} href={buildUrl(category, f.value, color, sort)} style={chip(period === f.value)}>{f.label}</a>)}
          </div>
        </div>
        <div style={{ marginBottom: "0.625rem" }}>
          <p style={sLabel}>Färg</p>
          <div style={{ display: "flex", gap: "0.25rem", overflowX: "auto" }} className="no-scrollbar">
            {COLORS.map(f => <a key={f.value} href={buildUrl(category, period, f.value, sort)} style={chip(color === f.value)}>
              {f.hex && <span style={{ width: "0.6rem", height: "0.6rem", borderRadius: "50%", backgroundColor: f.hex, border: f.value==="light"?"1px solid #C4BDB0":"none", flexShrink: 0 }} />}
              {f.label}
            </a>)}
          </div>
        </div>
        <div>
          <p style={sLabel}>Sortering</p>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {SORTS.map(s => <a key={s.value} href={buildUrl(category, period, color, s.value)} style={chip(sort === s.value)}>{s.label}</a>)}
          </div>
        </div>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `document.getElementById('filter-toggle').addEventListener('click',function(){var p=document.getElementById('filter-panel');p.style.display=p.style.display==='none'?'block':'none';});` }} />

      {/* Results */}
      <div style={{ padding: "0.5rem 1rem 4rem" }}>
        {artworks.length > 0 ? (
          <>
            {/* Hero — first artwork, full width */}
            <a href={"/artwork/" + artworks[0].id} data-id={artworks[0].id}
              style={{
                display: "block", borderRadius: "1rem", overflow: "hidden",
                backgroundColor: artworks[0].color, marginBottom: "0.75rem",
                textDecoration: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              }}>
              <div style={{ overflow: "hidden" }}>
                <img src={artworks[0].heroUrl} alt={artworks[0].title} width={800}
                  onError={(e: any) => { e.target.style.display = "none"; }}
                  style={{ width: "100%", display: "block" }} />
              </div>
              <div style={{ padding: "0.875rem", backgroundColor: "#F0EBE3" }}>
                <p className="font-serif" style={{ fontSize: "1.125rem", fontWeight: 600, color: "#3D3831", lineHeight: 1.3 }}>{artworks[0].title}</p>
                <p style={{ fontSize: "0.8rem", color: "#8C8478", marginTop: "0.25rem" }}>{artworks[0].artist}</p>
                {artworks[0].year && <p style={{ fontSize: "0.7rem", color: "#D4CDC3", marginTop: "0.125rem" }}>{artworks[0].year}</p>}
              </div>
            </a>

            {/* Masonry grid */}
            <div id="grid" style={{ columnCount: 2, columnGap: "0.75rem" }}>
              {artworks.slice(1).map((a: any) => (
                <a key={a.id} href={"/artwork/" + a.id} data-id={a.id}
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
                  <div style={{ padding: "0.5rem" }}>
                    <p style={{ fontSize: "0.75rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.title}</p>
                    <p style={{ fontSize: "0.65rem", color: "#8C8478", marginTop: "0.1875rem" }}>{a.artist}</p>
                  </div>
                </a>
              ))}
            </div>

            {/* Infinite scroll */}
            <div id="load-more" style={{ textAlign: "center", padding: "1.5rem 0" }}>
              <div id="load-spinner" style={{ display: "none", color: "#D4CDC3", fontSize: "0.8rem" }}>Laddar fler...</div>
            </div>
            <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var grid=document.getElementById('grid'),spinner=document.getElementById('load-spinner');
  if(!grid||!spinner)return;
  var loading=false,done=false,offset=${PAGE_SIZE};
  var params=new URLSearchParams(window.location.search);
  function getIds(){return Array.from(grid.querySelectorAll('a[data-id]')).map(function(a){return a.dataset.id}).join(',');}
  function card(a){return '<a href="/artwork/'+a.id+'" data-id="'+a.id+'" style="break-inside:avoid;display:block;border-radius:0.75rem;overflow:hidden;background:#F0EBE3;margin-bottom:0.75rem;text-decoration:none"><div style="background:'+(a.color||'#D4CDC3')+';aspect-ratio:3/4;overflow:hidden"><img src="'+a.imageUrl+'" width="400" height="533" style="width:100%;height:100%;object-fit:cover" loading="lazy" onerror="this.style.display=\\'none\\'" /></div><div style="padding:0.5rem"><p style="font-size:0.75rem;font-weight:500;color:#3D3831;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">'+a.title+'</p><p style="font-size:0.65rem;color:#8C8478;margin-top:0.1875rem">'+a.artist+'</p></div></a>';}
  function loadMore(){
    if(loading||done)return;loading=true;spinner.style.display='block';
    var p=new URLSearchParams();
    if(params.get('cat'))p.set('cat',params.get('cat'));
    if(params.get('period'))p.set('period',params.get('period'));
    if(params.get('color'))p.set('color',params.get('color'));
    if(params.get('sort'))p.set('sort',params.get('sort'));
    p.set('offset',offset);p.set('limit','20');p.set('exclude',getIds());
    fetch('/api/explore-more?'+p.toString()).then(function(r){return r.json()}).then(function(data){
      if(!data.length){done=true;spinner.style.display='none';return;}
      grid.insertAdjacentHTML('beforeend',data.map(card).join(''));
      offset+=data.length;loading=false;spinner.style.display='none';
    }).catch(function(){loading=false;spinner.style.display='none';});
  }
  new IntersectionObserver(function(e){if(e[0].isIntersecting)loadMore();},{rootMargin:'400px'}).observe(spinner);
})();
            `}} />
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
            <p style={{ fontSize: "1.25rem", color: "#D4CDC3" }}>Inga träffar</p>
            <p style={{ fontSize: "0.875rem", color: "#8C8478", marginTop: "0.5rem" }}>Prova en annan kombination.</p>
            <a href="/explore" style={{ display: "inline-block", marginTop: "1rem", padding: "0.625rem 1.25rem", borderRadius: "999px", backgroundColor: "#3D3831", color: "#FAF7F2", fontSize: "0.8rem", fontWeight: 500, textDecoration: "none" }}>Rensa filter</a>
          </div>
        )}
      </div>
    </div>
  );
}
