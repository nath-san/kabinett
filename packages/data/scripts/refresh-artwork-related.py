#!/usr/bin/env python3
from __future__ import annotations

import atexit
import dataclasses
import json
import math
import os
import re
import sqlite3
import sys
import time
import unicodedata
from dataclasses import dataclass
from multiprocessing import cpu_count, get_context, shared_memory
from pathlib import Path
from typing import Any

try:
    import numpy as np
except Exception as error:  # pragma: no cover - handled at runtime
    np = None  # type: ignore[assignment]
    _IMPORT_ERROR: Exception | None = error
else:
    _IMPORT_ERROR = None

DEFAULT_RECENT = 5000
DEFAULT_NEIGHBOR_LIMIT = 12
DEFAULT_K = 20
DEFAULT_WORKERS = 4

WRITE_BATCH_SIZE = 100
PROGRESS_INTERVAL = 250


def compat_dataclass(*args: Any, **kwargs: Any):
    if sys.version_info >= (3, 10):
        kwargs.setdefault("slots", True)
    return dataclasses.dataclass(*args, **kwargs)


@compat_dataclass
class CliOptions:
    artists_only: bool
    neighbors_only: bool
    all_artists: bool
    all_neighbors: bool
    recent: int
    neighbor_limit: int
    k: int
    workers: int
    ids: list[int]
    no_workers: bool


@compat_dataclass
class NeighborResult:
    artwork_id: int
    neighbors: list[tuple[int, float | None]]
    skipped: bool


@compat_dataclass
class EmbeddingState:
    artwork_ids: Any
    embeddings: Any
    candidate_mask: Any
    candidate_count: int
    index_by_artwork_id: dict[int, int] | None = None
    invalid_indices: Any = None


_WORKER_ARTWORK_IDS: Any = None
_WORKER_EMBEDDINGS: Any = None
_WORKER_CANDIDATE_MASK: Any = None
_WORKER_INVALID_INDICES: Any = None
_WORKER_CANDIDATE_COUNT = 0
_WORKER_K = 0
_WORKER_NEIGHBOR_LIMIT = 0
_WORKER_SHARED_MEMORY: list[shared_memory.SharedMemory] = []
_WORKER_STATE: EmbeddingState | None = None


def require_numpy() -> None:
    if _IMPORT_ERROR is None:
        return
    raise SystemExit(f"NumPy krävs för att uppdatera artwork_neighbors: {_IMPORT_ERROR}")


def using_numpy() -> bool:
    return np is not None and _IMPORT_ERROR is None


def resolve_db_path() -> Path:
    env_path = os.environ.get("DATABASE_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "kabinett.db").resolve()


def connect_db(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path))
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def normalize_artist_name(name: str) -> str:
    name = unicodedata.normalize("NFKD", name)
    name = "".join(char for char in name if not unicodedata.combining(char))
    name = name.lower()
    name = re.sub(r"[^a-z0-9]+", " ", name).strip()
    name = re.sub(r"\s+", " ", name)
    return name


def parse_ids(raw: str) -> list[int]:
    values: list[int] = []
    for part in raw.split(","):
        try:
            value = int(part.strip(), 10)
        except ValueError:
            continue
        if value > 0:
            values.append(value)
    return values


