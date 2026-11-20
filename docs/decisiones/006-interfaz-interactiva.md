---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, interfaz]
---

# 006: Interfaz interactiva

## Contexto
El panel de [[005-direccion-visual]] mostraba 24 barras horarias vacías y una
lista de recientes sin interacción. Los sismos tenían el mismo tamaño casi
siempre y no se podían consultar.

## Decisión
- Barra superior delgada: título, selector 1 h / 24 h segmentado, estado en vivo
  y hora UTC de la última actualización.
- Panel derecho de contexto: total, magnitud máxima con lugar, hora del evento
  más reciente, histograma de magnitudes, mini gráfico de actividad y lista de
  los 10 eventos más fuertes de la ventana.
- Radio del punto proporcional a la magnitud (escala exponencial suave con
  mínimo visible). Magnitud 4 o más: halo y pulso permanente. Magnitud 5 o más:
  etiqueta con el lugar.
- Hover muestra un tooltip. Clic en un punto o en la lista rota el globo y abre
  la tarjeta de detalle con el enlace al USGS.
- Solo se muestran campos del DTO de la API.

## Consecuencias
- La lista ordenada por magnitud reemplaza a la de recientes.
- La interacción requiere raycasting sobre los puntos. Solo se testean los
  marcadores, no la esfera, para mantener la velocidad.

## Revisión
Revisar si la tarjeta de detalle necesita un modo móvil, con panel inferior.