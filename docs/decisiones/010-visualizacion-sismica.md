---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, visualizacion, marcadores]
---

# 010: Visualización sísmica (reemplaza marcadores de 007 y 008 en lo visual)

## Contexto
Los marcadores actuales son esferas y puntos de tamaño casi uniforme. El documento
de rediseño pide jerarquía por magnitud, halos luminosos, selección sincronizada
con el sidebar, agrupación por zoom y tratamiento de profundidad. La decisión 007
usaba una paleta distinta a la del rediseño.

## Decisión
- **Escala de magnitud:** 0-2 #F5C400, 2-3 #FFB000, 3-4 #FF8A00, 4-5 #FF4545,
  5 o más #FF3473. Una sola constante en colors.ts; leyenda, marcadores e histograma
  la leen de ahí.
- **Marcadores:** THREE.Sprite con textura radial (núcleo, halo, glow de baja
  opacidad). Tamaño en píxeles creciente con la magnitud, sin tamaños exagerados.
- **Antigüedad:** eventos de menos de 10 min con mayor luminosidad y pulso ocasional;
  eventos antiguos con menor intensidad. Ningún evento se oculta por antigüedad.
- **Pulso:** anillo expansivo que se desvanece. Solo para eventos recientes y el
  seleccionado. Desactivado con prefers-reduced-motion.
- **Selección:** clic en marcador o en fila del sidebar. Ambos usan el mismo estado
  de selección. Cámara con transición suave hacia el evento y zoom moderado. Al
  deseleccionar (clic fuera o Escape) se restauran tamaño, luminosidad y cámara.
- **Agrupación:** solo visual, según la distancia de cámara. No se modifican datos.
- **Profundidad:** indicada en el tooltip y en la ficha. Sin desplazar el epicentro.
- **Tema del globo:** [opción A o B que elijas].
- **Stack:** Three.js existente. No se reemplaza por Globe.gl ni React Three Fiber.

## Alternativas descartadas
- Esferas 3D por evento: costo de rendimiento alto con muchos eventos.
- Paleta de 007 sin cambios: menor contraste sobre fondo oscuro.

## Consecuencias
- La decisión 007 deja de aplicar a los colores de magnitud.
- La decisión 008 cambia en el comportamiento de selección y cámara.
- **El tamaño de los marcadores ya no es invariante al viewport** (ver decisión 011): ahora depende de la distancia real de cada sprite a la cámara con clamp 6–22 px.

## Revisión
Revisar la agrupación si el número de eventos supera los 200 en la ventana de 24 h.