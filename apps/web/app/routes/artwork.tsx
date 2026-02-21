import type { Route } from "./+types/artwork";
import { getDb, type ArtworkRow } from "../lib/db.server";

export function meta({ data }: Route.MetaArgs) {
  const title = data?.artwork?.title || "Konstverk";
  return [
    { title: `${title} — Kabinett` },
    { name: "description", content: `${title} ur Nationalmuseums samling.` },
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
    imageUrl: row.iiif_url.replace("http://", "https://") + "full/1200,/0/default.jpg",
    thumbUrl: row.iiif_url.replace("http://", "https://") + "full/400,/0/default.jpg",
    color: row.dominant_color || "#D4CDC3",
    iiifBase: row.iiif_url.replace("http://", "https://"),
  };

  // Get similar works by color
  const similar = row.color_r != null
    ? (db
        .prepare(
          `SELECT id, title_sv, iiif_url, dominant_color
           FROM artworks
           WHERE id != ? AND color_r IS NOT NULL
           ORDER BY ABS(color_r - ?) + ABS(color_g - ?) + ABS(color_b - ?)
           LIMIT 6`
        )
        .all(row.id, row.color_r, row.color_g, row.color_b) as any[])
    : [];

  return { artwork, similar };
}

export default function Artwork({ loaderData }: Route.ComponentProps) {
  const { artwork, similar } = loaderData;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      {/* Hero image */}
      <div
        className="w-full flex justify-center px-(--spacing-page) pt-4"
        style={{ backgroundColor: artwork.color }}
      >
        <img
          src={artwork.imageUrl}
          alt={artwork.title}
          className="max-h-[70vh] w-auto max-w-full object-contain"
        />
      </div>

      {/* Info */}
      <div className="px-(--spacing-page) py-8 max-w-2xl mx-auto">
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-charcoal leading-snug">
          {artwork.title}
        </h1>

        {artwork.artists.length > 0 && (
          <p className="mt-2 text-lg text-warm-gray">
            {artwork.artists.map((a: any) => a.name).join(", ")}
          </p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          {artwork.datingText && (
            <Detail label="Datering" value={artwork.datingText} />
          )}
          {artwork.category && (
            <Detail label="Kategori" value={artwork.category} />
          )}
          {artwork.techniqueMaterial && (
            <Detail label="Teknik/Material" value={artwork.techniqueMaterial} />
          )}
          {artwork.acquisitionYear && (
            <Detail label="Förvärvad" value={String(artwork.acquisitionYear)} />
          )}
        </div>

        {/* Color swatch */}
        <div className="mt-6 flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full border border-stone/30"
            style={{ backgroundColor: artwork.color }}
          />
          <span className="text-xs text-warm-gray font-mono">{artwork.color}</span>
        </div>

        {/* External link */}
        <a
          href={`http://collection.nationalmuseum.se/eMP/eMuseumPlus?service=ExternalInterface&module=collection&viewType=detailView&objectId=${artwork.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-6 text-sm text-warm-gray underline hover:text-charcoal transition-colors"
        >
          Visa på Nationalmuseum →
        </a>
      </div>

      {/* Similar works */}
      {similar.length > 0 && (
        <div className="px-(--spacing-page) pb-16 max-w-4xl mx-auto">
          <h2 className="font-serif text-xl font-semibold text-charcoal mb-4">
            Liknande färger
          </h2>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {similar.map((s: any) => (
              <a
                key={s.id}
                href={`/artwork/${s.id}`}
                className="rounded-lg overflow-hidden bg-linen"
              >
                <div
                  style={{
                    backgroundColor: s.dominant_color || "#D4CDC3",
                    aspectRatio: "1",
                  }}
                  className="overflow-hidden"
                >
                  <img
                    src={
                      s.iiif_url.replace("http://", "https://") +
                      "full/200,/0/default.jpg"
                    }
                    alt={s.title_sv || ""}
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                  />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Back */}
      <div className="px-(--spacing-page) pb-12 text-center">
        <a
          href="/explore"
          className="text-sm text-warm-gray hover:text-charcoal transition-colors"
        >
          ← Tillbaka till utforska
        </a>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-warm-gray text-xs uppercase tracking-wide">{label}</p>
      <p className="text-charcoal mt-0.5">{value}</p>
    </div>
  );
}
