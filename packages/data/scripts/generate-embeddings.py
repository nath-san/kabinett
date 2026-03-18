#!/usr/bin/env python3
# Requirements: pip install torch open_clip_torch Pillow aiohttp numpy
"""
Generate CLIP image embeddings and focal points for artworks.

Usage:
  pnpm embeddings:generate
  pnpm embeddings:generate --clean
  pnpm embeddings:generate:py
  pnpm embeddings:generate:py --clean
"""

from __future__ import annotations

import argparse
import asyncio
import io
import math
import os
import platform
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

try:
    import aiohttp
    import numpy as np
    import open_clip
    import torch
    from PIL import Image, ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    _IMPORT_ERROR: Exception | None = None
except Exception as error:  # pragma: no cover - handled at runtime
    aiohttp = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]
    open_clip = None  # type: ignore[assignment]
    torch = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]
    _IMPORT_ERROR = error

IMAGE_WIDTH = 400
BATCH_SIZE = 64
DOWNLOAD_CONCURRENCY = 32
FETCH_RETRIES = 1
FETCH_BACKOFF_MS = 500
NEIGHBOR_LIMIT = 12
NEIGHBOR_K = 48
SIZE_MAP = ((200, "thumbnail"), (400, "medium"), (math.inf, "medium"))


@dataclass(slots=True)
class ArtworkRow:
    artwork_id: int
    iiif_url: str


@dataclass(slots=True)
class DownloadedImage:
    artwork_id: int
    image_bytes: bytes


@dataclass(slots=True)
class FailureRecord:
    artwork_id: int
    message: str


@dataclass(slots=True)
class EmbeddingWrite:
    artwork_id: int
    embedding_bytes: bytes
    focal_x: float
    focal_y: float


@dataclass(slots=True)
class VecState:
    extension_loaded: bool
    tables_ready: bool


