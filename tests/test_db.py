"""Tests for database persistence module."""

import json
import os
import pytest

from src.ingest.db import (
    EarthquakeRecord,
    feature_to_record,
    get_latest_earthquakes,
    init_schema,
    upsert_earthquakes,
)
from src.ingest.usgs import validate_geojson


FIXTURE_PATH = "tests/fixtures/all_hour_sample.geojson"

# Test database URL - set via env var in CI, or use local test database
TEST_DSN = os.getenv("TEST_DATABASE_URL")


def load_fixture() -> dict:
    """Load and parse the fixture GeoJSON."""
    with open(FIXTURE_PATH, "rb") as f:
        body = f.read()
    return validate_geojson(body)


class TestFeatureToRecord:
    """Tests for feature_to_record conversion."""

    def test_converts_all_features(self):
        """All features in fixture convert to valid records."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        assert len(records) == 5
        for rec in records:
            assert isinstance(rec, EarthquakeRecord)
            assert rec.id
            assert isinstance(rec.properties, dict)
            assert isinstance(rec.lat, float)
            assert isinstance(rec.lon, float)
            assert isinstance(rec.updated_ms, int)
            assert rec.updated_ms > 0
            # Check coordinates are reasonable
            assert -180 <= rec.lon <= 180
            assert -90 <= rec.lat <= 90

    def test_specific_feature_values(self):
        """Check specific known values from fixture."""
        data = load_fixture()
        # Find the Alaska M2.5 event
        feature = next(f for f in data["features"] if f["id"] == "aka2026wnvaqb")
        rec = feature_to_record(feature)

        assert rec.id == "aka2026wnvaqb"
        assert rec.properties["mag"] == 2.5
        assert rec.properties["place"] == "12 km SSW of Skwentna, Alaska"
        assert rec.lat == 61.892
        assert rec.lon == -151.528
        assert rec.updated_ms == 1794629151133

    def test_missing_updated_raises(self):
        """Feature without 'updated' property raises ValueError."""
        bad_feature = {
            "id": "test123",
            "properties": {"mag": 1.0, "place": "Test"},
            "geometry": {"type": "Point", "coordinates": [-120, 35, 10]},
        }
        with pytest.raises(ValueError, match="missing 'updated' property"):
            feature_to_record(bad_feature)


class TestDatabaseIntegration:
    """Integration tests requiring a PostgreSQL database.

    These tests are skipped if TEST_DATABASE_URL is not set.
    Set TEST_DATABASE_URL to run them, e.g.:
    TEST_DATABASE_URL=postgresql://postgres:***@localhost:5432/pulso_test pytest tests/test_db.py
    """

    @pytest.fixture(autouse=True)
    def _check_db(self):
        if not TEST_DSN:
            pytest.skip("TEST_DATABASE_URL not set")

    @pytest.fixture(autouse=True)
    def _clean_table(self):
        """Truncate earthquakes table before each test."""
        init_schema(TEST_DSN)
        with init_schema.__globals__["get_conn"](TEST_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()
        yield
        # Also clean up after test
        with init_schema.__globals__["get_conn"](TEST_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("TRUNCATE TABLE earthquakes")
            conn.commit()

    def test_init_schema_creates_table(self):
        """init_schema creates the earthquakes table."""
        # Table already created by _clean_table fixture
        with init_schema.__globals__["get_conn"](TEST_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT column_name, data_type
                    FROM information_schema.columns
                    WHERE table_name = 'earthquakes'
                    ORDER BY ordinal_position
                """)
                columns = {row[0]: row[1] for row in cur.fetchall()}

        expected_columns = {
            "id": "text",
            "version": "integer",
            "properties": "jsonb",
            "lat": "double precision",
            "lon": "double precision",
            "updated_ms": "bigint",
            "ingested_at": "timestamp with time zone",
        }
        for col, typ in expected_columns.items():
            assert col in columns, f"Missing column: {col}"
            assert columns[col] == typ, f"Column {col} has type {columns[col]}, expected {typ}"

    def test_upsert_inserts_new_records(self):
        """Upsert inserts new earthquake records."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        inserted, updated, skipped = upsert_earthquakes(records, TEST_DSN)

        assert inserted == 5
        assert updated == 0
        assert skipped == 0

        # Verify records in database
        latest = get_latest_earthquakes(10, TEST_DSN)
        assert len(latest) == 5
        for row in latest:
            assert row["version"] == 1
            assert row["id"] in [r.id for r in records]

    def test_upsert_idempotent_on_same_data(self):
        """Re-upserting the same data does not create duplicates or increment version."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        # First insert
        upsert_earthquakes(records, TEST_DSN)
        # Second upsert with identical data
        inserted, updated, skipped = upsert_earthquakes(records, TEST_DSN)

        assert inserted == 0
        assert updated == 0
        assert skipped == 5

        # Versions should still be 1
        latest = get_latest_earthquakes(10, TEST_DSN)
        assert all(row["version"] == 1 for row in latest)

    def test_upsert_updates_on_newer_updated_ms(self):
        """Upsert updates record when updated_ms is newer."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        # Initial insert
        upsert_earthquakes(records, TEST_DSN)

        # Create modified records with newer updated_ms
        newer_records = []
        for rec in records:
            newer_rec = EarthquakeRecord(
                id=rec.id,
                properties={**rec.properties, "mag": rec.properties["mag"] + 0.1, "updated": rec.updated_ms + 1000},
                lat=rec.lat + 0.001,
                lon=rec.lon + 0.001,
                depth_km=rec.depth_km,
                updated_ms=rec.updated_ms + 1000,
                event_time_ms=rec.event_time_ms + 1000,
            )
            newer_records.append(newer_rec)

        inserted, updated, skipped = upsert_earthquakes(newer_records, TEST_DSN)

        assert inserted == 0
        assert updated == 5
        assert skipped == 0

        # Versions should be 2
        latest = get_latest_earthquakes(10, TEST_DSN)
        assert all(row["version"] == 2 for row in latest)
        # Magnitudes should be updated
        for row in latest:
            original = next(r for r in records if r.id == row["id"])
            assert row["properties"]["mag"] == pytest.approx(original.properties["mag"] + 0.1, rel=1e-9)

    def test_upsert_ignores_older_updated_ms(self):
        """Upsert does not update when updated_ms is older or equal."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        # Initial insert
        upsert_earthquakes(records, TEST_DSN)

        # Try to upsert with older updated_ms
        older_records = []
        for rec in records:
            older_rec = EarthquakeRecord(
                id=rec.id,
                properties={**rec.properties, "mag": 9.9},  # Different mag
                lat=rec.lat,
                lon=rec.lon,
                depth_km=rec.depth_km,
                updated_ms=rec.updated_ms - 1000,  # Older
                event_time_ms=rec.event_time_ms,
            )
            older_records.append(older_rec)

        inserted, updated, skipped = upsert_earthquakes(older_records, TEST_DSN)

        assert inserted == 0
        assert updated == 0
        assert skipped == 5

        # Data should be unchanged
        latest = get_latest_earthquakes(10, TEST_DSN)
        assert all(row["version"] == 1 for row in latest)
        for row in latest:
            original = next(r for r in records if r.id == row["id"])
            assert row["properties"]["mag"] == original.properties["mag"]

    def test_upsert_mixed_new_and_existing(self):
        """Upsert handles mix of new and existing records."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        # Insert first 3
        upsert_earthquakes(records[:3], TEST_DSN)

        # Upsert all 5 (3 existing, 2 new)
        inserted, updated, skipped = upsert_earthquakes(records, TEST_DSN)

        assert inserted == 2
        assert updated == 0
        assert skipped == 3

        latest = get_latest_earthquakes(10, TEST_DSN)
        assert len(latest) == 5

    def test_get_latest_earthquakes_ordering(self):
        """get_latest_earthquakes returns records ordered by updated_ms desc."""
        data = load_fixture()
        records = [feature_to_record(f) for f in data["features"]]

        upsert_earthquakes(records, TEST_DSN)

        latest = get_latest_earthquakes(10, TEST_DSN)
        updated_ms_values = [row["updated_ms"] for row in latest]
        assert updated_ms_values == sorted(updated_ms_values, reverse=True)