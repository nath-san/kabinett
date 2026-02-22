import type { LoaderFunctionArgs } from "react-router";
import { getDb } from "../lib/db.server";
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  env,
} from "@xenova/transformers";

env.allowLocalModels = false;

// Swedish → English lookup for CLIP (trained primarily on English)
const SV_EN_LOOKUP: Record<string, string> = {
  // Animals
  djur: "animals", häst: "horse", hund: "dog", katt: "cat", fågel: "bird",
  fåglar: "birds", ko: "cow", lejon: "lion", fisk: "fish", fjäril: "butterfly",
  // Nature
  landskap: "landscape", skog: "forest", hav: "sea ocean", sjö: "lake",
  berg: "mountain", himmel: "sky", moln: "clouds", sol: "sun", måne: "moon",
  träd: "tree", blommor: "flowers", blomma: "flower", vinter: "winter snow",
  sommar: "summer", höst: "autumn", vår: "spring",
  // People
  kvinna: "woman", man: "man", barn: "child children", flicka: "girl",
  pojke: "boy", porträtt: "portrait", ansikte: "face", människor: "people",
  naken: "nude naked", kropp: "body",
  // Mood
  mörk: "dark darkness", mörkt: "dark night", ljus: "light bright",
  lugn: "calm peaceful", storm: "storm stormy", dramatisk: "dramatic",
  sorg: "sadness grief", glädje: "joy happiness", ensam: "lonely solitary",
  kärlek: "love romance",
  // Objects & scenes
  stad: "city town", hus: "house building", kyrka: "church", slott: "castle palace",
  skepp: "ship boat", bro: "bridge", trädgård: "garden", mat: "food",
  frukt: "fruit", vin: "wine", bord: "table", stol: "chair",
  // Art
  stilleben: "still life", abstrakt: "abstract", skulptur: "sculpture",
  målning: "painting", teckning: "drawing",
  // Colors
  röd: "red", blå: "blue", grön: "green", gul: "yellow", vit: "white",
  svart: "black", guld: "gold golden",
  // Misc
  krig: "war battle", död: "death", musik: "music", dans: "dance",
  religion: "religion religious", gud: "god", ängel: "angel",
  vågor: "waves", snö: "snow", is: "ice", eld: "fire",
};

function translateQuery(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const translated = words.map((w) => {
    const en = SV_EN_LOOKUP[w];
    return en ? `${w} ${en}` : w;
  });
  return translated.join(" ");
}

type CachedEmbedding = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  heroUrl: string;
  year: string;
  color: string;
  embedding: Float32Array;
};

let textModelPromise: Promise<{
  tokenizer: any;
  textModel: any;
}> | null = null;
let embeddingCache: CachedEmbedding[] | null = null;
let embeddingCachePromise: Promise<CachedEmbedding[]> | null = null;
let embeddingCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
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
      const tokenizer = await AutoTokenizer.from_pretrained(
        "Xenova/clip-vit-base-patch32"
      );
      const textModel = await CLIPTextModelWithProjection.from_pretrained(
        "Xenova/clip-vit-base-patch32"
      );
      return { tokenizer, textModel };
    })();
  }
  return textModelPromise;
}

async function loadEmbeddingCache(): Promise<CachedEmbedding[]> {
  const now = Date.now();
  if (embeddingCache && (now - embeddingCacheTime) < CACHE_TTL) return embeddingCache;
  if (embeddingCachePromise && (now - embeddingCacheTime) < CACHE_TTL) return embeddingCachePromise;
  // Bust stale cache
  embeddingCache = null;
  embeddingCachePromise = null;

  embeddingCachePromise = (async () => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text, c.embedding
       FROM clip_embeddings c
       JOIN artworks a ON a.id = c.artwork_id`
      )
      .all() as any[];

    const mapped = rows.map((r) => {
      const buffer: Buffer = r.embedding;
      const view = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 4
      );
      const embedding = new Float32Array(view);
      const iiif = r.iiif_url.replace("http://", "https://");
      return {
        id: r.id,
        title: r.title_sv || r.title_en || "Utan titel",
        artist: parseArtist(r.artists),
        imageUrl: iiif + "full/400,/0/default.jpg",
        heroUrl: iiif + "full/800,/0/default.jpg",
        year: r.dating_text || "",
        color: r.dominant_color || "#D4CDC3",
        embedding,
      } as CachedEmbedding;
    });

    embeddingCache = mapped;
    embeddingCacheTime = Date.now();
    return mapped;
  })();

  return embeddingCachePromise;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  if (!q) return Response.json([]);

  const [{ tokenizer, textModel }, cache] = await Promise.all([
    getTextModel(),
    loadEmbeddingCache(),
  ]);

  if (cache.length === 0) {
    const db = getDb();
    try {
      const ftsQuery = q.split(/\s+/).map((w) => `"${w}"*`).join(" ");
      const rows = db.prepare(
        `SELECT a.id, a.title_sv, a.title_en, a.iiif_url, a.dominant_color, a.artists, a.dating_text
         FROM artworks_fts f JOIN artworks a ON a.id = f.rowid
         WHERE artworks_fts MATCH ? ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[];

      const results = rows.map((row) => {
        const iiif = row.iiif_url.replace("http://", "https://");
        return {
          id: row.id,
          title: row.title_sv || row.title_en || "Utan titel",
          artist: parseArtist(row.artists),
          imageUrl: iiif + "full/400,/0/default.jpg",
          heroUrl: iiif + "full/800,/0/default.jpg",
          year: row.dating_text || "",
          color: row.dominant_color || "#D4CDC3",
          similarity: 0,
        };
      });

      return Response.json(results);
    } catch {
      return Response.json([]);
    }
  }

  const translatedQuery = translateQuery(q);
  const textInputs = tokenizer(translatedQuery, { padding: true, truncation: true });
  const { text_embeds } = await textModel(textInputs);
  const queryEmbedding = normalize(new Float32Array(text_embeds.data));

  const scored = cache.map((item) => ({
    item,
    score: dot(queryEmbedding, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, limit).map(({ item, score }) => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    imageUrl: item.imageUrl,
    heroUrl: item.heroUrl,
    year: item.year,
    color: item.color,
    similarity: score,
  }));

  return Response.json(results);
}