@dataclass(slots=True)
class ProcessingStats:
    processed: int
    failed: int
    processed_ids: list[int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--clean", action="store_true")
    parser.add_argument("--skip-neighbors-refresh", action="store_true")
    return parser.parse_args()


def require_runtime_dependencies() -> None:
    if _IMPORT_ERROR is None:
        return
    raise SystemExit(
        "Missing Python dependencies. Install with: "
        "pip install torch open_clip_torch Pillow aiohttp numpy"
    )


def resolve_db_path() -> Path:
    env_path = os.environ.get("DATABASE_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "kabinett.db").resolve()


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def connect_db(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path))
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    return connection


def ensure_artwork_column(connection: sqlite3.Connection, column: str, definition: str) -> None:
    try:
        connection.execute(f"ALTER TABLE artworks ADD COLUMN {column} {definition}")
    except sqlite3.OperationalError as error:
        message = str(error).lower()
        if "duplicate column name" not in message:
            raise


def init_db(connection: sqlite3.Connection) -> None:
    ensure_artwork_column(connection, "focal_x", "REAL DEFAULT 0.5")
    ensure_artwork_column(connection, "focal_y", "REAL DEFAULT 0.5")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS broken_images (
          artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS clip_embeddings (
          artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id),
          embedding BLOB
        );
        CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
        CREATE TABLE IF NOT EXISTS artwork_neighbors (
          artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
          neighbor_artwork_id INTEGER NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
          rank INTEGER NOT NULL,
          distance REAL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (artwork_id, rank),
          UNIQUE (artwork_id, neighbor_artwork_id)
        );
        CREATE INDEX IF NOT EXISTS idx_artwork_neighbors_artwork ON artwork_neighbors(artwork_id, rank);
        """
    )
    connection.commit()


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.5
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def should_retry_status(status: int) -> bool:
    return status == 429 or status >= 500


async def fetch_with_retry(session: aiohttp.ClientSession, url: str, retries: int = FETCH_RETRIES) -> bytes:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            async with session.get(url, allow_redirects=True) as response:
                if 200 <= response.status < 300:
                    return await response.read()
                error = RuntimeError(f"HTTP {response.status}")
                if not should_retry_status(response.status):
                    raise error
                last_error = error
        except Exception as error:
            last_error = error
            retryable_http = False
            if isinstance(error, RuntimeError) and str(error).startswith("HTTP "):
                try:
                    retryable_http = should_retry_status(int(str(error).split()[1]))
                except Exception:
                    retryable_http = False
            if attempt == retries or (isinstance(error, RuntimeError) and not retryable_http):
                raise
        if attempt < retries:
            await asyncio.sleep((FETCH_BACKOFF_MS / 1000) * (2 ** attempt))
    if last_error is not None:
        raise last_error
    raise RuntimeError("fetch_with_retry: all retries failed")


def external_image_url(iiif_or_direct: str, width: int) -> str:
    normalized = iiif_or_direct.replace("http://", "https://")
    shm_match = re.search(r"/(thumb|thumbnail|medium|full)(\?.*)?$", normalized)
    if shm_match:
        target = next((item[1] for item in SIZE_MAP if width <= item[0]), "full")
        return re.sub(r"/(thumb|thumbnail|medium|full)(\?.*)?$", rf"/{target}\2", normalized)
    if "ems.dimu.org" in normalized:
        return re.sub(r"dimension=\d+x\d+", f"dimension={width}x{width}", normalized)
    iiif_base = normalized if normalized.endswith("/") else f"{normalized}/"
    return f"{iiif_base}full/{width},/0/default.jpg"


def normalize_vector(vector: np.ndarray) -> np.ndarray:
    array = np.asarray(vector, dtype=np.float32)
    denom = float(np.linalg.norm(array))
    if not math.isfinite(denom) or denom == 0:
        denom = 1.0
    return array / denom


def compute_focal_point_from_image(image: Image.Image) -> tuple[float, float]:
    width, height = image.size
    if width <= 0 or height <= 0:
        return 0.5, 0.5
    grayscale = image.convert("L")
    values = np.asarray(grayscale, dtype=np.float32)
    if values.ndim != 2 or values.size == 0:
        return 0.5, 0.5
    padded = np.pad(values, 1, mode="edge")
    grad_x = (
        -padded[:-2, :-2]
        + padded[:-2, 2:]
        - (2 * padded[1:-1, :-2])
        + (2 * padded[1:-1, 2:])
        - padded[2:, :-2]
        + padded[2:, 2:]
    )
    grad_y = (
        padded[:-2, :-2]
        + (2 * padded[:-2, 1:-1])
        + padded[:-2, 2:]
        - padded[2:, :-2]
        - (2 * padded[2:, 1:-1])
        - padded[2:, 2:]
    )
    edge_map = np.hypot(grad_x, grad_y)
    total_weight = float(edge_map.sum())
    if not math.isfinite(total_weight) or total_weight <= 1e-6:
        return 0.5, 0.5
    x_weights = edge_map.sum(axis=0)
    y_weights = edge_map.sum(axis=1)
    x_positions = (np.arange(width, dtype=np.float32) + 0.5) / max(width, 1)
    y_positions = (np.arange(height, dtype=np.float32) + 0.5) / max(height, 1)
    focal_x = float(np.dot(x_weights, x_positions) / total_weight)
    focal_y = float(np.dot(y_weights, y_positions) / total_weight)
    return clamp01(focal_x), clamp01(focal_y)


def prepare_downloaded_images(downloads: list[DownloadedImage], preprocess: Any) -> tuple[list[tuple[int, float, float, torch.Tensor]], list[FailureRecord]]:
    prepared: list[tuple[int, float, float, torch.Tensor]] = []
    failures: list[FailureRecord] = []
    for item in downloads:
        try:
            with Image.open(io.BytesIO(item.image_bytes)) as image:
                focal_x, focal_y = compute_focal_point_from_image(image)
                tensor = preprocess(image.convert("RGB"))
            prepared.append((item.artwork_id, focal_x, focal_y, tensor))
        except Exception as error:
            message = str(error).strip() or error.__class__.__name__
            failures.append(FailureRecord(item.artwork_id, message))
    return prepared, failures


async def build_embedding_writes(
    downloads: list[DownloadedImage],
    preprocess: Any,
    model: Any,
    device: torch.device,
) -> tuple[list[EmbeddingWrite], list[FailureRecord]]:
    prepared, failures = await asyncio.to_thread(prepare_downloaded_images, downloads, preprocess)
    if not prepared:
        return [], failures
    try:
        batch = torch.stack([item[3] for item in prepared], dim=0).to(device)
        with torch.inference_mode():
            features = model.encode_image(batch)
        feature_rows = features.detach().cpu().numpy().astype(np.float32, copy=False)
    except Exception as error:
        message = str(error).strip() or error.__class__.__name__
        failed_ids = {failure.artwork_id for failure in failures}
        batch_failures = [
            FailureRecord(artwork_id=item[0], message=message)
            for item in prepared
            if item[0] not in failed_ids
        ]
        return [], failures + batch_failures
    writes: list[EmbeddingWrite] = []
    for index, prepared_item in enumerate(prepared):
        artwork_id, focal_x, focal_y, _ = prepared_item
        embedding = normalize_vector(feature_rows[index]).tobytes()
        writes.append(
            EmbeddingWrite(
                artwork_id=artwork_id,
                embedding_bytes=embedding,
                focal_x=focal_x,
                focal_y=focal_y,
            )
        )
    return writes, failures


def scalar_count(connection: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> int:
    row = connection.execute(sql, tuple(params)).fetchone()
    return int(row[0]) if row else 0


def load_rows_to_embed(connection: sqlite3.Connection) -> list[ArtworkRow]:
    rows = connection.execute(
        """
        SELECT a.id, a.iiif_url
        FROM artworks a
        LEFT JOIN clip_embeddings c ON c.artwork_id = a.id
        WHERE a.iiif_url IS NOT NULL
          AND LENGTH(a.iiif_url) > 40
          AND c.artwork_id IS NULL
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        ORDER BY CASE a.source WHEN 'nordiska' THEN 0 WHEN 'nationalmuseum' THEN 1 ELSE 2 END, a.id
        """
    ).fetchall()
    return [ArtworkRow(artwork_id=int(row[0]), iiif_url=str(row[1])) for row in rows]


def table_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM sqlite_master
        WHERE type IN ('table', 'view')
          AND name = ?
        """,
        (name,),
    ).fetchone()
    return row is not None


