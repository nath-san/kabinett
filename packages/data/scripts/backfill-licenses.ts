/**
 * Backfill media_license + media_copyright for all artworks.
 *
 * Sources:
 * - nationalmuseum: NM API → iiif_license.copyright / iiif_license.license
 * - shm: K-samsök → mediaLicense + copyright (from presentation block)
 * - nordiska: K-samsök → mediaLicense (from presentation block)
 *
 * Usage:
 *   npx tsx scripts/backfill-licenses.ts
 *   npx tsx scripts/backfill-licenses.ts --source=shm
 *   npx tsx scripts/backfill-licenses.ts --source=nordiska
 *   npx tsx scripts/backfill-licenses.ts --source=nationalmuseum
 *   npx tsx scripts/backfill-licenses.ts --dry-run
 */

import Database from "better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { KSAMSOK_XML_PARSER_CONFIG, findAll, findFirst, getText } from "./lib/ksamsok-utils";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../kabinett.db");

const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE_ARG = process.argv.find((a) => a.startsWith("--source="));
const ONLY_SOURCE = SOURCE_ARG ? SOURCE_ARG.split("=")[1] : null;

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// --- Ensure columns exist ---
for (const col of ["media_license", "media_copyright"]) {
  try {
    db.exec(`ALTER TABLE artworks ADD COLUMN ${col} TEXT`);
    console.log(`Added column: ${col}`);
  } catch {
    // Already exists
  }
}

const parser = new XMLParser(KSAMSOK_XML_PARSER_CONFIG);

const KSAMSOK_API = "https://kulturarvsdata.se/ksamsok/api";
const NM_API = "https://api.nationalmuseum.se/api/objects";

// License URL → short label mapping
const LICENSE_MAP: Record<string, string> = {
  "http://kulturarvsdata.se/resurser/license#cc0": "CC0",
  "http://kulturarvsdata.se/resurser/License#cc0": "CC0",
  "http://creativecommons.org/publicdomain/zero/1.0/": "CC0",
  "http://kulturarvsdata.se/resurser/license#by": "CC BY",
  "http://kulturarvsdata.se/resurser/License#by": "CC BY",
  "http://creativecommons.org/licenses/by/4.0/": "CC BY",
  "http://kulturarvsdata.se/resurser/license#by-sa": "CC BY-SA",
  "http://kulturarvsdata.se/resurser/License#by-sa": "CC BY-SA",
  "http://creativecommons.org/licenses/by-sa/4.0/": "CC BY-SA",
  "http://kulturarvsdata.se/resurser/license#by-nc-nd": "CC BY-NC-ND",
  "http://kulturarvsdata.se/resurser/License#by-nc-nd": "CC BY-NC-ND",
  "http://creativecommons.org/licenses/by-nc-nd/4.0/": "CC BY-NC-ND",
  "http://kulturarvsdata.se/resurser/license#by-nc": "CC BY-NC",
  "http://kulturarvsdata.se/resurser/License#by-nc": "CC BY-NC",
  "http://kulturarvsdata.se/resurser/license#by-nc-sa": "CC BY-NC-SA",
  "http://kulturarvsdata.se/resurser/License#by-nc-sa": "CC BY-NC-SA",
  "http://kulturarvsdata.se/resurser/license#by-nd": "CC BY-ND",
  "http://kulturarvsdata.se/resurser/License#by-nd": "CC BY-ND",
  "http://kulturarvsdata.se/resurser/license#pdm": "Public Domain",
  "http://kulturarvsdata.se/resurser/License#pdm": "Public Domain",
  "http://kulturarvsdata.se/resurser/license#pdmark": "Public Domain",
  "http://kulturarvsdata.se/resurser/License#pdmark": "Public Domain",
  "http://kulturarvsdata.se/resurser/license#inc": "In Copyright",
  "http://kulturarvsdata.se/resurser/License#inc": "In Copyright",
};

function normalizeLicense(url: string): string {
  return LICENSE_MAP[url.trim()] || url.trim();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- K-samsök backfill (SHM + Nordiska) ---

async function fetchPage(query: string, startRecord: number, hitsPerPage: number) {
  const params = new URLSearchParams({
    method: "search",
    query,
    startRecord: String(startRecord),
    hitsPerPage: String(hitsPerPage),
    "x-api": "kabinett",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${KSAMSOK_API}?${params.toString()}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
      } else {
        throw err;
      }
    }
  }
  throw new Error("unreachable");
}

