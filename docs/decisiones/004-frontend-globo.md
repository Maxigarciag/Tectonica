---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, visualizacion]
---

# 004: Frontend del globo

## Contexto
La API ya sirve eventos en [[003-api-y-cache]]. Falta la visualización
pública del proyecto ([[00-contexto/proyecto]]).

## Decisión
- **Estilo:** claro y didáctico. Textura terrestre clara, colores vivos
  por magnitud, fondo claro y legible.
- **Ventana:** selector entre "última hora" (`window=hour`) y "últimas
  24 horas" (`window=day`). Por defecto, última hora.
- **Stack:** Vite + TypeScript + Three.js, instalado por npm y empaquetado
  en el build. No se usan CDN en el sitio final.
- **Datos:** el frontend consulta solo `/api/v1/earthquakes` (nunca al
  USGS). Refresca cada 30 s, que coincide con el `max-age` de la API.
- **Desarrollo:** Vite hace proxy de `/api` hacia `http://127.0.0.1:8000`,
  así no hace falta CORS en local.
- **Producción:** el build se sirve desde la misma máquina que la API
  (Caddy), mismo origen, sin CORS.
- **Visualización:**
  - Magnitud: color por rango (verde, amarillo, naranja, rojo) y tamaño
    en escala logarítmica.
  - Profundidad: se muestra en el detalle de cada evento, no como altura
    en el globo.
  - Un evento se marca como reciente si ocurrió en los últimos 10 minutos.
- **Interfaz:**
  - Cabecera con título y selector de ventana.
  - Indicador de estado: "actualizado hace N s", o aviso si `stale` es true.
  - Panel lateral con cantidad de eventos y el de mayor magnitud.
  - Clic en un evento: muestra lugar, magnitud, profundidad y hora.
- **Atribución:** pie de página con "Datos: U.S. Geological Survey".
- **Textura terrestre:** usar una imagen con licencia verificada, y
  registrar su origen y licencia en `docs/fuentes/`.

## Alternativas descartadas
- Globo oscuro: se descartó porque el proyecto apunta a un público general.
- Consultar al USGS desde el navegador: rompe el límite de tasa y
  expone el formato interno del feed.
- globe.gl: oculta Three.js, que es el objetivo de aprendizaje.

## Consecuencias
- Hay que mantener dos modos de servir (Vite en desarrollo, Caddy en
  producción), pero el código del frontend es el mismo.
- La textura y sus licencias pasan a ser parte del repositorio.

## Revisión
Revisar si el volumen de visitas requiere caché en el borde (CDN).