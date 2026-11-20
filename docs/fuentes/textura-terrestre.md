# Texturas y assets geográficos (decisión 005)

## Archivos en `frontend/public/`

| Archivo | Estado | Origen | Licencia |
|---------|--------|--------|----------|
| `earth-day.jpg` | FALTANTE | NASA Blue Marble | Dominio público (NASA) |
| `earth-night.jpg` | FALTANTE | NASA Black Marble | Dominio público (NASA) |
| `countries.geojson` | FALTANTE | Natural Earth 110 m | Dominio público |

## Estado actual

Ninguno de los tres archivos de assets mencionados en la decisión 005 está presente en `frontend/public/`. Solo existe `earth-texture.jpg` (de la decisión 004, reemplazada por 005).

## Fallback implementado

Si los archivos faltan, el código usa fallbacks procedimentales:

1. **earth-day / earth-night**: El shader del globo usa colores planos (azul oceánico para día, negro con puntos para noche) en lugar de texturas de imagen. La mezcla día/noche se calcula desde la posición del sol basada en la hora UTC actual.

2. **countries.geojson**: Si el fetch falla, no se dibujan fronteras de países. El globo se muestra sin bordes nacionales.

## Próximo paso

Descargar y colocar en `frontend/public/`:
- `earth-day.jpg`: https://visibleearth.nasa.gov/images/55167/blue-marble-west (dominio público NASA)
- `earth-night.jpg`: https://visibleearth.nasa.gov/images/55167/black-marble (dominio público NASA)
- `countries.geojson`: https://naturalearth.s3.amazonaws.com/110m_cultural/ne_110m_admin_0_countries.geojson (dominio público)

Las imágenes de la NASA están en **dominio público** (NASA media usage policy: https://www.nasa.gov/multimedia/guidelines/index.html).

## Licencias de fallbacks actuales

Texturas procedimentales generadas para el proyecto Pulso de la Tierra. Sin restricciones de uso.
