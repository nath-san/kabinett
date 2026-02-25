/**
 * Check which IIIF images return 501 and mark them as broken.
 * Quick scan — only checks HTTP status, doesn't download.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");
const BATCH = 100;
const CONCURRENCY = 20;

async function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS broken_images (artwork_id INTEGER PRIMARY KEY)`);

    const alreadyChecked = (db.prepare("SELECT COUNT(*) as c FROM broken_images").get() as any).c;
    
    // Get all artwork IDs not yet checked
    const rows = db.prepare(`
      SELECT a.id, a.iiif_url FROM artworks a
      WHERE a.iiif_url IS NOT NULL AND LENGTH(a.iiif_url) > 90
      ORDER BY a.id
    `).all() as Array<{ id: number; iiif_url: string }>;

    console.log(`\n🔍 Checking ${rows.length} images (${alreadyChecked} already marked broken)`);

    const insertBroken = db.prepare("INSERT OR IGNORE INTO broken_images (artwork_id) VALUES (?)");
    let checked = 0;
    let broken = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      
      // Check in parallel chunks
      for (let j = 0; j < batch.length; j += CONCURRENCY) {
        const chunk = batch.slice(j, j + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (row) => {
            const url = row.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg";
            try {
              const res = await fetch(url, { method: "HEAD", redirect: "follow" });
              return { id: row.id, ok: res.ok };
            } catch {
              return { id: row.id, ok: false };
            }
          })
        );

        for (const r of results) {
          if (!r.ok) {
            insertBroken.run(r.id);
            broken++;
          }
        }
        checked += chunk.length;
      }

      const pct = ((checked / rows.length) * 100).toFixed(1);
      console.log(`   ${checked}/${rows.length} (${pct}%) — ${broken} broken`);
    }

    console.log(`\n✅ Done. ${broken} broken images marked.`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
