import type { Route } from "./+types/skola";
import { getCampaignConfig } from "../lib/campaign.server";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";
import { parseArtist } from "../lib/parsing";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Skola — Kabinett" },
    {
      name: "description",
      content:
        "Färdiga lektioner kopplade till svenska museisamlingar. Bildanalys, diskussionsfrågor och koppling till Lgr22.",
    },
  ];
}

type SchoolWalkPreview = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  target_grades: string | null;
  previewUrl: string | null;
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
  discussion_question: string | null;
  position: number;
};

type SchoolWalkInfo = {
  title: string;
  subtitle: string;
  description: string;
  color: string;
  target_grades: string | null;
  lgr22_references: string | null;
  discussion_intro: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("walk") || "";
  const db = getDb();
  const campaign = getCampaignConfig();
  const sourceA = sourceFilter("a");

  const campaignFilter =
    campaign.id === "default"
      ? ["default", "nationalmuseum"]
      : [campaign.id];

  const walkRows = db
    .prepare(
      `SELECT id, slug, title, subtitle, description, color, target_grades
       FROM walks
       WHERE published = 1 AND type = 'school'
         AND campaign_id IN (${campaignFilter.map(() => "?").join(",")})
       ORDER BY created_at DESC`
    )
    .all(...campaignFilter) as Array<Omit<SchoolWalkPreview, "previewUrl">>;

  // Get first artwork image for each walk as preview
  const previewRows = db
    .prepare(
      `SELECT wi.walk_id, a.iiif_url
       FROM walk_items wi
       JOIN artworks a ON a.id = wi.artwork_id
       WHERE wi.position = 1
         AND a.iiif_url IS NOT NULL
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}`
    )
    .all(...sourceA.params) as Array<{ walk_id: number; iiif_url: string }>;

  const previewMap = new Map<number, string>(
    previewRows.map((row) => [row.walk_id, buildImageUrl(row.iiif_url, 800)])
  );

  const walkPreviews: SchoolWalkPreview[] = walkRows.map((w) => ({
    ...w,
    previewUrl: previewMap.get(w.id) || null,
  }));

  let artworks: WalkArtwork[] = [];
  let walkInfo: SchoolWalkInfo | null = null;

  if (selected) {
    const walk = db
      .prepare(
        `SELECT id, title, subtitle, description, color, target_grades, lgr22_references, discussion_intro
         FROM walks WHERE slug = ? AND published = 1 AND type = 'school'`
      )
      .get(selected) as
      | (SchoolWalkInfo & { id: number })
      | undefined;

    if (walk) {
      walkInfo = {
        title: walk.title,
        subtitle: walk.subtitle,
        description: walk.description,
        color: walk.color,
        target_grades: walk.target_grades,
        lgr22_references: walk.lgr22_references,
        discussion_intro: walk.discussion_intro,
      };

      artworks = db
        .prepare(
          `SELECT wi.position, wi.narrative_text, wi.discussion_question,
                  a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
           FROM walk_items wi
           JOIN artworks a ON a.id = wi.artwork_id
           WHERE wi.walk_id = ?
             AND a.id NOT IN (SELECT artwork_id FROM broken_images)
             AND ${sourceA.sql}
           ORDER BY wi.position ASC`
        )
        .all(walk.id, ...sourceA.params) as WalkArtwork[];
    }
  }

  return { walkPreviews, artworks, selected, walkInfo };
}

