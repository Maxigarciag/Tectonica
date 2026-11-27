---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, deduplicacion, persistencia]
relacionada: [decisiones/001-stack]
---

# Propuesta 002: Deduplicación y persistencia de eventos sísmicos

## Contexto
El worker de ingesta descarga el feed `all_hour.geojson` cada ejecución y guarda la respuesta cruda. Un mismo sismo puede aparecer en varias descargas con magnitud/ubicación actualizada (el USGS actualiza los eventos). La clave única es el campo `id` del evento (ej. `aka2026wnvxll`, `ci41361863`).

Decisión 001 define PostgreSQL como base de datos. Esta propuesta define cómo almacenar y deduplicar.

---

## Opciones

### Opción A: UPSERT por `id` + versión (recomendada)
**Esquema:** tabla `earthquakes` con PK `id`, columna `version` (entero), `properties` (JSONB), `geometry` (JSONB/PostGIS), `ingested_at`.

**Lógica:** `INSERT ... ON CONFLICT (id) DO UPDATE SET properties = EXCLUDED.properties, version = earthquakes.version + 1, ingested_at = NOW() WHERE EXCLUDED.properties->>'updated' > earthquakes.properties->>'updated'`.

**Trade-offs:**
- ✅ Simple, atómico, una sola tabla
- ✅ Conserva historial de actualizaciones vía `version`
- ✅ `updated` del USGS (epoch ms) permite comparar frescura
- ⚠️ Pierde snapshots intermedios (solo queda la última versión)
- ⚠️ Requiere índice en `properties->>'updated'` para consultas de "eventos actualizados recientemente"

---

### Opción B: Tabla de eventos + tabla de versiones (append-only)
**Esquema:** `earthquakes(id PK, latest_version FK)` + `earthquake_versions(id, version PK, properties JSONB, geometry JSONB, ingested_at)`.

**Lógica:** Cada ingesta inserta fila en `earthquake_versions`. Si `id` no existe en `earthquakes`, inserta ahí con `latest_version = 1`. Si existe, inserta versión N+1 y actualiza `latest_version`.

**Trade-offs:**
- ✅ Historial completo de cada actualización (auditoría, reprocesamiento)
- ✅ Consultas temporales fáciles ("¿cómo era este evento a las X?")
- ✅ Idempotencia natural: re-ingestar el mismo archivo no duplica si se chequea `(id, version, updated)`
- ⚠️ Más complejo (2 tablas, FK, transacciones)
- ⚠️ Más almacenamiento (pero volumen bajo: ~50k eventos/día × pocos KB)

---

### Opción C: Tabla raw + vista materializada deduplicada
**Esquema:** `raw_ingestions(ingestion_id, payload JSONB, ingested_at)` + vista `latest_earthquakes` que extrae el último `updated` por `id` via `jsonb_array_elements` + `DISTINCT ON`.

**Trade-offs:**
- ✅ Separación total: ingesta nunca falla por validación de esquema
- ✅ Reprocesamiento trivial (re-leer raw y refrescar vista)
- ✅ Schema-on-read flexible
- ⚠️ Consultas más lentas (parseo JSON en query time)
- ⚠️ Vista materializada requiere refresh periódico
- ⚠️ Menos ergonomía para API (necesita JOIN o vista)

---

## Recomendación
**Opción A** para empezar. Equilibrio entre simplicidad operativa y capacidad de deduplicar correctamente. Si luego se necesita historial completo, migrar a B es directo (añadir tabla de versiones y backfill).

## Preguntas abiertas
- ¿PostGIS desde el inicio para consultas geoespaciales (radio, bbox) o WKB en JSONB y migrar después?
- ¿Particionar por tiempo (mes) en `earthquakes` o `earthquake_versions`?
- ¿Índices: GIN en `properties` para filtros flexibles, BRIN en `ingested_at`?