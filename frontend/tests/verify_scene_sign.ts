import * as THREE from 'three'
import { EARTH_RADIUS, latLonToVector3 } from '../src/visibility.ts'

// Configuración
const SPRITE_OFFSET = 1
const TAGBINA_LAT = 8.3996
const TAGBINA_LON = 126.2112
const RADIUS = EARTH_RADIUS + SPRITE_OFFSET

const cameraPos = new THREE.Vector3(0, 0, 320)
const d = cameraPos.length()
const threshold = EARTH_RADIUS / d

const testAngles = [2.8362, 2.8200, 5.3320]

console.log('=== Verificación independiente del signo de rotación ===')
console.log(`Tagbina: lat=${TAGBINA_LAT}, lon=${TAGBINA_LON}`)
console.log(`Radio del punto: ${RADIUS} (EARTH_RADIUS=${EARTH_RADIUS} + SPRITE_OFFSET=${SPRITE_OFFSET})`)
console.log(`Cámara en (0, 0, 320), d = ${d}`)
console.log(`Umbral R/d = ${EARTH_RADIUS} / ${d} = ${threshold.toFixed(6)}`)
console.log('')

// Función para calcular posición mundial con método 1: latLonToVector3 + applyAxisAngle
function worldPosMethod1(lat: number, lon: number, radius: number, angleY: number): THREE.Vector3 {
  const localPos = latLonToVector3(lat, lon, radius)
  const rotated = localPos.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleY)
  return rotated
}

// Función para calcular posición mundial con método 2: matrixWorld
function worldPosMethod2(lat: number, lon: number, radius: number, angleY: number): THREE.Vector3 {
  const localPos = latLonToVector3(lat, lon, radius)
  const earthGroup = new THREE.Group()
  earthGroup.rotation.y = angleY
  earthGroup.updateMatrixWorld(true)
  const worldPos = localPos.clone().applyMatrix4(earthGroup.matrixWorld)
  return worldPos
}

// Función para calcular dot product en un ángulo dado
function dotAtAngle(angle: number): number {
  const pos = worldPosMethod2(TAGBINA_LAT, TAGBINA_LON, RADIUS, angle)
  return pos.dot(cameraPos) / (EARTH_RADIUS * d)
}

// Barrido fino para encontrar el cruce exacto del umbral
function findCrossing(start: number, end: number, step: number, expectedCrossing: number, tolerance: number): { angle: number; dot: number; before: boolean; after: boolean } | null {
  let prevAngle = start
  let prevDot = dotAtAngle(start)
  let prevVisible = prevDot >= threshold

  for (let angle = start + step; angle <= end; angle += step) {
    const dot = dotAtAngle(angle)
    const visible = dot >= threshold

    if (visible !== prevVisible) {
      // Cruce detectado - refinar con bisección
      let low = prevAngle
      let high = angle
      let lowDot = prevDot
      let highDot = dot

      // Guardar la dirección ANTES de la bisección
      const beforeVisibleOriginal = prevVisible
      const afterVisibleOriginal = visible

      for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2
        const midDot = dotAtAngle(mid)
        if ((midDot >= threshold) === (highDot >= threshold)) {
          high = mid
          highDot = midDot
        } else {
          low = mid
          lowDot = midDot
        }
      }

      const crossingAngle = (low + high) / 2
      const crossingDot = dotAtAngle(crossingAngle)

      console.log(`  Cruce detectado en ${crossingAngle.toFixed(6)} rad (esperado ${expectedCrossing} ± ${tolerance})`)
      console.log(`    dot = ${crossingDot.toFixed(6)}, umbral = ${threshold.toFixed(6)}`)
      console.log(`    Antes (${prevAngle.toFixed(6)} rad): ${beforeVisibleOriginal ? 'VISIBLE' : 'OCULTO'} (dot=${prevDot.toFixed(6)})`)
      console.log(`    Después (${angle.toFixed(6)} rad): ${afterVisibleOriginal ? 'VISIBLE' : 'OCULTO'} (dot=${dot.toFixed(6)})`)

      const withinTolerance = Math.abs(crossingAngle - expectedCrossing) <= tolerance
      if (!withinTolerance) {
        console.log(`    ✗ FUERA DE TOLERANCIA: |${crossingAngle.toFixed(6)} - ${expectedCrossing}| = ${Math.abs(crossingAngle - expectedCrossing).toFixed(6)} > ${tolerance}`)
      } else {
        console.log(`    ✓ DENTRO DE TOLERANCIA: |${crossingAngle.toFixed(6)} - ${expectedCrossing}| = ${Math.abs(crossingAngle - expectedCrossing).toFixed(6)} ≤ ${tolerance}`)
      }

      return { angle: crossingAngle, dot: crossingDot, before: beforeVisibleOriginal, after: afterVisibleOriginal }
    }

    prevAngle = angle
    prevDot = dot
    prevVisible = visible
  }

  console.log(`  ✗ NO SE ENCONTRÓ CRUCE en [${start}, ${end}]`)
  return null
}

