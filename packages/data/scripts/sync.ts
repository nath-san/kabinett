/**
 * Kabinett Incremental Sync
 *
 * Fetches only new/updated artworks from Nationalmuseum's API.
 * Sorts by last_updated desc and stops when reaching already-synced items.
 * Also detects removed artworks by checking a sample of existing IDs.
 *
 * Usage:
 *   pnpm sync:incremental          # Incremental update
 *   pnpm sync:incremental --full   # Force full re-sync
 *   pnpm sync:incremental --check-removed  # Also check for removed artworks
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const API_BASE = "https://api.nationalmuseum.se/api/objects";
const LIMIT = 100;
const FULL_MODE = process.argv.includes("--full");
const CHECK_REMOVED = process.argv.includes("--check-removed");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Ensure last_updated column exists
try {
  db.exec("ALTER TABLE artworks ADD COLUMN last_updated INTEGER");
} catch {
  // Column already exists
}

// Get our latest last_updated timestamp
const latestRow = db.prepare("SELECT MAX(last_updated) as latest FROM artworks").get() as any;
const latestTimestamp: number = FULL_MODE ? 0 : (latestRow?.latest || 0);

console.log(`🔄 Incremental sync — latest stored timestamp: ${latestTimestamp}`);
if (latestTimestamp > 0) {
  console.log(`   (${new Date(latestTimestamp * 1000).toISOString()})`);
}
if (FULL_MODE) console.log("   ⚠️  Full mode — re-syncing everything");

// --- Helpers ---

async function fetchPage(page: number): Promise<{ items: any[]; totalPages: number }> {
  const url = `${API_BASE}?limit=${LIMIT}&page=${page}&sort=last_updated&order=desc`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status} on page ${page}`);
  const json = await res.json();
  return {
    items: json.data.items,
    totalPages: json.data.paging.total_pages,
  };
}

// --- Upsert ---

const upsertStmt = db.prepare(`
  INSERT INTO artworks (
    id, inventory_number, title_sv, title_en, category, technique_material,
    artists, dating_text, year_start, year_end, acquisition_year,
    iiif_url, dominant_color, color_r, color_g, color_b,
    descriptions_sv, descriptions_en, acquisition_sv, object_type_sv,
    style_sv, signature, inscription, motive_category, loan,
    material_tags, technique_tags, dimensions_json, actors_json,
    exhibitions_json, last_updated, source, synced_at
  ) VALUES (
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, datetime('now')
  )
  ON CONFLICT(id) DO UPDATE SET
    inventory_number = excluded.inventory_number,
    title_sv = excluded.title_sv,
    title_en = excluded.title_en,
    category = excluded.category,
    technique_material = excluded.technique_material,
    artists = excluded.artists,
    dating_text = excluded.dating_text,
    year_start = excluded.year_start,
    year_end = excluded.year_end,
    acquisition_year = excluded.acquisition_year,
    iiif_url = excluded.iiif_url,
    descriptions_sv = excluded.descriptions_sv,
    descriptions_en = excluded.descriptions_en,
    acquisition_sv = excluded.acquisition_sv,
    object_type_sv = excluded.object_type_sv,
    style_sv = excluded.style_sv,
    signature = excluded.signature,
    inscription = excluded.inscription,
    motive_category = excluded.motive_category,
    loan = excluded.loan,
    material_tags = excluded.material_tags,
    technique_tags = excluded.technique_tags,
    dimensions_json = excluded.dimensions_json,
    actors_json = excluded.actors_json,
    exhibitions_json = excluded.exhibitions_json,
    last_updated = excluded.last_updated,
    source = excluded.source,
    synced_at = datetime('now')
`);

function parseItem(item: any) {
  const dating = item.dating?.[0];
  const artists = (item.actors || []).map((a: any) => ({
    name: a.actor_full_name || null,
    nationality: a.actor_nationality || null,
    role: a.actor_role || null,
  }));

  return {
    id: item.id,
    inventory_number: item.inventory_number || null,
    title_sv: item.title?.sv || null,
    title_en: item.title?.en || null,
    category: item.category?.sv || null,
    technique_material: item.technique_material?.sv || null,
    artists: JSON.stringify(artists),
    dating_text: dating?.date?.sv || null,
    year_start: dating?.start_date || null,
    year_end: dating?.end_date || null,
    acquisition_year: item.acquisition_year || null,
    iiif_url: item.iiif || null,
    descriptions_sv: item.descriptions?.sv || null,
    descriptions_en: item.descriptions?.en || null,
    acquisition_sv: item.acquisition?.sv || null,
    object_type_sv: item.object_type?.sv || null,
    style_sv: item.style?.sv || null,
    signature: item.signature || null,
    inscription: item.inscription || null,
    motive_category: item.motive_category || null,
    loan: item.loan ? 1 : 0,
    material_tags: (item.material_tags || []).join(", "),
    technique_tags: (item.technique_tags || []).join(", "),
    dimensions_json: JSON.stringify(item.dimensions || []),
    actors_json: JSON.stringify(item.actors || []),
    exhibitions_json: JSON.stringify(item.exhibitions || []),
    last_updated: item.last_updated || null,
  };
}

// --- Main ---

async function main() {
  try {
    const existingRows = db.prepare("SELECT id, last_updated FROM artworks").all() as Array<{
      id: string | number;
      last_updated: number | null;
    }>;
    const existingById = new Map(existingRows.map((row) => [row.id, row.last_updated]));

    let page = 1;
    let totalNew = 0;
    let totalUpdated = 0;
    let done = false;

    while (!done) {
      const { items, totalPages } = await fetchPage(page);
      if (items.length === 0) break;

      for (const item of items) {
        const itemTimestamp = item.last_updated || 0;

        // If not full mode, stop when we reach already-synced items
        if (!FULL_MODE && itemTimestamp <= latestTimestamp) {
          done = true;
          break;
        }

        const parsed = parseItem(item);

        // Skip items without IIIF (NOT NULL constraint)
        if (!parsed.iiif_url) continue;

        const isExisting = existingById.has(item.id);

        upsertStmt.run(
          parsed.id, parsed.inventory_number, parsed.title_sv, parsed.title_en,
          parsed.category, parsed.technique_material, parsed.artists,
          parsed.dating_text, parsed.year_start, parsed.year_end,
          parsed.acquisition_year, parsed.iiif_url,
          null,
          null, null, null,
          parsed.descriptions_sv, parsed.descriptions_en, parsed.acquisition_sv,
          parsed.object_type_sv, parsed.style_sv, parsed.signature,
          parsed.inscription, parsed.motive_category, parsed.loan,
          parsed.material_tags, parsed.technique_tags, parsed.dimensions_json,
          parsed.actors_json, parsed.exhibitions_json, parsed.last_updated, "nationalmuseum",
        );

        existingById.set(item.id, parsed.last_updated ?? null);

        if (isExisting) {
          totalUpdated++;
        } else {
          totalNew++;
        }
      }

      if (!done) {
        console.log(`   Page ${page}/${totalPages} — ${totalNew} new, ${totalUpdated} updated`);
        page++;

        // Rate limit
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    console.log(`\n✅ Sync complete: ${totalNew} new, ${totalUpdated} updated artworks`);

    // Check for removed artworks
    if (CHECK_REMOVED) {
      console.log("\n🔍 Checking for removed artworks...");
      const sampleIds = (db.prepare(
        "SELECT id FROM artworks ORDER BY RANDOM() LIMIT 500"
      ).all() as any[]).map((r) => r.id);

      let removed = 0;
      for (const id of sampleIds) {
        try {
          const res = await fetch(`${API_BASE}/${id}`);
          if (res.status === 404) {
            db.prepare("DELETE FROM artworks WHERE id = ?").run(id);
            db.prepare("DELETE FROM clip_embeddings WHERE artwork_id = ?").run(id);
            removed++;
            console.log(`   Removed: ${id}`);
          }
          await new Promise((r) => setTimeout(r, 100));
        } catch {
          // Skip network errors
        }
      }
      console.log(`✅ Removed ${removed} artworks no longer in API`);
    }

    const needColorExtraction = (db.prepare(`
      SELECT COUNT(*) as c FROM artworks
      WHERE iiif_url IS NOT NULL AND dominant_color IS NULL
    `).get() as any).c;

    if (needColorExtraction > 0) {
      console.log(`\n⚠️  ${needColorExtraction} artworks need color extraction — run a separate color extraction command`);
    }

    // Report new artworks needing embeddings
    const needEmbeddings = (db.prepare(`
      SELECT COUNT(*) as c FROM artworks
      WHERE iiif_url IS NOT NULL AND LENGTH(iiif_url) > 90
      AND id NOT IN (SELECT artwork_id FROM clip_embeddings)
    `).get() as any).c;

    if (needEmbeddings > 0) {
      console.log(`\n⚠️  ${needEmbeddings} artworks need CLIP embeddings — run: pnpm embeddings`);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
