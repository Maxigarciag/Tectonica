---
tipo: contexto
estado: en-curso
fecha: 2026-11-14
tags:
  - proyecto
  - pipeline
  - sismos
---

# Contexto del proyecto

## Objetivo
Mostrar los sismos del mundo casi en tiempo real sobre un globo 3D interactivo,
publicado en internet, con datos tomados de fuentes públicas.

## Qué significa que funcione
- Los sismos nuevos aparecen en el sitio dentro de 1 minuto desde que el
  USGS los publica. El USGS informa que muchos eventos fuera de EE. UU.
  se publican 15 minutos o más después del origen, así que el criterio
  mide desde la publicación, no desde el sismo.
- El pipeline corre sin intervención durante 24 h seguidas.
- Un dato malformado no tumba el pipeline: se registra en el log y se descarta.
- Reprocesar los datos crudos produce el mismo resultado (idempotencia).
- El sitio responde aunque la fuente externa esté caída, mostrando el último dato válido.

## Fuentes de datos
- USGS: feed de sismos, formato GeoJSON, frecuencia de actualización de pocos minutos (verificar), ver [[fuentes/usgs-sismos]].

## Stack
- Backend: Python 3.12, httpx, pydantic v2, FastAPI + uvicorn.
- Almacenamiento: PostgreSQL.
- Frontend: Vite, TypeScript, Three.js.
- Tests: pytest (backend), Vitest (frontend).
- Calidad: ruff, mypy, pre-commit.
- Contenedores: Docker Compose (fase de despliegue; en desarrollo local no es obligatorio).
- Deploy: VPS + Caddy (HTTPS automático).
- CI/CD: GitHub Actions.
- Monitoreo: endpoint /health, logs estructurados, UptimeRobot.
- Detalle y justificación en [[decisiones/001-stack]].

## Restricciones
- Proyecto personal, presupuesto cero (planes gratuitos y VPS económico).
- Sin datos sensibles en el repositorio. Secretos solo en variables de entorno.
- El frontend nunca consulta al USGS directamente: todo pasa por la API con caché.
- Límites de uso del USGS: verificar en su documentación oficial antes de implementar.
- Citar al USGS como fuente en el sitio.

## Reglas para el agente
- Leer este archivo y las notas de `decisiones/` y `fuentes/` antes de actuar.
- No modificar carpetas fuera de `docs/` y `src/` sin pedirlo.
- No inventar campos ni URLs de la fuente: verificar contra la documentación o contra una respuesta real guardada en `tests/fixtures/`.
- Guardar decisiones importantes en `decisiones/`, con número secuencial.
- Proponer notas nuevas en `inbox/`, no crearlas directamente en otras carpetas.
- Al terminar una tarea, actualizar la sección "Estado actual" de este archivo.

## Estado actual
- Estructura del vault creada.
- Stack definido (ver decisión 001).
- Worker de ingesta funcionando: descarga `all_hour.geojson`, valida `FeatureCollection`, guarda bytes crudos en `data/raw/usgs/`.
- Logging estructurado JSON implementado.
- **Scheduler con Expires/backoff**: worker programa próxima consulta según cabecera `Expires` (mín 60s, fallback 60s), pide gzip, reintenta con backoff ante error/429 sin borrar datos.
- **Migración `event_time_ms`**: columna `BIGINT NOT NULL` con índice descendente, backfill desde `properties->>'time'`.
- Tests con pytest (18 tests pasando): validación, guardado, fetch con MockTransport, scheduler, integración `ingest_once()`.
- Fixture real guardada en `tests/fixtures/all_hour_sample.geojson`.
- **Decisión 002 implementada (Opción A)**: persistencia en PostgreSQL con tabla `earthquakes` (PK `id`, `version`, `properties` JSONB, `lat`/`lon` DOUBLE PRECISION, `updated_ms` BIGINT, `event_time_ms` BIGINT). Upsert con comparación numérica de `updated_ms`. Tests unitarios e integración (10 tests pasando).
- **Decisión 003 implementada**: API FastAPI con 3 endpoints (`/health`, `/api/v1/status`, `/api/v1/earthquakes`), DTO sin `properties` crudo, caché en memoria 30s con ETag y `Cache-Control: max-age=30`, 304 en ETag match, `stale=true` cuando ingesta se detiene.
- Tests API (16 tests): DTO, filtro por ventana, ETag/304, `/health` con ingesta vieja, `stale=true` cuando ingesta se detuvo.
- Pendiente de verificar: límites de uso USGS en [[fuentes/usgs-sismos]].

- Próximo paso: Frontend Three.js + globo 3D (decisión 001).
- **Frontend implementado (decisión 005)**: Vite + TypeScript + Three.js en `frontend/`.
  - Globo 3D con textura día/noche (Earth-day/Earth-night) con mezcla según posición del sol, océano con brillo especular, atmósfera halo celeste.
  - Campo de estrellas procedural, fronteras de países desde GeoJSON.
  - Sismos como pulsos de luz aditivos: tamaño logarítmico por magnitud, color por rango, trazo vertical por profundidad, anillo expansivo < 10 min, halo mag ≥ 4.
  - OrbitControls con inercia y zoom limitado (150-600).
  - UI panel oscuro: conteo de eventos, magnitud máxima, histograma de magnitudes, eventos por hora, lista de eventos recientes con elipsis.
  - Detalle al clic: rota cámara, muestra id/lugar/magnitud/profundidad/hora UTC/enlace USGS.
  - Indicador único de actualización con cuenta regresiva en tiempo real (verde/ámbar/rojo).
  - `npm run build` y `tsc --noEmit` pasan sin errores.
  - Limitación del entorno: no se pudo verificar en tiempo real que el frontend cargue datos de la API en 8000 debido a que los procesos en background no persisten entre llamadas de terminal.