#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import dataclasses
import io
import os
import sqlite3
import sys
import time
from pathlib import Path

try:
    import aiohttp
    from PIL import Image, ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    _IMPORT_ERROR: Exception | None = None
except Exception as error:  # pragma: no cover - handled at runtime
    aiohttp = None  # type: ignore[assignment]
    Image = None  # type: ignore[assignment]
    ImageFile = None  # type: ignore[assignment]
    _IMPORT_ERROR = error

BATCH_SIZE = 500
DOWNLOAD_CONCURRENCY = 64
FETCH_RETRIES = 3
FETCH_BACKOFF_MS = 500
CONNECT_TIMEOUT_SECONDS = 10
REQUEST_TIMEOUT_SECONDS = 30

SELECT_ARTWORKS_QUERY = """
SELECT id, iiif_url, source
FROM artworks
WHERE dominant_color IS NULL
  AND iiif_url IS NOT NULL
ORDER BY id ASC
"""

UPDATE_ARTWORK_QUERY = """
UPDATE artworks
SET dominant_color = ?,
    color_r = ?,
    color_g = ?,
    color_b = ?
WHERE id = ?
"""


def compat_dataclass(*args: object, **kwargs: object):
    if sys.version_info >= (3, 10):
        kwargs.setdefault("slots", True)
    return dataclasses.dataclass(*args, **kwargs)


@compat_dataclass
class ArtworkRow:
    artwork_id: int
    iiif_url: str
    source: str | None


@compat_dataclass
class ColorUpdate:
    artwork_id: int
    dominant_color: str
    red: int
    green: int
    blue: int


@compat_dataclass
class FailureRecord:
    artwork_id: int
    message: str


def require_runtime_dependencies() -> None:
    if _IMPORT_ERROR is None:
        return
    raise SystemExit(
        "Saknade Python-beroenden. Installera med: pip install Pillow aiohttp numpy"
    )


def resolve_db_path() -> Path:
    env_path = os.environ.get("DATABASE_PATH")
    if env_path:
        return Path(env_path).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "kabinett.db").resolve()