def detect_platform_package_names() -> list[str]:
    system = platform.system().lower()
    machine = platform.machine().lower()
    machine = {"x86_64": "x64", "amd64": "x64", "aarch64": "arm64"}.get(machine, machine)
    names = ["sqlite-vec"]
    if system == "darwin":
        names.insert(0, f"sqlite-vec-darwin-{machine}")
    elif system == "linux":
        names.insert(0, f"sqlite-vec-linux-{machine}")
    elif system == "windows":
        names.insert(0, f"sqlite-vec-windows-{machine}")
    return names


def find_extension_files(package_dir: Path) -> list[Path]:
    if not package_dir.exists():
        return []
    candidates = [
        path
        for path in package_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in {".dylib", ".so", ".dll"}
    ]
    candidates = [path for path in candidates if "vec" in path.name.lower() or "sqlite" in path.name.lower()]
    return sorted(
        candidates,
        key=lambda path: (
            0 if "vec0" in path.name.lower() else 1,
            0 if "sqlite" in path.name.lower() else 1,
            len(str(path)),
        ),
    )


def iter_sqlite_vec_candidates() -> list[Path]:
    env_path = os.environ.get("SQLITE_VEC_PATH")
    if env_path:
        raw_path = Path(env_path).expanduser()
        if raw_path.is_file():
            return [raw_path.resolve()]
        if raw_path.is_dir():
            files = find_extension_files(raw_path)
            if files:
                return files
    roots = [repo_root() / "node_modules", Path(__file__).resolve().parents[1] / "node_modules", Path.cwd() / "node_modules"]
    package_names = detect_platform_package_names()
    found: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        if not root.exists():
            continue
        pnpm_root = root / ".pnpm"
        for package_name in package_names:
            direct = root / package_name
            for candidate in find_extension_files(direct):
                resolved = candidate.resolve()
                if resolved not in seen:
                    seen.add(resolved)
                    found.append(resolved)
            if pnpm_root.exists():
                for package_dir in pnpm_root.glob(f"{package_name}@*/node_modules/{package_name}"):
                    for candidate in find_extension_files(package_dir):
                        resolved = candidate.resolve()
                        if resolved not in seen:
                            seen.add(resolved)
                            found.append(resolved)
    return found


