<div align="center">

# Tectonica

**Near real-time seismic data pipeline and interactive 3D geospatial observatory**

[![Python 3.13+](https://img.shields.io/badge/Python-3.13%2B-0369a1?style=flat-square&labelColor=0f172a)](https://www.python.org/)
[![PostgreSQL 14+](https://img.shields.io/badge/PostgreSQL-14%2B-0369a1?style=flat-square&labelColor=0f172a)](https://www.postgresql.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-REST%20API-0369a1?style=flat-square&labelColor=0f172a)](https://fastapi.tiangolo.com/)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-0369a1?style=flat-square&labelColor=0f172a)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-0369a1?style=flat-square&labelColor=0f172a)](https://threejs.org/)

<br />

<img src="docs/gifs/demo.gif" alt="Tectonica — Interactive 3D Seismic Observatory Demo" width="100%" />

</div>

---

## Overview

Public seismic feeds publish flat GeoJSON snapshots where individual events are repeatedly revised as monitoring stations refine magnitude and epicenter estimates. Querying those feeds directly from the browser couples the interface to external schemas, risks upstream rate limits, and provides no local persistence.

**Tectonica** ingests official earthquake feeds from the **U.S. Geological Survey (USGS)** via periodic near real-time polling, deduplicates and versions records in **PostgreSQL**, serves typed contracts through a cached **FastAPI** service, and visualizes global seismic activity on an interactive **Three.js** globe.

---

## Key Features

- **Resilient Near Real-Time Ingestion** — Adaptive Python worker polling USGS GeoJSON feeds (`>= 60s` floor via `Expires` headers) with exponential backoff, raw snapshot archiving, and conditional PostgreSQL upserts.
- **Interactive 3D Globe** — Custom Three.js scene with NASA *Blue Marble* imagery, procedural ocean specular roughness, real-time UTC solar lighting, and smooth orbital camera flights.
- **Tectonic Plates & Density Heatmap** — 3D **PB2002** plate boundaries with nearest-fault highlighting on event selection, paired with a latitude-compensated Gaussian thermal density layer.
- **Telemetry & One-Click Filtering** — Live summary metrics, interactive 5-bin magnitude distribution filter, synchronized list-to-globe selection, collapsible event inspector, and `M >= 2.5` toast alerts.
- **Freshness Monitoring & Fallback** — Health and status endpoints track ingestion recency, while the client preserves the last valid dataset during transient network failures.
- **Dual Themes & Scene Controls** — Flash-free switching between **Dark Observatory** and **Light Cartographic Studio** modes, refractive HUD panels, stylized P/S wave visual cues, and playback/zoom controls.

---

## System Architecture

```mermaid
flowchart LR
    USGS["USGS GeoJSON Feed"] -->|"HTTPS Poll (>=60s)"| Worker["Python Ingestion Worker"]
    Worker -->|"Raw bytes"| Raw[("Raw Snapshots (data/raw/usgs/)")]
    Worker -->|"Conditional Upsert"| PG[("PostgreSQL (earthquakes)")]
    PG -->|"Indexed Read"| API["FastAPI (TTL + ETag Cache)"]
    API -->|"REST JSON / 304"| UI["Three.js 3D Frontend"]

    classDef primary fill:#0f172a,stroke:#38bdf8,stroke-width:1.5px,color:#f8fafc
    classDef storage fill:#0f172a,stroke:#94a3b8,stroke-width:1.5px,color:#f8fafc
    class USGS,Worker,API,UI primary
    class Raw,PG storage
```

For schema details, upsert SQL, 3D spherical math, and operational notes, see [`docs/architecture.md`](docs/architecture.md).

```text
Tectonica/
├── src/
│   ├── ingest/              # USGS polling worker (usgs.py), PostgreSQL pool/upsert (db.py) & SQL migrations
│   └── api/                 # FastAPI endpoints, Pydantic DTOs & in-memory ETag cache (main.py)
├── frontend/
│   ├── public/              # NASA Blue Marble texture & PB2002 tectonic plates GeoJSON
│   ├── src/                 # Three.js globe (globe.ts), telemetry UI (ui.ts), HTTP client & visibility math
│   └── tests/               # Spherical projection & horizon culling verification
├── tests/                   # Backend unit & PostgreSQL integration suites (pytest)
├── scripts/                 # Least-privilege read-only PostgreSQL role script
└── docs/                    # Architecture reference (architecture.md), ADRs & demo capture
```

---

## Engineering Highlights

| Challenge | Implemented Solution |
| :--- | :--- |
| **Mutable upstream events** | Atomic `INSERT ... ON CONFLICT (id) DO UPDATE` guarded by `WHERE EXCLUDED.updated_ms > earthquakes.updated_ms` increments `version` only on newer revisions and uses `RETURNING (xmax = 0)` to classify inserts, updates, and skips. |
| **Rate limits & transient faults** | Adaptive scheduling respects upstream `Expires` headers (`60s` floor) with `gzip` compression, 5-attempt exponential backoff on `429`/`5xx` errors, and isolated worker cycles that preserve existing state. |
| **Raw data auditability** | Validated `FeatureCollection` payloads are archived unmodified as UTC-timestamped `.geojson` files prior to normalization into a hybrid relational + `JSONB` (`B-Tree` & `GIN`) schema. |
| **Schema decoupling** | Strict input validation rejects malformed upstream responses, while FastAPI serves flat Pydantic v2 DTOs (`EarthquakeDTO`) decoupled from raw USGS `properties`. |
| **Polling read amplification** | An in-memory `SimpleCache` (`30s` TTL) paired with `Cache-Control: max-age=30` and SHA-256 `ETag` headers short-circuits unchanged client polls with `HTTP 304 Not Modified`. |
| **Pipeline observability** | Structured JSON logs report per-cycle `inserted`/`updated`/`skipped` counts, and `/health` + `/api/v1/status` evaluate `MAX(ingested_at)` against a `300s` staleness threshold. |
| **Deterministic verification** | Unit tests simulate upstream HTTP edge cases via `httpx.MockTransport` and saved USGS fixtures, complemented by isolated PostgreSQL integration tests and Node.js 3D visibility assertions. |
| **3D spherical accuracy** | Analytical horizon culling (`dot(normalize(P), normalize(C)) >= R / d`), viewport-calibrated marker clamping (`4.5–26 px`), antimeridian segment splitting, and `1 / cos(lat)` heatmap scaling prevent globe artifacts. |

---

## Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Data Engineering** | Python `>= 3.13`, `httpx`, `psycopg` v3 (`psycopg_pool`), structured JSON `logging` |
| **Storage** | PostgreSQL `>= 14` (Relational + `JSONB`, `B-Tree` & `GIN` indexes, SQL migrations) |
| **Backend & API** | FastAPI, Pydantic v2, Uvicorn |
| **Frontend & 3D** | TypeScript, Three.js, Vite, HTML5 Canvas, `liquid-gl`, CSS Custom Properties |
| **Testing & Quality** | `pytest`, Ruff, Mypy, TypeScript (`tsc`), Node.js `assert` |

---

## Getting Started

### Prerequisites

- **Python** `>= 3.13`, **Node.js** `>= 18` (`npm`), and **PostgreSQL** `>= 14`

### 1. Database & Environment

Create a local database (e.g., `pulso_local`) and export `DATABASE_URL`. **The application does not auto-load `.env` files**, so set `DATABASE_URL` in every terminal running the worker or API (URL-encode special password characters):

```powershell
# Windows (PowerShell)
$env:DATABASE_URL = "postgresql://USER:PASSWORD@localhost:5432/pulso_local"
```

```bash
# Linux / macOS
export DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/pulso_local"
```

### 2. Backend Setup & Schema Initialization

`init_schema()` creates the base `earthquakes` table (including `event_time_ms`), while `depth_km` is added via migration `002` and must be applied before the first ingestion run:

```bash
python -m venv .venv
# Activate: .venv\Scripts\Activate.ps1 (PowerShell) | source .venv/bin/activate (Bash)

pip install -e ".[dev]"
python -c "from src.ingest.db import init_schema; init_schema()"
psql "$DATABASE_URL" -f src/ingest/migrations/002_add_depth_km.sql
```

*(In PowerShell, pass `$env:DATABASE_URL` to `psql`. Legacy migration `001_add_event_time_ms.sql` is also idempotent if needed.)*

### 3. Run Services

Run each service in a separate terminal (with `.venv` active and `DATABASE_URL` set for Python processes):

```bash
# Terminal 1 — Ingestion worker
python -m src.ingest.usgs

# Terminal 2 — REST API (http://127.0.0.1:8000)
python -m uvicorn src.api.main:app --reload --port 8000

# Terminal 3 — Frontend dev server (http://127.0.0.1:5173, proxies /api to :8000)
cd frontend && npm install && npm run dev
```

---

## API Reference

| Method | Endpoint | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | — | Service status (`healthy` \| `degraded`) and `stale` flag (`MAX(ingested_at)` older than `300s`). |
| `GET` | `/api/v1/status` | — | Latest `ingested_at` UTC timestamp, `age_seconds`, and `stale` boolean. |
| `GET` | `/api/v1/earthquakes` | `window` (`hour` \| `day`), `min_mag` (`0–10`), `limit` (`1–1000`) | Filtered earthquake DTOs with `30s` TTL cache, `ETag`, and `304 Not Modified` support. |

> [!NOTE]
> Because the worker polls `all_hour.geojson` exclusively, `window=day` queries up to 24 hours of events accumulated locally in PostgreSQL since the worker started. In addition, `ingested_at` updates only on new inserts or upstream revisions, so `> 5` minutes without new global seismic updates marks `stale: true` even while polling is active (see [`docs/architecture.md`](docs/architecture.md#4-known-operational-behaviors--current-limitations)).

---

## Testing & Documentation

```bash
# Backend unit tests, linting, and type checking
python -m pytest
ruff check src tests
mypy --explicit-package-bases src

# Optional PostgreSQL integration suite (apply migration 002 to pulso_test first)
# PowerShell: $env:TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/pulso_test"; python -m pytest -v
TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/pulso_test" python -m pytest -v

# Frontend type check, production bundle, and 3D visibility math tests
npm --prefix frontend run build
node frontend/tests/verify_visibility.mjs
```

- **System Architecture & Operational Reference:** [`docs/architecture.md`](docs/architecture.md)
- **Architecture Decision Records (Spanish):** [`docs/decisiones/`](docs/decisiones/) — Key records include [001 Stack](docs/decisiones/001-stack.md), [002 Deduplication & Persistence](docs/inbox/002-deduplicacion-persistencia.md), [003 API & Cache](docs/decisiones/003-api-y-cache.md), and [011 Marker Scaling](docs/decisiones/011-escalado-marcadores.md.md).

---

## Data Sources & Credits

- **Seismic Data:** [U.S. Geological Survey (USGS) — Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) (`all_hour.geojson`, public domain).
- **Tectonic Boundaries:** Peter Bird (2003), *PB2002* digital model of plate boundaries.
- **Planetary Imagery & Typography:** [NASA Visible Earth (*Blue Marble*)](https://visibleearth.nasa.gov/) (public domain) · *Inter* & *JetBrains Mono* (SIL OFL).
