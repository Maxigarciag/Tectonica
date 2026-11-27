"""FastAPI application with earthquake endpoints and in-memory cache."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import FastAPI, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from psycopg.rows import dict_row

from src.ingest.db import get_latest_earthquakes, get_pool

logger = logging.getLogger("api")


# DTO Models
class EarthquakeDTO(BaseModel):
    """Earthquake data transfer object."""
    id: str
    mag: float
    place: str
    time: str  # ISO 8601 UTC
    lat: float
    lon: float
    depth_km: float | None = None
    updated: int  # epoch ms


class EarthquakesResponse(BaseModel):
    """Response for earthquakes list endpoint."""
    events: list[EarthquakeDTO]
    count: int
    window: str
    stale: bool = False


class StatusResponse(BaseModel):
    """Response for status endpoint."""
    last_ingestion: Optional[str]  # ISO 8601 UTC
    age_seconds: Optional[float]
    stale: bool


class HealthResponse(BaseModel):
    """Response for health endpoint."""
    status: str
    stale: bool


# In-memory cache
@dataclass
class CacheEntry:
    data: str
    etag: str
    expires_at: float


class SimpleCache:
    """Simple in-memory cache with TTL and ETag support."""

    def __init__(self, ttl: int = 30):
        self._cache: dict[str, CacheEntry] = {}
        self._ttl = ttl

    def _make_key(self, window: str, min_mag: float, limit: int) -> str:
        return f"earthquakes:{window}:{min_mag}:{limit}"

    def _compute_etag(self, data: str) -> str:
        return hashlib.sha256(data.encode()).hexdigest()[:16]

    def get(self, window: str, min_mag: float, limit: int) -> Optional[CacheEntry]:
        key = self._make_key(window, min_mag, limit)
        entry = self._cache.get(key)
        if entry and entry.expires_at > time.time():
            return entry
        elif entry:
            del self._cache[key]
        return None

    def set(self, window: str, min_mag: float, limit: int, data: str) -> CacheEntry:
        key = self._make_key(window, min_mag, limit)
        etag = self._compute_etag(data)
        entry = CacheEntry(
            data=data,
            etag=etag,
            expires_at=time.time() + self._ttl,
        )
        self._cache[key] = entry
        return entry


cache = SimpleCache(ttl=30)


def earthquake_to_dto(row: dict) -> EarthquakeDTO:
    """Convert database row to EarthquakeDTO.

    lat/lon/depth se toman de las columnas de la fila (decisión 003),
    no de properties, porque feature_to_record no guarda geometry
    dentro de properties. depth_km puede ser None si no hay profundidad.
    """
    return EarthquakeDTO(
        id=row["id"],
        mag=row["properties"]["mag"],
        place=row["properties"]["place"],
        time=datetime.fromtimestamp(row["event_time_ms"] / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        lat=row["lat"],
        lon=row["lon"],
        depth_km=row["depth_km"],
        updated=row["updated_ms"],
    )


def get_latest_ingestion_time(dsn: Optional[str] = None) -> Optional[datetime]:
    """Get the timestamp of the most recent ingestion."""
    with get_pool(dsn).connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(ingested_at) FROM earthquakes")
            result = cur.fetchone()
            if result and result[0]:
                return result[0]
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - log startup/shutdown."""
    logger.info("api.startup")
    yield
    logger.info("api.shutdown")


app = FastAPI(
    title="Tectonica API",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - restrict to frontend domain in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check - fails if last ingestion > 5 minutes ago."""
    last_ingestion = get_latest_ingestion_time()
    now = datetime.now(timezone.utc)

    if last_ingestion is None:
        stale = True
        age_seconds = None
    else:
        age_seconds = (now - last_ingestion).total_seconds()
        stale = age_seconds > 300  # 5 minutes

    return HealthResponse(
        status="degraded" if stale else "healthy",
        stale=stale,
    )


@app.get("/api/v1/status", response_model=StatusResponse)
async def status():
    """Status endpoint - last ingestion info."""
    last_ingestion = get_latest_ingestion_time()
    now = datetime.now(timezone.utc)

    if last_ingestion is None:
        return StatusResponse(
            last_ingestion=None,
            age_seconds=None,
            stale=True,
        )

    age_seconds = (now - last_ingestion).total_seconds()
    return StatusResponse(
        last_ingestion=last_ingestion.isoformat().replace("+00:00", "Z"),
        age_seconds=age_seconds,
        stale=age_seconds > 300,
    )


@app.get("/api/v1/earthquakes", response_model=EarthquakesResponse)
async def get_earthquakes(
    request: Request,
    response: Response,
    window: Annotated[str, Query(pattern="^(hour|day)$")] = "hour",
    min_mag: Annotated[float, Query(ge=0, le=10)] = 0.0,
    limit: Annotated[int, Query(ge=1, le=1000)] = 500,
):
    """Get earthquakes filtered by time window and minimum magnitude."""
    # Check cache first
    cached = cache.get(window, min_mag, limit)

    # Check If-None-Match header
    if_none_match = request.headers.get("If-None-Match")
    if cached and if_none_match == cached.etag:
        response.headers["Cache-Control"] = "max-age=30"
        response.headers["ETag"] = cached.etag
        return Response(status_code=304, headers=dict(response.headers))

    if cached:
        response.headers["Cache-Control"] = "max-age=30"
        response.headers["ETag"] = cached.etag
        return Response(content=cached.data, media_type="application/json", headers=dict(response.headers))

    # Fetch from database
    now = datetime.now(timezone.utc)
    window_seconds = 3600 if window == "hour" else 86400
    cutoff_ms = int((now.timestamp() - window_seconds) * 1000)

    with get_pool().connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT id, version, properties, lat, lon, depth_km, updated_ms, event_time_ms, ingested_at
                    FROM earthquakes
                    WHERE event_time_ms >= %s AND (properties->>'mag')::double precision >= %s
                    ORDER BY event_time_ms DESC
                    LIMIT %s
                """, (cutoff_ms, min_mag, limit))
                rows = cur.fetchall()

    events = [earthquake_to_dto(row) for row in rows]

    # Determine if data is stale
    last_ingestion = get_latest_ingestion_time()
    stale = False
    if last_ingestion:
        age_seconds = (now - last_ingestion).total_seconds()
        stale = age_seconds > 300

    resp_data = EarthquakesResponse(
        events=events,
        count=len(events),
        window=window,
        stale=stale,
    )

    json_data = resp_data.model_dump_json()
    entry = cache.set(window, min_mag, limit, json_data)

    response.headers["Cache-Control"] = "max-age=30"
    response.headers["ETag"] = entry.etag

    return Response(content=json_data, media_type="application/json", headers=dict(response.headers))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