def parse_positive_int(raw: str | None, fallback: int) -> int:
    if not raw:
        return fallback
    try:
        value = int(raw, 10)
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def parse_args(argv: list[str]) -> CliOptions:
    detected_cpu_count = cpu_count() or 0
    artists_only = "--artists-only" in argv
    neighbors_only = "--neighbors-only" in argv
    all_artists = "--all-artists" in argv
    all_neighbors = "--all-neighbors" in argv
    no_workers = "--no-workers" in argv
    recent_arg = next((arg for arg in argv if arg.startswith("--recent=")), None)
    neighbor_limit_arg = next((arg for arg in argv if arg.startswith("--neighbor-limit=")), None)
    k_arg = next((arg for arg in argv if arg.startswith("--k=")), None)
    workers_arg = next((arg for arg in argv if arg.startswith("--workers=")), None)
    ids_arg = next((arg for arg in argv if arg.startswith("--ids=")), None)
    return CliOptions(
        artists_only=artists_only,
        neighbors_only=neighbors_only,
        all_artists=all_artists,
        all_neighbors=all_neighbors,
        recent=parse_positive_int(recent_arg.split("=", 1)[1] if recent_arg else None, DEFAULT_RECENT),
        neighbor_limit=parse_positive_int(
            neighbor_limit_arg.split("=", 1)[1] if neighbor_limit_arg else None,
            DEFAULT_NEIGHBOR_LIMIT,
        ),
        k=parse_positive_int(k_arg.split("=", 1)[1] if k_arg else None, DEFAULT_K),
        workers=parse_positive_int(
            workers_arg.split("=", 1)[1] if workers_arg else None,
            detected_cpu_count if detected_cpu_count > 0 else DEFAULT_WORKERS,
        ),
        ids=parse_ids(ids_arg.split("=", 1)[1] if ids_arg else ""),
        no_workers=no_workers,
    )


def ensure_related_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
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
        """
    )


def parse_artists(raw: str | None) -> list[tuple[str, str, int]]:
    try:
        parsed = json.loads(raw or "[]")
    except Exception:
        parsed = []
    if not isinstance(parsed, list) or not parsed:
        return []
    names: list[tuple[str, str, int]] = []
    seen: set[str] = set()
    for index, item in enumerate(parsed):
        if not isinstance(item, dict):
            continue
        candidate = item.get("name")
        if not isinstance(candidate, str):
            continue
        candidate = candidate.strip()
        if not candidate:
            continue
        normalized = normalize_artist_name(candidate)
        if not normalized or normalized in seen:
            continue
        names.append((candidate, normalized, index))
        seen.add(normalized)
    return names


def rebuild_artwork_artists(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        SELECT id, artists FROM artworks
        WHERE artists IS NOT NULL AND artists != ''
        """
    ).fetchall()

    inserted = 0
    with connection:
        connection.execute("DELETE FROM artwork_artists")
        for artwork_id, artists in rows:
            for artist_name, artist_name_norm, position in parse_artists(artists):
                connection.execute(
                    """
                    INSERT OR REPLACE INTO artwork_artists
                      (artwork_id, artist_name, artist_name_norm, position)
                    VALUES (?, ?, ?, ?)
                    """,
                    (artwork_id, artist_name, artist_name_norm, position),
                )
                inserted += 1

    print(f"✅ Byggde om artwork_artists ({inserted} rader)")


def select_recent_ids(connection: sqlite3.Connection, recent: int) -> list[int]:
    rows = connection.execute(
        """
        SELECT id
        FROM artworks
        WHERE artists IS NOT NULL AND artists != ''
        ORDER BY
          COALESCE(last_updated, CAST(strftime('%s', synced_at) AS INTEGER), 0) DESC,
          id DESC
        LIMIT ?
        """,
        (recent,),
    ).fetchall()
    return [int(row[0]) for row in rows]


def upsert_artists_for_ids(connection: sqlite3.Connection, ids: list[int]) -> None:
    if not ids:
        print("ℹ️ Inga artwork-id att uppdatera i artwork_artists")
        return

    inserted = 0
    with connection:
        for artwork_id in ids:
            connection.execute("DELETE FROM artwork_artists WHERE artwork_id = ?", (artwork_id,))
            row = connection.execute(
                """
                SELECT id, artists
                FROM artworks
                WHERE id = ?
                  AND artists IS NOT NULL
                  AND artists != ''
                """,
                (artwork_id,),
            ).fetchone()
            if row is None:
                continue
            for artist_name, artist_name_norm, position in parse_artists(row[1]):
                connection.execute(
                    """
                    INSERT OR REPLACE INTO artwork_artists
                      (artwork_id, artist_name, artist_name_norm, position)
                    VALUES (?, ?, ?, ?)
                    """,
                    (row[0], artist_name, artist_name_norm, position),
                )
                inserted += 1

    print(f"✅ Uppdaterade artwork_artists för {len(ids)} verk ({inserted} rader)")


