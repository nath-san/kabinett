import { getDb } from "./db.server";
import { buildImageUrl } from "./images";
import { sourceFilter } from "./museums.server";
import { parseArtist } from "./parsing";
import { pipeline, env } from "@xenova/transformers";

env.allowLocalModels = false;

export const MULTILINGUAL_CLIP_TEXT_MODEL = "sentence-transformers/clip-ViT-B-32-multilingual-v1";

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
  focal_x: number | null;
  focal_y: number | null;
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
  focal_x: number | null;
  focal_y: number | null;
};

let textExtractorPromise: Promise<any> | null = null;

function normalize(vec: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const denom = Math.sqrt(sum) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / denom;
  return out;
}

// Dense projection weights (768 -> 512) from the sentence-transformers model
// Loaded lazily from HuggingFace
let projectionMatrix: Float32Array | null = null;

async function loadProjectionMatrix(): Promise<Float32Array> {
  if (projectionMatrix) return projectionMatrix;
  const url = "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/resolve/main/2_Dense/pytorch_model.bin";
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  // pytorch_model.bin is a zip of tensors; the weight matrix is "linear.weight" shaped [512, 768]
  // For simplicity, we'll extract it using a direct approach
  // The model has no bias, just a linear projection
  // Actually, let's use the safetensors format instead
  const stUrl = "https://huggingface.co/sentence-transformers/clip-ViT-B-32-multilingual-v1/resolve/main/2_Dense/model.safetensors";
  const stResponse = await fetch(stUrl);
  const stBuffer = await stResponse.arrayBuffer();
  // Parse safetensors: 8 bytes header length (LE u64), then JSON header, then raw data
  const view = new DataView(stBuffer);
  const headerLen = Number(view.getBigUint64(0, true));
  const headerJson = new TextDecoder().decode(new Uint8Array(stBuffer, 8, headerLen));
  const header = JSON.parse(headerJson);
  const weightMeta = header["linear.weight"];
  const offset = weightMeta.data_offsets[0];
  const end = weightMeta.data_offsets[1];
  const dataStart = 8 + headerLen;
  projectionMatrix = new Float32Array(stBuffer, dataStart + offset, (end - offset) / 4);
  console.log(`[CLIP] Loaded projection matrix: ${projectionMatrix.length} values (${weightMeta.shape})`);
  return projectionMatrix;
}

function projectTo512(vec768: Float32Array): Float32Array {
  // matrix is [512, 768], multiply: out[i] = sum_j(matrix[i*768+j] * vec[j])
  const out = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    let sum = 0;
    const base = i * 768;
    for (let j = 0; j < 768; j++) {
      sum += projectionMatrix![base + j] * vec768[j];
    }
    out[i] = sum;
  }
  return out;
}

async function getTextExtractor() {
  if (!textExtractorPromise) {
    textExtractorPromise = Promise.all([
      pipeline("feature-extraction", MULTILINGUAL_CLIP_TEXT_MODEL, { quantized: false }),
      loadProjectionMatrix(),
    ]).then(([pipe]) => pipe).catch((error) => {
      textExtractorPromise = null;
      throw error;
    });
  }
  return textExtractorPromise;
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
      m.name as museum_name,
      a.focal_x,
      a.focal_y
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
  const textExtractor = await getTextExtractor();
  const extracted = await textExtractor(q, { pooling: "mean", normalize: false });
  const vec768 = new Float32Array(extracted.data);
  const projected = projectTo512(vec768);
  const queryEmbedding = normalize(projected);
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
    focal_x: row.focal_x ?? null,
    focal_y: row.focal_y ?? null,
  }));
}
