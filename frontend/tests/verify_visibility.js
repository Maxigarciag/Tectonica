import * as THREE from 'three'
import assert from 'node:assert'

// Funciones puras (duplicadas desde visibility.ts para no depender de TS en el test)
const EARTH_RADIUS = 100

function latLonToVector3(lat, lon, radius) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = (lon * Math.PI) / 180
  const x = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)
  const z = radius * Math.sin(phi) * Math.cos(theta)
  return new THREE.Vector3(x, y, z)
}

function computeVisibility(lat, lon, worldMatrix, cameraPos, earthRadius = EARTH_RADIUS) {
  const localPos = latLonToVector3(lat, lon, earthRadius)
  localPos.applyMatrix4(worldMatrix)
  const d = cameraPos.length()
  const dot = localPos.dot(cameraPos) / (earthRadius * d)
  return dot >= earthRadius / d
}

const cameraPos = new THREE.Vector3(0, 0, 320)
const d = cameraPos.length() // 320
const threshold = EARTH_RADIUS / d // 0.3125

console.log('=== Test de visibilidad (decision 010) ===')
console.log(`Camara en (0, 0, 320), d = ${d}`)
console.log(`Umbral R/d = ${EARTH_RADIUS} / ${d} = ${threshold.toFixed(6)}`)
console.log('')

// Test 1: us7000ty9z (mag 4.7) visible en rotacion 0
const worldMatrix0 = new THREE.Matrix4()
const v1 = computeVisibility(-22.2364, -63.6530, worldMatrix0, cameraPos)
console.log(`Test 1 - us7000ty9z en rotacion 0: visible = ${v1} (esperado: true)`)
assert.strictEqual(v1, true, 'us7000ty9z deberia ser visible en rotacion 0')

// Test 2: lat 0, lon 0 visible en rotacion 0
const v2 = computeVisibility(0, 0, worldMatrix0, cameraPos)
console.log(`Test 2 - lat 0, lon 0 en rotacion 0: visible = ${v2} (esperado: true)`)
assert.strictEqual(v2, true, 'lat 0, lon 0 deberia ser visible en rotacion 0')

// Test 3: lat 0, lon 0 oculto en rotacion PI
const worldMatrixPi = new THREE.Matrix4()
worldMatrixPi.makeRotationY(Math.PI)
const v3 = computeVisibility(0, 0, worldMatrixPi, cameraPos)
console.log(`Test 3 - lat 0, lon 0 en rotacion PI: visible = ${v3} (esperado: false)`)
assert.strictEqual(v3, false, 'lat 0, lon 0 deberia estar oculto en rotacion PI')

// Test 4: us7000ty9z tiene exactamente 2 cambios por vuelta
console.log('')
console.log('Test 4 - us7000ty9z: simulando rotacion 0 a 2pi...')
const changes1 = []
let prevVisible1 = null

for (let i = 0; i <= 720; i++) {
  const angle = (i / 720) * 2 * Math.PI
  const worldMatrix = new THREE.Matrix4()
  worldMatrix.makeRotationY(angle)
  const visible = computeVisibility(-22.2364, -63.6530, worldMatrix, cameraPos)
  if (prevVisible1 !== null && visible !== prevVisible1) {
    changes1.push(angle)
    const localPos = latLonToVector3(-22.2364, -63.6530, EARTH_RADIUS)
    localPos.applyMatrix4(worldMatrix)
    const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
    console.log(`  Cambio en angulo ${angle.toFixed(4)} rad: dot = ${dot.toFixed(6)}, umbral = ${threshold.toFixed(6)}`)
  }
  prevVisible1 = visible
}

console.log(`  Total cambios: ${changes1.length} (esperado: 2)`)
assert.strictEqual(changes1.length, 2, 'us7000ty9z deberia tener exactamente 2 cambios por vuelta')

// Test 5: lat 0, lon 0 tiene exactamente 2 cambios por vuelta
console.log('')
console.log('Test 5 - lat 0, lon 0: simulando rotacion 0 a 2pi...')
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
    console.log(`  Cambio en angulo ${angle.toFixed(4)} rad: dot = ${dot.toFixed(6)}, umbral = ${threshold.toFixed(6)}`)
  }
  prevVisible2 = visible
}

console.log(`  Total cambios: ${changes2.length} (esperado: 2)`)
assert.strictEqual(changes2.length, 2, 'lat 0, lon 0 deberia tener exactamente 2 cambios por vuelta')

console.log('')
console.log('=== TODOS LOS TESTS PASARON ===')