def try_load_sqlite_vec(connection: sqlite3.Connection) -> bool:
    try:
        connection.enable_load_extension(True)
    except Exception:
        return False
    try:
        try:
            import sqlite_vec  # type: ignore[import-not-found]

            sqlite_vec.load(connection)
            return True
        except Exception:
            pass
        for candidate in iter_sqlite_vec_candidates():
            try:
                connection.load_extension(str(candidate))
                return True
            except Exception:
                continue
        return False
    finally:
        try:
            connection.enable_load_extension(False)
        except Exception:
            pass


def prepare_vec_state(connection: sqlite3.Connection, clean_start: bool) -> VecState:
    extension_loaded = try_load_sqlite_vec(connection)
    tables_ready = extension_loaded and table_exists(connection, "vec_artworks") and table_exists(connection, "vec_artwork_map")
    if tables_ready and clean_start:
        with connection:
            connection.execute("DELETE FROM vec_artwork_map")
            connection.execute("DELETE FROM vec_artworks")
    return VecState(extension_loaded=extension_loaded, tables_ready=tables_ready)


def upsert_vec_rows(connection: sqlite3.Connection, writes: list[EmbeddingWrite]) -> None:
    if not writes:
        return
    ids = [write.artwork_id for write in writes]
    placeholders = ", ".join("?" for _ in ids)
    existing_rows = connection.execute(
        f"SELECT vec_rowid, artwork_id FROM vec_artwork_map WHERE artwork_id IN ({placeholders})",
        ids,
    ).fetchall()
    if existing_rows:
        connection.executemany("DELETE FROM vec_artworks WHERE rowid = ?", [(int(row[0]),) for row in existing_rows])
        connection.executemany("DELETE FROM vec_artwork_map WHERE artwork_id = ?", [(int(row[1]),) for row in existing_rows])
    for write in writes:
        cursor = connection.execute(
            "INSERT INTO vec_artworks (embedding) VALUES (?)",
            (sqlite3.Binary(write.embedding_bytes),),
        )
        rowid = int(cursor.lastrowid or 0)
        if rowid <= 0:
            raise RuntimeError(f"Failed to insert vec row for artwork {write.artwork_id}")
        connection.execute(
            "INSERT INTO vec_artwork_map (vec_rowid, artwork_id) VALUES (?, ?)",
            (rowid, write.artwork_id),
        )


def write_pending_changes(
    connection: sqlite3.Connection,
    writes: list[EmbeddingWrite],
    broken_ids: list[int],
    vec_state: VecState,
) -> None:
    if not writes and not broken_ids:
        return
    with connection:
        if broken_ids:
            connection.executemany(
                "INSERT OR IGNORE INTO broken_images (artwork_id) VALUES (?)",
                [(artwork_id,) for artwork_id in broken_ids],
            )
        for write in writes:
            connection.execute(
                "INSERT OR REPLACE INTO clip_embeddings (artwork_id, embedding) VALUES (?, ?)",
                (write.artwork_id, sqlite3.Binary(write.embedding_bytes)),
            )
            connection.execute(
                "UPDATE artworks SET focal_x = ?, focal_y = ? WHERE id = ?",
                (write.focal_x, write.focal_y, write.artwork_id),
            )
        if vec_state.tables_ready and writes:
            upsert_vec_rows(connection, writes)


def format_eta(seconds_remaining: float) -> str:
    if not math.isfinite(seconds_remaining) or seconds_remaining <= 0:
        return "0m"
    eta_seconds = int(round(seconds_remaining))
    eta_minutes = eta_seconds // 60
    eta_hours = eta_minutes // 60
    if eta_hours > 0:
        return f"{eta_hours}h {eta_minutes % 60}m"
    return f"{eta_minutes}m"


