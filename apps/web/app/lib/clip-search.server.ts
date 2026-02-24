import { getDb } from "./db.server";
import { buildImageUrl } from "./images";
import { sourceFilter } from "./museums.server";
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  env,
} from "@xenova/transformers";

env.allowLocalModels = false;

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
  frukt: "fruit", vin: "wine", bord: "table", stol: "chair",
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

async function translateToEnglish(text: string): Promise<string> {
  const lower = text.toLowerCase().trim();
  
  // Check rich prompts first (curated, best quality)
  const rich = RICH_PROMPTS[lower];
  if (rich) return rich;
  
  const cached = translationCache.get(lower);
  if (cached) return cached;

  // Fallback to lookup table
  const words = lower.split(/\s+/);
  const translated = words.map((w) => {
    const en = SV_EN_LOOKUP[w];
    return en ? en : w;
  }).join(" ");
  translationCache.set(lower, translated);
  return translated;
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

type CachedEmbedding = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  heroUrl: string;
  year: string;
  color: string;
  embedding: Float32Array;
  museum_name: string | null;
  source: string | null;
};

let textModelPromise: Promise<{ tokenizer: any; textModel: any }> | null = null;
let embeddingCache: CachedEmbedding[] | null = null;
let embeddingCachePromise: Promise<CachedEmbedding[]> | null = null;
let embeddingCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const denom = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / denom;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
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

async function loadEmbeddingCache(): Promise<CachedEmbedding[]> {
  const now = Date.now();
  if (embeddingCache && (now - embeddingCacheTime) < CACHE_TTL) return embeddingCache;
  if (embeddingCachePromise && (now - embeddingCacheTime) < CACHE_TTL) return embeddingCachePromise;
  embeddingCache = null;
  embeddingCachePromise = null;

  embeddingCachePromise = (async () => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text,
              a.source, m.name as museum_name, c.embedding
       FROM clip_embeddings c
       JOIN artworks a ON a.id = c.artwork_id
       LEFT JOIN museums m ON m.id = a.source
       WHERE ${sourceFilter("a")}
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)`
    ).all() as any[];

    const mapped = rows.map((r) => {
      const buffer: Buffer = r.embedding;
      const view = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      return {
        id: r.id,
        title: r.title_sv || r.title_en || "Utan titel",
        artist: parseArtist(r.artists),
        imageUrl: buildImageUrl(r.iiif_url, 400),
        heroUrl: buildImageUrl(r.iiif_url, 800),
        year: r.dating_text || "",
        color: r.dominant_color || "#D4CDC3",
        embedding: new Float32Array(view),
        museum_name: r.museum_name ?? null,
        source: r.source ?? null,
      } as CachedEmbedding;
    });

    embeddingCache = mapped;
    embeddingCacheTime = Date.now();
    return mapped;
  })();

  return embeddingCachePromise;
}

export async function clipSearch(q: string, limit = 60, offset = 0, source?: string): Promise<ClipResult[]> {
  const [{ tokenizer, textModel }, cache] = await Promise.all([
    getTextModel(),
    loadEmbeddingCache(),
  ]);

  const scoped = source ? cache.filter((item) => item.source === source) : cache;
  if (scoped.length === 0) return [];

  // Try async translation first, fallback to sync lookup
  let translatedQuery: string;
  try {
    translatedQuery = await translateToEnglish(q);
  } catch {
    translatedQuery = translateQuerySync(q);
  }
  const textInputs = tokenizer(translatedQuery, { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);
  const queryEmbedding = normalize(new Float32Array(text_embeds.data));

  const scored = scoped.map((item) => ({
    item,
    score: dot(queryEmbedding, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(offset, offset + limit).map(({ item, score }) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    imageUrl: item.imageUrl,
    heroUrl: item.heroUrl,
    year: item.year,
    color: item.color,
    similarity: score,
    museum_name: item.museum_name ?? null,
    source: item.source ?? null,
  }));
}
