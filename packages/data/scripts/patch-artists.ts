import Database from "better-sqlite3";
import { resolve } from "path";

const DB_PATH = resolve(import.meta.dirname!, "../kabinett.db");
const API_BASE = "https://api.nationalmuseum.se/api/objects";
const LIMIT = 100;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const update = db.prepare("UPDATE artworks SET artists = @artists WHERE id = @id");

async function fetchPage(page: number) {
  const url = `${API_BASE}?page=${page}&limit=${LIMIT}`;
  const res = await fetch(url);
  const text = await res.text();
  const cleaned = text.replace(/[\x00-\x1f\x7f]/g, (ch) =>
    ch === "\n" || ch === "\r" || ch === "\t" ? ch : ""
  );
  const data = JSON.parse(cleaned);
  return data?.data?.items ?? [];
}

async function main() {
  const total = (db.prepare("SELECT COUNT(*) as c FROM artworks").get() as any).c;
  const maxPages = Math.ceil(total / LIMIT) + 10;
  console.log(`Patching artists for ~${total} artworks (up to ${maxPages} pages)...`);

  let updated = 0;
  let pagesEmpty = 0;

  for (let page = 1; page <= maxPages; page++) {
    const items = await fetchPage(page);
    if (items.length === 0) {
      pagesEmpty++;
      if (pagesEmpty > 3) break;
      continue;
    }
    pagesEmpty = 0;

    const tx = db.transaction(() => {
      for (const item of items) {
        const actors = (item.actors || [])
          .filter((a: any) => a.actor_full_name && a.actor_full_name !== "Ingen uppgift")
          .map((a: any) => ({ name: a.actor_full_name, nationality: a.actor_nationality || null }));

        if (actors.length > 0) {
          update.run({ id: item.id, artists: JSON.stringify(actors) });
          updated++;
        }
      }
    });
    tx();

    if (page % 50 === 0) {
      console.log(`  Page ${page}... (${updated} artists patched so far)`);
    }
  }

  console.log(`\nDone! Patched ${updated} artworks with artist data.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
