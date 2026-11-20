---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, interaccion, layout]
---

# 008: Interacción, layout y marcadores

## Contexto
La decisión [[006-interfaz-interactiva]] marcó como implementado el clic en
sismos, pero no funciona. La tarjeta de detalle es texto plano y, al cerrarla,
la vista de la cámara queda desorientada. El histograma por hora no renderiza.
El panel derecho es estrecho y las listas se cortan.

## Decisión
- **Raycasting** sobre los marcadores (no sobre la esfera) para hover y clic.
- **Tarjeta de detalle** flotante con magnitud, lugar, hora local y UTC,
  profundidad, coordenadas, id, updated y enlace al USGS. Se cierra con Escape.
- **Cámara:** al abrir el detalle se guarda posición y target de la cámara; al
  cerrar se restauran. El globo nunca queda sin referencia.
- **Buscador rápido** arriba: filtra por lugar o magnitud. Al elegir un
  resultado, la cámara vuela al punto y abre la tarjeta.
- **Layout:** panel derecho con secciones (Resumen, Magnitudes, Actividad,
  Más fuertes) y ancho redimensionable arrastrando su borde. Leyenda de
  magnitud en el costado izquierdo del globo.
- **Marcadores:** núcleo cuyo tamaño sigue a la magnitud, halo suave, anillo de
  pulso para magnitud 4 o más, y línea de profundidad. Colores de la 007.
- **Ventana:** control segmentado "1 h | 24 h".
- **Estado:** pill neutro con punto de color y texto "En vivo · hace N s". El
  color solo indica conexión: verde al día, gris desactualizado, rojo error.
  Sin semáforo, para no chocar con la escala de magnitud.
- **Título:** [nombre a definir].
- **Histograma por hora:** debe renderizar. Ver criterio de la 006.

## Alternativas descartadas
- Semáforo para el estado: el rojo colisiona con la magnitud alta.
- Tarjeta como texto en el panel: no permite navegar desde el mapa.

## Consecuencias
- La 006 queda parcialmente reemplazada en interacción y layout.
- El modo claro y oscuro se implementa como fase posterior y tendrá una decisión
  propia.

## Revisión
Revisar si el detalle necesita una versión para pantallas chicas.