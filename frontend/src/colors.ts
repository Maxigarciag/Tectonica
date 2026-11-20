/** 
 * Tokens de color centralizados (decisión 007 y 010).
 * Lee las variables CSS definidas en styles.css y las expone para Three.js.
 * El mapeo de magnitud vive en un solo lugar: acá (decisión 010).
 */

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

function cssVar(varName: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim()
}

/**
 * Mapa de magnitudes (única fuente de verdad, decisión 010).
 * Colores: 0-2 #F5C400, 2-3 #FFB000, 3-4 #FF8A00, 4-5 #FF4545, 5+ #FF3473.
 * Leyenda, marcadores e histograma leen de esta constante.
 */
export const MAG_COLORS_MAP: { threshold: number; color: string; label: string; size: number }[] = [
  { threshold: 2, color: '#FBBF24', label: 'Menos de 2', size: 1 },
  { threshold: 3, color: '#FB923C', label: '2 a 3', size: 2 },
  { threshold: 4, color: '#F97316', label: '3 a 4', size: 3 },
  { threshold: 5, color: '#EF4444', label: '4 a 5', size: 4 },
  { threshold: Infinity, color: '#DC2626', label: '5 o más', size: 5 },
]

/** Devuelve el color CSS (string #RRGGBB) para una magnitud dada. */
export function colorForMagnitudeCss(mag: number): string {
  for (const c of MAG_COLORS_MAP) {
    if (mag < c.threshold) return c.color
  }
  return MAG_COLORS_MAP[MAG_COLORS_MAP.length - 1].color
}

/** Devuelve el color numérico (0xRRGGBB) para una magnitud dada (Three.js). */
export function colorForMagnitude(mag: number): number {
  return hexToNumber(colorForMagnitudeCss(mag))
}

/** Color de la atmósfera (celeste, solo borde). */
export function atmosphereColor(): number {
  return hexToNumber(cssVar('--atmosphere'))
}

/** Color de acento de UI (#168BFF). */
export function accentColor(): number {
  return hexToNumber(cssVar('--accent'))
}

/** Color verde para estado \"al día\". */
export function freshColor(): number {
  return hexToNumber(cssVar('--fresh'))
}

/** Color gris para estado \"desactualizado\". */
export function staleColor(): number {
  return hexToNumber(cssVar('--stale'))
}

/** Color rojo para error de red. */
export function errorColor(): number {
  return hexToNumber(cssVar('--error'))
}

/** Lee un valor de variable CSS como string (para uso en estilos inline del DOM). */
export function cssColor(varName: string): string {
  return cssVar(varName)
}