def log_progress(
    processed: int,
    total_remaining: int,
    failed: int,
    start_time: float,
    last_pct_logged: int,
) -> int:
    pct = "100.0" if total_remaining <= 0 else f"{(processed / total_remaining) * 100:.1f}"
    print(f"   {processed}/{total_remaining} ({pct}%) [{failed} failed]")
    pct_value = 100.0 if total_remaining <= 0 else (processed / total_remaining) * 100
    pct_whole = math.floor(pct_value)
    if pct_whole > last_pct_logged:
        elapsed = max(time.time() - start_time, 1e-6)
        rate = processed / elapsed if processed > 0 else 0.0
        eta_seconds = ((total_remaining - processed) / rate) if rate > 0 else 0.0
        now = datetime.now().strftime("%H:%M")
        print(
            f"   [{now}] {pct_whole}% — {processed}/{total_remaining} ({failed} failed) — {rate:.1f}/s — ETA {format_eta(eta_seconds)}"
        )
        return pct_whole
    return last_pct_logged


def failure_message(error: Exception) -> str:
    return str(error).strip() or error.__class__.__name__


async def download_worker(
    input_queue: asyncio.Queue[ArtworkRow | None],
    output_queue: asyncio.Queue[DownloadedImage | FailureRecord | None],
    session: aiohttp.ClientSession,
) -> None:
    while True:
        row = await input_queue.get()
        if row is None:
            await output_queue.put(None)
            return
        try:
            image_bytes = await fetch_with_retry(session, external_image_url(row.iiif_url, IMAGE_WIDTH))
            await output_queue.put(DownloadedImage(artwork_id=row.artwork_id, image_bytes=image_bytes))
        except Exception as error:
            await output_queue.put(FailureRecord(artwork_id=row.artwork_id, message=failure_message(error)))


async def process_rows(
    rows: list[ArtworkRow],
    connection: sqlite3.Connection,
    preprocess: Any,
    model: Any,
    device: torch.device,
    total_remaining: int,
    vec_state: VecState,
) -> ProcessingStats:
    input_queue: asyncio.Queue[ArtworkRow | None] = asyncio.Queue()
    output_queue: asyncio.Queue[DownloadedImage | FailureRecord | None] = asyncio.Queue(maxsize=BATCH_SIZE * 2)
    for row in rows:
        await input_queue.put(row)
    for _ in range(DOWNLOAD_CONCURRENCY):
        await input_queue.put(None)

    connector = aiohttp.TCPConnector(limit=DOWNLOAD_CONCURRENCY, limit_per_host=DOWNLOAD_CONCURRENCY)
    timeout = aiohttp.ClientTimeout(total=60)

    processed = 0
    failed = 0
    processed_ids: list[int] = []
    pending_downloads: list[DownloadedImage] = []
    pending_broken_ids: list[int] = []
    last_pct_logged = -1
    results_since_log = 0
    failure_samples: list[FailureRecord] = []
    start_time = time.time()

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        workers = [
            asyncio.create_task(download_worker(input_queue, output_queue, session))
            for _ in range(DOWNLOAD_CONCURRENCY)
        ]
        finished_workers = 0
        while finished_workers < DOWNLOAD_CONCURRENCY:
            result = await output_queue.get()
            if result is None:
                finished_workers += 1
                continue
            results_since_log += 1
            if isinstance(result, FailureRecord):
                failed += 1
                pending_broken_ids.append(result.artwork_id)
                if len(failure_samples) < 10:
                    failure_samples.append(result)
                    print(f"   ⚠️  Failed {result.artwork_id}: {result.message}")
            else:
                pending_downloads.append(result)
            if len(pending_downloads) >= BATCH_SIZE:
                writes, batch_failures = await build_embedding_writes(pending_downloads[:BATCH_SIZE], preprocess, model, device)
                pending_downloads = pending_downloads[BATCH_SIZE:]
                if batch_failures:
                    failed += len(batch_failures)
                    pending_broken_ids.extend(failure.artwork_id for failure in batch_failures)
                    for failure in batch_failures:
                        if len(failure_samples) < 10:
                            failure_samples.append(failure)
                            print(f"   ⚠️  Failed {failure.artwork_id}: {failure.message}")
                if writes:
                    processed += len(writes)
                    processed_ids.extend(write.artwork_id for write in writes)
                write_pending_changes(connection, writes, pending_broken_ids, vec_state)
                pending_broken_ids.clear()
                last_pct_logged = log_progress(processed, total_remaining, failed, start_time, last_pct_logged)
                results_since_log = 0
            elif results_since_log >= DOWNLOAD_CONCURRENCY:
                write_pending_changes(connection, [], pending_broken_ids, vec_state)
                pending_broken_ids.clear()
                last_pct_logged = log_progress(processed, total_remaining, failed, start_time, last_pct_logged)
                results_since_log = 0
        await asyncio.gather(*workers)

    if pending_downloads or pending_broken_ids:
        writes, batch_failures = await build_embedding_writes(pending_downloads, preprocess, model, device)
        if batch_failures:
            failed += len(batch_failures)
            pending_broken_ids.extend(failure.artwork_id for failure in batch_failures)
            for failure in batch_failures:
                if len(failure_samples) < 10:
                    failure_samples.append(failure)
                    print(f"   ⚠️  Failed {failure.artwork_id}: {failure.message}")
        if writes:
            processed += len(writes)
            processed_ids.extend(write.artwork_id for write in writes)
        write_pending_changes(connection, writes, pending_broken_ids, vec_state)
        last_pct_logged = log_progress(processed, total_remaining, failed, start_time, last_pct_logged)

    return ProcessingStats(processed=processed, failed=failed, processed_ids=processed_ids)


