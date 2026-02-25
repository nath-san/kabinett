import { getDb } from "./db.server";
import { buildImageUrl } from "./images";
import { sourceFilter } from "./museums.server";
import { parseArtist } from "./parsing";
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  pipeline,
  env,
} from "@xenova/transformers";

env.allowLocalModels = false;

let translatorPromise: Promise<any> | null = null;

function getTranslator() {
  if (!translatorPromise) {
    translatorPromise = pipeline("translation", "Xenova/opus-mt-sv-en");
  }
  return translatorPromise;
}

const SV_EN_LOOKUP: Record<string, string> = {
  djur: "animals horses dogs cats birds painting", djuren: "animals horses dogs cats birds painting",
  häst: "horse equestrian", hästar: "horses equestrian", hästarna: "horses equestrian",
  hund: "dog", hundar: "dogs", katt: "cat", katter: "cats",
  fågel: "bird", fåglar: "birds", fåglarna: "birds",
  ko: "cow", lejon: "lion", fisk: "fish", fjäril: "butterfly",
  landskap: "landscape", landskapet: "landscape scenery",
  skog: "forest", skogen: "forest woods",
  hav: "sea ocean seascape coast ships maritime", havet: "sea ocean seascape coast ships maritime painting",
  sjö: "lake", sjön: "lake water",
  berg: "mountain mountains", bergen: "mountains",
  himmel: "sky", himlen: "sky clouds",
  moln: "clouds", sol: "sun sunshine", måne: "moon moonlight",
  träd: "tree trees", blommor: "flowers floral still life botanical", blomma: "flower floral",
  blommorna: "flowers floral botanical",
  vinter: "winter snow cold", vintern: "winter snow cold landscape",
  sommar: "summer warm sunny", sommaren: "summer warm sunny landscape",
  höst: "autumn fall foliage", hösten: "autumn fall foliage",
  vår: "spring blossoms", våren: "spring blossoms",
  kvinna: "woman female", kvinnan: "woman female portrait",
  man: "man male", mannen: "man male portrait",
  barn: "child children", barnen: "children kids",
  flicka: "girl", flickan: "girl young woman",
  pojke: "boy", pojken: "boy young man",
  porträtt: "portrait face person", ansikte: "face portrait", ansiktet: "face portrait",
  människor: "people persons crowd",
  naken: "nude naked body", kropp: "body human figure",
  mörk: "dark darkness", mörkt: "dark night", ljus: "light bright",
  lugn: "calm peaceful", storm: "storm stormy", dramatisk: "dramatic",
  sorg: "sadness grief", glädje: "joy happiness", ensam: "lonely solitary",
  kärlek: "love romance",
  stad: "city town", hus: "house building", kyrka: "church", slott: "castle palace",
  skepp: "ship boat", bro: "bridge", trädgård: "garden", mat: "food",
  frukt: "fruit", äpple: "apple", äpplen: "apples", päron: "pear",
  citron: "lemon", druva: "grape", druvor: "grapes", bär: "berries",
  vin: "wine", bord: "table", stol: "chair",
  stilleben: "still life", abstrakt: "abstract", skulptur: "sculpture",
  målning: "painting", teckning: "drawing",
  röd: "red", rött: "red", blå: "blue", blått: "blue", grön: "green",
  grönt: "green", gul: "yellow", gult: "yellow", vit: "white",
  svart: "black", guld: "gold golden",
  krig: "war battle", död: "death", musik: "music", dans: "dance",
  religion: "religion religious", gud: "god", ängel: "angel",
  vågor: "waves", snö: "snow", is: "ice", eld: "fire",
};

// Rich prompt expansions for common Swedish search terms
const RICH_PROMPTS: Record<string, string> = {
  "djur": "animals, horses, dogs, cats, birds in paintings",
  "djuren": "animals, horses, dogs, cats, birds in paintings",
  "djur i konsten": "animals, horses, dogs, cats, birds in paintings",
  "havet": "seascape, ocean, coast, ships, water, maritime painting",
  "hav": "seascape, ocean, coast, ships, water, maritime painting",
  "havslandskap": "seascape, ocean, coast, ships, water, maritime painting",
  "blommor": "flowers, floral still life, roses, botanical painting",
  "blommorna": "flowers, floral still life, roses, botanical painting",
  "natt": "night scene, moonlight, dark atmosphere, nocturnal painting",
  "nattscener": "night scene, moonlight, dark atmosphere, nocturnal painting",
  "porträtt": "portrait, face, person, bust painting",
  "landskap": "landscape, scenery, countryside, nature painting",
  "stilleben": "still life, table, fruit, flowers, objects painting",
  "vinter": "winter, snow, cold, ice, frozen landscape painting",
  "sommar": "summer, warm, sunny, meadow, bright landscape painting",
  "hästar": "horses, equestrian, riding painting",
  "hundar": "dogs, hounds, hunting dogs painting",
  "barn": "children, kids, boys, girls, playing painting",
  "krig": "war, battle, soldiers, military painting",
  "dans": "dance, dancing, ball, music painting",
  "musik": "music, musicians, instruments, concert painting",
  "religion": "religious, biblical, church, saints, angels painting",
  "skulptur": "sculpture, statue, bust, marble, bronze",
  "abstrakt": "abstract art, geometric, modern, non-figurative",
};

const translationCache = new Map<string, string>();

