/**
 * Kabinett Data Sync
 *
 * Crawls Nationalmuseum's API and builds a local SQLite database
 * of all artworks with IIIF images.
 *
 * Usage:
 *   pnpm sync          # Full sync (~2084 pages)
 *   pnpm sync:test     # Test mode (2 pages)
 */

import Database from "better-sqlite3";
import sharp from "sharp";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const API_BASE = "https://api.nationalmuseum.se/api/objects";
const LIMIT = 100;
const TEST_MODE = process.argv.includes("--test");
const MAX_PAGES = TEST_MODE ? 2 : 2085;

// --- Types ---

interface ApiObject {
  id: number;
  inventory_number: string | null;
  iiif: string | null;
  title: { sv: string | null; en: string | null };
  technique_material: { sv: string | null; en: string | null };
  category: { sv: string | null; en: string | null };
  acquisition_year: number | null;
  dating: Array<{
    date_type: string;
    date: { sv: string | null; en: string | null };
    start_date: number | null;
    end_date: number | null;
  }>;
  artists?: Array<{
    name: string | null;
    nationality: string | null;
    role: { sv: string | null; en: string | null };
  }>;
  actors?: Array<{
    actor_full_name: string | null;
    actor_nationality: string | null;
    actor_role: string | null;
  }>;
  dimensions: Array<{
    type: string;
    value_1: number;
    value_2: number;
    unit: string;
  }>;
}

// --- Database Setup ---

function initDb(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
      id INTEGER PRIMARY KEY,
      inventory_number TEXT,
      title_sv TEXT,
      title_en TEXT,
      category TEXT,
      technique_material TEXT,
      artists TEXT,
      dating_text TEXT,
      year_start INTEGER,
      year_end INTEGER,
      acquisition_year INTEGER,
      iiif_url TEXT NOT NULL,
      dominant_color TEXT,
      color_r INTEGER,
      color_g INTEGER,
      color_b INTEGER,
      synced_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_artworks_category ON artworks(category);
    CREATE INDEX IF NOT EXISTS idx_artworks_year ON artworks(year_start);
    CREATE INDEX IF NOT EXISTS idx_artworks_color ON artworks(color_r, color_g, color_b);

    CREATE VIRTUAL TABLE IF NOT EXISTS artworks_fts USING fts5(
      title_sv, title_en, artists, technique_material, category,
      content='artworks', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  return db;
}

// --- API Fetching ---

async function fetchPage(page: number): Promise<ApiObject[]> {
  const url = `${API_BASE}?page=${page}&limit=${LIMIT}`;
  const res = await fetch(url);
  const text = await res.text();

  // API returns JSON with control characters — clean them
  const cleaned = text.replace(/[\x00-\x1f\x7f]/g, (ch) =>
    ch === "\n" || ch === "\r" || ch === "\t" ? ch : ""
  );

  const data = JSON.parse(cleaned);
  return data?.data?.items ?? [];
}

// --- Color Extraction ---

async function extractDominantColor(
  iiifUrl: string
): Promise<{ r: number; g: number; b: number; hex: string } | null> {
  try {
    const thumbUrl = `${iiifUrl}full/64,/0/default.jpg`;
    const res = await fetch(thumbUrl);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const { dominant } = await sharp(buffer).stats();

    const hex =
      "#" +
      [dominant.r, dominant.g, dominant.b]
        .map((c) => Math.round(c).toString(16).padStart(2, "0"))
        .join("");

    return { r: Math.round(dominant.r), g: Math.round(dominant.g), b: Math.round(dominant.b), hex };
  } catch {
    return null;
  }
}

// --- Main ---

async function main() {
  console.log(`\n🏛️  Kabinett Data Sync`);
  console.log(`   Mode: ${TEST_MODE ? "TEST (2 pages)" : "FULL"}`);
  console.log(`   Database: ${DB_PATH}\n`);

  const db = initDb();

  const insert = db.prepare(`
    INSERT OR REPLACE INTO artworks
    (id, inventory_number, title_sv, title_en, category, technique_material,
     artists, dating_text, year_start, year_end, acquisition_year,
     iiif_url, dominant_color, color_r, color_g, color_b)
    VALUES
    (@id, @inventory_number, @title_sv, @title_en, @category, @technique_material,
     @artists, @dating_text, @year_start, @year_end, @acquisition_year,
     @iiif_url, @dominant_color, @color_r, @color_g, @color_b)
  `);

  let totalSynced = 0;
  let totalSkipped = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await fetchPage(page);
    if (items.length === 0) {
      console.log(`   Page ${page}: empty — done.`);
      break;
    }

    const withImages = items.filter((item) => item.iiif);

    for (const item of withImages) {
      const color = await extractDominantColor(item.iiif!);
      const dating = item.dating?.[0];

      insert.run({
        id: item.id,
        inventory_number: item.inventory_number,
        title_sv: item.title?.sv || null,
        title_en: item.title?.en || null,
        category: item.category?.sv || null,
        technique_material: item.technique_material?.sv || null,
        artists: JSON.stringify(
          (item.actors || [])
            .filter((a: any) => a.actor_full_name && a.actor_full_name !== "Ingen uppgift")
            .map((a: any) => ({ name: a.actor_full_name, nationality: a.actor_nationality || null }))
        ),
        dating_text: dating?.date?.sv || null,
        year_start: dating?.start_date || null,
        year_end: dating?.end_date || null,
        acquisition_year: item.acquisition_year,
        iiif_url: item.iiif,
        dominant_color: color?.hex || null,
        color_r: color?.r ?? null,
        color_g: color?.g ?? null,
        color_b: color?.b ?? null,
      });

      totalSynced++;
    }

    totalSkipped += items.length - withImages.length;

    if (page % 50 === 0 || page <= 2) {
      console.log(
        `   Page ${page}/${MAX_PAGES}: ${withImages.length} artworks synced (${totalSynced} total)`
      );
    }
  }

  console.log(`\n✅ Sync complete!`);
  console.log(`   Synced: ${totalSynced} artworks with images`);
  console.log(`   Skipped: ${totalSkipped} without images`);
  console.log(`   Database: ${DB_PATH}\n`);

  db.close();
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
