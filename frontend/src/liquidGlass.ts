import liquidGL from 'liquid-gl'

const LENS_IDS = ['lens-header', 'lens-sidebar', 'lens-footer', 'lens-detail']
const initialized = new Set<string>()

/** Inicializa las lentes de liquid-gl sobre el fondo visual (#globe).
 *  El contenido de cada superficie queda en el DOM sobre la lentes, nítido. */
export function initLiquidGlass(): void {
  const tryInit = () => {
    const globe = document.getElementById('globe')
    if (!globe) return

    // Fondo animado: se vuelve a capturar a cada cambio
    liquidGL.registerDynamic('#globe')

    for (const id of LENS_IDS) {
      if (initialized.has(id)) continue
      const lens = document.getElementById(id)
      if (!lens) continue
      liquidGL({
        target: `#${id}`,
        snapshot: '#globe',
        resolution: 1.5,
        refraction: 0.007,
        aberration: 0.03,
        bevelDepth: 0.075,
        bevelWidth: 0.18,
        frost: 2.2,
        shadow: false,
        specular: true,
        reveal: 'none',
        tilt: false,
        magnify: 1.006,
      })
      initialized.add(id)
    }
  }

  // Deja que el globo renderice al menos un frame antes del primer snapshot
  setTimeout(tryInit, 80)
}

export function disposeLiquidGlass(): void {
  // liquid-gl no expone dispose por lente; nada que liberar acá
}
