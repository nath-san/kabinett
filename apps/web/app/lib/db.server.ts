import Database from "better-sqlite3";
import { resolve } from "path";
import { fileURLToPath } from "url";
import * as sqliteVec from "sqlite-vec";

const __dirname = import.meta.dirname ?? resolve(fileURLToPath(import.meta.url), "..");
const DB_PATH = process.env.DATABASE_PATH || resolve(
  __dirname,
  "../../../../packages/data/kabinett.db"
);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    sqliteVec.load(db);
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache
    db.pragma("mmap_size = 268435456"); // 256MB mmap
    db.pragma("temp_store = memory");
  }
  return db;
}

export interface ArtworkRow {
  id: number;
  title_sv: string;
  title_en: string | null;
  source: string | null;
  category: string | null;
  technique_material: string | null;
  artists: string | null;
  dating_text: string | null;
  year_start: number | null;
  acquisition_year: number | null;
  iiif_url: string;
  dominant_color: string | null;
  color_r: number | null;
  color_g: number | null;
  color_b: number | null;
  sub_museum: string | null;
  descriptions_sv: string | null;
  dimensions_json: string | null;
  signature: string | null;
  inscription: string | null;
  style_sv: string | null;
  object_type_sv: string | null;
  motive_category: string | null;
  exhibitions_json: string | null;
  material_tags: string | null;
  technique_tags: string | null;
}
