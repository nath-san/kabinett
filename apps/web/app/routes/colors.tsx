import { useRef, useCallback, useEffect } from "react";
import type { Route } from "./+types/colors";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Färger — Kabinett" },
    { name: "description", content: "Utforska konst efter färg." },
  ];
}

// Predefined palettes for initial view
const PALETTES = [
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
  { label: "Ljusa verk", slug: "light", bg: "#E8E0D4",
    sql: "(color_r + color_g + color_b) > 600 AND category LIKE '%Målningar%'" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("palette") || "";
  const db = getDb();

  const paletteCards: Array<{ label: string; slug: string; bg: string; heroUrl: string | null }> = [];
  for (const p of PALETTES) {
    let heroUrl: string | null = null;
    try {
      const hero = db.prepare(
        `SELECT iiif_url FROM artworks WHERE color_r IS NOT NULL AND iiif_url IS NOT NULL AND ${p.sql} ORDER BY RANDOM() LIMIT 1`
      ).get() as any;
      if (hero?.iiif_url) heroUrl = hero.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg";
    } catch {}
    paletteCards.push({ label: p.label, slug: p.slug, bg: p.bg, heroUrl });
  }

  let artworks: any[] = [];
  let paletteLabel = "";
  if (selected) {
    const palette = PALETTES.find(p => p.slug === selected);
    if (palette) {
      paletteLabel = palette.label;
      try {
        artworks = db.prepare(
          `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
           FROM artworks WHERE color_r IS NOT NULL AND ${palette.sql} ORDER BY RANDOM() LIMIT 40`
        ).all() as any[];
      } catch {}
    }
  }

  return { paletteCards, artworks, selected, paletteLabel };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

// HSL to RGB conversion
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
}

function ColorWheel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const isDragging = useRef(false);

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;

    // Draw color wheel
    for (let angle = 0; angle < 360; angle++) {
      const startAngle = (angle - 1) * Math.PI / 180;
      const endAngle = (angle + 1) * Math.PI / 180;
      
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      const [r1, g1, b1] = hslToRgb(angle, 10, 90);
      const [r2, g2, b2] = hslToRgb(angle, 80, 50);
      const [r3, g3, b3] = hslToRgb(angle, 90, 25);
      gradient.addColorStop(0, `rgb(${r1},${g1},${b1})`);
      gradient.addColorStop(0.5, `rgb(${r2},${g2},${b2})`);
      gradient.addColorStop(1, `rgb(${r3},${g3},${b3})`);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#FAF7F2";
    ctx.fill();
  }, []);

  useEffect(() => { drawWheel(); }, [drawWheel]);

  const pickColor = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixel = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    const [r, g, b] = [pixel[0], pixel[1], pixel[2]];
    
    // Ignore if clicking center or outside
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist < 10 || dist > canvas.width / 2) return;

    const hex = rgbToHex(r, g, b);

    // Update selected color indicator
    if (selectedRef.current) {
      selectedRef.current.style.backgroundColor = hex;
      selectedRef.current.style.display = "block";
    }
    if (labelRef.current) {
      labelRef.current.textContent = hex;
    }

    // Debounced fetch
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/color-search?r=${r}&g=${g}&b=${b}&limit=24`);
        const data = await res.json();
        renderResults(data, hex);
      } catch {}
    }, 150);
  }, []);

  const renderResults = useCallback((data: any[], hex: string) => {
    const el = resultsRef.current;
    if (!el) return;
    if (data.length === 0) {
      el.innerHTML = '<p style="color:#8C8478;text-align:center;padding:2rem">Inga verk hittades.</p>';
      return;
    }
    el.innerHTML = data.map((a: any) => `
      <a href="/artwork/${a.id}" style="break-inside:avoid;display:block;border-radius:0.75rem;overflow:hidden;background:#F0EBE3;text-decoration:none;margin-bottom:0.75rem">
        <div style="background:${a.dominant_color || '#D4CDC3'};aspect-ratio:3/4;overflow:hidden">
          <img src="${a.iiif_url.replace('http://', 'https://')}full/400,/0/default.jpg"
            alt="${(a.title_sv || '').replace(/"/g, '&quot;')}" width="400" height="533"
            style="width:100%;height:100%;object-fit:cover" loading="lazy" />
        </div>
        <div style="padding:0.5rem">
          <p style="font-size:0.8rem;font-weight:500;color:#3D3831;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">
            ${a.title_sv || 'Utan titel'}</p>
          <p style="font-size:0.7rem;color:#8C8478;margin-top:0.125rem">${parseArtistStatic(a.artists)}</p>
        </div>
      </a>
    `).join("");
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pickColor(e.clientX, e.clientY);
  }, [pickColor]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    pickColor(e.clientX, e.clientY);
  }, [pickColor]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <>
      {/* Color wheel */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1.5rem 1rem" }}>
        <div style={{ position: "relative" }}>
          <canvas
            ref={canvasRef}
            width={280}
            height={280}
            style={{
              width: "min(280px, 70vw)",
              height: "min(280px, 70vw)",
              borderRadius: "50%",
              cursor: "crosshair",
              touchAction: "none",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "1rem", minHeight: "2rem" }}>
          <div ref={selectedRef} style={{
            width: "1.5rem",
            height: "1.5rem",
            borderRadius: "50%",
            border: "2px solid #F0EBE3",
            display: "none",
            boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
          }} />
          <p ref={labelRef} style={{ fontSize: "0.875rem", color: "#8C8478", fontFamily: "monospace" }}></p>
        </div>
        <p style={{ fontSize: "0.75rem", color: "#D4CDC3", marginTop: "0.25rem" }}>
          Dra fingret över hjulet
        </p>
      </div>

      {/* Live results */}
      <div ref={resultsRef} style={{
        columnCount: 2,
        columnGap: "0.75rem",
        padding: "0 1rem 4rem",
      }} />
    </>
  );
}

// Static version for innerHTML
function parseArtistStatic(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Colors({ loaderData }: Route.ComponentProps) {
  const { paletteCards, artworks, selected, paletteLabel } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      <div style={{ padding: "2rem 1rem 0.5rem" }}>
        <h1 className="font-serif" style={{ fontSize: "1.75rem", fontWeight: 700, color: "#3D3831" }}>Färger</h1>
        <p style={{ color: "#8C8478", fontSize: "0.875rem", marginTop: "0.25rem" }}>
          Välj en färg och utforska konsten.
        </p>
      </div>

      {/* Interactive color wheel */}
      <ColorWheel />

      {/* Palette shortcuts */}
      <div style={{ padding: "0 1rem 1.5rem" }}>
        <p style={{ fontSize: "0.75rem", color: "#D4CDC3", marginBottom: "0.75rem" }}>Eller välj en färgvärld:</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
          {paletteCards.map((p) => (
            <a
              key={p.slug}
              href={"/colors?palette=" + p.slug + "#results"}
              style={{
                display: "block",
                position: "relative",
                overflow: "hidden",
                borderRadius: "0.75rem",
                aspectRatio: "3/2",
                backgroundColor: p.bg,
                textDecoration: "none",
                boxShadow: selected === p.slug ? "0 0 0 2px #3D3831" : "none",
              }}
            >
              {p.heroUrl && (
                <img src={p.heroUrl} alt="" style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
                }} />
              )}
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 60%)",
              }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, padding: "0.5rem" }}>
                <p style={{ color: "#fff", fontSize: "0.75rem", fontWeight: 600, textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>{p.label}</p>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Palette results */}
      {selected && artworks.length > 0 && (
        <div id="results" style={{ backgroundColor: "#FAF7F2", padding: "2rem 1rem 4rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
            <h2 className="font-serif" style={{ fontSize: "1.25rem", fontWeight: 600, color: "#3D3831" }}>
              {paletteLabel}
            </h2>
            <a href={"/colors?palette=" + selected + "#results"}
              style={{ fontSize: "0.875rem", color: "#8C8478", textDecoration: "none" }}>
              ✦ Slumpa
            </a>
          </div>
          <div style={{ columnCount: 2, columnGap: "0.75rem" }}>
            {artworks.map((a: any) => (
              <a key={a.id} href={"/artwork/" + a.id}
                style={{ breakInside: "avoid", display: "block", borderRadius: "0.75rem", overflow: "hidden", backgroundColor: "#F0EBE3", textDecoration: "none", marginBottom: "0.75rem" }}>
                <div style={{ backgroundColor: a.dominant_color || "#D4CDC3", aspectRatio: "3/4", overflow: "hidden" }}>
                  <img src={a.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg"}
                    alt={a.title_sv || ""} width={400} height={533}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ padding: "0.5rem" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 500, color: "#3D3831" }}>{a.title_sv || "Utan titel"}</p>
                  <p style={{ fontSize: "0.7rem", color: "#8C8478", marginTop: "0.125rem" }}>{parseArtist(a.artists)}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