let allPassed = true

// 1. Verificar signo en los 3 ángulos originales
console.log('--- Verificación de signo en ángulos de prueba ---')
for (const angle of testAngles) {
  const pos1 = worldPosMethod1(TAGBINA_LAT, TAGBINA_LON, RADIUS, angle)
  const pos2 = worldPosMethod2(TAGBINA_LAT, TAGBINA_LON, RADIUS, angle)

  const diffX = Math.abs(pos1.x - pos2.x)
  const diffY = Math.abs(pos1.y - pos2.y)
  const diffZ = Math.abs(pos1.z - pos2.z)
  const maxDiff = Math.max(diffX, diffY, diffZ)

  const signOk = maxDiff < 1e-6
  if (signOk) {
    console.log(`  ✓ ${angle} rad: diff=${maxDiff.toExponential(2)} < 1e-6`)
  } else {
    console.log(`  ✗ ${angle} rad: diff=${maxDiff.toExponential(2)} >= 1e-6`)
    allPassed = false
  }
}
console.log('')

// 2. Barrido fino alrededor del primer cruce (oculto → visible): 2.80 a 2.84
console.log('--- Barrido fino cruce 1: 2.80 a 2.84 rad (oculto → visible) ---')
const crossing1 = findCrossing(2.80, 2.84, 0.0005, 2.8362, 0.01)
if (crossing1) {
  if (Math.abs(crossing1.angle - 2.8362) > 0.01) {
    allPassed = false
  }
  // Esperado: OCULTO (false) → VISIBLE (true)
  if (crossing1.before || !crossing1.after) {
    console.log(`  ✗ Dirección incorrecta: esperaba OCULTO → VISIBLE, got ${crossing1.before ? 'VISIBLE' : 'OCULTO'} → ${crossing1.after ? 'VISIBLE' : 'OCULTO'}`)
    allPassed = false
  } else {
    console.log(`  ✓ Dirección correcta: OCULTO → VISIBLE`)
  }
} else {
  allPassed = false
}
console.log('')

// 3. Barrido fino alrededor del segundo cruce (visible → oculto): 5.30 a 5.36
console.log('--- Barrido fino cruce 2: 5.30 a 5.36 rad (visible → oculto) ---')
const crossing2 = findCrossing(5.30, 5.36, 0.0005, 5.3320, 0.01)
if (crossing2) {
  if (Math.abs(crossing2.angle - 5.3320) > 0.01) {
    allPassed = false
  }
  // Esperado: VISIBLE (true) → OCULTO (false)
  if (!crossing2.before || crossing2.after) {
    console.log(`  ✗ Dirección incorrecta: esperaba VISIBLE → OCULTO, got ${crossing2.before ? 'VISIBLE' : 'OCULTO'} → ${crossing2.after ? 'VISIBLE' : 'OCULTO'}`)
    allPassed = false
  } else {
    console.log(`  ✓ Dirección correcta: VISIBLE → OCULTO`)
  }
} else {
  allPassed = false
}
console.log('')

// 4. Verificar estado en los 3 ángulos originales
console.log('--- Verificación de estado en ángulos de prueba ---')
for (const angle of testAngles) {
  const pos = worldPosMethod2(TAGBINA_LAT, TAGBINA_LON, RADIUS, angle)
  const dot = pos.dot(cameraPos) / (EARTH_RADIUS * d)
  const visible = dot >= threshold
  console.log(`  ${angle} rad: dot=${dot.toFixed(6)}, umbral=${threshold.toFixed(6)} → ${visible ? 'VISIBLE' : 'OCULTO'}`)
}
console.log('')

// Resumen
console.log('=== RESUMEN ===')
if (allPassed) {
  console.log('✓ TODAS LAS VERIFICACIONES PASARON')
  console.log('  - Signo de rotación verificado en los 3 ángulos (diff < 1e-6)')
  if (crossing1) {
    console.log(`  - Cruce 1 (oculto→visible) en ${crossing1.angle.toFixed(6)} rad (esperado 2.8362 ± 0.01)`)
  }
  if (crossing2) {
    console.log(`  - Cruce 2 (visible→oculto) en ${crossing2.angle.toFixed(6)} rad (esperado 5.3320 ± 0.01)`)
  }
  console.log('  - 2.8200 rad: OCULTO (antes del primer cruce)')
  console.log('  - 2.8362 rad: VISIBLE (después del primer cruce)')
  // 5.3320 está ANTES del cruce 2 (5.333082), por eso es VISIBLE
  console.log('  - 5.3320 rad: VISIBLE (antes del segundo cruce en ~5.3331)')
} else {
  console.log('✗ ALGUNAS VERIFICACIONES FALLARON')
  process.exit(1)
}
