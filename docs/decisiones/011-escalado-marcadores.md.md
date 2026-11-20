---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, marcadores, escalado]
---

# 011: Escalado de marcadores con clamp

## Contexto
El tamaño de los sprites de sismo se calibró con distancias supuestas y el
resultado se ve distinto según la posición del evento. Hace falta una regla única
que mantenga la perspectiva sin que los sismos lejanos desaparezcan ni los cercanos
tapen la geografía. Complementa a [[010-visualizacion-sismica]], que fija la escala
de color y la antigüedad, pero deja el tamaño abierto.

## Decisión
- El tamaño en pantalla sale de la distancia real de cada sprite a la cámara, con
  perspectiva nativa del renderer (sizeAttenuation activo).
- Para que el tamaño no quede fuera de rango, se aplica un clamp:
  tamaño_px = clamp(base_mag * factor / distancia, 6, 22), con 6 px y 22 px medidos
  a la distancia de la vista inicial (219 unidades al sprite frontal).
- base_mag es el radio base por magnitud, con la misma escala logarítmica que ya
  existe. Mag menor a 2 parte de 6 px; mag 5 o más llega a 22 px.
- Los sismos del borde se ven más chicos por perspectiva, pero nunca bajan de 6 px.
- Los límites 6 y 22 son constantes en un solo lugar.

## Alternativas descartadas
- Tamaño fijo por magnitud: borra la perspectiva y hace que todos los sismos se
  vean igual, aunque estén del otro lado del globo.
- Perspectiva pura sin clamp: los sismos lejanos desaparecen y los cercanos tapan
  los continentes.

## Consecuencias
- Hay que quitar la declaración de "invariante al viewport" de la 010, porque ya no
  aplica: el tamaño depende de la distancia, con los límites del clamp.
- Los tests de tamaño tienen que comprobar el clamp en el borde del rango, no solo
  el valor central.

## Revisión
Revisar si el clamp de 22 px es suficiente para magnitudes mayores a 5, si aparecen
eventos así en la ventana de 24 h.