def refresh_artwork_artists(connection: sqlite3.Connection, options: CliOptions) -> None:
    if options.all_artists:
        rebuild_artwork_artists(connection)
        return

    existing_count = connection.execute("SELECT COUNT(*) as c FROM artwork_artists").fetchone()[0]
    if existing_count == 0:
        rebuild_artwork_artists(connection)
        return

    target_ids = options.ids if options.ids else select_recent_ids(connection, options.recent)
    upsert_artists_for_ids(connection, target_ids)


def collect_neighbor_artwork_ids(connection: sqlite3.Connection, options: CliOptions) -> list[int]:
    if options.ids:
        return options.ids

    if options.all_neighbors:
        rows = connection.execute(
            """
            SELECT a.id
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
            ORDER BY a.id
            """
        ).fetchall()
        return [int(row[0]) for row in rows]

    rows = connection.execute(
        """
        SELECT a.id
        FROM artworks a
        JOIN clip_embeddings c ON c.artwork_id = a.id
        WHERE a.iiif_url IS NOT NULL
          AND LENGTH(a.iiif_url) > 40
          AND a.id NOT IN (SELECT artwork_id FROM broken_images)
        ORDER BY COALESCE(a.last_updated, 0) DESC, a.id DESC
        LIMIT ?
        """,
        (options.recent,),
    ).fetchall()
    return [int(row[0]) for row in rows]


def load_embedding_state(connection: sqlite3.Connection) -> EmbeddingState:
    rows = connection.execute(
        """
        SELECT
          c.artwork_id,
          c.embedding,
          CASE
            WHEN a.id IS NOT NULL
              AND a.iiif_url IS NOT NULL
              AND a.id NOT IN (SELECT artwork_id FROM broken_images)
            THEN 1 ELSE 0
          END AS is_candidate
        FROM clip_embeddings c
        LEFT JOIN artworks a ON a.id = c.artwork_id
        ORDER BY c.artwork_id
        """
    )

    artwork_ids: list[int] = []
    vectors: list[Any] = []
    candidate_mask: list[bool] = []
    dimension: int | None = None

    for artwork_id, blob, is_candidate in rows:
        if blob is None:
            continue
        if using_numpy():
            vector = np.frombuffer(blob, dtype=np.float32)
            if vector.size == 0:
                continue
            if dimension is None:
                dimension = int(vector.size)
            if vector.size != dimension:
                continue
        else:
            if len(blob) % 4 != 0:
                continue
            vector = tuple(memoryview(blob).cast("f"))
            if not vector:
                continue
            if dimension is None:
                dimension = len(vector)
            if len(vector) != dimension:
                continue
        artwork_ids.append(int(artwork_id))
        if using_numpy():
            vectors.append(np.array(vector, dtype=np.float32, copy=True))
        else:
            vectors.append(vector)
        candidate_mask.append(bool(is_candidate))

    if not vectors:
        if using_numpy():
            return EmbeddingState(
                artwork_ids=np.empty((0,), dtype=np.int64),
                embeddings=np.empty((0, 0), dtype=np.float32),
                candidate_mask=np.empty((0,), dtype=np.bool_),
                candidate_count=0,
                index_by_artwork_id={},
                invalid_indices=np.empty((0,), dtype=np.int64),
            )
        return EmbeddingState(
            artwork_ids=[],
            embeddings=[],
            candidate_mask=[],
            candidate_count=0,
            index_by_artwork_id={},
            invalid_indices=[],
        )

    if using_numpy():
        artwork_id_array = np.asarray(artwork_ids, dtype=np.int64)
        embedding_matrix = np.vstack(vectors).astype(np.float32, copy=False)
        candidate_mask_array = np.asarray(candidate_mask, dtype=np.bool_)
        return EmbeddingState(
            artwork_ids=artwork_id_array,
            embeddings=embedding_matrix,
            candidate_mask=candidate_mask_array,
            candidate_count=int(np.count_nonzero(candidate_mask_array)),
            index_by_artwork_id={int(artwork_id): index for index, artwork_id in enumerate(artwork_id_array.tolist())},
            invalid_indices=np.flatnonzero(~candidate_mask_array),
        )

    return EmbeddingState(
        artwork_ids=artwork_ids,
        embeddings=vectors,
        candidate_mask=candidate_mask,
        candidate_count=sum(1 for value in candidate_mask if value),
        index_by_artwork_id={artwork_id: index for index, artwork_id in enumerate(artwork_ids)},
        invalid_indices=[index for index, is_candidate in enumerate(candidate_mask) if not is_candidate],
    )


