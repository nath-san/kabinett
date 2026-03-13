import { memo, useMemo, useState } from "react";
import type { Route } from "./+types/skola";
import { buildArtworkAltText } from "../components/artwork-meta";
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
        "Färdiga lektionsupplägg i svenska museisamlingar. Planera per ämne, årskurs eller tema med koppling till Lgr22.",
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
  campaign_id: string;
  subject: string | null;
  lgr22_references: string | null;
  previewUrl: string | null;
  subjects: string[];
  gradeBuckets: string[];
  themes: string[];
};

type WalkArtwork = {
  id: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  technique_material: string | null;
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

type SchoolWalkStats = {
  walkCount: number;
  subjectCount: number;
  gradeCount: number;
  themeCount: number;
};

type SchoolWalkRow = Omit<SchoolWalkPreview, "previewUrl" | "subjects" | "gradeBuckets" | "themes">;
type GroupBy = "museum" | "subject" | "grade" | "theme";

const MUSEUM_LABELS: Record<string, string> = {
  nationalmuseum: "Nationalmuseum",
  shm: "Historiska museet",
  nordiska: "Nordiska museet",
};

const MUSEUM_ORDER = ["nationalmuseum", "shm", "nordiska"];
const SUBJECT_ORDER = [
  "Bild",
  "Historia",
  "Samhällskunskap",
  "Slöjd",
  "Svenska",
  "Geografi",
  "Religionskunskap",
  "Övergripande",
];
const GRADE_ORDER = ["F–3", "4–6", "7–9", "Gymnasiet", "Alla årskurser"];
const THEME_ORDER = [
  "Bildanalys & berättande",
  "Historia & tidsresor",
  "Makt & samhälle",
  "Hantverk & design",
  "Identitet & kulturmöten",
  "Natur & miljö",
  "Kulturarv & källor",
];

const GROUP_MODE_LABELS: Record<GroupBy, string> = {
  museum: "Per museum",
  subject: "Per ämne",
  grade: "Per årskurs",
  theme: "Per tema",
};

const CAMPAIGN_PRIMARY_SOURCE: Record<string, string | null> = {
  default: null,
  nationalmuseum: "nationalmuseum",
  nordiska: "nordiska",
  shm: "shm",
};

const SUBJECT_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Bild", pattern: /\bbild\b|konst|färg|porträtt|komposition/i },
  { label: "Historia", pattern: /historia|historisk|medeltid|viking|stormakt|tidsperiod/i },
  { label: "Samhällskunskap", pattern: /samhäll|demokrati|politik|migration|mångfald|integration/i },
  { label: "Slöjd", pattern: /slöjd|hantverk|textil|snickeri|broderi|materialval|mönster/i },
  { label: "Svenska", pattern: /svenska|berättande|tolka|läsa|argument/i },
  { label: "Geografi", pattern: /geografi|landskap|miljö|natur|plats/i },
  { label: "Religionskunskap", pattern: /religion|kyrka|tro|ritual/i },
];

