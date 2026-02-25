import type { Route } from "./+types/walks";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Vandringar — Kabinett" },
    { name: "description", content: "Curaterade vandringar genom Sveriges kulturarv." },
  ];
}

type WalkPreview = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  previewUrl: string | null;
};

type WalkPreviewImageRow = {
  walk_id: number;
  iiif_url: string;
};

type WalkArtwork = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
  narrative_text: string | null;
  position: number;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("walk") || "";
  const db = getDb();

  const walkRows = db
    .prepare(
      `SELECT id, slug, title, subtitle, description, color
       FROM walks WHERE published = 1
       ORDER BY created_at DESC`
    )
    .all() as Array<Omit<WalkPreview, "previewUrl">>;

  const previewRows = db.prepare(
    `WITH ranked_previews AS (
      SELECT
        wi.walk_id,
        a.iiif_url,
        ROW_NUMBER() OVER (PARTITION BY wi.walk_id ORDER BY RANDOM()) AS rn
      FROM walk_items wi
      JOIN artworks a ON a.id = wi.artwork_id
      WHERE a.iiif_url IS NOT NULL
        AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        AND ${sourceFilter("a")}
    )
    SELECT walk_id, iiif_url
    FROM ranked_previews
    WHERE rn = 1`
  ).all() as WalkPreviewImageRow[];

  const previewMap = new Map<number, string>(
    previewRows.map((row) => [row.walk_id, buildImageUrl(row.iiif_url, 800)])
  );

  const walkPreviews: WalkPreview[] = walkRows.map((w) => ({
    ...w,
    previewUrl: previewMap.get(w.id) || null,
  }));

  let artworks: WalkArtwork[] = [];
  let walkInfo: { title: string; subtitle: string; description: string; color: string } | null = null;
  if (selected) {
    const walk = db
      .prepare(
        `SELECT id, title, subtitle, description, color
         FROM walks WHERE slug = ? AND published = 1`
      )
      .get(selected) as { id: number; title: string; subtitle: string; description: string; color: string } | undefined;

    if (walk) {
      walkInfo = {
        title: walk.title,
        subtitle: walk.subtitle,
        description: walk.description,
        color: walk.color,
      };

      artworks = db
        .prepare(
          `SELECT wi.position, wi.narrative_text,
                  a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
          FROM walk_items wi
          JOIN artworks a ON a.id = wi.artwork_id
          WHERE wi.walk_id = ?
            AND a.id NOT IN (SELECT artwork_id FROM broken_images)
            AND ${sourceFilter("a")}
          ORDER BY wi.position ASC`
        )
        .all(walk.id) as WalkArtwork[];
    }
  }

  return { walkPreviews, artworks, selected, walkInfo };
}

