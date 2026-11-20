"""Integration tests for FastAPI endpoints with real database.

These tests require TEST_DATABASE_URL environment variable to be set.
Set it to run them, e.g.:
TEST_DATABASE_URL=postgresql://postgres:***@localhost:5432/pulso_test pytest tests/test_integration.py -v
"""

import os
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from src.api.main import EarthquakeDTO, app, cache
from src.ingest.db import EarthquakeRecord, get_pool, init_schema, upsert_earthquakes

TEST_DSN = os.getenv("TEST_DATABASE_URL")


def _now_ms() -> int:
    """Current UTC time in epoch milliseconds."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _make_record(eq_id: str, mag: float, event_time_ms: int, updated_ms: int, depth_km: float | None = None) -> EarthquakeRecord:
    """Build an EarthquakeRecord with current-timestamp fields."""
    return EarthquakeRecord(
        id=eq_id,
        properties={"mag": mag, "place": "Test place"},
        lat=35.0,
        lon=-120.0,
        depth_km=depth_km,
        updated_ms=updated_ms,
        event_time_ms=event_time_ms,
    )


class TestEarthquakesEndpointIntegration:
    """Integration tests for /api/v1/earthquakes endpoint with real database.

    These tests are skipped if TEST_DATABASE_URL is not set.
    """

    @pytest.fixture(autouse=True)
    def _check_db(self):
        if not TEST_DSN:
            pytest.skip("TEST_DATABASE_URL not set")

    @pytest.fixture(autouse=True)
    def _clean_table(self):
        """Truncate earthquakes table before each test."""
        init_schema(TEST_DSN)
        pool = get_pool(TEST_DSN)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()
        cache._cache.clear()
        yield
        # Also clean up after test
        pool = get_pool(TEST_DSN)
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()
        cache._cache.clear()

    def test_get_earthquakes_hour_window_returns_200_and_dto_fields(self):
        """GET /api/v1/earthquakes?window=hour returns 200 and each item has only DTO fields."""
        now_ms = _now_ms()
        records = [
            _make_record(f"eq-{i}", 2.5 + i * 0.5, now_ms - 1000 * 60 * 10, now_ms, depth_km=10.0 + i)
            for i in range(5)
        ]
        upsert_earthquakes(records, TEST_DSN)

        client = TestClient(app)
        response = client.get("/api/v1/earthquakes?window=hour")

        assert response.status_code == 200
        payload = response.json()

        # Verify response structure
        assert "events" in payload
        assert "count" in payload
        assert "window" in payload
        assert "stale" in payload
        assert payload["window"] == "hour"
        assert isinstance(payload["events"], list)
        assert payload["count"] == len(payload["events"])

        # Verify each event has exactly the DTO fields (no extra fields)
        dto_fields = {"id", "mag", "place", "time", "lat", "lon", "depth_km", "updated"}
        for event in payload["events"]:
            assert set(event.keys()) == dto_fields, f"Event has unexpected fields: {set(event.keys()) - dto_fields}"

            # Verify field types
            assert isinstance(event["id"], str)
            assert isinstance(event["mag"], float)
            assert isinstance(event["place"], str)
            assert isinstance(event["time"], str)
            assert isinstance(event["lat"], float)
            assert isinstance(event["lon"], float)
            assert isinstance(event["depth_km"], float)
            assert isinstance(event["updated"], int)

            # Verify time format is ISO 8601 UTC (ends with Z)
            assert event["time"].endswith("Z")

    def test_get_earthquakes_day_window_returns_200(self):
        """GET /api/v1/earthquakes?window=day returns 200."""
        now_ms = _now_ms()
        records = [
            _make_record(f"eq-{i}", 2.5, now_ms - 1000 * 60 * 10, now_ms, depth_km=5.0)
            for i in range(3)
        ]
        upsert_earthquakes(records, TEST_DSN)

        client = TestClient(app)
        response = client.get("/api/v1/earthquakes?window=day")

        assert response.status_code == 200
        payload = response.json()
        assert payload["window"] == "day"
        assert isinstance(payload["events"], list)
        assert payload["count"] == 3

    def test_get_earthquakes_min_mag_filters_results(self):
        """min_mag parameter filters earthquakes by magnitude."""
        now_ms = _now_ms()
        records = [
            _make_record("eq-low", 1.5, now_ms - 1000 * 60 * 10, now_ms, depth_km=10.0),
            _make_record("eq-high", 4.5, now_ms - 1000 * 60 * 10, now_ms, depth_km=5.0),
        ]
        upsert_earthquakes(records, TEST_DSN)

        client = TestClient(app)

        # Request with min_mag that excludes low-mag events
        response = client.get("/api/v1/earthquakes?window=hour&min_mag=3.0")
        assert response.status_code == 200
        payload = response.json()

        # All returned events should have mag >= 3.0
        for event in payload["events"]:
            assert event["mag"] >= 3.0

        # Only the high-mag event should be returned
        assert payload["count"] == 1
        assert payload["events"][0]["id"] == "eq-high"

    def test_get_earthquakes_limit_respects_limit(self):
        """limit parameter limits the number of returned events."""
        now_ms = _now_ms()
        records = [
            _make_record(f"eq-{i}", 2.5, now_ms - 1000 * i, now_ms, depth_km=10.0)
            for i in range(5)
        ]
        upsert_earthquakes(records, TEST_DSN)

        client = TestClient(app)
        response = client.get("/api/v1/earthquakes?window=hour&limit=2")

        assert response.status_code == 200
        payload = response.json()
        assert payload["count"] <= 2
        assert len(payload["events"]) <= 2

    def test_get_earthquakes_empty_database_returns_empty_list(self):
        """Empty database returns empty events list with 200."""
        # No data inserted - table is empty from _clean_table fixture
        client = TestClient(app)
        response = client.get("/api/v1/earthquakes?window=hour")

        assert response.status_code == 200
        payload = response.json()
        assert payload["events"] == []
        assert payload["count"] == 0
        assert payload["window"] == "hour"
