/**
 * Create walks + walk_items tables.
 *
 * Usage:
 *   tsx scripts/create-walks-tables.ts
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
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

  console.log("\n✅ Walks tables ready.");
}

main();
