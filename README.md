# Tectonica

Sistema de monitoreo sísmico global en tiempo real. Integra un pipeline de ingesta continua desde el feed oficial del **USGS** (*United States Geological Survey*), persistencia deduplicada en **PostgreSQL**, una API REST con caché en memoria en **FastAPI**, y un cliente web interactivo construido sobre **Three.js** y **TypeScript** con visualización geofísica sobre un globo 3D.

---

## Arquitectura General

```
USGS GeoJSON Feed (all_hour)
        │
        ▼
  Worker de Ingesta (src/ingest/usgs.py)
   ├── Snapshot crudo (data/raw/usgs/*.geojson)
   └── Upsert deduplicado ──▶ PostgreSQL (src/ingest/db.py)
                                    │
                                    ▼
                            API REST FastAPI (src/api/main.py)
                             ├── Caché TTL 30s + ETag
                             ├── GET /api/v1/earthquakes
                             ├── GET /api/v1/status
                             └── GET /health
                                    │
                                    ▼
                            Frontend 3D (frontend/src/)
                             ├── Globo Three.js + Placas PB2002
                             ├── Mapa de densidad gaussiano
                             └── Tablero telemétrico + Modo Oscuro/Claro
```

---

## Características Principales

### Pipeline y Backend
* **Ingesta continua y resiliente:** Consulta periódica al feed GeoJSON del USGS con reintentos exponenciales, validación de esquema, almacenamiento de respaldo local y *upsert* idempotente en PostgreSQL.
* **API REST optimizada:** Endpoints tipados con Pydantic (`EarthquakesResponse`, `StatusResponse`, `HealthResponse`), soporte de ventanas temporales (`hour`, `day`), filtrado por magnitud mínima, caché en memoria con TTL de 30 s y validación `ETag`.
* **Migraciones SQL:** Esquema versionado en `src/ingest/migrations/`.

### Visualización 3D e Interfaz
* **Globo 3D interactivo (Three.js):** Textura terrestre *Blue Marble* con máscara procedimental de rugosidad oceánica y atenuación polar, iluminación solar día/noche en tiempo real UTC y micro-rotación inercial tras inactividad.
* **Contexto geológico (Placas Tectónicas PB2002):** Capa vectorial 3D de límites litosféricos con corte en antimeridiano y resaltado dinámico de la falla más cercana al seleccionar un sismo.
* **Simulación sísmica:** Epicentros escalados por magnitud real, propagación de ondas P y S al seleccionar o detectar eventos nuevos, y mapa de densidad térmica gaussiano activable por capas.
* **Tablero telemétrico y controles:** Resumen general (conteo, magnitud máxima, último evento, nivel de actividad), distribución por magnitud con **filtro interactivo de un clic**, panel de detalle colapsable con línea temporal, notificaciones discretas (`M ≥ 2.5`) y dock inferior de reproducción, velocidad y zoom.
* **Modo Oscuro y Modo Claro:** Cambio instantáneo entre estética espacial oscura y estudio cartográfico claro sin parpadeo inicial (*anti-FOUC*), adaptando tanto los tokens CSS como la iluminación, el *blending* y el contraste de la escena WebGL.

---

## Estructura del Repositorio

