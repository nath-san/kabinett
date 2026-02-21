import type { Route } from "./+types/explore";
import { getDb, type ArtworkRow } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Utforska — Kabinett" },
    { name: "description", content: "89 000 verk. Börja nånstans." },
  ];
}

const PAGE_SIZE = 40;

const FILTERS = [
  { label: "Alla", value: "" },
  { label: "Målningar", value: "Målningar" },
  { label: "Skulptur", value: "Skulptur" },
  { label: "Grafik", value: "Grafik" },
  { label: "Teckning", value: "Teckning" },
  { label: "Miniatyr", value: "Miniatyr" },
  { label: "Keramik", value: "Keramik" },
  { label: "Textil", value: "Textil" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const filter = url.searchParams.get("filter") || "";
  const offset = (page - 1) * PAGE_SIZE;

  const db = getDb();

  let rows: ArtworkRow[];
  let total: number;

  if (filter) {
    rows = db
      .prepare(
        "SELECT * FROM artworks WHERE category LIKE ? ORDER BY RANDOM() LIMIT ? OFFSET ?"
      )
      .all(`%${filter}%`, PAGE_SIZE, offset) as ArtworkRow[];
    total = (
      db
        .prepare("SELECT COUNT(*) as count FROM artworks WHERE category LIKE ?")
        .get(`%${filter}%`) as any
    ).count;
  } else {
    rows = db
      .prepare("SELECT * FROM artworks ORDER BY RANDOM() LIMIT ? OFFSET ?")
      .all(PAGE_SIZE, offset) as ArtworkRow[];
    total = (
      db.prepare("SELECT COUNT(*) as count FROM artworks").get() as any
    ).count;
  }

  const artworks = rows.map((r) => ({
    id: r.id,
    title: r.title_sv || r.title_en || "Utan titel",
    artist: parseArtist(r.artists),
    imageUrl:
      r.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    category: r.category?.split(" (")?.[0] || "",
    year: r.dating_text || "",
    color: r.dominant_color || "#D4CDC3",
  }));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return { artworks, total, page, totalPages, activeFilter: filter };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    const arr = JSON.parse(json);
    return arr[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

export default function Explore({ loaderData }: Route.ComponentProps) {
  const { artworks, total, page, totalPages, activeFilter } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-2">
        <h1 className="font-serif text-3xl font-bold text-charcoal">Utforska</h1>
        <p className="text-warm-gray text-sm mt-1">
          {total.toLocaleString("sv-SE")} verk
        </p>
      </div>

      {/* Filter chips */}
      <div
        className="px-(--spacing-page) py-4 flex gap-2 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {FILTERS.map((f) => (
          <a
            key={f.value}
            href={f.value ? `/explore?filter=${encodeURIComponent(f.value)}` : "/explore"}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              activeFilter === f.value
                ? "bg-charcoal text-cream"
                : "bg-linen text-warm-gray hover:bg-stone hover:text-charcoal"
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      {/* Masonry grid */}
      <div className="px-(--spacing-page) pb-24">
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3 space-y-3">
          {artworks.map((a) => (
            <a
              key={a.id}
              href={`/artwork/${a.id}`}
              className="art-card block break-inside-avoid rounded-xl overflow-hidden bg-linen group"
            >
              <div style={{ backgroundColor: a.color, aspectRatio: "3/4" }} className="overflow-hidden">
                <img
                  src={a.imageUrl}
                  alt={a.title}
                  width={400}
                  height={533}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              </div>
              <div className="p-3">
                <p className="text-sm font-medium text-charcoal leading-snug line-clamp-2">
                  {a.title}
                </p>
                <p className="text-xs text-warm-gray mt-1">{a.artist}</p>
                {a.year && <p className="text-xs text-stone mt-0.5">{a.year}</p>}
              </div>
            </a>
          ))}
        </div>

        {/* Pagination */}
        <div className="flex justify-center items-center gap-4 pt-8">
          {page > 1 && (
            <a
              href={`/explore?page=${page - 1}${activeFilter ? `&filter=${encodeURIComponent(activeFilter)}` : ""}`}
              className="px-5 py-2.5 bg-linen text-charcoal rounded-full text-sm font-medium hover:bg-stone transition-colors"
            >
              ← Föregående
            </a>
          )}
          <span className="text-xs text-warm-gray">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <a
              href={`/explore?page=${page + 1}${activeFilter ? `&filter=${encodeURIComponent(activeFilter)}` : ""}`}
              className="px-5 py-2.5 bg-linen text-charcoal rounded-full text-sm font-medium hover:bg-stone transition-colors"
            >
              Nästa →
            </a>
          )}
        </div>

        {/* Shuffle */}
        <div className="flex justify-center pt-4">
          <a
            href={`/explore?page=${Math.floor(Math.random() * totalPages) + 1}${activeFilter ? `&filter=${encodeURIComponent(activeFilter)}` : ""}`}
            className="px-5 py-2.5 bg-charcoal text-cream rounded-full text-sm font-medium hover:bg-ink transition-colors"
          >
            ✦ Slumpa
          </a>
        </div>
      </div>
    </div>
  );
}
