---
tipo: decision
estado: aceptada
fecha: 2026-11-14
tags: [decision, frontend, visualizacion, estetica]
---

# 005: Dirección visual (reemplaza el estilo de 004)

## Contexto
La decisión [[004-frontend-globo]] pedía un estilo claro y didáctico. El resultado
visual fue una esfera genérica sobre fondo claro, sin continentes ni contexto,
con puntos que no comunican la magnitud. Eso no cumple el objetivo del proyecto:
que el sitio se vea profesional y que los datos se entiendan.

## Decisión
- **Estilo:** observatorio oscuro. Fondo de espacio con campo de estrellas.
- **Planeta:** textura de día (Blue Marble), luces nocturnas (Black Marble) con
  mezcla día/noche según la posición del sol, y máscara de océano con brillo
  especular. Fronteras de países desde Natural Earth 110 m.
- **Atmósfera:** halo celeste suave, sin borde oscuro.
- **Sismos:** pulsos de luz aditivos. Tamaño por magnitud (escala logarítmica),
  color por rango de magnitud, profundidad indicada por trazo vertical. Eventos
  de menos de 10 min con anillo expansivo. Eventos de magnitud 4 o más, con halo.
- **Panel:** tablero oscuro con eventos por hora, histograma de magnitudes,
  conteo por región y lista de eventos recientes.
- **Textos:** un solo indicador de actualización. Sin elementos duplicados.
- **Rendimiento:** la escena debe mantener buena velocidad en un notebook.
  Si una capa es pesada en celular, se puede desactivar sin rehacer la escena.

## Alternativas descartadas
- Mantener estilo claro: no comunica la información ni se ve profesional.
- Esfera procedural sin texturas: no se reconoce como la Tierra.

## Consecuencias
- Se incorporan tres archivos de imagen y datos geográficos al repositorio
  (`frontend/public/`), con su licencia documentada en `docs/fuentes/`.
- La decisión 004 queda como historial. Su parte de estilo deja de aplicar.

## Revisión
Revisar si el tamaño de las texturas afecta la carga inicial.