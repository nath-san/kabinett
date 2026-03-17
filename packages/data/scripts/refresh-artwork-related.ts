import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { cpus } from "os";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import * as sqliteVec from "sqlite-vec";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DATABASE_PATH || resolve(__dirname, "../kabinett.db");

const DEFAULT_RECENT = 5000;
const DEFAULT_NEIGHBOR_LIMIT = 12;
const DEFAULT_K = 20;
const DEFAULT_WORKERS = 4;

const WRITE_BATCH_SIZE = 100;
const PROGRESS_INTERVAL = 250;

type ArtworkArtist = {
  id: number;
  artists: string | null;
};

type NeighborRow = {
  neighbor_id: number;
  distance: number | null;
};

type CliOptions = {
  artistsOnly: boolean;
  neighborsOnly: boolean;
  allArtists: boolean;
  allNeighbors: boolean;
  recent: number;
  neighborLimit: number;
  k: number;
  workers: number;
  ids: number[];
};

type NeighborResult = {
  artworkId: number;
  neighbors: NeighborRow[];
  skipped: boolean;
};

type WorkerConfig = {
  dbPath: string;
  k: number;
  neighborLimit: number;
};

type TaskMessage = {
  type: "task";
  artworkId: number;
};

type StopMessage = {
  type: "stop";
};

type ReadyMessage = {
  type: "ready";
};

type ResultMessage = {
  type: "result";
  payload: NeighborResult;
};

type WorkerToMainMessage = ReadyMessage | ResultMessage;

type MainToWorkerMessage = TaskMessage | StopMessage;

function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseIds(raw: string): number[] {
  return raw
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const detectedCpuCount = cpus()?.length ?? 0;
  const artistsOnly = args.includes("--artists-only");
  const neighborsOnly = args.includes("--neighbors-only");
  const allArtists = args.includes("--all-artists");
  const allNeighbors = args.includes("--all-neighbors");
  const recentArg = args.find((arg) => arg.startsWith("--recent="));
  const neighborLimitArg = args.find((arg) => arg.startsWith("--neighbor-limit="));
  const kArg = args.find((arg) => arg.startsWith("--k="));
  const workersArg = args.find((arg) => arg.startsWith("--workers="));
  const idsArg = args.find((arg) => arg.startsWith("--ids="));

  return {
    artistsOnly,
    neighborsOnly,
    allArtists,
    allNeighbors,
    recent: parsePositiveInt(recentArg?.split("=")[1], DEFAULT_RECENT),
    neighborLimit: parsePositiveInt(neighborLimitArg?.split("=")[1], DEFAULT_NEIGHBOR_LIMIT),
    k: parsePositiveInt(kArg?.split("=")[1], DEFAULT_K),
    workers: parsePositiveInt(
      workersArg?.split("=")[1],
      detectedCpuCount > 0 ? detectedCpuCount : DEFAULT_WORKERS
    ),
    ids: idsArg ? parseIds(idsArg.split("=")[1] || "") : [],
  };
}

