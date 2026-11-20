---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, color, tipografia]
---

# 007: Tipografía y color

## Contexto
La interfaz usaba una tipografía redondeada y colores celeste, rosa y violeta
que no transmitían magnitud. El celeste de la atmósfera competía con los sismos
menores, y el ámbar del estado se confundía con la escala de magnitud.

## Decisión
- Interfaz en Inter; cifras en JetBrains Mono con tabular-nums. Autohospedadas.
- Escala de magnitud secuencial, de amarillo pálido a rojo profundo, en cinco
  tramos: <2, 2-3, 3-4, 4-5, >=5.
- Atmósfera y acento de UI en celeste (#7dd3fc y #38bdf8), reservados para
  esos usos.
- Estado de conexión en texto y punto neutro, sin usar colores de la escala.
- Tamaño y número acompañan al color en todos los casos.

## Alternativas descartadas
- Escala arcoíris: no es ordenada ni accesible.
- Estado con ámbar: se confunde con la escala de magnitud.

## Consecuencias
- Hay que actualizar los colores de la leyenda, de los puntos y de los
  histogramas para que usen la misma escala.
- Se agregan dos fuentes al repositorio, con licencia OFL documentada en
  docs/fuentes/.

## Revisión
Revisar si la escala necesita un modo para daltonismo tipo protanopía.