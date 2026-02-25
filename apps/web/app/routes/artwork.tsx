import type { Route } from "./+types/artwork";
import { useMemo, useState } from "react";
import { getDb, type ArtworkRow } from "../lib/db.server";
import { loadClipCache, dot } from "../lib/clip-cache.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

export function headers() {
  return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
}

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
    { property: "og:description", content: artwork.ogDescription || `${artist}${artwork.datingText ? ` · ${artwork.datingText}` : ""}` },
    { property: "og:image", content: artwork.ogImageUrl || artwork.imageUrl },
    { property: "og:type", content: "article" },
    // Twitter card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: artwork.title },
    { name: "twitter:description", content: artwork.ogDescription || `${artist} — ${artwork.museumName || "Kabinett"}` },
    { name: "twitter:image", content: artwork.ogImageUrl || artwork.imageUrl },
  ];
}

export const links = ({ data }: { data?: { canonicalUrl?: string } } = {}) => {
  if (!data?.canonicalUrl) return [];
  return [{ rel: "canonical", href: data.canonicalUrl }];
};

function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, "\\u003C/");
}

function parseDimensions(json: string | null): string | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json) as Array<{ dimension?: string }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr.map((dimensionItem) => dimensionItem.dimension).filter(Boolean).join("; ");
  } catch { return null; }
}

function parseExhibitions(json: string | null): Array<{ title: string; venue: string; year: string }> {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as Array<{ title?: string; venue?: string; organizer?: string; year_start?: number }>;
    if (!Array.isArray(arr)) return [];
    return arr.map((exhibition) => ({
      title: exhibition.title || "",
      venue: exhibition.venue || exhibition.organizer || "",
      year: exhibition.year_start ? String(exhibition.year_start) : "",
    })).filter((exhibition) => exhibition.title || exhibition.venue);
  } catch { return []; }
}

type DescriptionSection = {
  heading: "Beskrivning" | "Proveniens" | "Utställningar" | "Litteratur";
  content: string;
};

const DESCRIPTION_PREFIX = /^Beskrivning i inventariet:\s*/i;
const DESCRIPTION_MARKERS = /(Proveniens:|Utställningar:|Litteratur:|Beskrivning:?)/g;

function normalizeDescriptionHeading(marker: string): DescriptionSection["heading"] {
  const normalized = marker.replace(":", "").trim();
  if (normalized === "Proveniens") return "Proveniens";
  if (normalized === "Utställningar") return "Utställningar";
  if (normalized === "Litteratur") return "Litteratur";
  return "Beskrivning";
}

