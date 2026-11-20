from __future__ import annotations

import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .db import EarthquakeRecord, feature_to_record, init_schema, upsert_earthquakes

FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
RAW_DIR = Path("data/raw/usgs")

MIN_POLL_INTERVAL = 60  # seconds
DEFAULT_POLL_INTERVAL = 60  # seconds
MAX_RETRIES = 5
BASE_BACKOFF = 2  # seconds

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {
            "level": record.levelname,
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "event": record.getMessage(),
        }
        extra = {k: v for k, v in record.__dict__.items() if k not in {
            "name", "msg", "args", "created", "filename", "funcName",
            "levelname", "levelno", "lineno", "module", "msecs",
            "message", "pathname", "process", "processName",
            "relativeCreated", "thread", "threadName", "exc_info",
            "exc_text", "stack_info", "getMessage",
        }}
        if extra:
            base.update(extra)
        return json.dumps(base, ensure_ascii=False)

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logging.basicConfig(level=logging.INFO, handlers=[handler])
logger = logging.getLogger("ingest.usgs")


def parse_expires_header(expires_str: str | None) -> int | None:
    """Parse Expires header and return seconds until expiry, or None if invalid."""
    if not expires_str:
        return None
    try:
        expires_dt = datetime.strptime(expires_str, "%a, %d %b %Y %H:%M:%S %Z")
        expires_dt = expires_dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        delta = (expires_dt - now).total_seconds()
        return int(delta)
    except (ValueError, TypeError):
        return None


def calculate_poll_interval(headers: httpx.Headers) -> int:
    """Calculate next poll interval from response headers.
    
    Uses Expires header if present, with minimum MIN_POLL_INTERVAL.
    Falls back to DEFAULT_POLL_INTERVAL if Expires is missing or invalid.
    """
    expires_seconds = parse_expires_header(headers.get("Expires"))
    if expires_seconds is not None:
        return max(expires_seconds, MIN_POLL_INTERVAL)
    return DEFAULT_POLL_INTERVAL


def fetch_feed(client: httpx.Client) -> tuple[bytes, int]:
    """Descarga el feed y devuelve (bytes, poll_interval_seconds).
    
    Implements retry with backoff for errors and 429.
    """
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(FEED_URL, timeout=10.0)
            if resp.status_code == 429:
                raise httpx.HTTPStatusError("Rate limited", request=resp.request, response=resp)
            resp.raise_for_status()
            poll_interval = calculate_poll_interval(resp.headers)
            return resp.content, poll_interval
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                backoff = BASE_BACKOFF * (2 ** attempt)
                logger.warning(
                    "fetch.retry",
                    extra={"attempt": attempt + 1, "max_retries": MAX_RETRIES, "backoff": backoff, "error": str(e)},
                )
                time.sleep(backoff)
            else:
                logger.error(
                    "fetch.failed",
                    extra={"attempts": MAX_RETRIES, "error": str(e)},
                )
    raise RuntimeError(f"Failed to fetch feed after {MAX_RETRIES} attempts") from last_error


def validate_geojson(body: bytes) -> dict:
    """Falla si el contenido no es JSON o no es un FeatureCollection."""
    data = json.loads(body)
    if data.get("type") != "FeatureCollection":
        raise ValueError(f"Tipo inesperado: {data.get('type')!r}")
    return data


def save_raw(body: bytes) -> Path:
    """Guarda la respuesta sin transformar, con marca de tiempo UTC en el nombre."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RAW_DIR / f"all_hour_{ts}.geojson"
    path.write_bytes(body)
    return path


def ingest_once() -> tuple[int, int, int, int, int]:
    """Run one ingestion cycle.
    
    Returns:
        (event_count, inserted, updated, skipped)
    """
    headers = {
        "User-Agent": "pulso-de-la-tierra/0.1",
        "Accept-Encoding": "gzip",
    }
    with httpx.Client(headers=headers) as client:
        body, poll_interval = fetch_feed(client)

    data = validate_geojson(body)
    path = save_raw(body)

    # Persist to database
    init_schema()
    records = [feature_to_record(f) for f in data.get("features", [])]
    inserted, updated, skipped = upsert_earthquakes(records)

    logger.info(
        "ingest.completed",
        extra={
            "event_count": len(records),
            "saved_path": str(path),
            "db_inserted": inserted,
            "db_updated": updated,
            "db_skipped": skipped,
            "next_poll_interval": poll_interval,
        },
    )
    return len(records), inserted, updated, skipped, poll_interval


def main() -> None:
    """Main worker loop - runs indefinitely."""
    logger.info("worker.started")
    while True:
        try:
            event_count, inserted, updated, skipped, next_poll_interval = ingest_once()
        except Exception as e:
            logger.error("worker.cycle_failed", extra={"error": str(e)})
            # On any error, wait minimum interval before retrying
            time.sleep(MIN_POLL_INTERVAL)
            continue

        # Wait for next poll interval (already logged in ingest.completed)
        time.sleep(next_poll_interval)


if __name__ == "__main__":
    main()
