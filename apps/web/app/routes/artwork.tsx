import type { Route } from "./+types/artwork";
import { getDb, type ArtworkRow } from "../lib/db.server";
import { loadClipCache, dot } from "../lib/clip-cache.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

export function meta({ data }: Route.MetaArgs) {
  if (!data?.artwork) return [{ title: "Konstverk — Kabinett" }];
  const { artwork } = data;
  const artist = artwork.artists?.[0]?.name || "Okänd konstnär";
  const genitive = artwork.museumName ? `${artwork.museumName}${artwork.museumName.endsWith("s") ? "" : "s"}` : "Kabinett";
  const desc = `${artwork.title} av ${artist}${artwork.datingText ? `, ${artwork.datingText}` : ""}. Ur ${genitive} samling.`;
  return [
    { title: `${artwork.title} — Kabinett` },
    { name: "description", content: desc },
    // OG tags
    { property: "og:title", content: artwork.title },
    { property: "og:description", content: `${artist}${artwork.datingText ? ` · ${artwork.datingText}` : ""}` },
    { property: "og:image", content: artwork.imageUrl },
    { property: "og:type", content: "article" },
    // Twitter card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: artwork.title },
    { name: "twitter:description", content: `${artist} — ${artwork.museumName || "Kabinett"}` },
    { name: "twitter:image", content: artwork.imageUrl },
  ];
}

function parseDimensions(json: string | null): string | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((d: any) => d.dimension).filter(Boolean).join("; ");
  } catch { return null; }
}

function parseExhibitions(json: string | null): Array<{ title: string; venue: string; year: string }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((e: any) => ({
      title: e.title || "",
      venue: e.venue || e.organizer || "",
      year: e.year_start ? String(e.year_start) : "",
    })).filter((e: any) => e.title || e.venue);
  } catch { return []; }
}