function parseDescriptionSections(raw: string | null): DescriptionSection[] {
  if (!raw) return [];

  const cleaned = raw
    .replace(/\r\n/g, "\n")
    .replace(DESCRIPTION_PREFIX, "")
    .trim();

  if (!cleaned) return [];

  const matches = Array.from(cleaned.matchAll(DESCRIPTION_MARKERS));
  if (matches.length === 0) {
    return [{ heading: "Beskrivning", content: cleaned }];
  }

  const sections: DescriptionSection[] = [];
  const firstIndex = matches[0]?.index ?? 0;
  const intro = cleaned.slice(0, firstIndex).trim();
  if (intro) {
    sections.push({ heading: "Beskrivning", content: intro });
  }

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    if (!current) continue;

    const marker = current[0];
    const start = (current.index ?? 0) + marker.length;
    const end = next?.index ?? cleaned.length;
    const content = cleaned.slice(start, end).trim();

    if (!content) continue;
    sections.push({
      heading: normalizeDescriptionHeading(marker),
      content,
    });
  }

  return sections.length > 0 ? sections : [{ heading: "Beskrivning", content: cleaned }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const artworkId = Number.parseInt(params.id || "", 10);
  if (!Number.isFinite(artworkId) || artworkId === 0) {
    throw new Response("Ogiltigt id", { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT a.*, m.name as museum_name, m.url as museum_url
       FROM artworks a
       LEFT JOIN museums m ON m.id = a.source
       WHERE a.id = ? AND ${sourceFilter("a")}`
    )
    .get(artworkId) as (ArtworkRow & { museum_name: string | null; museum_url: string | null }) | undefined;

  if (!row) throw new Response("Inte hittat", { status: 404 });

  let artists: Array<{ name: string; nationality: string; role: string }> = [];
  try {
    artists = JSON.parse(row.artists || "[]");
  } catch (_) {
    // ignore malformed artist payloads from source records
  }

  const collectionName = row.sub_museum || row.museum_name || null;
  const museumName = row.museum_name || "Museum";
  const museumSiteUrl = row.source === "nationalmuseum"
    ? "https://www.nationalmuseum.se"
    : row.source === "shm"
      ? "https://samlingar.shm.se"
      : row.source === "nordiska"
        ? "https://www.nordiskamuseet.se"
        : row.museum_url || null;
  const ogImageUrl = row.iiif_url
    ? (row.source === "nationalmuseum" ? buildImageUrl(row.iiif_url, 800) : row.iiif_url)
    : null;
  const ogDescriptionParts = [
    artists[0]?.name || "Okänd konstnär",
    row.dating_text || "",
    museumName || "",
  ].filter(Boolean);

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
    collectionName,
    museumSiteUrl,
    ogImageUrl,
    ogDescription: ogDescriptionParts.join(" · "),
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
  let similar: Array<{ id: number; title_sv: string | null; iiif_url: string; dominant_color: string | null; artists: string | null; dating_text: string | null }> = [];
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
               AND id NOT IN (SELECT artwork_id FROM broken_images)
               AND ${sourceFilter()}`)
          .all(...topIds) as Array<{ id: number; title_sv: string | null; iiif_url: string; dominant_color: string | null; artists: string | null; dating_text: string | null }>;
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
           AND id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceFilter()}
         ORDER BY RANDOM() LIMIT 6`
      ).all(row.id, `%${artistName}%`) as Array<{ id: number; title_sv: string | null; iiif_url: string; dominant_color: string | null; dating_text: string | null }>)
    : [];

  return { artwork, similar, sameArtist, artistName, canonicalUrl: `${url.origin}${url.pathname}` };
}

export default function Artwork({ loaderData }: Route.ComponentProps) {
  const { artwork, similar, sameArtist, artistName } = loaderData;
  const artist = artwork.artists?.[0]?.name || "Okänd konstnär";
  const descriptionSections = useMemo(() => parseDescriptionSections(artwork.description), [artwork.description]);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const canExpandDescription =
    descriptionSections.some((section) => section.content.length > 360) ||
    descriptionSections.reduce((sum, section) => sum + section.content.length, 0) > 700;

  const artworkJsonLd = {
    "@context": "https://schema.org",
    "@type": "VisualArtwork",
    name: artwork.title,
    image: artwork.imageUrl,
    creator: { "@type": "Person", name: artist },
    dateCreated: artwork.datingText || undefined,
    artform: artwork.category || undefined,
    artMedium: artwork.techniqueMaterial || undefined,
    description: artwork.description || artwork.ogDescription || undefined,
    url: loaderData.canonicalUrl,
  };

  return (
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(artworkJsonLd) }}
      />
      {/* Hero image with color bg */}
      <div
        className="flex justify-center items-center py-6 px-4 md:px-6 lg:px-8 min-h-[50vh] lg:min-h-[55vh] lg:max-h-[70vh] lg:max-w-5xl lg:mx-auto"
        style={{ backgroundColor: artwork.color }}
      >
        <img
          src={artwork.imageUrl}
          alt={`${artwork.title} — ${artist}`}
          loading="eager"
          fetchPriority="high"
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
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
            {artwork.artists.map((a, i: number) => (
              <span key={i}>
                {i > 0 && ", "}
                <a href={"/artist/" + encodeURIComponent(a.name)}
                  className="text-warm-gray no-underline border-b border-stone focus-ring">
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
        {(artwork.collectionName || artwork.museumName) && (
          <p className="mt-2 text-[0.85rem] text-warm-gray">
            Samling:{" "}
            {artwork.collectionName ? (
              <a
                href={`/samling/${encodeURIComponent(artwork.collectionName)}`}
                className="text-charcoal underline decoration-stone underline-offset-2 hover:decoration-warm-gray transition-colors focus-ring"
              >
                {artwork.collectionName}
              </a>
            ) : (
              <span className="text-charcoal">{artwork.museumName}</span>
            )}
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
        {descriptionSections.length > 0 && (
          <div className="mt-5 pt-5 border-t border-linen">
            <p className="text-[0.65rem] text-warm-gray uppercase tracking-[0.05em] mb-[0.4rem]">Beskrivning</p>
            <div className={[
              "relative",
              canExpandDescription && !isDescriptionExpanded ? "max-h-[20rem] overflow-hidden" : "",
            ].join(" ")}>
              <div className="space-y-4">
                {descriptionSections.map((section, index) => (
                  <section key={`${section.heading}-${index}`}>
                    <h3 className="text-[0.72rem] text-warm-gray uppercase tracking-[0.05em] mb-1">
                      {section.heading}
                    </h3>
                    <p className="text-[0.85rem] lg:text-[0.95rem] text-charcoal leading-[1.6] whitespace-pre-line">
                      {section.content}
                    </p>
                  </section>
                ))}
              </div>
              {canExpandDescription && !isDescriptionExpanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
              )}
            </div>
            {canExpandDescription && (
              <button
                onClick={() => setIsDescriptionExpanded((prev) => !prev)}
                className="mt-3 text-[0.8rem] text-warm-gray hover:text-charcoal transition-colors focus-ring"
              >
                {isDescriptionExpanded ? "Visa mindre" : "Visa mer"}
              </button>
            )}
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
              {artwork.exhibitions.slice(0, 5).map((ex, i: number) => (
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
                  window.__toast?.("Länk kopierad");
                }
              }}
              className="py-2 px-4 min-h-11 rounded-full border border-linen bg-white text-[0.8rem] text-charcoal cursor-pointer font-medium focus-ring"
            >
              Dela
            </button>
            {artwork.museumSiteUrl && (
              <a href={artwork.museumSiteUrl} target="_blank" rel="noopener noreferrer"
                className="text-[0.8rem] text-warm-gray no-underline focus-ring">
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
              <a key={s.id} href={"/artwork/" + s.id} className="shrink-0 w-32 lg:w-auto rounded-xl overflow-hidden bg-linen no-underline focus-ring">
                <div
                  className="aspect-[3/4] overflow-hidden"
                  style={{ backgroundColor: s.dominant_color || "#D4CDC3" }}
                >
                  <img src={buildImageUrl(s.iiif_url, 200)}
                    alt={`${s.title_sv || "Utan titel"} — ${artistName || "Okänd konstnär"}`} width={200} height={267}
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
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
              <a key={s.id} href={"/artwork/" + s.id} className="shrink-0 w-32 lg:w-auto rounded-xl overflow-hidden bg-linen no-underline focus-ring">
                <div
                  className="aspect-[3/4] overflow-hidden"
                  style={{ backgroundColor: s.dominant_color || "#D4CDC3" }}
                >
                  <img src={buildImageUrl(s.iiif_url, 200)}
                    alt={`${s.title_sv || "Utan titel"} — ${parseArtist(s.artists)}`} width={200} height={267}
                    loading="lazy"
                    decoding="async"
                    onError={(event) => {
                      event.currentTarget.classList.add("is-broken");
                    }}
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
        <a href="/discover" className="text-[0.875rem] text-warm-gray no-underline focus-ring">
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