const THEME_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Bildanalys & berättande", pattern: /bild|färg|komposition|porträtt|berätt|tolka/i },
  { label: "Historia & tidsresor", pattern: /historia|historisk|viking|medeltid|stormakt|tidsperiod/i },
  { label: "Makt & samhälle", pattern: /makt|symbol|kung|drottning|regent|demokrati|politik|samhäll/i },
  { label: "Hantverk & design", pattern: /hantverk|slöjd|textil|dräkt|formgiv|design|silver|trä/i },
  { label: "Identitet & kulturmöten", pattern: /identitet|kultur|möten|migration|vardagsliv|mångfald|samer|rom/i },
  { label: "Natur & miljö", pattern: /natur|landskap|djur|miljö|skärgård|skog|fjäll/i },
];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitTags(input: string | null): string[] {
  if (!input) return [];
  return input
    .split(/[,;/]| och | & |\+|\|/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function toCanonicalSubject(raw: string): string {
  const token = raw.trim().toLowerCase();
  if (!token) return "Övergripande";
  if (token.includes("bild") || token.includes("konst")) return "Bild";
  if (token.includes("hist")) return "Historia";
  if (token.includes("samhäll")) return "Samhällskunskap";
  if (token.includes("slöjd") || token.includes("hantverk")) return "Slöjd";
  if (token.includes("svenska") || token.includes("språk")) return "Svenska";
  if (token.includes("geografi")) return "Geografi";
  if (token.includes("religion")) return "Religionskunskap";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function extractSubjectsFromLgr22(lgr22: string | null): string[] {
  if (!lgr22) return [];

  const beforeColonMatches = [...lgr22.matchAll(/(^|[\s,;/])([A-Za-zÅÄÖåäö/ ]{2,})\s*:/g)];
  const parsed: string[] = [];

  for (const match of beforeColonMatches) {
    const raw = (match[2] || "").trim();
    if (!raw) continue;
    const parts = raw
      .split(/[\/,&]| och /i)
      .map((part) => part.trim())
      .filter(Boolean);
    parsed.push(...parts.map(toCanonicalSubject));
  }

  return unique(parsed);
}

function inferSubjects(row: SchoolWalkRow): string[] {
  const fromColumn = splitTags(row.subject).map(toCanonicalSubject);
  const fromLgr22 = extractSubjectsFromLgr22(row.lgr22_references);
  const textBlob = [row.title, row.subtitle, row.description, row.lgr22_references].filter(Boolean).join(" ");
  const inferred = SUBJECT_RULES
    .filter((rule) => rule.pattern.test(textBlob))
    .map((rule) => rule.label);

  const merged = unique([...fromColumn, ...fromLgr22, ...inferred]);
  return merged.length > 0 ? merged : ["Övergripande"];
}

function inferGradeBuckets(targetGrades: string | null): string[] {
  if (!targetGrades) return ["Alla årskurser"];

  const normalized = targetGrades.toLowerCase().replace(/\s+/g, " ");
  const buckets: string[] = [];

  if (/f[\s-]?3|förskoleklass|åk\s*1[-–]\s*3/.test(normalized)) buckets.push("F–3");
  if (/4[-–]\s*6|åk\s*4[-–]\s*6/.test(normalized)) buckets.push("4–6");
  if (/7[-–]\s*9|åk\s*7[-–]\s*9/.test(normalized)) buckets.push("7–9");
  if (/gymnas/.test(normalized)) buckets.push("Gymnasiet");

  return buckets.length > 0 ? unique(buckets) : ["Alla årskurser"];
}

function inferThemes(row: SchoolWalkRow): string[] {
  // Use title/subtitle/description first so themes become more specific.
  const primaryText = [row.title, row.subtitle, row.description].filter(Boolean).join(" ");
  const primaryMatches = THEME_RULES
    .filter((rule) => rule.pattern.test(primaryText))
    .map((rule) => rule.label);

  if (primaryMatches.length > 0) {
    return unique(primaryMatches);
  }

  // Fallback to Lgr22 text when no stronger signal exists.
  const fallbackText = row.lgr22_references || "";
  const fallbackMatches = THEME_RULES
    .filter((rule) => rule.pattern.test(fallbackText))
    .map((rule) => rule.label);

  return fallbackMatches.length > 0 ? unique(fallbackMatches) : ["Kulturarv & källor"];
}

function getGroupKeys(walk: SchoolWalkPreview, groupBy: GroupBy): string[] {
  if (groupBy === "museum") return [walk.campaign_id || "Övrigt"];
  if (groupBy === "subject") return [walk.subjects[0] || "Övrigt"];
  if (groupBy === "grade") return walk.gradeBuckets.length > 0 ? walk.gradeBuckets : ["Alla årskurser"];
  return [walk.themes[0] || "Kulturarv & källor"];
}

function getPreferredOrder(groupBy: GroupBy): string[] {
  if (groupBy === "museum") return MUSEUM_ORDER;
  if (groupBy === "subject") return SUBJECT_ORDER;
  if (groupBy === "grade") return GRADE_ORDER;
  return THEME_ORDER;
}

function getGroupLabels(groupBy: GroupBy): Record<string, string> {
  if (groupBy === "museum") return { ...MUSEUM_LABELS, Övrigt: "Övrigt" };
  if (groupBy === "subject") return { ...Object.fromEntries(SUBJECT_ORDER.map((key) => [key, key])), Övrigt: "Övrigt" };
  if (groupBy === "grade") return { ...Object.fromEntries(GRADE_ORDER.map((key) => [key, key])) };
  return { ...Object.fromEntries(THEME_ORDER.map((key) => [key, key])) };
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("walk") || "";
  const db = getDb();
  const campaign = getCampaignConfig();
  const sourceA = sourceFilter("a");
  const walkTableColumns = db
    .prepare("PRAGMA table_info(walks)")
    .all() as Array<{ name: string }>;
  const hasCampaignColumn = walkTableColumns.some((col) => col.name === "campaign_id");
  const hasTypeColumn = walkTableColumns.some((col) => col.name === "type");
  const hasTargetGradesColumn = walkTableColumns.some((col) => col.name === "target_grades");
  const hasSubjectColumn = walkTableColumns.some((col) => col.name === "subject");
  const hasLgr22Column = walkTableColumns.some((col) => col.name === "lgr22_references");
  const hasDiscussionIntroColumn = walkTableColumns.some((col) => col.name === "discussion_intro");

  // Default campaign shows ALL school walks (cross-museum overview)
  // Museum subdomains show only their own
  const isDefault = campaign.id === "default";
  const campaignFilter = isDefault
    ? ["default", "nationalmuseum", "nordiska", "shm"]
    : [campaign.id];

  if (!hasCampaignColumn || !hasTypeColumn) {
    return {
      walkPreviews: [] as SchoolWalkPreview[],
      artworks: [] as WalkArtwork[],
      selected: "",
      walkInfo: null as SchoolWalkInfo | null,
      isDefault,
      stats: { walkCount: 0, subjectCount: 0, gradeCount: 0, themeCount: 0 } as SchoolWalkStats,
    };
  }

  const walkRows = db
    .prepare(
      `SELECT id, slug, title, subtitle, description, color, campaign_id,
         ${hasTargetGradesColumn ? "target_grades" : "NULL as target_grades"},
         ${hasLgr22Column ? "lgr22_references" : "NULL as lgr22_references"},
         ${hasSubjectColumn ? "subject" : "NULL as subject"}
       FROM walks
       WHERE published = 1 AND type = 'school'
         AND campaign_id IN (${campaignFilter.map(() => "?").join(",")})
       ORDER BY campaign_id, ${hasTargetGradesColumn ? "target_grades," : ""} created_at DESC`
    )
    .all(...campaignFilter) as SchoolWalkRow[];

  const previewRows = db
    .prepare(
      `WITH ranked_previews AS (
         SELECT
           wi.walk_id,
           a.iiif_url,
           ROW_NUMBER() OVER (
             PARTITION BY wi.walk_id
             ORDER BY wi.position ASC
           ) AS rn
         FROM walk_items wi
         JOIN artworks a ON a.id = wi.artwork_id
         WHERE a.iiif_url IS NOT NULL
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
       )
       SELECT walk_id, iiif_url
       FROM ranked_previews
       WHERE rn = 1`
    )
    .all(...sourceA.params) as Array<{ walk_id: number; iiif_url: string }>;

  const sourceFallbackRows = db
    .prepare(
      `WITH ranked_source_previews AS (
         SELECT
           a.source,
           a.iiif_url,
           ROW_NUMBER() OVER (
             PARTITION BY a.source
             ORDER BY a.rowid DESC
           ) AS rn
         FROM artworks a
         WHERE a.iiif_url IS NOT NULL
           AND a.id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceA.sql}
       )
       SELECT source, iiif_url
       FROM ranked_source_previews
       WHERE rn = 1`
    )
    .all(...sourceA.params) as Array<{ source: string; iiif_url: string }>;

  const previewMap = new Map<number, string>(
    previewRows.map((row) => [row.walk_id, buildImageUrl(row.iiif_url, 800)])
  );
  const sourceFallbackMap = new Map<string, string>(
    sourceFallbackRows.map((row) => [row.source, buildImageUrl(row.iiif_url, 800)])
  );
  const firstFallbackPreview = sourceFallbackRows[0]
    ? buildImageUrl(sourceFallbackRows[0].iiif_url, 800)
    : null;

  const walkPreviews: SchoolWalkPreview[] = walkRows.map((walk) => ({
    ...walk,
    previewUrl:
      previewMap.get(walk.id)
      || (CAMPAIGN_PRIMARY_SOURCE[walk.campaign_id]
        ? sourceFallbackMap.get(CAMPAIGN_PRIMARY_SOURCE[walk.campaign_id] as string) || null
        : firstFallbackPreview)
      || null,
    subjects: inferSubjects(walk),
    gradeBuckets: inferGradeBuckets(walk.target_grades),
    themes: inferThemes(walk),
  }));

  const uniqueSubjects = new Set<string>();
  const uniqueGrades = new Set<string>();
  const uniqueThemes = new Set<string>();
  for (const walk of walkPreviews) {
    walk.subjects.forEach((subject) => uniqueSubjects.add(subject));
    walk.gradeBuckets.forEach((grade) => uniqueGrades.add(grade));
    walk.themes.forEach((theme) => uniqueThemes.add(theme));
  }

  const stats: SchoolWalkStats = {
    walkCount: walkPreviews.length,
    subjectCount: uniqueSubjects.size,
    gradeCount: uniqueGrades.size,
    themeCount: uniqueThemes.size,
  };

  let artworks: WalkArtwork[] = [];
  let walkInfo: SchoolWalkInfo | null = null;

  if (selected) {
    const walk = db
      .prepare(
        `SELECT id, title, subtitle, description, color,
                ${hasTargetGradesColumn ? "target_grades" : "NULL as target_grades"},
                ${hasLgr22Column ? "lgr22_references" : "NULL as lgr22_references"},
                ${hasDiscussionIntroColumn ? "discussion_intro" : "NULL as discussion_intro"}
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
                  a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.technique_material, a.dating_text
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

  return { walkPreviews, artworks, selected, walkInfo, isDefault, stats };
}

function StatChip({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[rgba(245,240,232,0.11)] bg-[rgba(19,16,13,0.55)] px-3 py-2.5">
      <p className="font-serif text-[1.05rem] text-dark-text leading-[1.1]">
        {value}
      </p>
      <p className="text-[0.66rem] uppercase tracking-[0.08em] text-dark-text-muted mt-1">
        {label}
      </p>
    </div>
  );
}

const WalkCard = memo(function WalkCard({ w }: { w: SchoolWalkPreview }) {
  const subject = w.subjects[0] || "Övergripande";
  const grade = w.gradeBuckets[0] || "Alla årskurser";
  const theme = w.themes[0] || "Kulturarv & källor";

  return (
    <a
      key={w.slug}
      href={"/skola?walk=" + w.slug}
      className="block relative overflow-hidden rounded-2xl h-48 no-underline group/walk focus-ring"
      style={{ backgroundColor: w.color }}
    >
      {!w.previewUrl && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),rgba(255,255,255,0.02)_62%)]" />
      )}
      {w.previewUrl && (
        <img
          src={w.previewUrl}
          alt=""
          role="presentation"
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.classList.add("is-broken");
          }}
          className="absolute inset-0 w-full h-full object-cover opacity-50 group-hover/walk:scale-[1.04] group-hover/walk:opacity-60 transition-[transform,opacity] duration-500"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.7)_0%,rgba(0,0,0,0.1)_60%)]" />
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <p className="text-[0.62rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.66)] rounded-full border border-[rgba(255,255,255,0.3)] px-2 py-0.5">
            {grade}
          </p>
          <p className="text-[0.62rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.66)] rounded-full border border-[rgba(255,255,255,0.3)] px-2 py-0.5">
            {subject}
          </p>
        </div>
        <h2 className="font-serif text-[1.375rem] font-bold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
          {w.title}
        </h2>
        <p className="text-[0.8rem] text-[rgba(255,255,255,0.7)] mt-1">
          {w.subtitle}
        </p>
        <p className="text-[0.68rem] text-[rgba(255,255,255,0.58)] mt-2 truncate">
          Tema: {theme}
        </p>
      </div>
    </a>
  );
});

function WalkGrid({
  walks,
  isDefault,
  stats,
}: {
  walks: SchoolWalkPreview[];
  isDefault: boolean;
  stats: SchoolWalkStats;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>(isDefault ? "museum" : "subject");
  const groupModes: GroupBy[] = isDefault
    ? ["museum", "subject", "grade", "theme"]
    : ["subject", "grade", "theme"];

  const labels = useMemo(() => getGroupLabels(groupBy), [groupBy]);
  const preferredOrder = useMemo(() => getPreferredOrder(groupBy), [groupBy]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SchoolWalkPreview[]>();

    for (const walk of walks) {
      const keys = unique(getGroupKeys(walk, groupBy));
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(walk);
      }
    }

    return groups;
  }, [walks, groupBy]);

  const orderedKeys = useMemo(() => {
    return [
      ...preferredOrder.filter((key) => grouped.has(key)),
      ...Array.from(grouped.keys())
        .filter((key) => !preferredOrder.includes(key))
        .sort((a, b) => a.localeCompare(b, "sv")),
    ];
  }, [grouped, preferredOrder]);

  return (
    <div className="px-5 pb-16 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
      <div className="rounded-2xl border border-[rgba(201,176,142,0.2)] bg-[linear-gradient(140deg,rgba(36,30,24,0.86),rgba(24,20,17,0.88))] px-4 py-4 mb-6 md:px-5 md:py-5">
        <p className="text-[0.63rem] uppercase tracking-[0.16em] text-dark-text-muted">
          Utforska upplägg
        </p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {groupModes.map((mode) => (
            <button
              key={mode}
              onClick={() => setGroupBy(mode)}
              className={`px-4 py-1.5 rounded-full text-[0.8rem] font-medium transition-colors cursor-pointer ${
                groupBy === mode
                  ? "bg-dark-text text-dark-base"
                  : "bg-[rgba(245,240,232,0.08)] text-dark-text-secondary hover:text-dark-text"
              }`}
            >
              {GROUP_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4 md:grid-cols-4">
          <StatChip value={String(stats.walkCount)} label="Lektionsupplägg" />
          <StatChip value={String(stats.subjectCount)} label="Ämnen" />
          <StatChip value={String(stats.gradeCount)} label="Årskurser" />
          <StatChip value={String(stats.themeCount)} label="Teman" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        {orderedKeys.map((key) => (
          <section
            key={key}
            className="rounded-2xl border border-[rgba(245,240,232,0.1)] bg-[rgba(35,30,25,0.45)] p-4 md:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-serif text-[1.18rem] text-dark-text">
                {labels[key] || key}
              </h2>
              <p className="text-[0.68rem] uppercase tracking-[0.08em] text-dark-text-muted">
                {grouped.get(key)?.length || 0} upplägg
              </p>
            </div>
            <div className="grid gap-3 mt-3">
              {grouped.get(key)!.map((w) => (
                <WalkCard key={w.slug} w={w} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {orderedKeys.length === 0 && (
        <div className="rounded-xl border border-[rgba(245,240,232,0.12)] bg-dark-raised p-4">
          <p className="text-[0.85rem] text-dark-text-secondary">
            Inga upplägg finns i den här vyn just nu.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Skola({ loaderData }: Route.ComponentProps) {
  const { walkPreviews, artworks, selected, walkInfo, isDefault, stats } = loaderData;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-dark-base text-dark-text">
      {/* Header */}
      {!selected && (
        <div className="pt-10 px-5 pb-6 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-[rgba(201,176,142,0.22)] bg-[linear-gradient(145deg,#2c241c_0%,#1e1914_48%,#15120f_100%)] px-5 py-7 md:px-8 md:py-8">
            <div className="pointer-events-none absolute -top-20 right-[-2.5rem] h-56 w-56 rounded-full bg-[rgba(196,85,58,0.22)] blur-3xl" />
            <div className="pointer-events-none absolute bottom-[-4.25rem] left-[-3rem] h-52 w-52 rounded-full bg-[rgba(135,93,56,0.28)] blur-3xl" />
            <p className="text-[0.62rem] uppercase tracking-[0.2em] text-[rgba(245,240,232,0.58)] font-medium relative">
              För skolan
            </p>
            <h1 className="font-serif text-[2rem] md:text-[2.2rem] text-dark-text mt-2 relative">
              Lektionsupplägg som väcker samtal
            </h1>
            <p className="text-dark-text-secondary text-[0.9rem] mt-3 leading-[1.7] max-w-[42rem] relative">
              Starta i ämne, årskurs eller tema. Varje upplägg innehåller utvalda verk,
              samtalsfrågor och tydlig koppling till Lgr22.
            </p>
          </div>
        </div>
      )}

      {/* Walk cards */}
      {!selected && (
        <WalkGrid
          walks={walkPreviews}
          isDefault={isDefault}
          stats={stats}
        />
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
                onError={(event) => {
                  event.currentTarget.classList.add("is-broken");
                }}
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
              <div className="bg-dark-raised border border-[rgba(201,176,142,0.15)] rounded-xl px-5 py-4 mt-6 max-w-[36rem]">
                <p className="text-[0.65rem] uppercase tracking-[0.15em] text-[rgba(201,176,142,0.55)] mb-1.5">
                  Innan ni börjar
                </p>
                <p className="text-[0.88rem] text-dark-text leading-[1.6]">
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
                      alt={buildArtworkAltText({
                        title_sv: a.title_sv || a.title_en || null,
                        artists: a.artists,
                        artist_name: null,
                        technique_material: a.technique_material,
                        dating_text: a.dating_text,
                      })}
                      width={800}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        event.currentTarget.classList.add("is-broken");
                      }}
                      className="w-full block"
                    />
                  </div>
                  <div className="p-4">
                    <p className="text-[0.7rem] text-[#8a7e72] mb-1">
                      {i + 1} / {artworks.length}
                    </p>
                    <p className="font-serif text-[1.125rem] font-semibold text-charcoal leading-[1.3]">
                      {a.title_sv || a.title_en || "Utan titel"}
                    </p>
                    <p className="text-[0.8rem] text-[#6b6054] mt-[0.375rem]">
                      {parseArtist(a.artists)}
                    </p>
                    {a.dating_text && (
                      <p className="text-[0.75rem] text-[#8a7e72] mt-1">
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
                  <div className="bg-dark-raised border border-[rgba(201,176,142,0.12)] rounded-card py-[0.9rem] px-4 mb-5">
                    <p className="text-[0.65rem] uppercase tracking-[0.12em] text-[rgba(201,176,142,0.55)] mb-1.5">
                      Diskutera
                    </p>
                    <p className="text-[0.9rem] text-dark-text leading-[1.6]">
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
          body, div, section, main { background: white !important; background-color: white !important; color: black !important; }
          .min-h-screen { min-height: auto; background: white !important; }
          .pt-\\[3\\.5rem\\] { padding-top: 0 !important; }
          img { max-height: 250px; object-fit: contain; break-inside: avoid; }
          a { color: inherit !important; text-decoration: none !important; }
          h1, h2, p { color: black !important; }
          [class*="bg-"] { background: white !important; background-color: white !important; }
          [class*="border-"] { border-color: #ddd !important; }
          [class*="text-dark"], [class*="text-stone"], [class*="text-warm"], [class*="text-charcoal"] { color: #333 !important; }
          [class*="rounded-card"], [class*="rounded-xl"] { border: 1px solid #ddd !important; }
          .shadow-lg, [class*="shadow-"] { box-shadow: none !important; }
        }
      `,
        }}
      />
    </div>
  );
}
