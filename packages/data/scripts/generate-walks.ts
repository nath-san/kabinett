/**
 * Generate AI walks using CLIP + GPT.
 *
 * Usage:
 *   tsx scripts/generate-walks.ts
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  AutoTokenizer,
  CLIPTextModelWithProjection,
  env,
} from "@xenova/transformers";

env.allowLocalModels = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4o-mini";
const FORCE = process.argv.includes("--force");

const THEMES = [
  "dramatic ocean storms and shipwrecks",
  "intimate portraits of women",
  "dark mysterious nocturnal scenes",
  "golden autumn landscapes",
  "children playing and childhood",
  "classical mythology and gods",
  "flowers and botanical art",
  "winter snow and ice landscapes",
  "horses and equestrian art",
  "religious biblical scenes",
];

const SYSTEM_PROMPT =
  "Du är en konstguide på Nationalmuseum. Skriv en vandring genom dessa verk. Ge vandringen en poetisk svensk titel, undertitel och en kort intro (2-3 meningar). Skriv sedan en kort text (1-2 meningar) för varje verk som kopplar det till nästa — skapa en röd tråd. Svara som JSON.";

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

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try {
    return JSON.parse(json)[0]?.name || "Okänd konstnär";
  } catch {
    return "Okänd konstnär";
  }
}

function slugify(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "vandring";
}

function extractJson(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in response");
    return JSON.parse(match[0]);
  }
}

type EmbeddingRow = {
  id: number;
  title: string;
  artist: string;
  date: string;
  dominant_color: string | null;
  embedding: Float32Array;
};

type WalkResponse = {
  title: string;
  subtitle: string;
  intro: string;
  items: Array<{ artwork_id: number; narrative_text?: string }>;
};

async function getTextModel() {
  const tokenizer = await AutoTokenizer.from_pretrained(
    "Xenova/clip-vit-base-patch32"
  );
  const textModel = await CLIPTextModelWithProjection.from_pretrained(
    "Xenova/clip-vit-base-patch32"
  );
  return { tokenizer, textModel };
}

function loadEmbeddings(db: Database.Database): EmbeddingRow[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.title_sv, a.title_en, a.artists, a.dating_text, a.dominant_color, c.embedding
       FROM clip_embeddings c
       JOIN artworks a ON a.id = c.artwork_id
       WHERE (a.category LIKE '%Måleri%' OR a.category LIKE '%Teckningar%')
         AND a.iiif_url IS NOT NULL
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)`
    )
    .all() as any[];

  return rows.map((r) => {
    const buffer: Buffer = r.embedding;
    const view = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / 4
    );
    const embedding = new Float32Array(view);
    return {
      id: r.id,
      title: r.title_sv || r.title_en || "Utan titel",
      artist: parseArtist(r.artists),
      date: r.dating_text || "",
      dominant_color: r.dominant_color || null,
      embedding,
    } as EmbeddingRow;
  });
}

function topSimilar(
  query: Float32Array,
  rows: EmbeddingRow[],
  count: number
): EmbeddingRow[] {
  const scored = rows.map((r) => ({ r, score: dot(query, r.embedding) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((s) => s.r);
}

async function callOpenAI(
  prompt: string,
  maxRetries = 3
): Promise<WalkResponse> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY saknas i miljön");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.7,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(1000 * 2 ** (attempt - 1), 10000);
        console.log(
          `     ⏳ ${res.status} — retry ${attempt}/${maxRetries} om ${wait}ms...`
        );
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI-fel: ${res.status} ${body}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Tomt svar från OpenAI");
      return extractJson(content) as WalkResponse;
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const wait = Math.min(1000 * 2 ** (attempt - 1), 10000);
      console.log(
        `     ⏳ Fel: ${err.message} — retry ${attempt}/${maxRetries} om ${wait}ms...`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw new Error("callOpenAI: alla retries misslyckades");
}

function alignItems(selected: EmbeddingRow[], response?: WalkResponse) {
  const validIds = new Set(selected.map((r) => r.id));
  const byId = new Map<number, string | null>();
  const items = response?.items || [];

  for (const item of items) {
    if (item?.artwork_id && validIds.has(item.artwork_id)) {
      byId.set(item.artwork_id, item.narrative_text || null);
    }
  }

  // Use GPT's ordering if all ids are valid, otherwise keep CLIP similarity order
  const gptIds = items.map((i) => i?.artwork_id).filter((id) => id && validIds.has(id));
  const useGptOrder =
    gptIds.length === selected.length &&
    new Set(gptIds).size === selected.length;

  const ordered = useGptOrder
    ? gptIds.map((id) => selected.find((r) => r.id === id)!)
    : selected;

  return ordered.map((row) => ({
    artwork_id: row.id,
    narrative_text: byId.get(row.id) ?? null,
  }));
}

async function main() {
  console.log("\n🚶 Kabinett Walk Generator");
  console.log(`   Database: ${DB_PATH}`);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  const existing = (db.prepare("SELECT COUNT(*) as c FROM walks").get() as any)
    .c as number;
  if (existing > 0 && !FORCE) {
    console.log("   Vandringar finns redan — avbryter. (Kör med --force för att regenerera)");
    return;
  }
  if (existing > 0 && FORCE) {
    console.log(`   --force: Tar bort ${existing} befintliga vandringar...`);
    db.exec("DELETE FROM walk_items");
    db.exec("DELETE FROM walks");
  }

  const embeddings = loadEmbeddings(db);
  if (embeddings.length === 0) {
    console.log("   Inga CLIP-embeddingar hittades — avbryter.");
    return;
  }

  console.log(`   Embeddingar laddade: ${embeddings.length}`);
  console.log("   Laddar CLIP-textmodell...");
  const { tokenizer, textModel } = await getTextModel();
  console.log("   Modell redo.\n");

  const insertWalk = db.prepare(
    `INSERT INTO walks (slug, title, subtitle, description, color, cover_artwork_id, published)
     VALUES (@slug, @title, @subtitle, @description, @color, @cover_artwork_id, 1)`
  );

  const insertItem = db.prepare(
    `INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text)
     VALUES (?, ?, ?, ?)`
  );

  const selectSlug = db.prepare(`SELECT id FROM walks WHERE slug = ?`);

  const createWalk = db.transaction(
    (walk: {
      slug: string;
      title: string;
      subtitle: string;
      description: string;
      color: string;
      cover_artwork_id: number | null;
      items: Array<{ artwork_id: number; narrative_text: string | null }>;
    }) => {
      const result = insertWalk.run(walk);
      const walkId = Number(result.lastInsertRowid);
      walk.items.forEach((item, idx) => {
        insertItem.run(walkId, item.artwork_id, idx + 1, item.narrative_text);
      });
      return walkId;
    }
  );

  for (const theme of THEMES) {
    console.log(`   ➜ Tema: ${theme}`);
    const textInputs = tokenizer(theme, { padding: true, truncation: true });
    const { text_embeds } = await textModel(textInputs);
    const queryEmbedding = normalize(new Float32Array(text_embeds.data));
    const top = topSimilar(queryEmbedding, embeddings, 12);

    if (top.length < 6) {
      console.log("     Hoppar — för få verk.");
      continue;
    }

    const list = top
      .map(
        (row, idx) =>
          `${idx + 1}. [${row.id}] ${row.title} — ${row.artist}${
            row.date ? ` — ${row.date}` : ""
          }`
      )
      .join("\n");

    const userPrompt = `Här är 12 verk i ordning:\n${list}\n\nSvara som JSON i formatet: {"title":"","subtitle":"","intro":"","items":[{"artwork_id":123,"narrative_text":""}]}. Använd samma ordning som listan.`;

    const response = await callOpenAI(userPrompt);

    const alignedItems = alignItems(top, response);
    const cover = top[0];
    const title = (response?.title || "Vandring").trim();
    const subtitle = (response?.subtitle || "").trim() || "En vandring genom samlingen";
    const intro = (response?.intro || "").trim() || "En vandring genom tolv verk ur samlingen.";

    let slug = slugify(title);
    let suffix = 2;
    while (selectSlug.get(slug)) {
      slug = `${slugify(title)}-${suffix}`;
      suffix++;
    }

    const color = cover?.dominant_color || "#3D3831";

    createWalk({
      slug,
      title,
      subtitle,
      description: intro,
      color,
      cover_artwork_id: cover?.id ?? null,
      items: alignedItems,
    });
  }

  const total = (db.prepare("SELECT COUNT(*) as c FROM walks").get() as any)
    .c as number;
  console.log(`\n✅ Klart. Skapade ${total} vandringar.`);
}

main().catch((err) => {
  console.error("\n❌ Walk generation failed.");
  console.error(err);
  process.exit(1);
});
