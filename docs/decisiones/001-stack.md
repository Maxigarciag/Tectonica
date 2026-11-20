---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, stack, arquitectura]
---

# 001: Stack del proyecto "Pulso de la Tierra"

## Contexto
Proyecto personal que muestra sismos en tiempo real sobre un globo 3D,
publicado en internet. Ver [[00-contexto/proyecto]].
Fuente principal: [[fuentes/usgs-sismos]].

## Decisión
- Backend: Python 3.13(desarrollo en 3.13.5), httpx, pydantic v2, FastAPI.
- Base de datos: PostgreSQL.
- Frontend: Vite, TypeScript, Three.js.
- Tests: pytest y Vitest, con fixtures de respuestas reales guardadas.
- Calidad: ruff, mypy, pre-commit.
- Contenedores: Docker Compose (worker, api, db, web).
- Deploy: VPS + Caddy (HTTPS automático). Frontend servido por la misma máquina.
- CI/CD: GitHub Actions.
- Monitoreo: endpoint /health, logs estructurados, UptimeRobot.

## Alternativas consideradas
- SQLite: más simple, pero migrar a Postgres después tiene costo.
- Kafka / Spark: sobredimensionado para este volumen.
- globe.gl: más rápido de armar, pero oculta Three.js, que es el objetivo de aprendizaje.
- Kubernetes: demasiada complejidad operativa para un proyecto personal.

## Consecuencias
- Hay que mantener un VPS (actualizaciones, backups de la base).
- El frontend nunca consulta al USGS directamente: todo pasa por la API con caché.
- Los datos del USGS son de dominio público, pero hay que citar la fuente en el sitio.

## Revisión
Revisar esta decisión si el volumen de visitas supera lo que aguanta un solo VPS,
o si aparece una fuente de datos que requiera otra arquitectura.

---

## Actualización 2026-11-14

- **Python: 3.13** (confirmado en entorno de desarrollo)

## Etapas implementadas
- [x] Ingesta: worker que descarga `all_hour.geojson`, valida `FeatureCollection`, guarda bytes crudos en `data/raw/usgs/`
- [x] Logging estructurado (JSON) con nivel, timestamp, evento y campos extra
- [x] Tests con pytest + httpx.MockTransport (10 tests: validación, guardado, fetch, integración)
- [x] Deduplicación y persistencia (decisión 002, Opción A): tabla `earthquakes` con PK `id`, `version`, `properties` JSONB, `lat`/`lon`, `updated_ms` BIGINT, `event_time_ms` BIGINT, upsert condicional por `updated_ms`
- [x] API FastAPI + caché (decisión 003): 3 endpoints, DTO, caché 30s con ETag, `Cache-Control: max-age=30`, 304, `stale`
- [ ] Frontend Three.js + globo 3D
- [ ] Despliegue VPS + Caddy