export async function loader({ params }: Route.LoaderArgs) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.*, m.name as museum_name, m.url as museum_url
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.id = ? AND ${sourceFilter("a")}`
    )
    .get(params.id) as (ArtworkRow & { museum_name: string | null; museum_url: string | null }) | undefined;

  if (!row) throw new Response("Inte hittat", { status: 404 });

  let artists: Array<{ name: string; nationality: string; role: string }> = [];
  try {
    artists = JSON.parse(row.artists || "[]");
  } catch {}

  const museumName = row.museum_name || "Museum";
  const museumUrl = row.museum_url || null;
  const externalUrl = row.source === "nationalmuseum"
    ? `https://collection.nationalmuseum.se/eMP/eMuseumPlus?service=ExternalInterface&module=collection&viewType=detailView&objectId=${row.id}`
    : museumUrl;

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
    imageUrl: buildImageUrl(row.iiif_url, 800),
    thumbUrl: buildImageUrl(row.iiif_url, 400),
    color: row.dominant_color || "#D4CDC3",
    colorR: row.color_r,
    colorG: row.color_g,
    colorB: row.color_b,
    museumName,
    museumUrl,
    externalUrl,
    // Extra fields
    description: row.descriptions_sv || null,
    dimensions: parseDimensions(row.dimensions_json),
    signature: row.signature || null,
    inscription: row.inscription || null,
    style: row.style_sv || null,
    objectType: row.object_type_sv || null,
    motiveCategory: row.motive_category || null,
    exhibitions: parseExhibitions(row.exhibitions_json),
    materialTags: row.material_tags || null,
    techniqueTags: row.technique_tags || null,
  };

  // Similar by CLIP embedding (semantic/visual similarity)
  let similar: any[] = [];
  try {
    const cache = await loadClipCache();
    const current = cache.find((c) => c.id === row.id);
    if (current) {
      const scored = cache
        .filter((c) => c.id !== row.id)
        .map((c) => ({ id: c.id, score: dot(current.embedding, c.embedding) }));
      scored.sort((a, b) => b.score - a.score);
      const topIds = scored.slice(0, 8).map((s) => s.id);
      if (topIds.length > 0) {
        similar = db
          .prepare(
            `SELECT id, title_sv, iiif_url, dominant_color, artists, dating_text
             FROM artworks
             WHERE id IN (${topIds.map(() => "?").join(",")})
               AND ${sourceFilter()}`)
          .all(...topIds) as any[];
        // Preserve similarity order
        const orderMap = new Map(topIds.map((id, i) => [id, i]));
        similar.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      }
    }
  } catch {
    // Fall back to no similar
  }

  // Same artist
  const artistName = artists[0]?.name;
  const knownArtist = artistName && !artistName.match(/^(okänd|unknown|anonym)/i);
  const sameArtist = knownArtist
    ? (db.prepare(
        `SELECT id, title_sv, iiif_url, dominant_color, dating_text
         FROM artworks
         WHERE id != ? AND artists LIKE ? AND iiif_url IS NOT NULL
           AND ${sourceFilter()}
         ORDER BY RANDOM() LIMIT 6`
      ).all(row.id, `%${artistName}%`) as any[])
    : [];

  return { artwork, similar, sameArtist, artistName };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Artwork({ loaderData }: Route.ComponentProps) {
  const { artwork, similar, sameArtist, artistName } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      {/* Hero image with color bg */}
      <div
        className="flex justify-center items-center py-6 px-4 md:px-6 lg:px-8 min-h-[50vh] lg:min-h-[55vh] lg:max-h-[70vh] lg:max-w-5xl lg:mx-auto"
        style={{ backgroundColor: artwork.color }}
      >
        <img
          src={artwork.imageUrl}
          alt={artwork.title}
          className="max-h-[70vh] lg:max-h-[70vh] max-w-full lg:max-w-5xl object-contain rounded shadow-[0_8px_40px_rgba(0,0,0,0.3)]"
        />
      </div>

      {/* Info card — overlapping the image slightly */}
      <div className="-mt-8 mx-4 mb-0 p-6 bg-white rounded-2xl relative z-10 shadow-[0_2px_20px_rgba(0,0,0,0.06)] max-w-3xl mx-auto lg:mx-auto lg:px-8">
        <h1 className="font-serif text-[1.5rem] lg:text-[2rem] font-bold text-charcoal leading-[1.3]">
          {artwork.title}
        </h1>

        {artwork.artists.length > 0 && (
          <p className="mt-2 text-base lg:text-[1.05rem]">
            {artwork.artists.map((a: any, i: number) => (
              <span key={i}>
                {i > 0 && ", "}
                <a href={"/artist/" + encodeURIComponent(a.name)}
                  className="text-warm-gray no-underline border-b border-stone">
                  {a.name}
                </a>
              </span>
            ))}
            {artwork.artists[0]?.nationality && (
              <span className="text-sm text-stone">
                {" "}· {artwork.artists[0].nationality}
              </span>
            )}
          </p>
        )}
        {artwork.museumUrl && (
          <p className="mt-2 text-[0.85rem] text-warm-gray">
            <a
              href={artwork.museumUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline border-b border-stone/60 text-warm-gray"
            >
              {artwork.museumName}
            </a>
          </p>
        )}

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-linen">
          {artwork.datingText && <Detail label="Datering" value={artwork.datingText} />}
          {artwork.category && <Detail label="Kategori" value={artwork.category} />}
          {artwork.techniqueMaterial && <Detail label="Teknik" value={artwork.techniqueMaterial} />}
          {artwork.dimensions && <Detail label="Mått" value={artwork.dimensions} />}
          {artwork.acquisitionYear && <Detail label="Förvärvad" value={String(artwork.acquisitionYear)} />}
          {artwork.objectType && <Detail label="Objekttyp" value={artwork.objectType} />}
          {artwork.style && <Detail label="Stil" value={artwork.style} />}
          {artwork.motiveCategory && <Detail label="Motiv" value={artwork.motiveCategory} />}
        </div>

        {/* Description */}
        {artwork.description && (
          <div className="mt-5 pt-5 border-t border-linen">
            <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em] mb-[0.4rem]">Beskrivning</p>
            <p className="text-[0.85rem] lg:text-[0.95rem] text-charcoal leading-[1.6]">
              {artwork.description}
            </p>
          </div>
        )}

        {/* Signature & Inscription */}
        {(artwork.signature || artwork.inscription) && (
          <div className="mt-5 pt-5 border-t border-linen grid grid-cols-1 gap-3">
            {artwork.signature && (
              <div>
                <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em]">Signatur</p>
                <p className="text-[0.8rem] text-charcoal mt-[0.15rem] italic">{artwork.signature}</p>
              </div>
            )}
            {artwork.inscription && (
              <div>
                <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em]">Inskription</p>
                <p className="text-[0.8rem] text-charcoal mt-[0.15rem] italic">{artwork.inscription}</p>
              </div>
            )}
          </div>
        )}

        {/* Exhibitions */}
        {artwork.exhibitions.length > 0 && (
          <div className="mt-5 pt-5 border-t border-linen">
            <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em] mb-2">
              Utställningar ({artwork.exhibitions.length})
            </p>
            <div className="flex flex-col gap-[0.4rem]">
              {artwork.exhibitions.slice(0, 5).map((ex: any, i: number) => (
                <div key={i} className="text-[0.8rem] text-charcoal leading-[1.4]">
                  <span className="font-medium">{ex.title}</span>
                  {ex.venue && <span className="text-warm-gray"> — {ex.venue}</span>}
                  {ex.year && <span className="text-[#B5AFA6]"> ({ex.year})</span>}
                </div>
              ))}
              {artwork.exhibitions.length > 5 && (
                <p className="text-[0.7rem] text-[#B5AFA6]">
                  +{artwork.exhibitions.length - 5} till
                </p>
              )}
            </div>
          </div>
        )}

        {/* Color + link row */}
        <div className="flex justify-between items-center mt-5 pt-5 border-t border-linen">
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded-full border border-[rgba(212,205,195,0.4)]"
              style={{ backgroundColor: artwork.color }}
            />
            <span className="text-[0.75rem] text-stone font-mono">{artwork.color}</span>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={() => {
                const artist = artwork.artists?.[0]?.name || "Okänd konstnär";
                const text = `${artwork.title} av ${artist}`;
                const url = window.location.href;
                if (navigator.share) {
                  navigator.share({ title: artwork.title, text, url });
                } else {
                  navigator.clipboard.writeText(url);
                  (window as any).__toast?.("Länk kopierad");
                }
              }}
              className="py-2 px-4 rounded-full border border-linen bg-white text-[0.8rem] text-charcoal cursor-pointer font-medium"
            >
              Dela
            </button>
            {artwork.externalUrl && (
              <a href={artwork.externalUrl} target="_blank" rel="noopener noreferrer"
                className="text-[0.8rem] text-warm-gray no-underline">
                {`Visa på ${artwork.museumName}`} →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Same artist section */}
      {sameArtist.length > 0 && (
        <section className="pt-10 px-4 md:px-6 lg:px-8 max-w-[50rem] lg:max-w-5xl mx-auto">
          <h2 className="font-serif text-[1.25rem] font-semibold text-charcoal">
            Mer av {artistName}
          </h2>
          <div className="flex gap-3 overflow-x-auto pt-4 pb-2 no-scrollbar lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:pb-0">
            {sameArtist.map((s: any) => (
              <a key={s.id} href={"/artwork/" + s.id} className="shrink-0 w-32 lg:w-auto rounded-xl overflow-hidden bg-linen no-underline">
                <div
                  className="aspect-[3/4] overflow-hidden"
                  style={{ backgroundColor: s.dominant_color || "#D4CDC3" }}
                >
                  <img src={buildImageUrl(s.iiif_url, 200)}
                    alt={s.title_sv || ""} width={200} height={267}
                    className="w-full h-full object-cover" />
                </div>
                <div className="p-2">
                  <p className="text-[0.75rem] text-charcoal leading-[1.3] overflow-hidden line-clamp-2">
                    {s.title_sv || "Utan titel"}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Similar colors */}
      {similar.length > 0 && (
        <section className="pt-10 px-4 md:px-6 lg:px-8 max-w-[50rem] lg:max-w-5xl mx-auto">
          <h2 className="font-serif text-[1.25rem] font-semibold text-charcoal">
            Liknande verk
          </h2>
          <div className="flex gap-3 overflow-x-auto pt-4 pb-2 no-scrollbar lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:pb-0">
            {similar.map((s: any) => (
              <a key={s.id} href={"/artwork/" + s.id} className="shrink-0 w-32 lg:w-auto rounded-xl overflow-hidden bg-linen no-underline">
                <div
                  className="aspect-[3/4] overflow-hidden"
                  style={{ backgroundColor: s.dominant_color || "#D4CDC3" }}
                >
                  <img src={buildImageUrl(s.iiif_url, 200)}
                    alt={s.title_sv || ""} width={200} height={267}
                    className="w-full h-full object-cover" />
                </div>
                <div className="p-2">
                  <p className="text-[0.75rem] text-charcoal leading-[1.3] overflow-hidden line-clamp-2">
                    {s.title_sv || "Utan titel"}
                  </p>
                  <p className="text-[0.65rem] text-warm-gray mt-[0.125rem]">{parseArtist(s.artists)}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Back */}
      <div className="pt-10 pb-12 px-4 text-center">
        <a href="/discover" className="text-[0.875rem] text-warm-gray no-underline">
          ← Utforska mer
        </a>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em]">{label}</p>
      <p className="text-[0.875rem] text-charcoal mt-[0.125rem]">{value}</p>
    </div>
  );
}