```text
pulso-de-la-tierra/
├── src/
│   ├── api/
│   │   └── main.py                 # Aplicación FastAPI, caché ETag y endpoints REST
│   └── ingest/
│       ├── db.py                   # Pool de conexiones PostgreSQL, esquema y consultas
│       ├── usgs.py                 # Worker de ingesta continua desde USGS
│       └── migrations/             # Migraciones SQL incrementales
├── frontend/
│   ├── public/
│   │   ├── earth-day.jpg           # Textura superficial Blue Marble
│   │   ├── tectonic-plates.json    # Límites de placas tectónicas (PB2002 GeoJSON)
│   │   └── logo.svg
│   ├── src/
│   │   ├── main.ts                 # Orquestación de estado, eventos y ciclo de vida
│   │   ├── globe.ts                # Escena Three.js, shaders, capas 3D y cámara
│   │   ├── ui.ts                   # Interfaz DOM, tablero, inspector y notificaciones
│   │   ├── data.ts                 # Cliente HTTP y polling de estado/eventos
│   │   ├── visibility.ts           # Proyección esférica y visibilidad desde cámara
│   │   ├── liquidGlass.ts          # Integración de lentes WebGL (liquid-gl)
│   │   ├── colors.ts               # Paleta de magnitudes y utilidades cromáticas
│   │   ├── icons.ts                # Iconografía SVG
│   │   ├── types.ts                # Contratos TypeScript (DTOs)
│   │   └── styles.css              # Sistema de diseño, tokens y temas oscuro/claro
│   ├── tests/
│   │   └── verify_visibility.mjs   # Verificación matemática de proyección y horizonte
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
├── tests/                          # Suite de pruebas unitarias e integración (pytest)
├── scripts/                        # Scripts auxiliares SQL (ej. usuario de solo lectura)
├── docs/                           # Documentación técnica y registros de decisiones (ADR)
├── data/raw/usgs/                  # Snapshots GeoJSON descargados (ignorado por Git)
├── pyproject.toml                  # Dependencias Python y configuración Ruff / Mypy / Pytest
└── .env.example                    # Plantilla de variables de entorno
```

---

## Requisitos Previos

* **Python:** `>= 3.13`
* **Node.js:** `>= 18` y `npm`
* **PostgreSQL:** `>= 14`

---

## Instalación y Puesta en Marcha

### 1. Variables de entorno
Copiar la plantilla y configurar la cadena de conexión a PostgreSQL:

```bash
cp .env.example .env
```

Editar `.env`:
```env
DATABASE_URL=postgresql://usuario:password@localhost:5432/pulso_local
```

### 2. Backend (Python + FastAPI)
Crear y activar un entorno virtual, e instalar dependencias:

```bash
python -m venv .venv
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# Linux / macOS:
source .venv/bin/activate

pip install -e ".[dev]"
```

Ejecutar el worker de ingesta (en una terminal):
```bash
python -m src.ingest.usgs
```

Levantar el servidor de API (en otra terminal):
```bash
uvicorn src.api.main:app --reload --port 8000
```

### 3. Frontend (Vite + TypeScript)
Instalar dependencias e iniciar el servidor de desarrollo:

```bash
cd frontend
npm install
npm run dev
```

La aplicación quedará disponible en `http://127.0.0.1:5173/` (consumiendo la API en `http://127.0.0.1:8000/`).

---

## Endpoints de la API

| Método | Ruta | Parámetros | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | — | Estado operativo del servicio y si los datos están desactualizados (`stale`). |
| `GET` | `/api/v1/status` | — | Marca temporal de la última ingesta (`last_ingestion`) y antigüedad en segundos. |
| `GET` | `/api/v1/earthquakes` | `window` (`hour` \| `day`), `min_mag` (`float`), `limit` (`int`) | Lista de sismos normalizados con soporte de caché TTL 30 s y `ETag`. |

---

## Pruebas y Verificación

### Backend
```bash
pytest
ruff check src tests
mypy src
```

### Frontend
```bash
# Verificación de tipos (tsc) y build de producción (Vite)
npm --prefix frontend run build

# Verificación de proyección esférica y visibilidad de marcadores
node frontend/tests/verify_visibility.mjs
```

---

## Fuentes de Datos y Documentación

* **Sismicidad en tiempo real:** [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) (`all_hour.geojson`).
* **Límites de placas tectónicas:** Modelo PB2002 (*Peter Bird, 2003*).
* **Textura terrestre:** NASA *Blue Marble*.
* **Decisiones de arquitectura:** Ver carpeta `docs/decisiones/`.