def vec_index_matches_clip_embeddings(connection: sqlite3.Connection) -> bool:
    if not table_exists(connection, "vec_artwork_map"):
        return False
    clip_count = scalar_count(connection, "SELECT COUNT(*) FROM clip_embeddings")
    vec_count = scalar_count(connection, "SELECT COUNT(*) FROM vec_artwork_map")
    return clip_count > 0 and clip_count == vec_count


def refresh_neighbors_for_ids_with_vec(connection: sqlite3.Connection, artwork_ids: list[int]) -> None:
    if not artwork_ids:
        return
    unique_ids = list(dict.fromkeys(artwork_ids))
    refreshed = 0
    with connection:
        for artwork_id in unique_ids:
            try:
                rows = connection.execute(
                    """
                    SELECT map.artwork_id AS neighbor_id,
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
                    LIMIT ?
                    """,
                    (artwork_id, NEIGHBOR_K, artwork_id, NEIGHBOR_LIMIT * 3),
                ).fetchall()
            except sqlite3.Error:
                continue
            if not rows:
                continue
            connection.execute("DELETE FROM artwork_neighbors WHERE artwork_id = ?", (artwork_id,))
            limited_rows = rows[:NEIGHBOR_LIMIT]
            connection.executemany(
                """
                INSERT OR REPLACE INTO artwork_neighbors
                  (artwork_id, neighbor_artwork_id, rank, distance, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                """,
                [
                    (artwork_id, int(row[0]), index + 1, row[1])
                    for index, row in enumerate(limited_rows)
                ],
            )
            refreshed += 1
    print(f"   Refreshed neighbors for {refreshed}/{len(unique_ids)} artworks")


def refresh_neighbors_for_ids_with_numpy(connection: sqlite3.Connection, artwork_ids: list[int]) -> None:
    if not artwork_ids:
        return
    unique_ids = list(dict.fromkeys(artwork_ids))
    rows = connection.execute(
        """
        SELECT c.artwork_id, c.embedding
        FROM clip_embeddings c
        JOIN artworks a ON a.id = c.artwork_id
        WHERE a.iiif_url IS NOT NULL
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        ORDER BY c.artwork_id
        """
    ).fetchall()
    artwork_id_list: list[int] = []
    vectors: list[np.ndarray] = []
    for artwork_id, blob in rows:
        if blob is None:
            continue
        vector = np.frombuffer(blob, dtype=np.float32)
        if vector.size != 512:
            continue
        artwork_id_list.append(int(artwork_id))
        vectors.append(vector.astype(np.float32, copy=False))
    if not vectors:
        print(f"   Refreshed neighbors for 0/{len(unique_ids)} artworks")
        return
    matrix = np.vstack(vectors)
    id_to_index = {artwork_id: index for index, artwork_id in enumerate(artwork_id_list)}
    refreshed = 0
    with connection:
        for artwork_id in unique_ids:
            query_index = id_to_index.get(artwork_id)
            if query_index is None:
                continue
            query = matrix[query_index]
            deltas = matrix - query
            distances = np.sqrt(np.maximum(np.sum(deltas * deltas, axis=1), 0.0))
            if distances.size <= 1:
                continue
            top_k = min(NEIGHBOR_LIMIT * 3 + 1, distances.size)
            candidate_indices = np.argpartition(distances, top_k - 1)[:top_k]
            ordered_indices = candidate_indices[np.argsort(distances[candidate_indices], kind="stable")]
            neighbor_rows: list[tuple[int, int, int, float]] = []
            rank = 0
            for index in ordered_indices:
                neighbor_id = artwork_id_list[int(index)]
                if neighbor_id == artwork_id:
                    continue
                rank += 1
                neighbor_rows.append((artwork_id, neighbor_id, rank, float(distances[int(index)])))
                if rank >= NEIGHBOR_LIMIT:
                    break
            if not neighbor_rows:
                continue
            connection.execute("DELETE FROM artwork_neighbors WHERE artwork_id = ?", (artwork_id,))
            connection.executemany(
                """
                INSERT OR REPLACE INTO artwork_neighbors
                  (artwork_id, neighbor_artwork_id, rank, distance, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                """,
                neighbor_rows,
            )
            refreshed += 1
    print(f"   Refreshed neighbors for {refreshed}/{len(unique_ids)} artworks")


