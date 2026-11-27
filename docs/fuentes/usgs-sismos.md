---
tipo: fuente
estado: activa
fecha: 2026-11-14
tags: [fuente, sismos, usgs]
---

# USGS: feed de sismos

- Proveedor: U.S. Geological Survey.
- Formato: GeoJSON.
- Frecuencia de actualización: cada pocos minutos (verificar en la documentación oficial).
- Acceso: público, sin registro ni API key.
- Uso permitido: dominio público, citar la fuente.

## Verificar antes de implementar
- [x] Patrón de URL: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{magnitud}_{periodo}.geojson` (confirmado en varias fuentes; falta contrastar con la página oficial).
- [ ] Lista exacta de combinaciones válidas en la documentación oficial del USGS (las fuentes de terceros no coinciden).
- [ ] Límites de uso y encabezados recomendados.
- [ ] Campos del evento: id, magnitud, lugar, tiempo, coordenadas, profundidad.
- [ ] Guardar una respuesta real en `tests/fixtures/` para los tests.

## Comportamiento conocido
- Un nombre de feed inválido puede devolver HTTP 200 con el texto `404 File Not Found`. Validar el nombre y el formato antes de parsear.

## Notas
- Un mismo sismo puede aparecer varias veces con magnitud actualizada. La clave de deduplicación es el `id` del evento, y la lógica de "versión más nueva" está definida en [[decisiones/002-deduplicacion-persistencia]].