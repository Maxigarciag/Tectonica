# Texturas y assets geográficos (decisión 005)

## Archivos en `frontend/public/`

| Archivo | Estado | Origen | Licencia |
|---------|--------|--------|----------|
| `earth-day.jpg` | DISPONIBLE | NASA Blue Marble | Dominio público (NASA) |
| `tectonic-plates.json` | DISPONIBLE | Modelo PB2002 (Peter Bird, 2003) | Uso académico / público con atribución |
| `earth-night.jpg` | NO INCLUIDO (opcional) | NASA Black Marble | Dominio público (NASA) |
| `countries.geojson` | NO INCLUIDO (opcional) | Natural Earth 110 m | Dominio público |

## Estado actual

- `earth-day.jpg` se encuentra disponible en `frontend/public/earth-day.jpg` y se utiliza como textura superficial principal del globo, generando además en tiempo de ejecución la máscara procedimental de rugosidad oceánica en `globe.ts`.
- `tectonic-plates.json` se encuentra disponible en `frontend/public/tectonic-plates.json` para renderizar la capa vectorial 3D de límites de placas litosféricas.
- `earth-night.jpg` y `countries.geojson` permanecen como recursos opcionales no incluidos en el repositorio.

## Fallbacks activos para recursos opcionales

Si los archivos opcionales no están presentes en `frontend/public/`, la escena degrada de forma limpia sin errores fatales:

1. **`earth-night.jpg`**: La iluminación día/noche sigue operando mediante `DirectionalLight` calculada según la posición solar UTC real, sin mapa emisivo nocturno.
2. **`countries.geojson`**: Si la petición devuelve error o no existe el archivo, se omite silenciosamente el trazado de fronteras políticas manteniendo los continentes y las placas tectónicas.

## Referencias de origen y licencias

- `earth-day.jpg`: https://visibleearth.nasa.gov/images/55167/blue-marble-west (dominio público NASA — https://www.nasa.gov/multimedia/guidelines/index.html)
- `tectonic-plates.json`: Peter Bird (2003), *An updated digital model of plate boundaries* (PB2002), *Geochemistry, Geophysics, Geosystems*, 4(3), 1027.