async function backfillKsamsok(source: "shm" | "nordiska") {
  const org = source === "shm" ? "shm" : "nomu";
  const query = `serviceOrganization=${org} AND thumbnailExists=j`;
  const HITS_PER_PAGE = 500;
  const CONCURRENCY = 8;

  // Build lookup: UUID → artwork id
  const artworks = db
    .prepare(
      `SELECT id, iiif_url FROM artworks
       WHERE source = ? AND media_license IS NULL`
    )
    .all(source) as Array<{ id: number; iiif_url: string }>;

  if (artworks.length === 0) {
    console.log(`${source}: No artworks without license info. Done.`);
    return;
  }

  console.log(`${source}: ${artworks.length.toLocaleString()} artworks missing license info`);

  // Also load inventory_number for Nordiska matching
  const artworksWithInv = source === "nordiska"
    ? db.prepare(
        `SELECT id, iiif_url, inventory_number FROM artworks
         WHERE source = ? AND media_license IS NULL`
      ).all(source) as Array<{ id: number; iiif_url: string; inventory_number: string | null }>
    : artworks.map((a) => ({ ...a, inventory_number: null as string | null }));

  const urlToId = new Map<string, number>();
  for (const a of artworksWithInv) {
    if (source === "shm") {
      const match = a.iiif_url.match(/\/item\/([^/]+)\//);
      if (match) urlToId.set(match[1].toUpperCase(), a.id);
    } else {
      // Nordiska: match on inventory_number (stored as "nordiska:NMA0166359")
      // K-samsök about URI ends with the same ID (e.g. "nomu/photo/NMA0166359")
      if (a.inventory_number) {
        const inv = a.inventory_number.replace(/^nordiska:/, "");
        urlToId.set(inv, a.id);
      }
    }
  }

  const update = db.prepare(
    `UPDATE artworks SET media_license = ?, media_copyright = ? WHERE id = ?`
  );

  // First, get total hits
  const firstXml = await fetchPage(query, 1, 1);
  const firstParsed = parser.parse(firstXml);
  const totalHits = parseInt(getText(findFirst(firstParsed, "totalHits")), 10) || 0;
  console.log(`${source}: ${totalHits.toLocaleString()} total K-samsök records to scan`);

  let updated = 0;
  let totalProcessed = 0;

  // Process in parallel batches
  const totalPages = Math.ceil(totalHits / HITS_PER_PAGE);

  for (let batch = 0; batch < totalPages; batch += CONCURRENCY) {
    const pagePromises: Promise<string | null>[] = [];
    for (let p = 0; p < CONCURRENCY && batch + p < totalPages; p++) {
      const start = (batch + p) * HITS_PER_PAGE + 1;
      pagePromises.push(
        fetchPage(query, start, HITS_PER_PAGE).catch((err) => {
          console.error(`  Error page ${start}: ${err.message}`);
          return null;
        })
      );
    }

    const pages = await Promise.all(pagePromises);

    for (const xml of pages) {
      if (!xml) continue;
      const parsed = parser.parse(xml);
      const entities = findAll(parsed, "Entity");

      for (const entity of entities) {
        totalProcessed++;
        const about: string = entity?.["@_about"] || entity?.["@_rdf:about"] || "";
        const uuid = about.split("/").pop() || "";
        if (!uuid) continue;

        // Extract mediaLicense and copyright from presentation block
        const presentations = findAll(entity, "presentation");
        let mediaLicense: string | null = null;
        let copyright: string | null = null;

        for (const pres of presentations) {
          const ml = findAll(pres, "mediaLicense");
          for (const m of ml) {
            const t = getText(m).trim();
            if (t) mediaLicense = normalizeLicense(t);
          }
          const cp = findAll(pres, "copyright");
          for (const c of cp) {
            const t = getText(c).trim();
            if (t) copyright = t;
          }
        }

        if (!mediaLicense) {
          const il = entity?.itemLicense;
          const ilRes = il?.["@_resource"] || il?.["@_rdf:resource"] || "";
          if (ilRes) mediaLicense = normalizeLicense(ilRes);
        }

        if (!mediaLicense && !copyright) continue;

        // Match to our DB
        // SHM: UUID from about attr matches iiif_url UUID
        // Nordiska: entityId from about attr (e.g. "NMA0166359") matches inventory_number
        const key = source === "shm" ? uuid.toUpperCase() : uuid;
        const artworkId = urlToId.get(key);

        if (artworkId != null) {
          if (!DRY_RUN) {
            update.run(mediaLicense, copyright, artworkId);
          }
          updated++;
        }
      }
    }

    if (totalProcessed % 10000 < HITS_PER_PAGE * CONCURRENCY || batch + CONCURRENCY >= totalPages) {
      console.log(
        `  ${source}: ${updated.toLocaleString()} matched (${totalProcessed.toLocaleString()} / ${totalHits.toLocaleString()} scanned)`
      );
    }
  }

  console.log(
    `\n${source}: Done — ${updated.toLocaleString()} updated${DRY_RUN ? " (DRY RUN)" : ""}`
  );
}

// --- Nationalmuseum backfill ---

async function backfillNationalmuseum() {
  const artworks = db
    .prepare(
      `SELECT id FROM artworks WHERE source = 'nationalmuseum' AND media_license IS NULL`
    )
    .all() as Array<{ id: number }>;

  if (artworks.length === 0) {
    console.log("nationalmuseum: No artworks without license info. Done.");
    return;
  }

  console.log(`nationalmuseum: ${artworks.length.toLocaleString()} artworks missing license info`);

  const update = db.prepare(
    `UPDATE artworks SET media_license = ?, media_copyright = ? WHERE id = ?`
  );

  const CONCURRENCY = 10;
  let updated = 0;
  let noLicense = 0;
  let errors = 0;

  async function fetchOne(id: number) {
    try {
      const res = await fetch(`${NM_API}/${id}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { errors++; return; }

      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data[0] : json.data;
      if (!data) { errors++; return; }

      const lic = data.iiif_license || {};
      const copyright = lic.copyright || null;
      const license = lic.license || null;
      const creditline = lic.creditline || null;

      const copyrightParts: string[] = [];
      if (copyright) copyrightParts.push(copyright);
      if (creditline && !copyright?.includes(creditline)) {
        copyrightParts.push(creditline);
      }
      const mediaCopyright = copyrightParts.join(" — ") || null;
      const mediaLicense = license ? normalizeLicense(license) : null;

      if (mediaCopyright || mediaLicense) {
        if (!DRY_RUN) {
          update.run(mediaLicense, mediaCopyright, id);
        }
        updated++;
      } else {
        noLicense++;
      }
    } catch {
      errors++;
    }
  }

  // Process with concurrency pool
  let index = 0;
  async function worker() {
    while (index < artworks.length) {
      const i = index++;
      await fetchOne(artworks[i].id);
      if (i % 500 === 0 && i > 0) {
        console.log(
          `  nationalmuseum: ${updated.toLocaleString()} updated, ${errors} errors (${i.toLocaleString()} / ${artworks.length.toLocaleString()})`
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker())
  );

  console.log(
    `\nnationalmuseum: Done — ${updated.toLocaleString()} updated, ${noLicense.toLocaleString()} no license, ${errors} errors${DRY_RUN ? " (DRY RUN)" : ""}`
  );
}

// --- Main ---

async function main() {
  console.log(`\n🔑 License backfill${DRY_RUN ? " (DRY RUN)" : ""}\n`);

  if (!ONLY_SOURCE || ONLY_SOURCE === "shm") {
    await backfillKsamsok("shm");
  }
  if (!ONLY_SOURCE || ONLY_SOURCE === "nordiska") {
    await backfillKsamsok("nordiska");
  }
  if (!ONLY_SOURCE || ONLY_SOURCE === "nationalmuseum") {
    await backfillNationalmuseum();
  }

  // Normalize inconsistent license strings
  const normalizations: [string, string][] = [
    ["CC BY SA", "CC BY-SA"],
    ["CC BY SApub", "CC BY-SA"],
  ];
  for (const [from, to] of normalizations) {
    const result = db.prepare("UPDATE artworks SET media_license = ? WHERE media_license = ?").run(to, from);
    if (result.changes > 0) {
      console.log(`Normalized "${from}" → "${to}": ${result.changes} rows`);
    }
  }

  // Summary
  const stats = db
    .prepare(
      `SELECT source,
              COUNT(*) as total,
              SUM(CASE WHEN media_license IS NOT NULL THEN 1 ELSE 0 END) as with_license,
              SUM(CASE WHEN media_copyright IS NOT NULL THEN 1 ELSE 0 END) as with_copyright
       FROM artworks GROUP BY source`
    )
    .all() as Array<{
    source: string;
    total: number;
    with_license: number;
    with_copyright: number;
  }>;

  console.log("\n📊 License coverage:\n");
  for (const s of stats) {
    const pctLic = ((s.with_license / s.total) * 100).toFixed(1);
    const pctCop = ((s.with_copyright / s.total) * 100).toFixed(1);
    console.log(
      `  ${s.source}: ${s.with_license.toLocaleString()}/${s.total.toLocaleString()} license (${pctLic}%), ${s.with_copyright.toLocaleString()} copyright (${pctCop}%)`
    );
  }

  // License distribution
  const dist = db
    .prepare(
      `SELECT media_license, COUNT(*) as cnt FROM artworks
       WHERE media_license IS NOT NULL
       GROUP BY media_license ORDER BY cnt DESC`
    )
    .all() as Array<{ media_license: string; cnt: number }>;

  if (dist.length > 0) {
    console.log("\n📋 License distribution:");
    for (const d of dist) {
      console.log(`  ${d.media_license}: ${d.cnt.toLocaleString()}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });
