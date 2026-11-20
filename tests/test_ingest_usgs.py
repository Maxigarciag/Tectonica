"""Tests for USGS ingestion module."""

import json
from pathlib import Path

import httpx
import pytest

from src.ingest.usgs import calculate_poll_interval, fetch_feed, ingest_once, parse_expires_header, save_raw, validate_geojson


FIXTURE_PATH = Path("tests/fixtures/all_hour_sample.geojson")


@pytest.fixture
def valid_geojson_bytes() -> bytes:
    return FIXTURE_PATH.read_bytes()


@pytest.fixture
def valid_geojson_dict(valid_geojson_bytes) -> dict:
    return json.loads(valid_geojson_bytes)


class TestParseExpiresHeader:
    def test_valid_expires_header(self):
        expires = "Sat, 14 Nov 2026 05:45:34 GMT"
        result = parse_expires_header(expires)
        assert result is not None
        assert isinstance(result, int)

    def test_none_expires_returns_none(self):
        assert parse_expires_header(None) is None

    def test_empty_expires_returns_none(self):
        assert parse_expires_header("") is None

    def test_invalid_expires_returns_none(self):
        assert parse_expires_header("invalid") is None


class TestCalculatePollInterval:
    def test_uses_expires_when_valid(self):
        headers = httpx.Headers({"Expires": "Sat, 14 Nov 2026 05:45:34 GMT"})
        result = calculate_poll_interval(headers)
        assert result >= 60

    def test_minimum_interval_enforced(self):
        headers = httpx.Headers({"Expires": "Sat, 14 Nov 2026 05:44:00 GMT"})
        result = calculate_poll_interval(headers)
        assert result == 60

    def test_fallback_when_no_expires(self):
        headers = httpx.Headers({"Cache-Control": "public, max-age=60"})
        result = calculate_poll_interval(headers)
        assert result == 60


class TestValidateGeojson:
    def test_valid_fixture_accepted(self, valid_geojson_bytes):
        result = validate_geojson(valid_geojson_bytes)
        assert isinstance(result, dict)
        assert result["type"] == "FeatureCollection"
        assert "features" in result
        assert len(result["features"]) > 0

    def test_non_featurecollection_rejected(self):
        body = b'{"type": "Feature", "properties": {}}'
        with pytest.raises(ValueError, match="Tipo inesperado"):
            validate_geojson(body)

    def test_invalid_json_rejected(self):
        body = b"not valid json"
        with pytest.raises(json.JSONDecodeError):
            validate_geojson(body)


class TestSaveRaw:
    def test_saves_bytes_to_timestamped_file(self, tmp_path, valid_geojson_bytes):
        import src.ingest.usgs as usgs_module
        original_raw_dir = usgs_module.RAW_DIR
        usgs_module.RAW_DIR = tmp_path / "raw" / "usgs"
        try:
            path = save_raw(valid_geojson_bytes)
            assert path.exists()
            assert path.suffix == ".geojson"
            assert "all_hour_" in path.name
            assert path.read_bytes() == valid_geojson_bytes
        finally:
            usgs_module.RAW_DIR = original_raw_dir


class TestFetchFeed:
    def test_success_returns_bytes_and_interval(self, valid_geojson_bytes):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=valid_geojson_bytes, headers={"Expires": "Sat, 14 Nov 2026 05:45:34 GMT"})

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport)
        body, interval = fetch_feed(client)
        assert body == valid_geojson_bytes
        assert interval >= 60

    def test_http_error_raises_after_retries(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, content=b"Internal Server Error")

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport)

        # No dormir realmente durante los backoffs de reintento
        monkeypatch.setattr("src.ingest.usgs.time.sleep", lambda *args: None)

        with pytest.raises(RuntimeError, match="Failed to fetch feed after 5 attempts"):
            fetch_feed(client)

    def test_429_triggers_retry_then_raises(self, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, content=b"Rate Limited")

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport)

        # No dormir realmente durante los backoffs de reintento
        monkeypatch.setattr("src.ingest.usgs.time.sleep", lambda *args: None)

        with pytest.raises(RuntimeError, match="Failed to fetch feed after 5 attempts"):
            fetch_feed(client)

    def test_404_text_with_200_status_rejected_by_validation(self):
        body = b"404 File Not Found"

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=body)

        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport)

        result, _ = fetch_feed(client)
        assert result == body

        with pytest.raises(json.JSONDecodeError):
            validate_geojson(result)