def format_progress(completed: int, total: int, started_at: float) -> str:
    elapsed = max(time.monotonic() - started_at, 1e-9)
    rate = completed / elapsed
    remaining = max(total - completed, 0)
    eta_seconds = int(round(remaining / rate)) if rate > 0 else 0
    eta_minutes = eta_seconds // 60
    eta_hours = eta_minutes // 60
    eta_string = f"{eta_hours}h {eta_minutes % 60}m" if eta_hours > 0 else f"{eta_minutes}m"
    percentage = (completed / total * 100.0) if total > 0 else 100.0
    return f"   {completed}/{total} ({percentage:.1f}%) — {rate:.0f} verk/s — ETA {eta_string}"


def compute_neighbors_for_id(
    artwork_id: int,
    artwork_ids: Any,
    embeddings: Any,
    candidate_mask: Any,
    invalid_indices: Any,
    candidate_count: int,
    k: int,
    neighbor_limit: int,
) -> NeighborResult:
    if not using_numpy():
        return compute_neighbors_for_id_without_numpy(
            artwork_id,
            artwork_ids,
            embeddings,
            candidate_mask,
            candidate_count,
            k,
            neighbor_limit,
        )

    if embeddings.shape[0] == 0 or candidate_count <= 0:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    position = int(np.searchsorted(artwork_ids, artwork_id))
    if position >= artwork_ids.size or int(artwork_ids[position]) != artwork_id:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    similarities = embeddings @ embeddings[position]
    if invalid_indices.size:
        similarities[invalid_indices] = -np.inf
    similarities[position] = -np.inf

    valid_count = candidate_count - (1 if bool(candidate_mask[position]) else 0)
    if valid_count <= 0:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    top_k = min(k, valid_count)
    if top_k <= 0:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    candidate_indices = np.argpartition(-similarities, top_k - 1)[:top_k]
    ordered_indices = candidate_indices[
        np.argsort(-similarities[candidate_indices], kind="stable")
    ]

    neighbors: list[tuple[int, float | None]] = []
    for index in ordered_indices:
        neighbor_index = int(index)
        similarity = float(similarities[neighbor_index])
        if not math.isfinite(similarity):
            continue
        neighbor_artwork_id = int(artwork_ids[neighbor_index])
        if neighbor_artwork_id == artwork_id:
            continue
        similarity = max(-1.0, min(1.0, similarity))
        distance = math.sqrt(max(2.0 - (2.0 * similarity), 0.0))
        neighbors.append((neighbor_artwork_id, distance))
        if len(neighbors) >= neighbor_limit:
            break

    return NeighborResult(
        artwork_id=artwork_id,
        neighbors=neighbors,
        skipped=len(neighbors) == 0,
    )


def compute_neighbors_for_id_without_numpy(
    artwork_id: int,
    artwork_ids: list[int],
    embeddings: list[tuple[float, ...]],
    candidate_mask: list[bool],
    candidate_count: int,
    k: int,
    neighbor_limit: int,
) -> NeighborResult:
    if not embeddings or candidate_count <= 0:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    try:
        position = artwork_ids.index(artwork_id)
    except ValueError:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    valid_count = candidate_count - (1 if candidate_mask[position] else 0)
    if valid_count <= 0:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    query = embeddings[position]
    scored: list[tuple[float, int]] = []
    for index, neighbor_id in enumerate(artwork_ids):
        if not candidate_mask[index] or neighbor_id == artwork_id:
            continue
        similarity = 0.0
        candidate = embeddings[index]
        for component, other_component in zip(query, candidate):
            similarity += component * other_component
        scored.append((similarity, neighbor_id))

    if not scored:
        return NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

    scored.sort(key=lambda item: (-item[0], item[1]))
    top_k = min(k, len(scored))
    neighbors: list[tuple[int, float | None]] = []
    for similarity, neighbor_id in scored[:top_k]:
        similarity = max(-1.0, min(1.0, float(similarity)))
        distance = math.sqrt(max(2.0 - (2.0 * similarity), 0.0))
        neighbors.append((neighbor_id, distance))
        if len(neighbors) >= neighbor_limit:
            break

    return NeighborResult(
        artwork_id=artwork_id,
        neighbors=neighbors,
        skipped=len(neighbors) == 0,
    )


