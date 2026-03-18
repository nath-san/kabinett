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

    CREATE TABLE IF NOT EXISTS source_stats_materialized (
      source TEXT PRIMARY KEY,
      total_works INTEGER NOT NULL,
      paintings INTEGER NOT NULL,
      min_year INTEGER,
      max_year INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_collections_materialized (
      source TEXT NOT NULL,
      collection_name TEXT NOT NULL,
      PRIMARY KEY (source, collection_name)
    );

    CREATE TABLE IF NOT EXISTS site_stats_materialized_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      refreshed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artwork_artists (
      artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      artist_name TEXT NOT NULL,
      artist_name_norm TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (artwork_id, artist_name_norm)
    );

    CREATE TABLE IF NOT EXISTS artwork_neighbors (
      artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      neighbor_artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      distance REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (artwork_id, rank),
      UNIQUE (artwork_id, neighbor_artwork_id)
    );
  `);

  console.log("✅ Ensured required tables");
}

function seedMuseums(db: Database.Database) {
  db.exec(`
    INSERT OR IGNORE INTO museums (id, name, description, url, image_base_url, source_type, enabled) VALUES (
      'nationalmuseum',
      'Nationalmuseum',
      'Sveriges främsta konstmuseum med verk från medeltiden till idag. Måleri, skulptur, grafik och konsthantverk.',
      'https://www.nationalmuseum.se',
      NULL,
      'api',
      1
    );

    INSERT OR IGNORE INTO museums (id, name, description, url, image_base_url, source_type, enabled) VALUES (
      'shm',
      'Statens historiska museer',
      'Fem museer under samma myndighet: Historiska museet, Livrustkammaren, Hallwylska museet, Skoklosters slott och Tumba bruksmuseum.',
      'https://shm.se',
      'https://media.samlingar.shm.se/item',
      'ksamsok',
      1
    );

    INSERT OR IGNORE INTO museums (id, name, description, url, image_base_url, source_type, enabled) VALUES (
      'nordiska',
      'Nordiska museet',
      'Sveriges största kulturhistoriska museum. Folkkonst, mode, fotografi och vardagshistoria från 1500-talet till idag.',
      'https://www.nordiskamuseet.se',
      NULL,
      'ksamsok',
      1
    );

    INSERT OR IGNORE INTO museums (id, name, description, url, source_type, enabled) VALUES (
      'europeana',
      'Europeana',
      'European digital cultural heritage',
      'https://www.europeana.eu',
      'europeana',
      1
    );
  `);

  console.log("✅ Seeded museums");
}

function ensureFts(db: Database.Database) {
  let recreatedFts = false;
  let shouldRebuildFts = false;
  const expectedColumns = [
    "title_sv",
    "title_en",
    "artists",
    "category",
    "technique_material",
    "dating_text",
  ];
  const ftsExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artworks_fts' LIMIT 1")
    .get() as { 1: number } | undefined;

  if (ftsExists) {
    const existingColumns = db.prepare("PRAGMA table_info(artworks_fts)").all() as Array<{ name: string }>;
    const existingSet = new Set(existingColumns.map((col) => col.name));
    const missingColumns = expectedColumns.filter((column) => !existingSet.has(column));

    if (missingColumns.length > 0) {
      console.log(`⚠️ Recreating artworks_fts (missing columns: ${missingColumns.join(", ")})`);
      db.exec(`
        DROP TRIGGER IF EXISTS artworks_ai;
        DROP TRIGGER IF EXISTS artworks_ad;
        DROP TRIGGER IF EXISTS artworks_au;
        DROP TABLE IF EXISTS artworks_fts;
      `);
      recreatedFts = true;
    }
  }

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS artworks_fts USING fts5(
      title_sv,
      title_en,
      artists,
      category,
      technique_material,
      dating_text,
      content='artworks',
      content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  db.exec(`
    DROP TRIGGER IF EXISTS artworks_ai;
    DROP TRIGGER IF EXISTS artworks_ad;
    DROP TRIGGER IF EXISTS artworks_au;
  `);

  db.exec(`
    CREATE TRIGGER artworks_ai AFTER INSERT ON artworks BEGIN
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

    CREATE TRIGGER artworks_ad AFTER DELETE ON artworks BEGIN
      INSERT INTO artworks_fts(artworks_fts, rowid, title_sv, title_en, artists, category, technique_material, dating_text)
      VALUES ('delete', old.id, old.title_sv, old.title_en, old.artists, old.category, old.technique_material, old.dating_text);
    END;

    CREATE TRIGGER artworks_au AFTER UPDATE ON artworks BEGIN
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

  const artworkCount = (db.prepare(
    "SELECT COUNT(*) as count FROM artworks"
  ).get() as { count: number }).count;

  const docsizeExists = db
    .prepare("SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'artworks_fts_docsize' LIMIT 1")
    .get() as { ok?: number } | undefined;

  const indexedCount = docsizeExists?.ok === 1
    ? (db.prepare("SELECT COUNT(*) as count FROM artworks_fts_docsize").get() as { count: number }).count
    : 0;

  if (!recreatedFts && artworkCount !== indexedCount) {
    console.log(`⚠️ artworks_fts index out of sync (${indexedCount}/${artworkCount} indexed) — forcing rebuild`);
    shouldRebuildFts = true;
  }

  if (recreatedFts || shouldRebuildFts) {
    db.exec(`INSERT INTO artworks_fts(artworks_fts) VALUES ('rebuild');`);
    console.log("✅ Rebuilt artworks_fts index");
    return;
  }

  console.log("ℹ️ artworks_fts already indexed");
}

function ensureIndexes(db: Database.Database) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_artworks_year ON artworks(year_start);
    CREATE INDEX IF NOT EXISTS idx_artworks_source ON artworks(source);
    CREATE INDEX IF NOT EXISTS idx_artworks_last_updated ON artworks(last_updated);
    CREATE INDEX IF NOT EXISTS idx_artworks_color ON artworks(color_r, color_g, color_b);
    CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
    CREATE INDEX IF NOT EXISTS idx_artwork_artists_norm ON artwork_artists(artist_name_norm);
    CREATE INDEX IF NOT EXISTS idx_artwork_artists_artwork ON artwork_artists(artwork_id);
    CREATE INDEX IF NOT EXISTS idx_artwork_neighbors_artwork ON artwork_neighbors(artwork_id, rank);
    CREATE INDEX IF NOT EXISTS idx_artwork_neighbors_neighbor ON artwork_neighbors(neighbor_artwork_id);
    CREATE INDEX IF NOT EXISTS idx_walk_items_walk_position ON walk_items(walk_id, position);
    CREATE INDEX IF NOT EXISTS idx_source_collections_materialized_source ON source_collections_materialized(source);
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
    seedMuseums(db);
    ensureFts(db);
    ensureIndexes(db);
    backfillSource(db);
    console.log("✅ Schema is ready\n");
  } finally {
    db.close();
  }
}

main();
