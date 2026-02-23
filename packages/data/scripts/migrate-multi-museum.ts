import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function ensureColumn() {
  try {
    db.exec("ALTER TABLE artworks ADD COLUMN source TEXT DEFAULT 'nationalmuseum'");
    console.log("✅ Added artworks.source column");
  } catch {
    console.log("ℹ️ artworks.source column already exists");
  }
}

function ensureMuseumsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS museums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      url TEXT,
      image_base_url TEXT,
      source_type TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);
  console.log("✅ Ensured museums table");
}

function ensureIndexes() {
  db.exec("CREATE INDEX IF NOT EXISTS idx_artworks_source ON artworks(source)");
  console.log("✅ Ensured artworks.source index");
}

function seedMuseums() {
  const insert = db.prepare(`
    INSERT INTO museums (id, name, description, url, image_base_url, source_type, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      url = excluded.url,
      image_base_url = excluded.image_base_url,
      source_type = excluded.source_type,
      enabled = excluded.enabled
  `);

  insert.run(
    "nationalmuseum",
    "Nationalmuseum",
    "Sveriges främsta konstmuseum med verk från medeltiden till idag. Måleri, skulptur, grafik och konsthantverk.",
    "https://www.nationalmuseum.se",
    null,
    "api"
  );

  insert.run(
    "shm",
    "Statens historiska museer",
    "Fem museer under samma myndighet: Historiska museet, Livrustkammaren, Hallwylska museet, Skoklosters slott och Tumba bruksmuseum.",
    "https://shm.se",
    "https://media.samlingar.shm.se/item",
    "ksamsok"
  );

  insert.run(
    "nordiska",
    "Nordiska museet",
    "Sveriges största kulturhistoriska museum. Folkkonst, mode, fotografi och vardagshistoria från 1500-talet till idag.",
    "https://www.nordiskamuseet.se",
    null,
    "ksamsok"
  );

  console.log("✅ Seeded museums");
}

function backfillSource() {
  const info = db.prepare("UPDATE artworks SET source = 'nationalmuseum' WHERE source IS NULL OR source = ''").run();
  console.log(`✅ Backfilled source for ${info.changes} artworks`);
}

try {
  ensureColumn();
  ensureMuseumsTable();
  ensureIndexes();
  backfillSource();
  seedMuseums();
} finally {
  db.close();
}