function ensureRelatedTables(db: Database.Database) {
  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_artwork_artists_norm ON artwork_artists(artist_name_norm);
    CREATE INDEX IF NOT EXISTS idx_artwork_artists_artwork ON artwork_artists(artwork_id);
    CREATE INDEX IF NOT EXISTS idx_artwork_neighbors_artwork ON artwork_neighbors(artwork_id, rank);
    CREATE INDEX IF NOT EXISTS idx_artwork_neighbors_neighbor ON artwork_neighbors(neighbor_artwork_id);
  `);
}

function rebuildArtworkArtists(db: Database.Database) {
  const rows = db.prepare(
    `SELECT id, artists FROM artworks
     WHERE artists IS NOT NULL AND artists != ''`
  ).all() as ArtworkArtist[];

  const clear = db.prepare("DELETE FROM artwork_artists");
  const insert = db.prepare(
    `INSERT OR REPLACE INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
     VALUES (?, ?, ?, ?)`
  );

  let inserted = 0;
  const write = db.transaction(() => {
    clear.run();
    for (const row of rows) {
      let parsed: Array<{ name?: string | null }> = [];
      try {
        parsed = JSON.parse(row.artists || "[]");
      } catch {
        parsed = [];
      }
      if (!Array.isArray(parsed) || parsed.length === 0) continue;

      const seen = new Set<string>();
      for (let index = 0; index < parsed.length; index += 1) {
        const candidate = parsed[index]?.name?.trim();
        if (!candidate) continue;
        const normalized = normalizeArtistName(candidate);
        if (!normalized || seen.has(normalized)) continue;
        insert.run(row.id, candidate, normalized, index);
        seen.add(normalized);
        inserted += 1;
      }
    }
  });
  write();
  console.log(`✅ Rebuilt artwork_artists (${inserted} rows)`);
}

function selectRecentIds(db: Database.Database, recent: number): number[] {
  const rows = db.prepare(
    `SELECT id
     FROM artworks
     WHERE artists IS NOT NULL AND artists != ''
     ORDER BY
       COALESCE(last_updated, CAST(strftime('%s', synced_at) AS INTEGER), 0) DESC,
       id DESC
     LIMIT ?`
  ).all(recent) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

function upsertArtistsForIds(db: Database.Database, ids: number[]) {
  if (ids.length === 0) {
    console.log("ℹ️ No artwork ids to refresh in artwork_artists");
    return;
  }

  const deleteByArtwork = db.prepare("DELETE FROM artwork_artists WHERE artwork_id = ?");
  const selectById = db.prepare(
    `SELECT id, artists
     FROM artworks
     WHERE id = ?
       AND artists IS NOT NULL
       AND artists != ''`
  );
  const insert = db.prepare(
    `INSERT OR REPLACE INTO artwork_artists (artwork_id, artist_name, artist_name_norm, position)
     VALUES (?, ?, ?, ?)`
  );

  let inserted = 0;
  const write = db.transaction(() => {
    for (const id of ids) {
      deleteByArtwork.run(id);
      const row = selectById.get(id) as ArtworkArtist | undefined;
      if (!row) continue;

      let parsed: Array<{ name?: string | null }> = [];
      try {
        parsed = JSON.parse(row.artists || "[]");
      } catch {
        parsed = [];
      }
      if (!Array.isArray(parsed) || parsed.length === 0) continue;

      const seen = new Set<string>();
      for (let index = 0; index < parsed.length; index += 1) {
        const candidate = parsed[index]?.name?.trim();
        if (!candidate) continue;
        const normalized = normalizeArtistName(candidate);
        if (!normalized || seen.has(normalized)) continue;
        insert.run(row.id, candidate, normalized, index);
        seen.add(normalized);
        inserted += 1;
      }
    }
  });

  write();
  console.log(`✅ Refreshed artwork_artists for ${ids.length} artworks (${inserted} rows)`);
}

function refreshArtworkArtists(db: Database.Database, options: CliOptions) {
  if (options.allArtists) {
    rebuildArtworkArtists(db);
    return;
  }

  const existingCount = (db.prepare("SELECT COUNT(*) as c FROM artwork_artists").get() as { c: number }).c;
  if (existingCount === 0) {
    rebuildArtworkArtists(db);
    return;
  }

  const targetIds = options.ids.length > 0 ? options.ids : selectRecentIds(db, options.recent);
  upsertArtistsForIds(db, targetIds);
}

function collectNeighborArtworkIds(db: Database.Database, options: CliOptions): number[] {
  if (options.ids.length > 0) return options.ids;

  if (options.allNeighbors) {
    const all = db.prepare(
      `SELECT a.id
       FROM artworks a
       JOIN clip_embeddings c ON c.artwork_id = a.id
       WHERE a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND NOT EXISTS (
           SELECT 1
           FROM artwork_neighbors n
           WHERE n.artwork_id = a.id
         )
       ORDER BY a.id`
    ).all() as Array<{ id: number }>;
    return all.map((row) => row.id);
  }

  const recent = db.prepare(
    `SELECT a.id
     FROM artworks a
     JOIN clip_embeddings c ON c.artwork_id = a.id
     WHERE a.iiif_url IS NOT NULL
       AND LENGTH(a.iiif_url) > 40
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
     ORDER BY COALESCE(a.last_updated, 0) DESC, a.id DESC
     LIMIT ?`
  ).all(options.recent) as Array<{ id: number }>;

  return recent.map((row) => row.id);
}

function createWorkers(count: number, config: WorkerConfig): Worker[] {
  const workers: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    workers.push(
      new Worker(new URL(import.meta.url), {
        workerData: config,
        execArgv: ["--import", "tsx/esm"],
      })
    );
  }
  return workers;
}

async function rebuildArtworkNeighborsSingleThread(db: Database.Database, options: CliOptions) {
  const targetIds = collectNeighborArtworkIds(db, options);
  if (targetIds.length === 0) {
    console.log("ℹ️ No artwork ids to refresh in artwork_neighbors");
    return;
  }

  const neighborLimit = Math.max(options.neighborLimit, 1);
  const k = Math.max(options.k, neighborLimit);

  const clearNeighbors = db.prepare("DELETE FROM artwork_neighbors WHERE artwork_id = ?");
  const insertNeighbor = db.prepare(
    `INSERT OR REPLACE INTO artwork_neighbors
      (artwork_id, neighbor_artwork_id, rank, distance, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );
  const getNeighbors = db.prepare(
    `SELECT
       map.artwork_id AS neighbor_id,
       v.distance AS distance
     FROM vec_artworks v
     JOIN vec_artwork_map map ON map.vec_rowid = v.rowid
     JOIN artworks a ON a.id = map.artwork_id
     WHERE v.embedding MATCH (
         SELECT embedding FROM clip_embeddings WHERE artwork_id = ?
       )
       AND k = ?
       AND map.artwork_id != ?
       AND a.iiif_url IS NOT NULL
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
     ORDER BY v.distance
     LIMIT ?`
  );

  const writeBatch = db.transaction((batch: NeighborResult[]) => {
    for (const result of batch) {
      if (result.skipped || result.neighbors.length === 0) continue;
      clearNeighbors.run(result.artworkId);
      for (let index = 0; index < result.neighbors.length; index += 1) {
        const neighbor = result.neighbors[index];
        if (!neighbor) continue;
        insertNeighbor.run(result.artworkId, neighbor.neighbor_id, index + 1, neighbor.distance);
      }
    }
  });

  console.log(`ℹ️ Refreshing neighbors single-threaded (k=${k}, limit=${neighborLimit}, ${targetIds.length} artworks)`);

  let completed = 0;
  let refreshed = 0;
  let skipped = 0;
  const pendingWrites: NeighborResult[] = [];
  const startTime = Date.now();

  for (const artworkId of targetIds) {
    try {
      const neighbors = getNeighbors.all(artworkId, k, artworkId, k) as NeighborRow[];
      const result: NeighborResult = {
        artworkId,
        neighbors: neighbors.slice(0, neighborLimit),
        skipped: neighbors.length === 0,
      };
      pendingWrites.push(result);
      if (result.skipped) { skipped += 1; } else { refreshed += 1; }
    } catch {
      pendingWrites.push({ artworkId, neighbors: [], skipped: true });
      skipped += 1;
    }

    completed += 1;

    if (pendingWrites.length >= WRITE_BATCH_SIZE) {
      writeBatch(pendingWrites.splice(0, pendingWrites.length));
    }

    if (completed % PROGRESS_INTERVAL === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = completed / elapsed;
      const remaining = targetIds.length - completed;
      const etaSec = Math.round(remaining / rate);
      const etaM = Math.floor(etaSec / 60);
      const etaH = Math.floor(etaM / 60);
      const etaStr = etaH > 0 ? `${etaH}h ${etaM % 60}m` : `${etaM}m`;
      console.log(`   ${completed}/${targetIds.length} (${(completed / targetIds.length * 100).toFixed(1)}%) — ${rate.toFixed(0)} verk/s — ETA ${etaStr}`);
    }
  }

  if (pendingWrites.length > 0) {
    writeBatch(pendingWrites.splice(0, pendingWrites.length));
  }

  console.log(`✅ Rebuilt artwork_neighbors for ${refreshed} artworks (${skipped} skipped)`);
}

