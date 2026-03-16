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
  artworkCount: number;
  discussionCount: number;
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

type SchoolWalkRow = Omit<
  SchoolWalkPreview,
  "previewUrl" | "subjects" | "gradeBuckets" | "themes" | "artworkCount" | "discussionCount"
>;
type GroupBy = "museum" | "subject" | "grade" | "theme";
type SortBy = "match" | "quickstart" | "dialogue";

const MUSEUM_LABELS: Record<string, string> = {
  default: "Flera samlingar",
  nationalmuseum: "Nationalmuseum",
  shm: "Historiska museet",
  nordiska: "Nordiska museet",
};

const MUSEUM_ORDER = ["nationalmuseum", "shm", "nordiska", "default"];
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

const DEFAULT_SORT_MODE: SortBy = "quickstart";

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

const THEME_VALUE_TEXT: Record<string, string> = {
  "Bildanalys & berättande": "Stöd för bildtolkning och muntligt resonemang",
  "Historia & tidsresor": "Ger historiska perspektiv med tydliga exempel",
  "Makt & samhälle": "Bra grund för värdegrund och samhällsfrågor",
  "Hantverk & design": "Konkreta ingångar till material och form",
  "Identitet & kulturmöten": "Öppnar för samtal om identitet och normer",
  "Natur & miljö": "Kopplar konst till miljö och livsvillkor",
  "Kulturarv & källor": "Tränar källkritik och kulturarvsperspektiv",
};

