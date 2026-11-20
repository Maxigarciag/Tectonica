---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, tema, cohesion]
---

# 009: Tema claro y cohesión visual

## Contexto
La interfaz actual es oscura. La decisión [[005-direccion-visual]] la definió así,
pero el resultado es pesado y el océano del globo se ve casi negro. Cabecera,
panel y pie tienen tratamientos distintos y no se perciben como un conjunto.

## Decisión
- **Tema claro como predeterminado**, con modo oscuro disponible como opción.
  Este tema reemplaza la dirección oscura de 005 en la parte de interfaz; el
  globo mantiene el fondo de espacio, pero más claro.
- **Escala de magnitud para tema claro:** tonos más saturados que los de 007,
  para que cada tramo se distinga sobre fondo blanco. Se mantiene la misma
  jerarquía de tamaño y de brillo.
- **Océano:** iluminación con HemisphereLight celeste y blanca, ambiente más
  alto en tema claro, y brillo especular de océano si se descarga la máscara.
- **Sistema de superficies:** cabecera, panel y pie comparten radio de esquina,
  borde, nivel de vidrio y fondo. La diferencia entre zonas se marca solo con
  separación, no con color.
- **Acento único:** un azul para interacción y estado activo. Los colores de
  magnitud no se usan para decoración.
- **Tipografía:** Inter para títulos y texto; cifras con tabular-nums.

## Alternativas descartadas
- Solo subir la luz del modo oscuro: no resuelve la legibilidad del claro ni
  la cohesión entre zonas.
- Tema claro sin ajustar la escala de magnitud: los tramos bajos desaparecen.

## Consecuencias
- Hay que definir tokens de tema (claro y oscuro) y aplicarlos con una clase en
  el documento, no con valores sueltos.
- La escala de magnitud tiene dos variantes; se elige según el tema.
- Hay que descargar una máscara de océano si se quiere brillo especular.

## Revisión
Revisar si el modo oscuro necesita su propia escala de magnitud completa.