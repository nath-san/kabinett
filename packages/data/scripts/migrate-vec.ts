import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as sqliteVec from "sqlite-vec";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || resolve(__dirname, "../kabinett.db");
const BATCH_SIZE = 1_000;

type EmbeddingRow = {
  artwork_id: number;
  embedding: Buffer;
};

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  sqliteVec.load(db);

  try {
    console.log(`\n🧭 Migrerar sqlite-vec index: ${DB_PATH}`);

    // Drop and recreate — vec0 doesn't support negative PKs so we use
    // a separate mapping table and let vec0 auto-assign rowids
    db.exec("DROP TABLE IF EXISTS vec_artworks");
    db.exec("DROP TABLE IF EXISTS vec_artwork_map");

    db.exec(`
      CREATE VIRTUAL TABLE vec_artworks USING vec0(
        embedding float[512]
      );
    `);

    db.exec(`
      CREATE TABLE vec_artwork_map (
        vec_rowid INTEGER PRIMARY KEY,
        artwork_id INTEGER NOT NULL
      );
    `);
    db.exec("CREATE INDEX IF NOT EXISTS idx_vec_artwork_map_artwork ON vec_artwork_map(artwork_id)");

    const total = (
      db.prepare("SELECT COUNT(*) AS count FROM clip_embeddings").get() as { count: number }
    ).count;
    console.log(`   Embeddings att migrera: ${total}`);

    const insertVec = db.prepare("INSERT INTO vec_artworks (embedding) VALUES (?)");
    const insertMap = db.prepare("INSERT INTO vec_artwork_map (vec_rowid, artwork_id) VALUES (?, ?)");
    const getLastRowid = db.prepare("SELECT last_insert_rowid() as rid");
    const insertBatch = db.transaction((rows: EmbeddingRow[]) => {
      for (const row of rows) {
        insertVec.run(row.embedding);
        const { rid } = getLastRowid.get() as { rid: number };
        insertMap.run(rid, row.artwork_id);
      }
    });

    let processed = 0;
    let skipped = 0;
    let lastId = -Number.MAX_SAFE_INTEGER;

    while (true) {
      let rows: EmbeddingRow[];
      try {
        rows = db.prepare(
          "SELECT artwork_id, embedding FROM clip_embeddings WHERE artwork_id > ? ORDER BY artwork_id LIMIT ?"
        ).all(lastId, BATCH_SIZE) as EmbeddingRow[];
      } catch (err) {
        console.error(`   ⚠️ Read error after artwork_id ${lastId}, skipping ahead...`);
        // Skip ahead by trying the next range
        const nextRow = db.prepare(
          "SELECT MIN(artwork_id) as next_id FROM clip_embeddings WHERE artwork_id > ? + 1000"
        ).get(lastId) as { next_id: number | null } | undefined;
        if (!nextRow?.next_id) break;
        lastId = nextRow.next_id - 1;
        skipped++;
        continue;
      }

      if (rows.length === 0) break;
      lastId = rows[rows.length - 1].artwork_id;

      try {
        insertBatch(rows);
      } catch (err) {
        // Insert one by one on batch failure
        for (const row of rows) {
          try {
            insertVec.run(row.embedding);
            const info = db.prepare("SELECT last_insert_rowid() as rid").get() as { rid: number };
            insertMap.run(info.rid, row.artwork_id);
          } catch { skipped++; }
        }
      }
      processed += rows.length;

      if (processed % 10_000 < BATCH_SIZE || rows.length < BATCH_SIZE) {
        const pct = ((processed / total) * 100).toFixed(1);
        console.log(`   ${processed}/${total} (${pct}%)${skipped > 0 ? ` [${skipped} skipped]` : ""}`);
      }
    }

    console.log(`\n✅ sqlite-vec migration klar — ${processed} vektorer indexerade\n`);
  } finally {
    db.close();
  }
}

main();
