# Tectonica — Architecture & Implementation Reference

This document details the internal architecture, data model, HTTP caching mechanics, 3D geospatial math, and verified operational behaviors of **Tectonica**.

---

## 1. End-to-End Data Flow

1. **Upstream Polling (`src/ingest/usgs.py`):**
   - Requests `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` with `Accept-Encoding: gzip` and a custom `User-Agent`.
   - Parses the upstream HTTP `Expires` header to schedule the next polling cycle, enforcing a `60s` minimum floor (`MIN_POLL_INTERVAL = 60`) and falling back to `60s` when the header is absent or invalid.
   - Retries failed requests (`httpx.RequestError`, `5xx`, and explicit `HTTP 429` rate limits) up to 5 times with exponential backoff (`2s * 2^attempt`). Unhandled cycle failures are logged as structured JSON (`worker.cycle_failed`) without terminating the process or deleting existing records.

2. **Validation & Raw Archiving (`src/ingest/usgs.py`):**
   - Validates that the response decodes as JSON with `"type": "FeatureCollection"` (guarding against upstream `HTTP 200` responses containing plain-text `404 File Not Found` payloads).
   - Writes unmodified payload bytes to `data/raw/usgs/all_hour_<YYYYMMDDTHHMMSSZ>.geojson` before record transformation, enabling deterministic replay and auditability.

3. **Normalization & Idempotent Persistence (`src/ingest/db.py`):**
   - `feature_to_record()` extracts `id`, `lat`, `lon`, `depth_km`, `updated_ms`, and `event_time_ms` while preserving the full USGS `properties` dictionary. Missing `updated` or `time` fields raise a `ValueError`.
   - Connections are managed via `psycopg_pool.ConnectionPool` (`min_size=1`, `max_size=4`).
   - `upsert_earthquakes()` executes an atomic conditional upsert per record:

   ```sql
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
   ```

   - PostgreSQL's `xmax = 0` system column distinguishes newly inserted rows (`True`) from updated rows (`False`), while rows failing the `WHERE` predicate return no tuple and are counted as `skipped`.

4. **API Serving & Caching (`src/api/main.py`):**
   - Exposes typed Pydantic v2 models (`EarthquakeDTO`, `EarthquakesResponse`, `StatusResponse`, `HealthResponse`) without leaking raw `JSONB` `properties`.
   - `SimpleCache` stores serialized JSON payloads in memory for `30s` keyed by `earthquakes:{window}:{min_mag}:{limit}` alongside a 16-character SHA-256 `ETag`.
   - Matching `If-None-Match` request headers short-circuit database execution and return `HTTP 304 Not Modified` with `Cache-Control: max-age=30`.
   - `scripts/create_readonly_user.sql` defines an optional least-privilege `api_readonly` PostgreSQL role restricted to `SELECT` on `earthquakes`.

---

## 2. Database Schema & Migrations

### Hybrid Table Layout

| Column | Type | Purpose |
| :--- | :--- | :--- |
| `id` | `TEXT PRIMARY KEY` | Official USGS event identifier (e.g., `ci41361863`) |
| `version` | `INTEGER NOT NULL` | Starts at `1`; increments only when `EXCLUDED.updated_ms` is newer |
| `properties` | `JSONB NOT NULL` | Complete upstream USGS properties payload (`GIN`-indexed) |
| `lat`, `lon` | `DOUBLE PRECISION NOT NULL` | Extracted WGS84 coordinates |
| `depth_km` | `REAL NULL` | Hypocenter depth in kilometers (added via migration `002`) |
| `updated_ms` | `BIGINT NOT NULL` | Upstream revision epoch in milliseconds (`B-Tree`-indexed) |
| `event_time_ms` | `BIGINT NOT NULL` | Origin timestamp in epoch milliseconds (`B-Tree`-indexed) |
| `ingested_at` | `TIMESTAMPTZ NOT NULL` | Database persistence timestamp (`B-Tree`-indexed) |

### Incremental SQL Migrations (`src/ingest/migrations/`)

- [`001_add_event_time_ms.sql`](../src/ingest/migrations/001_add_event_time_ms.sql): Staged migration for legacy schemas—adds nullable `event_time_ms`, backfills from `(properties->>'time')::BIGINT`, verifies zero `NULL` rows inside a `DO $$` block, enforces `NOT NULL`, and adds a descending index (`idx_earthquakes_event_time_ms_desc`).
- [`002_add_depth_km.sql`](../src/ingest/migrations/002_add_depth_km.sql): Adds `depth_km REAL NULL` (`ADD COLUMN IF NOT EXISTS`).

---

## 3. 3D Geospatial Rendering & Frontend Architecture

- **Analytical Horizon Culling (`frontend/src/visibility.ts`):**
  - Instead of costly per-frame mesh occlusion raycasts against the Earth sphere, visibility of a surface point $P$ on a sphere of radius $R = 100$ from camera position $C$ at distance $d = \|C\|$ is computed analytically via:
    $$\frac{P_{\text{world}} \cdot C}{R \cdot d} \ge \frac{R}{d}$$
  - Verified across full $0 \to 2\pi$ orbital sweeps in `frontend/tests/verify_visibility.mjs`.

- **Viewport-Calibrated Marker Clamping (`frontend/src/globe.ts`):**
  - Marker radius follows a logarithmic magnitude curve ($\log_{10}(\text{mag} + 1)$) calibrated at reference camera distance `219` and clamped dynamically per frame using real camera-to-sprite distance and canvas height (`PX_FACTOR`) so screen size stays within `4.5 px`–`26 px`.