const GROUP_HELP_TEXTS: Record<GroupBy, Record<string, string>> = {
  museum: {
    default: "Upplägg som hämtar verk och perspektiv från flera samlingar.",
    nationalmuseum: "Konsthistoriska verk med fokus på bildanalys och visuellt berättande.",
    shm: "Historiska föremål som öppnar för tidsresor, makt och samhällsfrågor.",
    nordiska: "Vardagsliv, traditioner och design med tydliga kopplingar till elevernas erfarenheter.",
    Övrigt: "Blandade upplägg från flera samlingar.",
  },
  subject: {
    Bild: "Bildtolkning, komposition och samtal om uttryck i klassrummet.",
    Historia: "Tidsperioder, förändring och källor med konkreta exempel ur samlingarna.",
    Samhällskunskap: "Normer, makt och samhällsfrågor med historiska och nutida perspektiv.",
    Slöjd: "Material, teknik och formgivning med verk som fungerar i praktiska moment.",
    Svenska: "Språk, tolkning och resonemang med stöd av visuella källor.",
    Geografi: "Miljö, plats och landskap kopplat till kultur och historia.",
    Religionskunskap: "Tro, ritualer och livsfrågor med föremål som utgångspunkt.",
    Övergripande: "Breda upplägg för ämnesövergripande arbete.",
  },
  grade: {
    "F–3": "Tydliga startpunkter och korta frågor för yngre elever.",
    "4–6": "Balans mellan fakta, reflektion och egna tolkningar.",
    "7–9": "Fördjupning med mer komplexa resonemang och jämförelser.",
    Gymnasiet: "Analysinriktade upplägg med större krav på argumentation.",
    "Alla årskurser": "Flexibla upplägg som kan anpassas till olika nivåer.",
  },
  theme: {
    "Bildanalys & berättande": "Fokus på bildspråk, tolkning och berättande i flera steg.",
    "Historia & tidsresor": "Konkreta ingångar till tidsperioder och historiska skeenden.",
    "Makt & samhälle": "Underlag för samtal om makt, representation och samhällsfrågor.",
    "Hantverk & design": "Material, teknik och design som går att koppla till praktiskt arbete.",
    "Identitet & kulturmöten": "Samtal om tillhörighet, normer och kulturella möten.",
    "Natur & miljö": "Miljö- och naturperspektiv med visuella och historiska ingångar.",
    "Kulturarv & källor": "Kulturarv som källa till källkritik, jämförelser och analys.",
  },
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getQuickstartScore(walk: SchoolWalkPreview): number {
  const targetArtworks = Math.abs(walk.artworkCount - 3);
  const longTextPenalty = walk.subtitle.length > 70 ? 2 : 0;
  const discussionBonus = walk.discussionCount > 0 ? -2 : 1;
  return targetArtworks + longTextPenalty + discussionBonus;
}

function getDialogueScore(walk: SchoolWalkPreview): number {
  return (walk.discussionCount * 3) + Math.min(walk.artworkCount, 5);
}

function compareWalks(
  a: SchoolWalkPreview,
  b: SchoolWalkPreview,
  sortBy: SortBy,
  orderIndex: Map<number, number>
): number {
  if (sortBy === "quickstart") {
    const delta = getQuickstartScore(a) - getQuickstartScore(b);
    if (delta !== 0) return delta;
  } else if (sortBy === "dialogue") {
    const delta = getDialogueScore(b) - getDialogueScore(a);
    if (delta !== 0) return delta;
  }

  const indexA = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const indexB = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  return indexA - indexB;
}

function getGroupHelp(groupBy: GroupBy, key: string): string {
  const groupTexts = GROUP_HELP_TEXTS[groupBy];
  return groupTexts[key] || "";
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

  const walkMetaRows = db
    .prepare(
      `SELECT
         wi.walk_id,
         COUNT(*) AS artwork_count,
         SUM(
           CASE
             WHEN wi.discussion_question IS NOT NULL AND trim(wi.discussion_question) <> '' THEN 1
             ELSE 0
           END
         ) AS discussion_count
       FROM walk_items wi
       JOIN artworks a ON a.id = wi.artwork_id
       WHERE a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceA.sql}
       GROUP BY wi.walk_id`
    )
    .all(...sourceA.params) as Array<{
      walk_id: number;
      artwork_count: number;
      discussion_count: number | null;
    }>;

  const walkMetaMap = new Map<number, { artworkCount: number; discussionCount: number }>(
    walkMetaRows.map((row) => [
      row.walk_id,
      {
        artworkCount: row.artwork_count,
        discussionCount: row.discussion_count || 0,
      },
    ])
  );

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
    artworkCount: walkMetaMap.get(walk.id)?.artworkCount || 0,
    discussionCount: walkMetaMap.get(walk.id)?.discussionCount || 0,
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

const WalkCard = memo(function WalkCard({ w }: { w: SchoolWalkPreview }) {
  const subject = w.subjects[0] || "Övergripande";
  const grade = w.gradeBuckets[0] || "Alla årskurser";
  const theme = w.themes[0] || "Kulturarv & källor";
  const valueText = THEME_VALUE_TEXT[theme] || "Lektionsunderlag med tydliga frågeingångar.";
  const dialogueText = w.discussionCount > 0
    ? `${w.discussionCount} diskussionsfrågor`
    : "Bygg samtal utifrån verken";

  return (
    <a
      key={w.slug}
      href={"/skola?walk=" + w.slug}
      className="block relative overflow-hidden rounded-2xl h-64 no-underline group/walk focus-ring border border-[rgba(255,255,255,0.14)] shadow-[0_12px_30px_rgba(0,0,0,0.22)] bg-[rgba(18,16,14,0.95)]"
    >
      {!w.previewUrl && (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.32),rgba(255,255,255,0.02)_64%)]" />
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
          className="absolute inset-0 w-full h-full object-cover opacity-62 group-hover/walk:scale-[1.05] group-hover/walk:opacity-78 transition-[transform,opacity] duration-500"
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.3)_58%,rgba(0,0,0,0.36)_100%)]" />
      <div className="absolute inset-x-0 top-0 h-14 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.38),transparent)]" />
      <div className="absolute bottom-0 left-0 right-0 p-5">
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          <p className="text-[0.62rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.8)] rounded-full border border-[rgba(255,255,255,0.36)] bg-[rgba(0,0,0,0.2)] px-2 py-0.5">
            {grade}
          </p>
          <p className="text-[0.62rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.8)] rounded-full border border-[rgba(255,255,255,0.36)] bg-[rgba(0,0,0,0.2)] px-2 py-0.5">
            {subject}
          </p>
          <p className="text-[0.62rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.8)] rounded-full border border-[rgba(255,255,255,0.36)] bg-[rgba(0,0,0,0.2)] px-2 py-0.5">
            {theme}
          </p>
        </div>
        <h2 className="font-serif text-[1.28rem] font-bold text-white leading-[1.22] drop-shadow-[0_1px_4px_rgba(0,0,0,0.34)]">
          {w.title}
        </h2>
        <p className="text-[0.8rem] text-[rgba(255,255,255,0.76)] mt-1 line-clamp-1">
          {w.subtitle}
        </p>
        <p className="text-[0.73rem] text-[rgba(255,255,255,0.72)] mt-2 line-clamp-1">
          {valueText}
        </p>
        <p className="text-[0.69rem] text-[rgba(255,255,255,0.62)] mt-1.5">
          {dialogueText}
        </p>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-[rgba(255,255,255,0.14)] bg-[rgba(7,6,5,0.26)] px-2.5 py-1.5">
          <p className="text-[0.72rem] text-[rgba(255,255,255,0.82)]">
            {w.artworkCount} verk
          </p>
          <span className="text-[0.66rem] uppercase tracking-[0.14em] text-[rgba(255,255,255,0.9)]">
            Öppna upplägg
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-[linear-gradient(to_top,rgba(0,0,0,0.08),transparent)] opacity-0 transition-opacity duration-300 group-hover/walk:opacity-100" />
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
  const orderIndex = useMemo(
    () => new Map<number, number>(walks.map((walk, index) => [walk.id, index])),
    [walks]
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, SchoolWalkPreview[]>();

    for (const walk of walks) {
      const keys = unique(getGroupKeys(walk, groupBy));
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(walk);
      }
    }

    for (const [key, values] of groups.entries()) {
      groups.set(key, [...values].sort((a, b) => compareWalks(a, b, DEFAULT_SORT_MODE, orderIndex)));
    }

    return groups;
  }, [walks, groupBy, orderIndex]);

  const orderedKeys = useMemo(() => {
    return [
      ...preferredOrder.filter((key) => grouped.has(key)),
      ...Array.from(grouped.keys())
        .filter((key) => !preferredOrder.includes(key))
        .sort((a, b) => a.localeCompare(b, "sv")),
    ];
  }, [grouped, preferredOrder]);

  return (
    <div id="upplagg" className="px-5 pb-16 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-2xl border border-[rgba(201,176,142,0.24)] bg-[rgba(30,25,21,0.9)] px-4 py-4 mb-6 md:px-5 md:py-5">
        <div className="relative flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-[0.63rem] uppercase tracking-[0.16em] text-dark-text-muted">
            Snabbvälj
          </p>
          <p className="text-[0.78rem] text-[rgba(245,240,232,0.76)]">
            Välj vy och öppna ett färdigt upplägg direkt.
          </p>
        </div>

        <p className="relative text-[0.67rem] uppercase tracking-[0.14em] text-[rgba(245,240,232,0.48)]">
          Visa efter
        </p>
        <div className="relative flex flex-wrap gap-2 mt-2.5">
          {groupModes.map((mode) => (
            <button
              key={mode}
              onClick={() => setGroupBy(mode)}
              className={`px-4 py-1.5 rounded-full text-[0.8rem] font-medium transition-colors cursor-pointer border ${
                groupBy === mode
                  ? "bg-dark-text text-dark-base border-[rgba(245,240,232,0.92)]"
                  : "bg-[rgba(245,240,232,0.08)] border-transparent text-dark-text-secondary hover:text-dark-text hover:border-[rgba(245,240,232,0.24)]"
              }`}
            >
              {GROUP_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <div className="rounded-lg border border-[rgba(245,240,232,0.13)] bg-[rgba(13,11,9,0.34)] px-3 py-2">
            <p className="text-[0.62rem] uppercase tracking-[0.13em] text-dark-text-muted">Upplägg</p>
            <p className="font-serif text-[1.05rem] text-dark-text mt-0.5">{stats.walkCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(245,240,232,0.13)] bg-[rgba(13,11,9,0.34)] px-3 py-2">
            <p className="text-[0.62rem] uppercase tracking-[0.13em] text-dark-text-muted">Ämnen</p>
            <p className="font-serif text-[1.05rem] text-dark-text mt-0.5">{stats.subjectCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(245,240,232,0.13)] bg-[rgba(13,11,9,0.34)] px-3 py-2">
            <p className="text-[0.62rem] uppercase tracking-[0.13em] text-dark-text-muted">Årskurser</p>
            <p className="font-serif text-[1.05rem] text-dark-text mt-0.5">{stats.gradeCount}</p>
          </div>
          <div className="rounded-lg border border-[rgba(245,240,232,0.13)] bg-[rgba(13,11,9,0.34)] px-3 py-2">
            <p className="text-[0.62rem] uppercase tracking-[0.13em] text-dark-text-muted">Teman</p>
            <p className="font-serif text-[1.05rem] text-dark-text mt-0.5">{stats.themeCount}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:gap-5">
        {orderedKeys.map((key) => {
          const groupItems = grouped.get(key) || [];
          const helperText = getGroupHelp(groupBy, key);

          return (
            <section
              key={key}
              className="relative overflow-hidden rounded-2xl border border-[rgba(245,240,232,0.14)] bg-[rgba(33,28,24,0.72)] p-4 md:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-serif text-[1.18rem] text-dark-text">
                  {labels[key] || key}
                </h2>
                <p className="text-[0.68rem] uppercase tracking-[0.08em] text-dark-text-muted">
                  {groupItems.length} upplägg
                </p>
              </div>
              {helperText && (
                <p className="text-[0.79rem] leading-[1.5] text-dark-text-secondary mt-1.5">
                  {helperText}
                </p>
              )}
              <div className="grid gap-3 mt-3 [content-visibility:auto]">
                {groupItems.map((w) => (
                  <WalkCard key={w.slug} w={w} />
                ))}
              </div>
            </section>
          );
        })}
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
  const selectedPreview = useMemo(
    () => (selected ? walkPreviews.find((walk) => walk.slug === selected) || null : null),
    [walkPreviews, selected]
  );
  const heroSummary = useMemo(() => {
    const quickStarts = walkPreviews.filter((walk) => getQuickstartScore(walk) <= 2).length;

    return { quickStarts };
  }, [walkPreviews]);
  const hasQuickStarts = heroSummary.quickStarts > 0;

  return (
    <div className="min-h-screen pt-[3.5rem] bg-dark-base text-dark-text">
      {/* Header */}
      {!selected && (
        <div className="pt-10 px-5 pb-6 md:max-w-6xl md:mx-auto md:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl border border-[rgba(201,176,142,0.24)] bg-[rgba(28,23,19,0.92)] px-5 py-7 md:px-8 md:py-8">
            <div className="relative grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
              <div>
                <p className="text-[0.62rem] uppercase tracking-[0.2em] text-[rgba(245,240,232,0.58)] font-medium">
                  För skolan
                </p>
                <h1 className="font-serif text-[2rem] md:text-[2.2rem] text-dark-text mt-2">
                  Startklara lektionsupplägg för klassrummet
                </h1>
                <p className="text-dark-text-secondary text-[0.9rem] mt-3 leading-[1.7] max-w-[42rem]">
                  Välj ett upplägg efter ämne, årskurs eller tema. Varje upplägg samlar verk,
                  diskussionsfrågor och Lgr22-koppling i en tydlig lektionsstruktur.
                </p>
                {hasQuickStarts ? (
                  <p className="mt-4 text-[0.8rem] text-[rgba(245,240,232,0.7)]">
                    {heroSummary.quickStarts} upplägg är extra snabba att komma igång med.
                  </p>
                ) : (
                  <p className="mt-4 text-[0.8rem] text-[rgba(245,240,232,0.7)]">
                    Börja med ämne, årskurs eller tema för att hitta rätt upplägg snabbare.
                  </p>
                )}
              </div>
              <div className="rounded-2xl border border-[rgba(245,240,232,0.16)] bg-[rgba(16,13,11,0.5)] px-4 py-4 md:px-5">
                <p className="text-[0.62rem] uppercase tracking-[0.16em] text-dark-text-muted">
                  {hasQuickStarts ? "Redo att starta" : "Att utforska"}
                </p>
                <p className="font-serif text-[1.85rem] leading-none text-dark-text mt-2">
                  {hasQuickStarts ? heroSummary.quickStarts : stats.walkCount}
                </p>
                <p className="text-[0.78rem] text-dark-text-secondary mt-1">
                  {hasQuickStarts
                    ? "upplägg fungerar som snabbstart just nu."
                    : "publicerade upplägg att välja bland just nu."}
                </p>
                <a
                  href="#upplagg"
                  className="mt-4 inline-flex items-center rounded-full border border-[rgba(245,240,232,0.24)] bg-[rgba(245,240,232,0.92)] px-4 py-2 text-[0.72rem] tracking-[0.08em] uppercase text-[#181410] hover:bg-white transition-colors no-underline focus-ring"
                >
                  Utforska upplägg
                </a>
              </div>
            </div>
            <p className="relative mt-4 text-[0.78rem] text-[rgba(245,240,232,0.76)]">
              Visar {stats.walkCount} publicerade upplägg just nu.
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
            className="pt-12 px-4 pb-10 relative md:px-6 bg-[rgba(18,16,14,0.96)]"
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
                className="absolute inset-0 w-full h-full object-cover opacity-25 no-print"
              />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(11,10,9,0.55)_0%,rgba(11,10,9,0.7)_100%)]" />
            <div className="relative md:max-w-6xl md:mx-auto md:px-0 lg:px-0">
              <a
                href="/skola"
                className="text-[0.8rem] text-[rgba(255,255,255,0.5)] no-underline focus-ring"
              >
                ← Tillbaka till översikten
              </a>
              <h1 className="font-serif text-[2rem] font-bold text-white mt-2 leading-[1.2]">
                {walkInfo.title}
              </h1>
              <p className="font-serif text-[1rem] text-[rgba(255,255,255,0.75)] mt-2">
                {walkInfo.subtitle}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <p className="text-[0.64rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.74)] rounded-full border border-[rgba(255,255,255,0.3)] px-2.5 py-1">
                  {selectedPreview?.gradeBuckets[0] || walkInfo.target_grades || "Alla årskurser"}
                </p>
                <p className="text-[0.64rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.74)] rounded-full border border-[rgba(255,255,255,0.3)] px-2.5 py-1">
                  {selectedPreview?.subjects[0] || "Övergripande"}
                </p>
                <p className="text-[0.64rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.74)] rounded-full border border-[rgba(255,255,255,0.3)] px-2.5 py-1">
                  {selectedPreview?.themes[0] || "Kulturarv & källor"}
                </p>
                <p className="text-[0.64rem] uppercase tracking-[0.13em] text-[rgba(255,255,255,0.74)] rounded-full border border-[rgba(255,255,255,0.3)] px-2.5 py-1">
                  {selectedPreview?.artworkCount || artworks.length} verk
                </p>
              </div>
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

              <div className="flex flex-wrap items-center gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-full border border-[rgba(255,255,255,0.24)] bg-[rgba(255,255,255,0.9)] px-4 py-2 text-[0.72rem] tracking-[0.08em] uppercase text-[#191511] hover:bg-white transition-colors no-underline focus-ring"
                >
                  Skriv ut upplägg
                </button>
                <a
                  href="/skola"
                  className="rounded-full border border-[rgba(255,255,255,0.24)] px-4 py-2 text-[0.72rem] tracking-[0.08em] uppercase text-[rgba(255,255,255,0.7)] hover:text-[rgba(255,255,255,0.94)] transition-colors no-underline focus-ring"
                >
                  Alla upplägg
                </a>
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
