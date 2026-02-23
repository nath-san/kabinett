import Database from "better-sqlite3";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = import.meta.dirname ?? resolve(fileURLToPath(import.meta.url), "..");
const DB_PATH = resolve(
  __dirname,
  "../../../../packages/data/kabinett.db"
);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
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
}
