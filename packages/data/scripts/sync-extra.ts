/**
 * Sync extra metadata from Nationalmuseum API:
 * dimensions, actors (with wikidata), exhibitions, loan status,
 * material_tags, technique_tags, signature, inscription,
 * descriptions, acquisition, object_type, style, motive_category
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const API_BASE = "https://api.nationalmuseum.se/api/objects";
const PAGE_SIZE = 50;
const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function initDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Add new columns (ignore if they already exist)
  const cols = [
    ["descriptions_sv", "TEXT"],
    ["descriptions_en", "TEXT"],
    ["acquisition_sv", "TEXT"],
    ["object_type_sv", "TEXT"],
    ["style_sv", "TEXT"],
    ["signature", "TEXT"],
    ["inscription", "TEXT"],
    ["motive_category", "TEXT"],
    ["loan", "INTEGER"],
    ["material_tags", "TEXT"],
    ["technique_tags", "TEXT"],
    ["dimensions_json", "TEXT"],
    ["actors_json", "TEXT"],
    ["exhibitions_json", "TEXT"],
    ["extra_synced", "INTEGER DEFAULT 0"],
  ];

  for (const [name, type] of cols) {
    try {
      db.exec(`ALTER TABLE artworks ADD COLUMN ${name} ${type}`);
    } catch {
      // column already exists
    }
  }

  return db;
}

async function main() {
  const db = initDb();

  const remaining = (
    db.prepare("SELECT COUNT(*) as c FROM artworks WHERE extra_synced = 0 OR extra_synced IS NULL").get() as any
  ).c;

  console.log(`\n📦 Syncing extra metadata for ${remaining} artworks\n`);

  const update = db.prepare(`
    UPDATE artworks SET
      descriptions_sv = ?, descriptions_en = ?,
      acquisition_sv = ?, object_type_sv = ?, style_sv = ?,
      signature = ?, inscription = ?, motive_category = ?,
      loan = ?, material_tags = ?, technique_tags = ?,
      dimensions_json = ?, actors_json = ?, exhibitions_json = ?,
      extra_synced = 1
    WHERE id = ?
  `);

  let page = 1;
  let total = 0;
  let synced = 0;

  while (true) {
    const url = `${API_BASE}?page=${page}&size=${PAGE_SIZE}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`   ⚠️ HTTP ${res.status} on page ${page}`);
        break;
      }

      const text = await res.text();
      // Clean control chars
      const cleaned = text.replace(/[\x00-\x1F\x7F]/g, (c) =>
        c === "\n" || c === "\r" || c === "\t" ? c : ""
      );
      const json = JSON.parse(cleaned);
      const items = json?.data?.items || [];

      if (items.length === 0) break;
      if (page === 1) {
        total = json?.data?.paging?.total || 0;
        console.log(`   Total objects in API: ${total}`);
      }

      for (const item of items) {
        const id = item.id;
        if (!id) continue;

        // Check if we have this artwork
        const exists = db.prepare("SELECT id FROM artworks WHERE id = ?").get(id);
        if (!exists) continue;

        update.run(
          item.descriptions?.sv || null,
          item.descriptions?.en || null,
          item.acquisition?.sv || null,
          item.object_type?.sv || null,
          item.style?.sv || null,
          item.signature || null,
          item.inscription || null,
          item.motive_category || null,
          item.loan === true ? 1 : item.loan === false ? 0 : null,
          item.material_tags?.length ? JSON.stringify(item.material_tags) : null,
          item.technique_tags?.length ? JSON.stringify(item.technique_tags) : null,
          item.dimensions?.length ? JSON.stringify(item.dimensions) : null,
          item.actors?.length ? JSON.stringify(item.actors) : null,
          item.exhibitions?.length ? JSON.stringify(item.exhibitions) : null,
          id
        );
        synced++;
      }

      const pct = total > 0 ? ((page * PAGE_SIZE / total) * 100).toFixed(1) : "?";
      if (page % 20 === 0) {
        console.log(`   Page ${page} — ${synced} updated (${pct}%)`);
      }

      page++;
      await sleep(DELAY_MS);
    } catch (err: any) {
      console.warn(`   ⚠️ Error on page ${page}: ${err.message}`);
      await sleep(1000);
      page++;
    }
  }

  console.log(`\n✅ Done. Updated ${synced} artworks with extra metadata.`);
}

main().catch(console.error);