export default function Skola({ loaderData }: Route.ComponentProps) {
  const { walkPreviews, artworks, selected, walkInfo } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-dark-base text-dark-text">
      {/* Header */}
      {!selected && (
        <div className="pt-10 px-5 pb-6 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <p className="text-[0.6rem] uppercase tracking-[0.2em] text-dark-text-muted font-medium">
            För skolan
          </p>
          <h1 className="font-serif text-[2rem] text-dark-text mt-2">
            Lektioner i museisamlingarna
          </h1>
          <p className="text-dark-text-secondary text-[0.88rem] mt-2.5 leading-[1.6] max-w-[36rem]">
            Färdiga vandringar med diskussionsfrågor och koppling till Lgr22.
            Välj en vandring, titta på verken tillsammans och diskutera.
          </p>
        </div>
      )}

      {/* Walk cards */}
      {!selected && (
        <div className="px-5 pb-16 flex flex-col gap-3.5 md:max-w-6xl md:mx-auto md:px-6 lg:px-8 lg:grid lg:grid-cols-2 lg:gap-4">
          {walkPreviews.map((w) => (
            <a
              key={w.slug}
              href={"/skola?walk=" + w.slug}
              className="block relative overflow-hidden rounded-2xl h-48 no-underline group/walk focus-ring"
              style={{ backgroundColor: w.color }}
            >
              {w.previewUrl && (
                <img
                  src={w.previewUrl}
                  alt=""
                  role="presentation"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover/walk:scale-[1.04] group-hover/walk:opacity-60 transition-[transform,opacity] duration-500"
                />
              )}
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.1)_60%)]" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                {w.target_grades && (
                  <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[rgba(255,255,255,0.5)] mb-1.5">
                    {w.target_grades}
                  </p>
                )}
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

      {/* Selected school walk */}
      {selected && walkInfo && (
        <>
          {/* Hero */}
          <div
            className="pt-12 px-4 pb-10 relative md:px-6"
            style={{ backgroundColor: walkInfo.color }}
          >
            {artworks[0] && (
              <img
                src={buildImageUrl(artworks[0].iiif_url, 800)}
                alt=""
                role="presentation"
                loading="eager"
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover opacity-25"
              />
            )}
            <div className="relative md:max-w-6xl md:mx-auto md:px-0 lg:px-0">
              <a
                href="/skola"
                className="text-[0.8rem] text-[rgba(255,255,255,0.5)] no-underline focus-ring"
              >
                ← Lektioner
              </a>
              {walkInfo.target_grades && (
                <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[rgba(255,255,255,0.45)] mt-4">
                  {walkInfo.target_grades}
                </p>
              )}
              <h1 className="font-serif text-[2rem] font-bold text-white mt-2 leading-[1.2]">
                {walkInfo.title}
              </h1>
              <p className="font-serif text-[1rem] text-[rgba(255,255,255,0.75)] mt-2">
                {walkInfo.subtitle}
              </p>
              <p className="text-[0.9rem] text-[rgba(255,255,255,0.7)] mt-3 leading-[1.6] max-w-[32rem]">
                {walkInfo.description}
              </p>

              {/* Lgr22 reference */}
              {walkInfo.lgr22_references && (
                <div className="mt-5 bg-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 max-w-[32rem]">
                  <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-1">
                    Koppling till Lgr22
                  </p>
                  <p className="text-[0.8rem] text-[rgba(255,255,255,0.65)] leading-[1.5]">
                    {walkInfo.lgr22_references}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-4 mt-5">
                <p className="text-[0.75rem] text-[rgba(255,255,255,0.4)]">
                  {artworks.length} verk
                </p>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="text-[0.72rem] tracking-[0.08em] uppercase text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.8)] transition-colors no-underline focus-ring"
                >
                  Skriv ut ↗
                </button>
              </div>
            </div>
          </div>

          {/* Discussion intro */}
          {walkInfo.discussion_intro && (
            <div className="px-4 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
              <div className="bg-[rgba(201,176,142,0.08)] border border-[rgba(201,176,142,0.12)] rounded-xl px-5 py-4 mt-6 max-w-[36rem]">
                <p className="text-[0.65rem] uppercase tracking-[0.15em] text-dark-text-muted mb-1.5">
                  Innan ni börjar
                </p>
                <p className="text-[0.88rem] text-dark-text-secondary leading-[1.6]">
                  {walkInfo.discussion_intro}
                </p>
              </div>
            </div>
          )}

          {/* Artworks with discussion questions */}
          <div className="pt-6 px-4 pb-16 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
            {artworks.map((a: WalkArtwork, i: number) => (
              <div key={a.id}>
                <a
                  href={"/artwork/" + a.id}
                  className="block rounded-2xl overflow-hidden bg-linen mb-2 no-underline shadow-[0_2px_12px_rgba(0,0,0,0.06)] focus-ring"
                >
                  <div
                    className="overflow-hidden"
                    style={{
                      backgroundColor: a.dominant_color || "#D4CDC3",
                    }}
                  >
                    <img
                      src={buildImageUrl(a.iiif_url, 800)}
                      alt={`${a.title_sv || a.title_en || "Utan titel"} — ${parseArtist(a.artists)}`}
                      width={800}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      className="w-full block"
                    />
                  </div>
                  <div className="p-4">
                    <p className="text-[0.7rem] text-stone mb-1">
                      {i + 1} / {artworks.length}
                    </p>
                    <p className="font-serif text-[1.125rem] font-semibold text-charcoal leading-[1.3]">
                      {a.title_sv || a.title_en || "Utan titel"}
                    </p>
                    <p className="text-[0.8rem] text-warm-gray mt-[0.375rem]">
                      {parseArtist(a.artists)}
                    </p>
                    {a.dating_text && (
                      <p className="text-[0.75rem] text-stone mt-1">
                        {a.dating_text}
                      </p>
                    )}
                  </div>
                </a>

                {/* Narrative text */}
                {a.narrative_text && (
                  <div className="bg-cream rounded-card py-[0.9rem] px-4 mb-2 text-warm-gray">
                    <p className="font-serif italic text-[0.95rem] leading-[1.6]">
                      {a.narrative_text}
                    </p>
                  </div>
                )}

                {/* Discussion question */}
                {a.discussion_question && (
                  <div className="bg-[rgba(201,176,142,0.06)] border border-[rgba(201,176,142,0.10)] rounded-card py-[0.9rem] px-4 mb-5">
                    <p className="text-[0.65rem] uppercase tracking-[0.12em] text-dark-text-muted mb-1">
                      Diskutera
                    </p>
                    <p className="text-[0.9rem] text-dark-text-secondary leading-[1.6]">
                      {a.discussion_question}
                    </p>
                  </div>
                )}

                {!a.narrative_text && !a.discussion_question && (
                  <div className="mb-5" />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Print styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @media print {
          nav, footer, .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .min-h-screen { min-height: auto; }
          img { max-height: 300px; object-fit: contain; }
          a { color: inherit !important; text-decoration: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `,
        }}
      />
    </div>
  );
}