export default function Walks({ loaderData }: Route.ComponentProps) {
  const { walkPreviews, artworks, selected, walkInfo } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-cream">
      {/* Header */}
      {!selected && (
        <div className="pt-10 px-4 pb-6 md:max-w-5xl lg:max-w-5xl md:mx-auto md:px-6 lg:px-8">
          <h1 className="font-serif text-[2rem] font-bold text-charcoal">
            Vandringar
          </h1>
          <p className="text-warm-gray text-[0.9rem] mt-2 leading-[1.5]">
            Curaterade resor genom samlingen. Varje vandring har ett tema och en berättelse.
          </p>
        </div>
      )}

      {/* Walk cards */}
      {!selected && (
        <div className="px-4 pb-16 flex flex-col gap-3 md:max-w-5xl lg:max-w-5xl md:mx-auto md:px-6 lg:px-8 lg:grid lg:grid-cols-2 lg:gap-4">
          {walkPreviews.map((w) => (
            <a key={w.slug} href={"/walks?walk=" + w.slug}
              className="block relative overflow-hidden rounded-2xl h-40 no-underline focus-ring"
              style={{ backgroundColor: w.color }}
            >
              {w.previewUrl && (
                <img src={w.previewUrl} alt="" role="presentation"
                  loading="lazy"
                  decoding="async"
                  onError={(event) => {
                    event.currentTarget.classList.add("is-broken");
                  }}
                  className="absolute inset-0 w-full h-full object-cover opacity-60" />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.1)_60%)]" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <h2 className="font-serif text-[1.375rem] font-bold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
                  {w.title}
                </h2>
                <p className="text-[0.8rem] text-[rgba(255,255,255,0.7)] mt-1">
                  {w.subtitle}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Selected walk */}
      {selected && walkInfo && (
        <>
          {/* Walk hero */}
          <div className="pt-12 px-4 pb-10 relative md:px-6" style={{ backgroundColor: walkInfo.color }}>
            {artworks[0] && (
                <img
                  src={buildImageUrl(artworks[0].iiif_url, 800)}
                  alt=""
                  role="presentation"
                  loading="eager"
                  fetchPriority="high"
                  onError={(event) => {
                    event.currentTarget.classList.add("is-broken");
                  }}
                  className="absolute inset-0 w-full h-full object-cover opacity-25"
                />
            )}
            <div className="relative md:max-w-5xl lg:max-w-5xl md:mx-auto md:px-0 lg:px-0">
              <a href="/walks" className="text-[0.8rem] text-[rgba(255,255,255,0.5)] no-underline focus-ring">
                ← Alla vandringar
              </a>
              <h1 className="font-serif text-[2rem] font-bold text-white mt-4 leading-[1.2]">
                {walkInfo.title}
              </h1>
              <p className="font-serif text-[1rem] text-[rgba(255,255,255,0.75)] mt-2">
                {walkInfo.subtitle}
              </p>
              <p className="text-[0.9rem] text-[rgba(255,255,255,0.7)] mt-3 leading-[1.6] max-w-[32rem]">
                {walkInfo.description}
              </p>
              <p className="text-[0.75rem] text-[rgba(255,255,255,0.4)] mt-4">
                {artworks.length} verk
              </p>
            </div>
          </div>

          {/* Walk artworks — large, one per row for immersive feel */}
          <div className="pt-6 px-4 pb-16 md:max-w-5xl lg:max-w-5xl md:mx-auto md:px-6 lg:px-8">
            {artworks.map((a: WalkArtwork, i: number) => (
              <div key={a.id}>
                <a href={"/artwork/" + a.id}
                  className="block rounded-2xl overflow-hidden bg-linen mb-4 no-underline shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-ring"
                >
                  <div className="overflow-hidden" style={{ backgroundColor: a.dominant_color || "#D4CDC3" }}>
                    <img src={buildImageUrl(a.iiif_url, 800)}
                      alt={`${a.title_sv || a.title_en || "Utan titel"} — ${parseArtist(a.artists)}`} width={800} height={600}
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                      loading="lazy"
                      decoding="async"
                      className="w-full block" />
                  </div>
                  <div className="p-4">
                    <p className="text-[0.7rem] text-stone mb-1">{i + 1} / {artworks.length}</p>
                    <p className="font-serif text-[1.125rem] font-semibold text-charcoal leading-[1.3]">
                      {a.title_sv || a.title_en || "Utan titel"}
                    </p>
                    <p className="text-[0.8rem] text-warm-gray mt-[0.375rem]">
                      {parseArtist(a.artists)}
                    </p>
                    {a.dating_text && (
                      <p className="text-[0.75rem] text-stone mt-1">{a.dating_text}</p>
                    )}
                  </div>
                </a>
                {a.narrative_text && i < artworks.length - 1 && (
                  <div className="bg-[#F5F0E8] rounded-[0.9rem] py-[0.9rem] px-4 mb-5 text-[#6C6257]">
                    <p className="font-serif italic text-[0.95rem] leading-[1.6]">
                      {a.narrative_text}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