def connect_db(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(db_path), timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def should_retry_status(status: int) -> bool:
    return status == 429 or status >= 500


def normalize_iiif_base(url: str) -> str:
    return url.replace("http://", "https://")


def build_image_url(iiif_url: str, source: str | None) -> str:
    normalized = normalize_iiif_base(iiif_url)
    if source == "nationalmuseum":
        return f"{normalized.rstrip('/')}/full/100,/0/default.jpg"
    return normalized


def resize_filter() -> int:
    resampling = getattr(Image, "Resampling", Image)
    return resampling.BOX


def extract_color_from_bytes(image_bytes: bytes) -> tuple[str, int, int, int]:
    with Image.open(io.BytesIO(image_bytes)) as image:
        pixel = image.convert("RGB").resize((1, 1), resample=resize_filter()).getpixel((0, 0))
    red, green, blue = int(pixel[0]), int(pixel[1]), int(pixel[2])
    dominant_color = f"#{red:02X}{green:02X}{blue:02X}"
    return dominant_color, red, green, blue


async def fetch_with_retry(session: aiohttp.ClientSession, url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(FETCH_RETRIES + 1):
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
            if attempt == FETCH_RETRIES or (
                isinstance(error, RuntimeError) and not retryable_http
            ):
                raise
        if attempt < FETCH_RETRIES:
            await asyncio.sleep((FETCH_BACKOFF_MS / 1000) * (2**attempt))
    if last_error is not None:
        raise last_error
    raise RuntimeError("Kunde inte hämta bild efter alla försök")


def load_pending_artworks(connection: sqlite3.Connection) -> list[ArtworkRow]:
    rows = connection.execute(SELECT_ARTWORKS_QUERY).fetchall()
    return [
        ArtworkRow(
            artwork_id=int(row["id"]),
            iiif_url=str(row["iiif_url"]),
            source=str(row["source"]) if row["source"] is not None else None,
        )
        for row in rows
    ]


def write_updates(connection: sqlite3.Connection, updates: list[ColorUpdate]) -> None:
    if not updates:
        return
    connection.executemany(
        UPDATE_ARTWORK_QUERY,
        [
            (
                update.dominant_color,
                update.red,
                update.green,
                update.blue,
                update.artwork_id,
            )
            for update in updates
        ],
    )
    connection.commit()


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def log_progress(
    processed: int,
    total: int,
    succeeded: int,
    failed: int,
    started_at: float,
) -> None:
    elapsed = max(time.perf_counter() - started_at, 1e-6)
    rate = processed / elapsed
    remaining = max(total - processed, 0)
    eta = remaining / rate if rate > 0 else 0
    progress = (processed / total) * 100 if total else 100
    print(
        "Framsteg: "
        f"{processed}/{total} ({progress:.1f} %) — "
        f"{rate:.1f}/s — ETA {format_duration(eta)} — "
        f"{succeeded} klara, {failed} fel"
    )


async def process_artwork(
    session: aiohttp.ClientSession,
    row: ArtworkRow,
    semaphore: asyncio.Semaphore,
) -> ColorUpdate | FailureRecord:
    image_url = build_image_url(row.iiif_url, row.source)
    try:
        async with semaphore:
            image_bytes = await fetch_with_retry(session, image_url)
        dominant_color, red, green, blue = await asyncio.to_thread(
            extract_color_from_bytes, image_bytes
        )
        return ColorUpdate(
            artwork_id=row.artwork_id,
            dominant_color=dominant_color,
            red=red,
            green=green,
            blue=blue,
        )
    except Exception as error:
        return FailureRecord(
            artwork_id=row.artwork_id,
            message=str(error) or "Okänt fel",
        )


async def process_batch(
    session: aiohttp.ClientSession,
    rows: list[ArtworkRow],
    semaphore: asyncio.Semaphore,
) -> tuple[list[ColorUpdate], list[FailureRecord]]:
    results = await asyncio.gather(
        *(process_artwork(session, row, semaphore) for row in rows)
    )

    updates: list[ColorUpdate] = []
    failures: list[FailureRecord] = []
    for result in results:
        if isinstance(result, ColorUpdate):
            updates.append(result)
        else:
            failures.append(result)
    return updates, failures


async def run() -> int:
    require_runtime_dependencies()
    db_path = resolve_db_path()
    connection = connect_db(db_path)

    try:
        rows = load_pending_artworks(connection)
        total = len(rows)

        print("Färgextraktion startar…")
        print(f"Databas: {db_path}")
        print(f"Antal verk att behandla: {total}")

        if total == 0:
            print("Inga verk saknar dominant färg.")
            return 0

        processed = 0
        succeeded = 0
        failed = 0
        first_failures: list[FailureRecord] = []
        started_at = time.perf_counter()
        semaphore = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)
        timeout = aiohttp.ClientTimeout(
            total=REQUEST_TIMEOUT_SECONDS,
            connect=CONNECT_TIMEOUT_SECONDS,
        )
        connector = aiohttp.TCPConnector(limit=DOWNLOAD_CONCURRENCY)

        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            for start_index in range(0, total, BATCH_SIZE):
                batch = rows[start_index : start_index + BATCH_SIZE]
                updates, failures = await process_batch(session, batch, semaphore)
                write_updates(connection, updates)

                processed += len(batch)
                succeeded += len(updates)
                failed += len(failures)

                for failure in failures:
                    if len(first_failures) >= 20:
                        break
                    first_failures.append(failure)

                log_progress(processed, total, succeeded, failed, started_at)

        print("\nKlar.")
        print(f"Uppdaterade färger: {succeeded}")
        print(f"Misslyckade: {failed}")

        if first_failures:
            print("De första misslyckade verken:")
            for failure in first_failures:
                print(f"- {failure.artwork_id}: {failure.message}")

        return 0
    finally:
        connection.close()


def main() -> int:
    try:
        return asyncio.run(run())
    except KeyboardInterrupt:
        print("Skriptet avbröts.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
