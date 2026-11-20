"""Database persistence for earthquake events.

Schema (Option A from decision 002):
- earthquakes table with PK id
- version: integer, increments on each update
- properties: JSONB with full USGS properties
- lat, lon: DOUBLE PRECISION (extracted from geometry.coordinates)
- updated_ms: BIGINT (extracted from properties.updated, epoch ms)
- ingested_at: TIMESTAMPTZ (when we persisted this version)

Upsert: INSERT ... ON CONFLICT (id) DO UPDATE
  SET properties = EXCLUDED.properties,
      version = earthquakes.version + 1,
      lat = EXCLUDED.lat,
      lon = EXCLUDED.lon,
      updated_ms = EXCLUDED.updated_ms,
      ingested_at = NOW()
  WHERE EXCLUDED.updated_ms > earthquakes.updated_ms
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

logger = logging.getLogger("ingest.db")


def _get_dsn() -> str:
    """Get DATABASE_URL from environment, fail with clear message if not set."""
    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "Set it to a PostgreSQL connection string, e.g. "
            "postgresql://user:pass@host:5432/dbname. "
            "See .env.example for template."
        )
    return dsn


_pool: ConnectionPool | None = None


def get_pool(dsn: str | None = None) -> ConnectionPool:
    """Get or create the global connection pool."""
    global _pool
    if _pool is None:
        _pool = ConnectionPool(dsn or _get_dsn(), min_size=1, max_size=4, open=True)
    return _pool


def close_pool() -> None:
    """Close the global connection pool."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def get_conn(dsn: str | None = None) -> Iterator[psycopg.Connection]:
    """Context manager for a database connection from the pool."""
    pool = get_pool(dsn)
    conn = pool.getconn()
    try:
        yield conn
    finally:
        pool.putconn(conn)


def init_schema(dsn: str | None = None) -> None:
    """Create the earthquakes table and indexes if they don't exist."""
    ddl = """
    CREATE TABLE IF NOT EXISTS earthquakes (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        properties JSONB NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        updated_ms BIGINT NOT NULL,
        event_time_ms BIGINT NOT NULL,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_earthquakes_updated_ms
        ON earthquakes (updated_ms);

    CREATE INDEX IF NOT EXISTS idx_earthquakes_ingested_at
        ON earthquakes (ingested_at);

    CREATE INDEX IF NOT EXISTS idx_earthquakes_event_time_ms
        ON earthquakes (event_time_ms);

    CREATE INDEX IF NOT EXISTS idx_earthquakes_properties_gin
        ON earthquakes USING GIN (properties);
    """
    with get_conn(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(ddl)
        conn.commit()
    logger.info("db.schema_initialized")


@dataclass(slots=True)
class EarthquakeRecord:
    """Normalized earthquake record ready for persistence."""
    id: str
    properties: dict
    lat: float
    lon: float
    depth_km: float | None
    updated_ms: int
    event_time_ms: int


def feature_to_record(feature: dict) -> EarthquakeRecord:
    """Convert a GeoJSON Feature to an EarthquakeRecord."""
    props = feature["properties"]
    coords = feature["geometry"]["coordinates"]
    # GeoJSON order: [longitude, latitude, depth]
    lon, lat = coords[0], coords[1]
    depth_km = coords[2] if len(coords) > 2 else None
    updated_ms = props.get("updated")
    event_time_ms = props.get("time")
    if updated_ms is None:
        raise ValueError(f"Feature {feature.get('id')} missing 'updated' property")
    if event_time_ms is None:
        raise ValueError(f"Feature {feature.get('id')} missing 'time' property")
    return EarthquakeRecord(
        id=feature["id"],
        properties=props,
        lat=lat,
        lon=lon,
        depth_km=depth_km,
        updated_ms=int(updated_ms),
        event_time_ms=int(event_time_ms),
    )


UPSERT_SQL = """
    INSERT INTO earthquakes (id, version, properties, lat, lon, depth_km, updated_ms, event_time_ms)
    VALUES (%(id)s, 1, %(properties)s, %(lat)s, %(lon)s, %(depth_km)s, %(updated_ms)s, %(event_time_ms)s)
    ON CONFLICT (id) DO UPDATE SET
        properties = EXCLUDED.properties,
        version = earthquakes.version + 1,
        lat = EXCLUDED.lat,
        lon = EXCLUDED.lon,
        depth_km = EXCLUDED.depth_km,
        updated_ms = EXCLUDED.updated_ms,
        event_time_ms = EXCLUDED.event_time_ms,
        ingested_at = NOW()
    WHERE EXCLUDED.updated_ms > earthquakes.updated_ms
    RETURNING (xmax = 0) AS inserted;
"""


def upsert_earthquakes(records: list[EarthquakeRecord], dsn: str | None = None) -> tuple[int, int, int]:
    """Upsert multiple earthquake records.

    Returns:
        (inserted_count, updated_count, skipped_count)
        - inserted: new rows created
        - updated: existing rows updated (WHERE condition matched)
        - skipped: rows not modified (WHERE condition failed: updated_ms <= existing)
    """
    if not records:
        return 0, 0, 0

    inserted = 0
    updated = 0
    with get_conn(dsn) as conn:
        with conn.cursor() as cur:
            for rec in records:
                cur.execute(
                    UPSERT_SQL,
                    {
                        "id": rec.id,
                        "properties": json.dumps(rec.properties),
                        "lat": rec.lat,
                        "lon": rec.lon,
                        "depth_km": rec.depth_km,
                        "updated_ms": rec.updated_ms,
                        "event_time_ms": rec.event_time_ms,
                    },
                )
                result = cur.fetchone()
                if result:
                    if result[0]:  # inserted (xmax = 0)
                        inserted += 1
                    else:  # updated (xmax != 0)
                        updated += 1
        conn.commit()

    skipped = len(records) - inserted - updated
    logger.info(
        "db.upsert_completed",
        extra={"inserted": inserted, "updated": updated, "skipped": skipped, "total": len(records)},
    )
    return inserted, updated, skipped


def get_latest_earthquakes(limit: int = 100, dsn: str | None = None) -> list[dict]:
    """Fetch latest earthquakes ordered by updated_ms desc."""
    sql = """
        SELECT id, version, properties, lat, lon, depth_km, updated_ms, ingested_at
        FROM earthquakes
        ORDER BY updated_ms DESC
        LIMIT %s
    """
    with get_conn(dsn) as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, (limit,))
            return cur.fetchall()