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
    INSERT OR IGNORE INTO museums (id, name, description, url, image_base_url, source_type, enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  insert.run(
    "nationalmuseum",
    "Nationalmuseum",
    "Sveriges museum för konst och design",
    "https://www.nationalmuseum.se",
    null,
    "api"
  );

  insert.run(
    "shm",
    "Statens historiska museer",
    "Sveriges nationella historiska museum",
    "https://shm.se",
    "https://media.samlingar.shm.se/item",
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