async def run() -> None:
    args = parse_args()
    require_runtime_dependencies()

    db_path = resolve_db_path()

    print("\n🎨 Kabinett CLIP + Focal Point Generation")
    print(f"   Database: {db_path}")
    print(f"   Mode: {'clean' if args.clean else 'incremental'}")

    connection = connect_db(db_path)
    try:
        init_db(connection)

        if args.clean:
            connection.executescript(
                """
                DROP TABLE IF EXISTS clip_embeddings;
                CREATE TABLE clip_embeddings (
                  artwork_id INTEGER PRIMARY KEY REFERENCES artworks(id),
                  embedding BLOB
                );
                CREATE INDEX IF NOT EXISTS idx_clip_embeddings_artwork ON clip_embeddings(artwork_id);
                """
            )
            connection.execute("UPDATE artworks SET focal_x = 0.5, focal_y = 0.5")
            connection.commit()

        total_with_images = scalar_count(
            connection,
            """
            SELECT COUNT(*)
            FROM artworks a
            WHERE a.iiif_url IS NOT NULL
              AND LENGTH(a.iiif_url) > 40
              AND a.id NOT IN (SELECT artwork_id FROM broken_images)
            """,
        )
        already_embedded = scalar_count(
            connection,
            """
            SELECT COUNT(*)
            FROM artworks a
            JOIN clip_embeddings c ON c.artwork_id = a.id
            WHERE a.iiif_url IS NOT NULL
              AND LENGTH(a.iiif_url) > 40
              AND a.id NOT IN (SELECT artwork_id FROM broken_images)
            """,
        )
        total_remaining = max(total_with_images - already_embedded, 0)

        print(f"   Total images: {total_with_images}")
        print(f"   Already embedded: {already_embedded}")
        print(f"   Remaining: {total_remaining}\n")

        if total_remaining == 0:
            print("✅ All artworks already have embeddings.")
            return

        print("   Loading CLIP vision model...")
        device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
        model, _, preprocess = open_clip.create_model_and_transforms(
            "ViT-B-32",
            pretrained="openai",
            precision="fp32",
        )
        model.eval()
        model.to(device)
        print("   Model loaded!\n")

        vec_state = prepare_vec_state(connection, args.clean)

        print("   Collecting artwork IDs to embed...")
        rows = load_rows_to_embed(connection)
        print(f"   Found {len(rows)} artworks to embed\n")

        stats = await process_rows(rows, connection, preprocess, model, device, total_remaining, vec_state)

        if not args.clean and not args.skip_neighbors_refresh:
            print("\n   Refreshing related neighbors for newly embedded artworks...")
            if vec_state.tables_ready and vec_index_matches_clip_embeddings(connection):
                refresh_neighbors_for_ids_with_vec(connection, stats.processed_ids)
            else:
                refresh_neighbors_for_ids_with_numpy(connection, stats.processed_ids)

        print(f"\n✅ Done. Embedded {stats.processed} artworks. ({stats.failed} failed)")
    finally:
        connection.close()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:
        print("\n❌ Embedding generation failed.")
        print(error)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
