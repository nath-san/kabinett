import type { Route } from "./+types/artist";
import { getDb } from "../lib/db.server";

export function meta({ data }: Route.MetaArgs) {
  const name = data?.artistName || "Konstnär";
  return [
    { title: `${name} — Kabinett` },
    { name: "description", content: `Verk av ${name} ur Nationalmuseums samling.` },
    { property: "og:title", content: name },
    { property: "og:description", content: `Utforska verk av ${name}` },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const name = decodeURIComponent(params.name || "");
  if (!name) throw new Response("Saknar namn", { status: 400 });

  const db = getDb();

  const allWorks = db.prepare(
    `SELECT id, title_sv, title_en, iiif_url, dominant_color, dating_text, year_start, category
     FROM artworks
     WHERE artists LIKE ? AND iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
     ORDER BY year_start ASC NULLS LAST`
  ).all(`%${name}%`) as any[];

  const total = db.prepare(
    `SELECT COUNT(*) as c FROM artworks WHERE artists LIKE ?`
  ).get(`%${name}%`) as any;

  // Get nationality from first work with artist data
  let nationality = "";
  const sample = db.prepare(
    `SELECT artists FROM artworks WHERE artists LIKE ? AND artists IS NOT NULL LIMIT 1`
  ).get(`%${name}%`) as any;
  if (sample?.artists) {
    try {
      const arr = JSON.parse(sample.artists);
      const match = arr.find((a: any) => a.name === name);
      if (match?.nationality) nationality = match.nationality;
    } catch {}
  }

  // Year range
  const years = allWorks.filter((w: any) => w.year_start).map((w: any) => w.year_start);
  const yearFrom = years.length > 0 ? Math.min(...years) : null;
  const yearTo = years.length > 0 ? Math.max(...years) : null;

  // Category breakdown
  const cats: Record<string, number> = {};
  for (const w of allWorks) {
    const cat = w.category?.split(" (")?.[0] || "Övrigt";
    cats[cat] = (cats[cat] || 0) + 1;
  }
  const categories = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Featured works (max 60 for display, with images)
  const works = allWorks.slice(0, 60).map((r: any) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    imageUrl: r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    color: r.dominant_color || "#D4CDC3",
    year: r.dating_text || "",
  }));

  return {
    artistName: name,
    nationality,
    total: total.c,
    displayed: works.length,
    yearFrom,
    yearTo,
    categories,
    works,
  };
}

export default function Artist({ loaderData }: Route.ComponentProps) {
  const { artistName, nationality, total, displayed, yearFrom, yearTo, categories, works } = loaderData;

  return (
    <div style={{ minHeight: "100vh", paddingTop: "3.5rem", backgroundColor: "#FAF7F2" }}>
      {/* Header */}
      <div style={{ padding: "2.5rem 1rem 1.5rem" }}>
        <h1 className="font-serif" style={{ fontSize: "2rem", fontWeight: 700, color: "#3D3831", lineHeight: 1.2 }}>
          {artistName}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.8rem", color: "#8C8478" }}>
          {nationality && <span>{nationality}</span>}
          {nationality && yearFrom && <span style={{ color: "#D4CDC3" }}>·</span>}
          {yearFrom && yearTo && yearFrom !== yearTo && <span>{yearFrom}–{yearTo}</span>}
          {yearFrom && yearFrom === yearTo && <span>{yearFrom}</span>}
        </div>
        <p style={{ fontSize: "0.875rem", color: "#8C8478", marginTop: "0.5rem" }}>
          {total} verk i samlingen
        </p>
      </div>

      {/* Category tags */}
      {categories.length > 1 && (
        <div style={{ padding: "0 1rem 1rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
          {categories.map(c => (
            <span key={c.name} style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "999px",
              fontSize: "0.75rem",
              backgroundColor: "#F0EBE3",
              color: "#8C8478",
            }}>
              {c.name} ({c.count})
            </span>
          ))}
        </div>
      )}

      {/* Works grid */}
      <div style={{ padding: "0.5rem 1rem 4rem" }}>
        <div style={{ columnCount: 2, columnGap: "0.75rem" }}>
          {works.map((w: any) => (
            <a key={w.id} href={"/artwork/" + w.id}
              style={{
                breakInside: "avoid", display: "block", borderRadius: "0.75rem",
                overflow: "hidden", backgroundColor: "#F0EBE3", marginBottom: "0.75rem",
                textDecoration: "none",
              }}>
              <div style={{ backgroundColor: w.color, aspectRatio: "3/4", overflow: "hidden" }}>
                <img src={w.imageUrl} alt={w.title} width={400} height={533}
                  onError={(e: any) => { e.target.style.display = "none"; }}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
              <div style={{ padding: "0.625rem" }}>
                <p style={{
                  fontSize: "0.8rem", fontWeight: 500, color: "#3D3831", lineHeight: 1.3,
                  overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>
                  {w.title}</p>
                {w.year && <p style={{ fontSize: "0.65rem", color: "#D4CDC3", marginTop: "0.25rem" }}>{w.year}</p>}
              </div>
            </a>
          ))}
        </div>
        {displayed < total && (
          <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#8C8478", paddingTop: "1rem" }}>
            Visar {displayed} av {total} verk
          </p>
        )}
      </div>
    </div>
  );
}
