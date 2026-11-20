"""Tests for FastAPI endpoints."""

import json
import os
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from src.api.main import EarthquakeDTO, EarthquakesResponse, SimpleCache, app, earthquake_to_dto, cache
from src.ingest.db import EarthquakeRecord, get_pool, init_schema, upsert_earthquakes

TEST_DSN = os.getenv("TEST_DATABASE_URL")

client = TestClient(app)


class TestEarthquakeDTO:
    """Tests for EarthquakeDTO model."""

    def test_dto_fields(self):
        """DTO has all required fields."""
        dto = EarthquakeDTO(
            id="test123",
            mag=2.5,
            place="Test location",
            time="2026-11-14T05:00:00Z",
            lat=35.0,
            lon=-120.0,
            depth_km=10.0,
            updated=1794630000000,
        )
        assert dto.id == "test123"
        assert dto.mag == 2.5
        assert dto.place == "Test location"
        assert dto.time == "2026-11-14T05:00:00Z"
        assert dto.lat == 35.0
        assert dto.lon == -120.0
        assert dto.depth_km == 10.0
        assert dto.updated == 1794630000000


class TestSimpleCache:
    """Tests for SimpleCache."""

    def test_set_and_get(self):
        """Cache stores and retrieves data."""
        cache = SimpleCache(ttl=60)
        entry = cache.set("hour", 2.5, 500, '{"events": []}')
        assert entry.etag
        assert entry.expires_at > time.time()

        retrieved = cache.get("hour", 2.5, 500)
        assert retrieved is not None
        assert retrieved.data == '{"events": []}'
        assert retrieved.etag == entry.etag

    def test_miss_returns_none(self):
        """Cache miss returns None."""
        cache = SimpleCache(ttl=60)
        assert cache.get("hour", 2.5, 500) is None

    def test_expired_entry_removed(self):
        """Expired entries are removed on get."""
        cache = SimpleCache(ttl=0)  # Immediate expiry
        cache.set("hour", 2.5, 500, '{"events": []}')
        time.sleep(0.01)
        assert cache.get("hour", 2.5, 500) is None

    def test_different_keys(self):
        """Different parameters create different cache entries."""
        cache = SimpleCache(ttl=60)
        cache.set("hour", 2.5, 500, '{"events": []}')
        cache.set("day", 2.5, 500, '{"events": []}')
        cache.set("hour", 3.0, 500, '{"events": []}')
        cache.set("hour", 2.5, 100, '{"events": []}')

        assert cache.get("hour", 2.5, 500) is not None
        assert cache.get("day", 2.5, 500) is not None
        assert cache.get("hour", 3.0, 500) is not None
        assert cache.get("hour", 2.5, 100) is not None


class TestHealthEndpoint:
    """Tests for /health endpoint."""

    @patch("src.api.main.get_latest_ingestion_time")
    def test_healthy_when_recent_ingestion(self, mock_get_time):
        """Returns healthy when last ingestion < 5 min ago."""
        mock_get_time.return_value = datetime.now(timezone.utc)
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["stale"] is False

    @patch("src.api.main.get_latest_ingestion_time")
    def test_degraded_when_old_ingestion(self, mock_get_time):
        """Returns degraded when last ingestion > 5 min ago."""
        old_time = datetime.now(timezone.utc).replace(year=2020)
        mock_get_time.return_value = old_time
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["stale"] is True

    @patch("src.api.main.get_latest_ingestion_time")
    def test_stale_when_no_ingestion(self, mock_get_time):
        """Returns stale when no ingestion has occurred."""
        mock_get_time.return_value = None
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["stale"] is True


class TestStatusEndpoint:
    """Tests for /api/v1/status endpoint."""

    @patch("src.api.main.get_latest_ingestion_time")
    def test_returns_ingestion_info(self, mock_get_time):
        """Returns last ingestion time and age."""
        fixed_time = datetime(2026, 11, 14, 5, 0, 0, tzinfo=timezone.utc)
        mock_get_time.return_value = fixed_time

        with patch("src.api.main.datetime") as mock_datetime:
            mock_datetime.now.return_value = datetime(2026, 11, 14, 5, 1, 0, tzinfo=timezone.utc)
            mock_datetime.side_effect = lambda *args, **kw: datetime(*args, **kw)
            mock_datetime.timezone = timezone

            response = client.get("/api/v1/status")
            assert response.status_code == 200
            data = response.json()
            assert data["last_ingestion"] == "2026-11-14T05:00:00Z"
            assert data["age_seconds"] == 60.0
            assert data["stale"] is False

    @patch("src.api.main.get_latest_ingestion_time")
    def test_stale_when_old(self, mock_get_time):
        """stale=true when ingestion > 5 min ago."""
        old_time = datetime.now(timezone.utc).replace(year=2020)
        mock_get_time.return_value = old_time
        response = client.get("/api/v1/status")
        assert response.status_code == 200
        data = response.json()
        assert data["stale"] is True