- **Tectonic Boundaries & Antimeridian Handling (`frontend/public/tectonic-plates.json`):**
  - Renders **PB2002** `LineString` and `MultiLineString` geometries slightly above the surface (`R + 0.22`), subdividing spans every `3°` for spherical curvature fidelity and skipping segments where $|\Delta \text{lon}| > 180^\circ$ to prevent cross-globe antimeridian artifacts. Selecting an event highlights the nearest fault segments within spatial proximity.

- **Spherical Gaussian Density Heatmap (`frontend/src/globe.ts`):**
  - Accumulates additive radial gradients onto a `1024x512` offscreen 2D canvas, scaling horizontal kernel width by $1 / \cos(\text{lat})$ (clamped at `0.3`) to counteract equirectangular stretching near the poles, then maps intensity (`0–255`) through an RGBA thermal lookup table (`CanvasTexture`).

- **Procedural Ocean Roughness & Dual Themes (`frontend/src/globe.ts`, `frontend/src/styles.css`):**
  - Generates an ocean roughness map on the fly from NASA *Blue Marble* RGB channels with polar attenuation above `60°` latitude to avoid specular glare over polar ice.
  - Synchronizes CSS custom properties (`[data-theme="dark" | "light"]`, initialized inline in `index.html` to prevent FOUC) with WebGL lighting (`DirectionalLight` + `HemisphereLight`) and marker blending (`AdditiveBlending` in dark mode, `NormalBlending` in light mode).
  - Reuses shared `SpriteMaterial` instances per magnitude bin and a single `RingGeometry` for expanding waves, with explicit GPU disposal on teardown.

---

## 4. Known Operational Behaviors & Current Limitations

The following behaviors reflect the exact current implementation without workarounds:

1. **Migration Initialization Order (`init_schema` vs. `002_add_depth_km.sql`):**
   - `init_schema()` in `src/ingest/db.py` creates `earthquakes` including `event_time_ms`, so `001_add_event_time_ms.sql` is already reflected in fresh tables (though safe and idempotent to run).
   - However, `init_schema()` does **not** include `depth_km` in its `CREATE TABLE` DDL, whereas `UPSERT_SQL` inserts into `depth_km`. On a newly created database (`pulso_local` or `pulso_test`), `init_schema()` must be followed by `psql "$DATABASE_URL" -f src/ingest/migrations/002_add_depth_km.sql` before the worker or integration tests insert records.

2. **Time Window Accumulation (`window=day`):**
   - The ingestion worker polls USGS `all_hour.geojson` exclusively; it does not fetch `all_day.geojson` on startup.
   - Consequently, `GET /api/v1/earthquakes?window=day` returns up to 24 hours of events **persisted locally in PostgreSQL**. On a fresh database, `window=day` initially mirrors the past hour and populates a full 24-hour history as the worker continues running.

3. **Freshness Heuristic (`MAX(ingested_at)` & Status Polling):**
   - `/health` and `/api/v1/status` compute staleness as `NOW() - MAX(ingested_at) > 300s` (`5 minutes`).
   - Because `UPSERT_SQL` updates `ingested_at = NOW()` only when a row is newly inserted or has a strictly newer `updated_ms`, a 5-minute window in which the USGS feed contains zero new or revised earthquakes causes `MAX(ingested_at)` to age past `300s`, reporting `stale: true` (`status: "degraded"`) even while the worker loop is healthy.
   - On the frontend (`frontend/src/data.ts`), `startStatusClient()` schedules its first `/api/v1/status` poll after the initial `30s` timer (`REFRESH_MS`), so the header status pill displays `"Cargando…"` during the first 30 seconds after page load while earthquake data renders immediately.

---

## 5. Architecture Decision Records Index

Original design notes and ADRs (authored in Spanish during development):

- **Context & Sources:** [`00-contexto/proyecto.md`](00-contexto/proyecto.md) · [`fuentes/usgs-sismos.md`](fuentes/usgs-sismos.md) · [`fuentes/textura-terrestre.md`](fuentes/textura-terrestre.md)
- **001 — Stack Selection:** [`decisiones/001-stack.md`](decisiones/001-stack.md)
- **002 — Deduplication & Persistence Options:** [`inbox/002-deduplicacion-persistencia.md`](inbox/002-deduplicacion-persistencia.md)
- **003 — API Contract & Caching:** [`decisiones/003-api-y-cache.md`](decisiones/003-api-y-cache.md)
- **004 — Initial Globe Frontend:** [`decisiones/004-frontend-globo.md`](decisiones/004-frontend-globo.md)
- **005 — Observatory Visual Direction:** [`decisiones/005-direccion-visual.md`](decisiones/005-direccion-visual.md)
- **006 — Interactive Dashboard:** [`decisiones/006-interfaz-interactiva.md`](decisiones/006-interfaz-interactiva.md)
- **007 — Typography & Color Scale:** [`decisiones/007-tipografia-y-color.md.md`](decisiones/007-tipografia-y-color.md.md)
- **008 — Raycasting, Camera & Layout:** [`decisiones/008-interaccion-y-layout.md.md`](decisiones/008-interaccion-y-layout.md.md)
- **009 — Light Theme & Cohesion:** [`decisiones/009-tema-claro-y-cohesion.md`](decisiones/009-tema-claro-y-cohesion.md)
- **010 — Seismic Marker Hierarchy:** [`decisiones/010-visualizacion-sismica.md.md`](decisiones/010-visualizacion-sismica.md.md)
- **011 — Distance-Aware Marker Clamping:** [`decisiones/011-escalado-marcadores.md.md`](decisiones/011-escalado-marcadores.md.md)