async function rebuildArtworkNeighbors(db: Database.Database, options: CliOptions) {
  const targetIds = collectNeighborArtworkIds(db, options);
  if (targetIds.length === 0) {
    console.log("ℹ️ No artwork ids to refresh in artwork_neighbors");
    return;
  }

  const neighborLimit = Math.max(options.neighborLimit, 1);
  const k = Math.max(options.k, neighborLimit);
  const workerCount = Math.max(1, Math.min(options.workers, targetIds.length));

  const clearNeighbors = db.prepare("DELETE FROM artwork_neighbors WHERE artwork_id = ?");
  const insertNeighbor = db.prepare(
    `INSERT OR REPLACE INTO artwork_neighbors
      (artwork_id, neighbor_artwork_id, rank, distance, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  );

  const writeBatch = db.transaction((batch: NeighborResult[]) => {
    for (const result of batch) {
      if (result.skipped || result.neighbors.length === 0) continue;
      clearNeighbors.run(result.artworkId);
      for (let index = 0; index < result.neighbors.length; index += 1) {
        const neighbor = result.neighbors[index];
        if (!neighbor) continue;
        insertNeighbor.run(result.artworkId, neighbor.neighbor_id, index + 1, neighbor.distance);
      }
    }
  });

  console.log(`ℹ️ Refreshing neighbors with ${workerCount} workers (k=${k}, limit=${neighborLimit})`);

  const workers = createWorkers(workerCount, {
    dbPath: DB_PATH,
    k,
    neighborLimit,
  });

  let completed = 0;
  let refreshed = 0;
  let skipped = 0;
  let queueIndex = 0;
  let activeWorkers = workers.length;
  let settled = false;

  const stoppedWorkers = new Set<Worker>();
  const pendingWrites: NeighborResult[] = [];

  const flushWrites = () => {
    if (pendingWrites.length === 0) return;
    writeBatch(pendingWrites.splice(0, pendingWrites.length));
  };

  const maybeStopWorker = (worker: Worker) => {
    if (stoppedWorkers.has(worker)) return;
    stoppedWorkers.add(worker);
    const message: StopMessage = { type: "stop" };
    worker.postMessage(message);
  };

  const sendNextTask = (worker: Worker) => {
    if (queueIndex >= targetIds.length) {
      maybeStopWorker(worker);
      return;
    }

    const message: TaskMessage = {
      type: "task",
      artworkId: targetIds[queueIndex],
    };
    queueIndex += 1;
    worker.postMessage(message);
  };

  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      for (const worker of workers) {
        void worker.terminate();
      }
      flushWrites();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const complete = () => {
      if (settled) return;
      settled = true;
      flushWrites();
      resolve();
    };

    for (const worker of workers) {
      worker.on("message", (message: WorkerToMainMessage) => {
        if (message.type === "ready") {
          sendNextTask(worker);
          return;
        }

        const result = message.payload;
        pendingWrites.push(result);

        completed += 1;
        if (result.skipped || result.neighbors.length === 0) {
          skipped += 1;
        } else {
          refreshed += 1;
        }

        if (pendingWrites.length >= WRITE_BATCH_SIZE) {
          flushWrites();
        }

        if (completed % PROGRESS_INTERVAL === 0) {
          console.log(`   Processed ${completed}/${targetIds.length} artworks...`);
        }

        sendNextTask(worker);
      });

      worker.on("error", (error) => {
        fail(error);
      });

      worker.on("exit", (code) => {
        activeWorkers -= 1;
        if (!settled && code !== 0) {
          fail(new Error(`Worker exited with code ${code}`));
          return;
        }
        if (!settled && activeWorkers === 0) {
          complete();
        }
      });
    }
  });

  console.log(`✅ Rebuilt artwork_neighbors for ${refreshed} artworks (${skipped} skipped)`);
}

function runWorker() {
  const config = workerData as WorkerConfig;
  const db = new Database(config.dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  db.pragma("query_only = ON");
  db.pragma("foreign_keys = OFF");
  sqliteVec.load(db);

  const getNeighbors = db.prepare(
    `SELECT
       map.artwork_id AS neighbor_id,
       v.distance AS distance
     FROM vec_artworks v
     JOIN vec_artwork_map map ON map.vec_rowid = v.rowid
     JOIN artworks a ON a.id = map.artwork_id
     WHERE v.embedding MATCH (
         SELECT embedding FROM clip_embeddings WHERE artwork_id = ?
       )
       AND k = ?
       AND map.artwork_id != ?
       AND a.iiif_url IS NOT NULL
       AND a.id NOT IN (SELECT artwork_id FROM broken_images)
     ORDER BY v.distance
     LIMIT ?`
  );

  parentPort?.on("message", (message: MainToWorkerMessage) => {
    if (message.type === "stop") {
      db.close();
      process.exit(0);
    }

    const artworkId = message.artworkId;
    try {
      const neighbors = getNeighbors.all(artworkId, config.k, artworkId, config.k) as NeighborRow[];
      const payload: NeighborResult = {
        artworkId,
        neighbors: neighbors.slice(0, config.neighborLimit),
        skipped: neighbors.length === 0,
      };
      const response: ResultMessage = { type: "result", payload };
      parentPort?.postMessage(response);
    } catch {
      const payload: NeighborResult = {
        artworkId,
        neighbors: [],
        skipped: true,
      };
      const response: ResultMessage = { type: "result", payload };
      parentPort?.postMessage(response);
    }
  });

  const ready: ReadyMessage = { type: "ready" };
  parentPort?.postMessage(ready);
}

async function runMain() {
  const args = process.argv.slice(2);
  const noWorkers = args.includes("--no-workers");
  const options = parseArgs();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  try {
    ensureRelatedTables(db);
    if (!options.neighborsOnly) {
      refreshArtworkArtists(db, options);
    }
    if (!options.artistsOnly) {
      if (noWorkers) {
        await rebuildArtworkNeighborsSingleThread(db, options);
      } else {
        await rebuildArtworkNeighbors(db, options);
      }
    }
  } finally {
    db.close();
  }
}

async function main() {
  if (isMainThread) {
    await runMain();
    return;
  }

  runWorker();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
