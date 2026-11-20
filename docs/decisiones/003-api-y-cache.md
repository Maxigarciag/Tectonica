---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, api, cache]
---

# 003: API y caché

## Contexto
El worker guarda eventos en PostgreSQL (ver [[002-deduplicacion-persistencia]]).
El frontend necesita leer esos datos sin consultar al USGS directamente
(ver [[00-contexto/proyecto]]). El USGS cachea sus feeds 60 s y puede
responder 429 si se consulta con demasiada frecuencia.

## Decisión
- **Worker:** consulta `all_hour.geojson` cada 60 s como mínimo. Usa la
  cabecera `Expires` de la respuesta para programar la próxima consulta,
  sin bajar de 60 s. Pide compresión (`Accept-Encoding: gzip`).
- **Errores del worker:** si el USGS falla o responde 429, conserva el
  último estado, registra el error y reintenta con backoff. No borra datos.
- **Migración:** agregar columna `event_time_ms BIGINT NOT NULL` con
  índice descendente, para filtrar por ventana sin leer el JSON.
- **Endpoints:**
  - `GET /api/v1/earthquakes?window=hour|day&min_mag=0&limit=500`
  - `GET /api/v1/status` (última ingesta, antigüedad, `stale`)
  - `GET /health` (error si la última ingesta tiene más de 5 min)
- **DTO de respuesta:** `id`, `mag`, `place`, `time` (ISO 8601 UTC), `lat`,
  `lon`, `depth_km`, `updated`. No se expone `properties` crudo.
- **Caché:** `Cache-Control: max-age=30` y `ETag` en la respuesta. Caché
  en memoria de 30 s dentro de la API. Sin Redis.
- **Acceso:** la API usa un usuario de PostgreSQL de solo lectura. CORS
  limitado al dominio del sitio. Rate limit propio en la API.
- **Datos viejos:** si la ingesta se detiene, la API sigue sirviendo el
  último estado con `stale: true` y la antigüedad.

## Alternativas descartadas
- Consultar al USGS desde el navegador: rompe el límite de tasa y expone
  el formato interno del feed.
- Redis: innecesario con un solo proceso de API.
- Devolver `properties` completo: acopla el frontend al formato del USGS.

## Consecuencias
- Hay que escribir una migración para `event_time_ms` y backfillear los
  registros existentes desde `properties->>'time'`.
- Si el USGS cambia el formato de `time` o `updated`, el mapeo se ajusta
  en un solo lugar.

## Revisión
Revisar si aparecen múltiples instancias de la API (entonces evaluar Redis)
o si el volumen de consultas supera lo que tolera el caché en memoria.