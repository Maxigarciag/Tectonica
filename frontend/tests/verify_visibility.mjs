import * as THREE from 'three'
import { computeVisibility, EARTH_RADIUS, latLonToVector3 } from '../src/visibility.ts'

import assert from 'node:assert'

const cameraPos = new THREE.Vector3(0, 0, 320)
const d = cameraPos.length() // 320
const threshold = EARTH_RADIUS / d // 0.3125

console.log('=== Test de visibilidad (decision 010) ===')
console.log(`Camara en (0, 0, 320), d = ${d}`)
console.log(`Umbral R/d = ${EARTH_RADIUS} / ${d} = ${threshold.toFixed(6)}`)
console.log('')

// Test 1: us7000ty9z (mag 4.7) at rotation 0: visible=true
const worldMatrix0 = new THREE.Matrix4()
const v1 = computeVisibility(-22.2364, -63.6530, worldMatrix0, cameraPos)
console.log(`us7000ty9z at rotation 0: visible = ${v1} (expected true)`)
assert.strictEqual(v1, true, 'us7000ty9z at rotation 0: visible=true')

// Test 2: Tagbina (mag 4.9) at rotation 0: visible=false
const vTagbina0 = computeVisibility(8.3996, 126.2112, worldMatrix0, cameraPos)
console.log(`Tagbina at rotation 0: visible = ${vTagbina0} (expected false)`)
assert.strictEqual(vTagbina0, false, 'Tagbina at rotation 0: visible=false')

// Test 3: lat 0, lon 0 at rotation PI: visible=false
const worldMatrixPi = new THREE.Matrix4()
worldMatrixPi.makeRotationY(Math.PI)
const v3 = computeVisibility(0, 0, worldMatrixPi, cameraPos)
console.log(`lat 0, lon 0 at rotation PI: visible = ${v3} (expected false)`)
assert.strictEqual(v3, false, 'lat 0, lon 0 at rotation PI: visible=false')

// Test 4: us7000ty9z at rotation ~0.7679: visible→oculto, at ~4.5989: oculto→visible
console.log('')
console.log('us7000ty9z: simulando rotación 0 a 2π...')
const changes1 = []
let prevVisible1 = null

for (let i = 0; i <= 720; i++) {
  const angle = (i / 720) * 2 * Math.PI
  const worldMatrix = new THREE.Matrix4()
  worldMatrix.makeRotationY(angle)
  const visible = computeVisibility(-22.2364, -63.6530, worldMatrix, cameraPos)
  if (prevVisible1 !== null && visible !== prevVisible1) {
    changes1.push(angle)
    // Verificar que dot está cerca del umbral en el cambio
    const localPos = latLonToVector3(-22.2364, -63.6530, EARTH_RADIUS)
    localPos.applyMatrix4(worldMatrix)
    const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
    console.log(`  us7000ty9z change at angle ${angle.toFixed(4)} rad: dot = ${dot.toFixed(6)}, threshold = ${threshold.toFixed(6)}`)
  }
  prevVisible1 = visible
}

console.log(`  us7000ty9z: total changes = ${changes1.length} (expected 2)`)
assert.strictEqual(changes1.length, 2, 'us7000ty9z: 2 cambios de visibilidad en rotación completa')

// Test 5: Tagbina at rotation ~1.2654: oculto→visible, at ~3.7612: visible→oculto
console.log('')
console.log('Tagbina: simulando rotación 0 a 2π...')
const changes3 = []
let prevVisible3 = null

for (let i = 0; i <= 720; i++) {
  const angle = (i / 720) * 2 * Math.PI
  const worldMatrix = new THREE.Matrix4()
  worldMatrix.makeRotationY(angle)
  const visible = computeVisibility(8.3996, 126.2112, worldMatrix, cameraPos)
  if (prevVisible3 !== null && visible !== prevVisible3) {
    changes3.push(angle)
    const localPos = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
    localPos.applyMatrix4(worldMatrix)
    const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
    console.log(`  Tagbina change at angle ${angle.toFixed(4)} rad: dot = ${dot.toFixed(6)}, threshold = ${threshold.toFixed(6)}`)
  }
  prevVisible3 = visible
}

console.log(`  Tagbina: total changes = ${changes3.length} (expected 2)`)
assert.strictEqual(changes3.length, 2, 'Tagbina: 2 cambios de visibilidad en rotación completa')

// Afirmación independiente: en rotación 1.28 rad, dot > umbral
const worldMatrixHigh = new THREE.Matrix4()
worldMatrixHigh.makeRotationY(1.28)
const posHigh = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
posHigh.applyMatrix4(worldMatrixHigh)
const dotHigh = posHigh.dot(cameraPos) / (EARTH_RADIUS * d)
console.log(`Tagbina at rotation 1.28 rad: dot = ${dotHigh.toFixed(6)}, threshold = ${threshold.toFixed(6)}`)
assert(dotHigh > threshold, `Tagbina at rotation 1.28 rad: dot ${dotHigh.toFixed(6)} should be > threshold ${threshold.toFixed(6)}`)

// Afirmación independiente: en rotación 1.24 rad, dot < umbral
const worldMatrixLow = new THREE.Matrix4()
worldMatrixLow.makeRotationY(1.24)
const posLow = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
posLow.applyMatrix4(worldMatrixLow)
const dotLow = posLow.dot(cameraPos) / (EARTH_RADIUS * d)
console.log(`Tagbina at rotation 1.24 rad: dot = ${dotLow.toFixed(6)}, threshold = ${threshold.toFixed(6)}`)
assert(dotLow < threshold, `Tagbina at rotation 1.24 rad: dot ${dotLow.toFixed(6)} should be < threshold ${threshold.toFixed(6)}`)

// Test 6: lat 0, lon 0 en rotación completa
console.log('')
console.log('lat 0, lon 0: simulando rotación 0 a 2π...')
const changes2 = []
let prevVisible2 = null

for (let i = 0; i <= 720; i++) {
  const angle = (i / 720) * 2 * Math.PI
  const worldMatrix = new THREE.Matrix4()
  worldMatrix.makeRotationY(angle)
  const visible = computeVisibility(0, 0, worldMatrix, cameraPos)
  if (prevVisible2 !== null && visible !== prevVisible2) {
    changes2.push(angle)
    const localPos = latLonToVector3(0, 0, EARTH_RADIUS)
    localPos.applyMatrix4(worldMatrix)
    const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
    console.log(`  lat 0, lon 0 change at angle ${angle.toFixed(4)} rad: dot = ${dot.toFixed(6)}, threshold = ${threshold.toFixed(6)}`)
  }
  prevVisible2 = visible
}

console.log(`  lat 0, lon 0: total changes = ${changes2.length} (expected 2)`)
assert.strictEqual(changes2.length, 2, 'lat 0, lon 0: 2 cambios de visibilidad')

console.log('')
console.log('=== TODOS LOS TESTS PASARON ===')