export function lookupTranslate(text: string): { result: string; allFound: boolean } {
  const words = text.split(/\s+/);
  let allFound = true;
  const translated = words.map((w) => {
    const en = SV_EN_LOOKUP[w];
    if (!en) allFound = false;
    return en || w;
  });
  return { result: translated.join(" "), allFound };
}

async function translateToEnglish(text: string): Promise<string> {
  const lower = text.toLowerCase().trim();

  // 1. Curated rich prompts (best quality)
  const rich = RICH_PROMPTS[lower];
  if (rich) return rich;

  // 2. Check cache
  const cached = translationCache.get(lower);
  if (cached) return cached;

  // 3. Try lookup table
  const lookup = lookupTranslate(lower);
  if (lookup.allFound) {
    translationCache.set(lower, lookup.result);
    return lookup.result;
  }

  // 4. Fall back to opus-mt-sv-en translation model
  try {
    const translator = await getTranslator();
    const output = await translator(lower, { max_length: 128 });
    const translated = (output as Array<{ translation_text: string }>)[0]?.translation_text?.trim();
    if (translated && translated.toLowerCase() !== lower) {
      translationCache.set(lower, translated);
      return translated;
    }
  } catch (err) {
    console.error("Translation model failed, using lookup fallback:", err);
  }

  // 5. Fallback: return partial lookup result
  translationCache.set(lower, lookup.result);
  return lookup.result;
}

function translateQuerySync(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const translated = words.map((w) => {
    const en = SV_EN_LOOKUP[w];
    return en ? `${w} ${en}` : w;
  });
  return translated.join(" ");
}

export type ClipResult = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  heroUrl: string;
  year: string;
  color: string;
  similarity: number;
  museum_name: string | null;
  source: string | null;
};

type VectorRow = {
  id: number;
  distance: number;
  title_sv: string | null;
  title_en: string | null;
  iiif_url: string;
  dominant_color: string | null;
  artists: string | null;
  dating_text: string | null;
  museum_name: string | null;
  source: string | null;
};

let textModelPromise: Promise<{ tokenizer: any; textModel: any }> | null = null;

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const denom = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / denom;
  return out;
}

async function getTextModel() {
  if (!textModelPromise) {
    textModelPromise = (async () => {
      const tokenizer = await AutoTokenizer.from_pretrained("Xenova/clip-vit-base-patch32");
      const textModel = await CLIPTextModelWithProjection.from_pretrained("Xenova/clip-vit-base-patch32");
      return { tokenizer, textModel };
    })();
  }
  return textModelPromise;
}

function clampSimilarityFromL2(distance: number): number {
  const value = 1 - distance / 2;
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function runKnnQuery(
  vectorBlob: Buffer,
  k: number,
  allowedSource: { sql: string; params: string[] }
): VectorRow[] {
  const db = getDb();
  // vec_artworks uses auto rowids; vec_artwork_map maps rowid -> artwork_id
  const sql = `
    SELECT
      map.artwork_id as id,
      v.distance,
      a.title_sv,
      a.title_en,
      a.iiif_url,
      a.dominant_color,
      a.artists,
      a.dating_text,
      a.source,
      m.name as museum_name
    FROM vec_artworks v
    JOIN vec_artwork_map map ON map.vec_rowid = v.rowid
    JOIN artworks a ON a.id = map.artwork_id
    LEFT JOIN museums m ON m.id = a.source
    WHERE v.embedding MATCH ?
      AND k = ?
      AND ${allowedSource.sql}
      AND a.id NOT IN (SELECT artwork_id FROM broken_images)
    ORDER BY v.distance
    LIMIT ?
  `;

  return db.prepare(sql).all(vectorBlob, k, ...allowedSource.params, k) as VectorRow[];
}

export async function clipSearch(q: string, limit = 60, offset = 0, source?: string): Promise<ClipResult[]> {
  const { tokenizer, textModel } = await getTextModel();

  let translatedQuery: string;
  try {
    translatedQuery = await translateToEnglish(q);
  } catch {
    translatedQuery = translateQuerySync(q);
  }

  const textInputs = tokenizer(translatedQuery, { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);
  const queryEmbedding = normalize(new Float32Array(text_embeds.data));
  const queryBuffer = Buffer.from(
    queryEmbedding.buffer,
    queryEmbedding.byteOffset,
    queryEmbedding.byteLength
  );

  const effectiveSource = source?.trim() || null;
  const desiredCount = offset + limit;
  const allowedSource = sourceFilter("a");
  let candidateK = Math.max(120, desiredCount * 3);
  let filteredRows: VectorRow[] = [];

  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = runKnnQuery(queryBuffer, candidateK, allowedSource);
    filteredRows = effectiveSource
      ? rows.filter((row) => row.source === effectiveSource)
      : rows;

    if (filteredRows.length >= desiredCount || rows.length < candidateK) {
      break;
    }

    candidateK = Math.min(candidateK * 2, 5_000);
  }

  return filteredRows.slice(offset, offset + limit).map((row) => ({
    id: row.id,
    title: row.title_sv || row.title_en || "Utan titel",
    artist: parseArtist(row.artists),
    imageUrl: buildImageUrl(row.iiif_url, 400),
    heroUrl: buildImageUrl(row.iiif_url, 800),
    year: row.dating_text || "",
    color: row.dominant_color || "#D4CDC3",
    similarity: clampSimilarityFromL2(row.distance),
    museum_name: row.museum_name ?? null,
    source: row.source ?? null,
  }));
}