def compute_neighbors_from_state(
    artwork_id: int,
    state: EmbeddingState,
    k: int,
    neighbor_limit: int,
) -> NeighborResult:
    return compute_neighbors_for_id(
        artwork_id,
        state.artwork_ids,
        state.embeddings,
        state.candidate_mask,
        state.invalid_indices,
        state.candidate_count,
        k,
        neighbor_limit,
    )


def write_neighbor_batch(connection: sqlite3.Connection, batch: list[NeighborResult]) -> None:
    if not batch:
        return
    with connection:
        for result in batch:
            if result.skipped or not result.neighbors:
                continue
            connection.execute("DELETE FROM artwork_neighbors WHERE artwork_id = ?", (result.artwork_id,))
            connection.executemany(
                """
                INSERT OR REPLACE INTO artwork_neighbors
                  (artwork_id, neighbor_artwork_id, rank, distance, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                """,
                [
                    (result.artwork_id, neighbor_id, index + 1, distance)
                    for index, (neighbor_id, distance) in enumerate(result.neighbors)
                ],
            )


def rebuild_artwork_neighbors_single_thread(
    connection: sqlite3.Connection,
    options: CliOptions,
) -> None:
    target_ids = collect_neighbor_artwork_ids(connection, options)
    if not target_ids:
        print("ℹ️ Inga artwork-id att uppdatera i artwork_neighbors")
        return

    neighbor_limit = max(options.neighbor_limit, 1)
    k = max(options.k, neighbor_limit)
    print(
        f"ℹ️ Uppdaterar grannar enkeltrådat (k={k}, limit={neighbor_limit}, {len(target_ids)} verk)"
    )
    if not using_numpy():
        print("ℹ️ NumPy saknas, använder en långsammare reservväg")

    state = load_embedding_state(connection)
    completed = 0
    refreshed = 0
    skipped = 0
    pending_writes: list[NeighborResult] = []
    started_at = time.monotonic()

    for artwork_id in target_ids:
        try:
            result = compute_neighbors_from_state(artwork_id, state, k, neighbor_limit)
        except Exception:
            result = NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)

        pending_writes.append(result)
        completed += 1
        if result.skipped or not result.neighbors:
            skipped += 1
        else:
            refreshed += 1

        if len(pending_writes) >= WRITE_BATCH_SIZE:
            write_neighbor_batch(connection, pending_writes)
            pending_writes.clear()

        if completed % PROGRESS_INTERVAL == 0:
            print(format_progress(completed, len(target_ids), started_at))

    if pending_writes:
        write_neighbor_batch(connection, pending_writes)

    print(f"✅ Byggde om artwork_neighbors för {refreshed} verk ({skipped} överhoppade)")


def create_shared_array(array: Any) -> tuple[shared_memory.SharedMemory, tuple[str, tuple[int, ...], str]]:
    contiguous = np.ascontiguousarray(array)
    shm = shared_memory.SharedMemory(create=True, size=contiguous.nbytes)
    shared_array = np.ndarray(contiguous.shape, dtype=contiguous.dtype, buffer=shm.buf)
    shared_array[...] = contiguous
    return shm, (shm.name, contiguous.shape, contiguous.dtype.str)


def close_worker_shared_memory() -> None:
    global _WORKER_SHARED_MEMORY
    for handle in _WORKER_SHARED_MEMORY:
        try:
            handle.close()
        except FileNotFoundError:
            pass
    _WORKER_SHARED_MEMORY = []


