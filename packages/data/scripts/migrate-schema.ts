import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || resolve(__dirname, "../kabinett.db");

function ensureArtworkColumn(db: Database.Database, column: string, definition: string) {
  try {
    db.exec(`ALTER TABLE artworks ADD COLUMN ${column} ${definition}`);
    console.log(`✅ Added artworks.${column}`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("duplicate column name")) {
      console.log(`ℹ️ artworks.${column} already exists`);
      return;
    }
    throw error;
  }
}

function ensureArtworkColumns(db: Database.Database) {
  ensureArtworkColumn(db, "source", "TEXT DEFAULT 'nationalmuseum'");
  ensureArtworkColumn(db, "sub_museum", "TEXT");
  ensureArtworkColumn(db, "last_updated", "INTEGER");
  ensureArtworkColumn(db, "dominant_color", "TEXT");
  ensureArtworkColumn(db, "color_r", "INTEGER");
  ensureArtworkColumn(db, "color_g", "INTEGER");
  ensureArtworkColumn(db, "color_b", "INTEGER");
  ensureArtworkColumn(db, "focal_x", "REAL DEFAULT 0.5");
  ensureArtworkColumn(db, "focal_y", "REAL DEFAULT 0.5");
}

function ensureTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS museums (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      url TEXT,
      image_base_url TEXT,
      source_type TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS broken_images (
      artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS clip_embeddings (
      artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE,
      embedding BLOB
    );

    CREATE TABLE IF NOT EXISTS walks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      description TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT "#3D3831",
      cover_artwork_id INTEGER REFERENCES artworks(id),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      published INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS walk_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      walk_id INTEGER NOT NULL REFERENCES walks(id) ON DELETE CASCADE,
      artwork_id INTEGER NOT NULL REFERENCES artworks(id),
      position INTEGER NOT NULL,
      narrative_text TEXT,
      UNIQUE(walk_id, position)
    );
  `);

  console.log("✅ Ensured required tables");
}

function ensureFts(db: Database.Database) {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS artworks_fts USING fts5(
      title_sv,
      title_en,
      artists,
      category,
      technique_material,
      dating_text,
      content='artworks',
      content_rowid='id'
    );
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS artworks_ai AFTER INSERT ON artworks BEGIN
      INSERT INTO artworks_fts(
        rowid,
        title_sv,
        title_en,
        artists,
        category,
        technique_material,
        dating_text
      ) VALUES (
        new.id,
        new.title_sv,
        new.title_en,
        new.artists,
        new.category,
        new.technique_material,
        new.dating_text
      );
    END;

    CREATE TRIGGER IF NOT EXISTS artworks_ad AFTER DELETE ON artworks BEGIN
      INSERT INTO artworks_fts(artworks_fts, rowid, title_sv, title_en, artists, category, technique_material, dating_text)
      VALUES ('delete', old.id, old.title_sv, old.title_en, old.artists, old.category, old.technique_material, old.dating_text);
    END;

    CREATE TRIGGER IF NOT EXISTS artworks_au AFTER UPDATE ON artworks BEGIN
      INSERT INTO artworks_fts(artworks_fts, rowid, title_sv, title_en, artists, category, technique_material, dating_text)
      VALUES ('delete', old.id, old.title_sv, old.title_en, old.artists, old.category, old.technique_material, old.dating_text);
      INSERT INTO artworks_fts(
        rowid,
        title_sv,
        title_en,
        artists,
        category,
        technique_material,
        dating_text
      ) VALUES (
        new.id,
        new.title_sv,
        new.title_en,
        new.artists,
        new.category,
        new.technique_material,
        new.dating_text
      );
    END;
  `);

  const missing = (db.prepare(
    `SELECT COUNT(*) as count
     FROM artworks
     WHERE id NOT IN (SELECT rowid FROM artworks_fts)`
  ).get() as { count: number }).count;

  if (missing > 0) {
    db.exec(`
      INSERT INTO artworks_fts(rowid, title_sv, title_en, artists, category, technique_material, dating_text)
      SELECT id, title_sv, title_en, artists, category, technique_material, dating_text
      FROM artworks
      WHERE id NOT IN (SELECT rowid FROM artworks_fts);
    `);
    console.log(`✅ Backfilled artworks_fts with ${missing} rows`);
  } else {
    console.log("ℹ️ artworks_fts already indexed");
  }
}

function ensureIndexes(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artworks_year ON artworks(year_start);
    CREATE INDEX IF NOT EXISTS idx_artworks_source ON artworks(source);
    CREATE INDEX IF NOT EXISTS idx_artworks_last_updated ON artworks(last_updated);
    CREATE INDEX IF NOT EXISTS idx_artworks_color ON artworks(color_r, color_g, color_b);
    CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
    CREATE INDEX IF NOT EXISTS idx_walk_items_walk_position ON walk_items(walk_id, position);
  `);

  console.log("✅ Ensured schema indexes");
}

function backfillSource(db: Database.Database) {
  const info = db
    .prepare("UPDATE artworks SET source = 'nationalmuseum' WHERE source IS NULL OR source = ''")
    .run();
  if (info.changes > 0) {
    console.log(`✅ Backfilled artworks.source for ${info.changes} rows`);
  }
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  try {
    console.log(`\n🛠️ Migrating schema: ${DB_PATH}`);
    ensureArtworkColumns(db);
    ensureTables(db);
    ensureFts(db);
    ensureIndexes(db);
    backfillSource(db);
    console.log("✅ Schema is ready\n");
  } finally {
    db.close();
  }
}

main();