def make_mock_row():
    """Create a sample database row for testing."""
    return {
        "id": "test123",
        "version": 1,
        "properties": {
            "mag": 2.5,
            "place": "Test location",
            "time": 1794630000000,
            "updated": 1794630100000,
        },
        "lat": 35.0,
        "lon": -120.0,
        "depth_km": 10.0,
        "updated_ms": 1794630100000,
        "event_time_ms": 1794630000000,
        "ingested_at": datetime.now(timezone.utc),
    }


class TestEarthquakesEndpoint:
    """Tests for /api/v1/earthquakes endpoint."""

    def test_returns_filtered_events(self):
        """Returns events filtered by window and min_mag using real database records."""
        if not TEST_DSN:
            pytest.skip("TEST_DATABASE_URL not set")

        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        records = [
            EarthquakeRecord(
                id=f"eq-{i}",
                properties={"mag": 2.5 + i * 0.5, "place": f"Place {i}"},
                lat=35.0,
                lon=-120.0,
                depth_km=10.0 + i,
                updated_ms=now_ms,
                event_time_ms=now_ms - i * 1000,  # eq-0 newest, eq-2 oldest
            )
            for i in range(3)
        ]
        init_schema(TEST_DSN)
        pool = get_pool(TEST_DSN)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()
        upsert_earthquakes(records, TEST_DSN)
        cache._cache.clear()

        response = client.get("/api/v1/earthquakes?window=hour&min_mag=2.0&limit=100")
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 3
        assert data["window"] == "hour"
        assert data["stale"] is False
        assert data["events"][0]["id"] == "eq-0"
        assert data["events"][0]["mag"] == 2.5

        # Check Cache-Control header
        assert response.headers["Cache-Control"] == "max-age=30"
        assert "ETag" in response.headers

        # Clean up
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()

    @patch("src.api.main.get_pool")
    @patch("src.api.main.get_latest_ingestion_time")
    def test_etag_304_when_unchanged(self, mock_get_time, mock_get_pool):
        """Returns 304 when If-None-Match matches ETag."""
        mock_get_time.return_value = datetime.now(timezone.utc)

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_get_pool.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

        mock_cursor.fetchall.return_value = [make_mock_row()]

        # First request - populate cache
        response1 = client.get("/api/v1/earthquakes?window=hour&min_mag=0")
        assert response1.status_code == 200
        etag = response1.headers["ETag"]

        # Second request with If-None-Match
        response2 = client.get("/api/v1/earthquakes?window=hour&min_mag=0", headers={"If-None-Match": etag})
        assert response2.status_code == 304
        assert response2.headers["Cache-Control"] == "max-age=30"
        assert response2.headers["ETag"] == etag

    @patch("src.api.main.get_pool")
    def test_stale_when_ingestion_old(self, mock_get_pool):
        """stale=true when ingestion stopped."""
        old_time = datetime(2020, 1, 1, tzinfo=timezone.utc)

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_get_pool.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_cursor.fetchall.return_value = []

        # Clear cache to avoid interference from other tests
        cache._cache.clear()

        with patch("src.api.main.get_latest_ingestion_time") as mock_get_time:
            mock_get_time.return_value = old_time

            # Since old_time is 2020 and real now is 2026, age is ~6 years >> 5 min
            # No need to mock datetime.now() - real time is already >> 5 min after 2020
            response = client.get("/api/v1/earthquakes?window=hour")
            assert response.status_code == 200
            data = response.json()
            assert data["stale"] is True

    def test_validation_window_parameter(self):
        """Validates window parameter."""
        response = client.get("/api/v1/earthquakes?window=invalid")
        assert response.status_code == 422

    def test_validation_min_mag_parameter(self):
        """Validates min_mag parameter."""
        response = client.get("/api/v1/earthquakes?min_mag=-1")
        assert response.status_code == 422

        response = client.get("/api/v1/earthquakes?min_mag=11")
        assert response.status_code == 422

    def test_validation_limit_parameter(self):
        """Validates limit parameter."""
        response = client.get("/api/v1/earthquakes?limit=0")
        assert response.status_code == 422

        response = client.get("/api/v1/earthquakes?limit=1001")
        assert response.status_code == 422