def init_worker(
    artwork_ids_spec: tuple[str, tuple[int, ...], str],
    embeddings_spec: tuple[str, tuple[int, ...], str],
    candidate_mask_spec: tuple[str, tuple[int, ...], str],
    candidate_count: int,
    k: int,
    neighbor_limit: int,
) -> None:
    global _WORKER_ARTWORK_IDS
    global _WORKER_EMBEDDINGS
    global _WORKER_CANDIDATE_MASK
    global _WORKER_INVALID_INDICES
    global _WORKER_CANDIDATE_COUNT
    global _WORKER_K
    global _WORKER_NEIGHBOR_LIMIT
    global _WORKER_SHARED_MEMORY

    close_worker_shared_memory()
    artwork_ids_shm = shared_memory.SharedMemory(name=artwork_ids_spec[0])
    embeddings_shm = shared_memory.SharedMemory(name=embeddings_spec[0])
    candidate_mask_shm = shared_memory.SharedMemory(name=candidate_mask_spec[0])
    _WORKER_SHARED_MEMORY = [artwork_ids_shm, embeddings_shm, candidate_mask_shm]
    _WORKER_ARTWORK_IDS = np.ndarray(
        artwork_ids_spec[1],
        dtype=np.dtype(artwork_ids_spec[2]),
        buffer=artwork_ids_shm.buf,
    )
    _WORKER_EMBEDDINGS = np.ndarray(
        embeddings_spec[1],
        dtype=np.dtype(embeddings_spec[2]),
        buffer=embeddings_shm.buf,
    )
    _WORKER_CANDIDATE_MASK = np.ndarray(
        candidate_mask_spec[1],
        dtype=np.dtype(candidate_mask_spec[2]),
        buffer=candidate_mask_shm.buf,
    )
    _WORKER_INVALID_INDICES = np.flatnonzero(~_WORKER_CANDIDATE_MASK)
    _WORKER_CANDIDATE_COUNT = candidate_count
    _WORKER_K = k
    _WORKER_NEIGHBOR_LIMIT = neighbor_limit
    atexit.register(close_worker_shared_memory)


def compute_neighbors_in_worker(artwork_id: int) -> NeighborResult:
    if _WORKER_STATE is not None:
        return compute_neighbors_from_state(artwork_id, _WORKER_STATE, _WORKER_K, _WORKER_NEIGHBOR_LIMIT)

    return compute_neighbors_for_id(
        artwork_id,
        _WORKER_ARTWORK_IDS,
        _WORKER_EMBEDDINGS,
        _WORKER_CANDIDATE_MASK,
        _WORKER_INVALID_INDICES,
        _WORKER_CANDIDATE_COUNT,
        _WORKER_K,
        _WORKER_NEIGHBOR_LIMIT,
    )


def init_worker_without_numpy(
    state: EmbeddingState,
    k: int,
    neighbor_limit: int,
) -> None:
    global _WORKER_STATE
    global _WORKER_K
    global _WORKER_NEIGHBOR_LIMIT

    _WORKER_STATE = state
    _WORKER_K = k
    _WORKER_NEIGHBOR_LIMIT = neighbor_limit