class TestIngestOnce:
    def test_ingest_once_succeeds_with_valid_feed(self, tmp_path, valid_geojson_bytes, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=valid_geojson_bytes, headers={"Expires": "Sat, 14 Nov 2026 05:45:34 GMT"})

        transport = httpx.MockTransport(handler)

        import src.ingest.usgs as usgs_module
        original_raw_dir = usgs_module.RAW_DIR
        usgs_module.RAW_DIR = tmp_path / "raw" / "usgs"
        monkeypatch.setattr(usgs_module, "RAW_DIR", usgs_module.RAW_DIR)

        original_client = usgs_module.httpx.Client
        def mock_client(*args, **kwargs):
            return original_client(transport=transport, *args, **kwargs)
        monkeypatch.setattr(usgs_module.httpx, "Client", mock_client)

        monkeypatch.setattr(usgs_module, "init_schema", lambda: None)
        monkeypatch.setattr(usgs_module, "feature_to_record", lambda f: type("Rec", (), {
            "id": f["id"],
            "properties": f["properties"],
            "lat": f["geometry"]["coordinates"][1],
            "lon": f["geometry"]["coordinates"][0],
            "updated_ms": f["properties"]["updated"],
            "event_time_ms": f["properties"]["time"],
        })())
        monkeypatch.setattr(usgs_module, "upsert_earthquakes", lambda recs: (len(recs), 0, 0))

        try:
            event_count, inserted, updated, skipped, _ = ingest_once()
            assert event_count == 5
            assert inserted == 5
            assert updated == 0
            assert skipped == 0
            saved_files = list(usgs_module.RAW_DIR.glob("all_hour_*.geojson"))
            assert len(saved_files) == 1
            assert saved_files[0].read_bytes() == valid_geojson_bytes
        finally:
            usgs_module.RAW_DIR = original_raw_dir
            monkeypatch.setattr(usgs_module.httpx, "Client", original_client)

    def test_ingest_once_raises_on_http_error(self, tmp_path, monkeypatch):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, content=b"Service Unavailable")

        transport = httpx.MockTransport(handler)

        import src.ingest.usgs as usgs_module
        original_raw_dir = usgs_module.RAW_DIR
        usgs_module.RAW_DIR = tmp_path / "raw" / "usgs"
        monkeypatch.setattr(usgs_module, "RAW_DIR", usgs_module.RAW_DIR)

        original_client = usgs_module.httpx.Client
        def mock_client(*args, **kwargs):
            return original_client(transport=transport, *args, **kwargs)
        monkeypatch.setattr(usgs_module.httpx, "Client", mock_client)

        # No dormir realmente durante los backoffs de reintento
        monkeypatch.setattr("src.ingest.usgs.time.sleep", lambda *args: None)

        try:
            with pytest.raises(RuntimeError, match="Failed to fetch feed after 5 attempts"):
                ingest_once()
            saved_files = list(usgs_module.RAW_DIR.glob("all_hour_*.geojson"))
            assert len(saved_files) == 0
        finally:
            usgs_module.RAW_DIR = original_raw_dir
            monkeypatch.setattr(usgs_module.httpx, "Client", original_client)

    def test_ingest_once_raises_on_invalid_geojson(self, tmp_path, monkeypatch):
        bad_body = b'{"type": "Feature", "properties": {}}'

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, content=bad_body)

        transport = httpx.MockTransport(handler)

        import src.ingest.usgs as usgs_module
        original_raw_dir = usgs_module.RAW_DIR
        usgs_module.RAW_DIR = tmp_path / "raw" / "usgs"
        monkeypatch.setattr(usgs_module, "RAW_DIR", usgs_module.RAW_DIR)

        original_client = usgs_module.httpx.Client
        def mock_client(*args, **kwargs):
            return original_client(transport=transport, *args, **kwargs)
        monkeypatch.setattr(usgs_module.httpx, "Client", mock_client)

        try:
            with pytest.raises(ValueError, match="Tipo inesperado"):
                ingest_once()
            saved_files = list(usgs_module.RAW_DIR.glob("all_hour_*.geojson"))
            assert len(saved_files) == 0
        finally:
            usgs_module.RAW_DIR = original_raw_dir
            monkeypatch.setattr(usgs_module.httpx, "Client", original_client)


class TestMainLoop:
    """Tests for the main worker loop."""

    def test_main_single_iteration_uses_next_poll_interval(self, monkeypatch):
        """main() sleeps with next_poll_interval returned by ingest_once().

        Mocks time.sleep to raise SystemExit after the first call so the
        infinite loop is cut after one iteration. This guards against the
        NameError where poll_interval was undefined in main().
        """
        import src.ingest.usgs as usgs_module

        sleep_calls: list[float] = []

        def fake_sleep(seconds: float) -> None:
            sleep_calls.append(seconds)
            raise SystemExit(0)

        monkeypatch.setattr("src.ingest.usgs.time.sleep", fake_sleep)

        call_count = {"n": 0}

        def mock_ingest_once() -> tuple[int, int, int, int, int]:
            call_count["n"] += 1
            return 5, 5, 0, 0, 60  # event_count, inserted, updated, skipped, next_poll_interval

        monkeypatch.setattr(usgs_module, "ingest_once", mock_ingest_once)

        with pytest.raises(SystemExit):
            usgs_module.main()

        assert call_count["n"] == 1, "main() should call ingest_once() exactly once"
        assert len(sleep_calls) == 1, "main() should call time.sleep() exactly once"
        assert sleep_calls[0] == 60, "main() should sleep with next_poll_interval from ingest_once()"