def rebuild_artwork_neighbors(connection: sqlite3.Connection, options: CliOptions) -> None:
    target_ids = collect_neighbor_artwork_ids(connection, options)
    if not target_ids:
        print("ℹ️ Inga artwork-id att uppdatera i artwork_neighbors")
        return

    neighbor_limit = max(options.neighbor_limit, 1)
    k = max(options.k, neighbor_limit)
    worker_count = max(1, min(options.workers, len(target_ids)))
    print(f"ℹ️ Uppdaterar grannar med {worker_count} processer (k={k}, limit={neighbor_limit})")
    if not using_numpy():
        print("ℹ️ NumPy saknas, använder en långsammare reservväg")

    state = load_embedding_state(connection)
    completed = 0
    refreshed = 0
    skipped = 0
    pending_writes: list[NeighborResult] = []
    started_at = time.monotonic()

    if state.candidate_count <= 0 or (using_numpy() and state.embeddings.shape[0] == 0) or (not using_numpy() and not state.embeddings):
        for artwork_id in target_ids:
            result = NeighborResult(artwork_id=artwork_id, neighbors=[], skipped=True)
            pending_writes.append(result)
            completed += 1
            skipped += 1
            if len(pending_writes) >= WRITE_BATCH_SIZE:
                write_neighbor_batch(connection, pending_writes)
                pending_writes.clear()
            if completed % PROGRESS_INTERVAL == 0:
                print(format_progress(completed, len(target_ids), started_at))
        if pending_writes:
            write_neighbor_batch(connection, pending_writes)
        print(f"✅ Byggde om artwork_neighbors för {refreshed} verk ({skipped} överhoppade)")
        return

    if not using_numpy():
        context = get_context("spawn")
        try:
            with context.Pool(
                processes=worker_count,
                initializer=init_worker_without_numpy,
                initargs=(state, k, neighbor_limit),
            ) as pool:
                for result in pool.imap_unordered(compute_neighbors_in_worker, target_ids, chunksize=1):
                    pending_writes.append(result)
                    completed += 1
                    if result.skipped or not result.neighbors:
                        skipped += 1
                    else:
                        refreshed += 1

                    if len(pending_writes) >= WRITE_BATCH_SIZE:
                        write_neighbor_batch(connection, pending_writes)
                        pending_writes.clear()

                    if completed % PROGRESS_INTERVAL == 0:
                        print(format_progress(completed, len(target_ids), started_at))
        except Exception:
            if pending_writes:
                write_neighbor_batch(connection, pending_writes)
                pending_writes.clear()
            raise

        if pending_writes:
            write_neighbor_batch(connection, pending_writes)

        print(f"✅ Byggde om artwork_neighbors för {refreshed} verk ({skipped} överhoppade)")
        return

    shared_handles: list[shared_memory.SharedMemory] = []
    try:
        artwork_ids_shm, artwork_ids_spec = create_shared_array(state.artwork_ids)
        embeddings_shm, embeddings_spec = create_shared_array(state.embeddings)
        candidate_mask_shm, candidate_mask_spec = create_shared_array(state.candidate_mask)
        shared_handles = [artwork_ids_shm, embeddings_shm, candidate_mask_shm]

        context = get_context("spawn")
        try:
            with context.Pool(
                processes=worker_count,
                initializer=init_worker,
                initargs=(
                    artwork_ids_spec,
                    embeddings_spec,
                    candidate_mask_spec,
                    state.candidate_count,
                    k,
                    neighbor_limit,
                ),
            ) as pool:
                for result in pool.imap_unordered(compute_neighbors_in_worker, target_ids, chunksize=1):
                    pending_writes.append(result)
                    completed += 1
                    if result.skipped or not result.neighbors:
                        skipped += 1
                    else:
                        refreshed += 1

                    if len(pending_writes) >= WRITE_BATCH_SIZE:
                        write_neighbor_batch(connection, pending_writes)
                        pending_writes.clear()

                    if completed % PROGRESS_INTERVAL == 0:
                        print(format_progress(completed, len(target_ids), started_at))
        except Exception:
            if pending_writes:
                write_neighbor_batch(connection, pending_writes)
                pending_writes.clear()
            raise
    finally:
        for handle in shared_handles:
            handle.close()
            handle.unlink()

    if pending_writes:
        write_neighbor_batch(connection, pending_writes)

    print(f"✅ Byggde om artwork_neighbors för {refreshed} verk ({skipped} överhoppade)")


def run_main() -> None:
    options = parse_args(sys.argv[1:])
    db_path = resolve_db_path()
    connection = connect_db(db_path)

    try:
        ensure_related_tables(connection)
        if not options.neighbors_only:
            refresh_artwork_artists(connection, options)
        if not options.artists_only:
            if options.no_workers:
                rebuild_artwork_neighbors_single_thread(connection, options)
            else:
                rebuild_artwork_neighbors(connection, options)
    finally:
        connection.close()


def main() -> None:
    run_main()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        raise SystemExit(1) from error
