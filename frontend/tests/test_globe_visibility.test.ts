import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { computeVisibility, EARTH_RADIUS, latLonToVector3 } from '../src/visibility'

describe('Globe visibility (decisión 010)', () => {
  const cameraPos = new THREE.Vector3(0, 0, 320)
  const d = cameraPos.length() // 320
  const threshold = EARTH_RADIUS / d // 0.3125

  describe('computeVisibility', () => {
    it('us7000ty9z (mag 4.7) at rotation 0: visible=true', () => {
      const worldMatrix = new THREE.Matrix4() // identidad
      const visible = computeVisibility(-22.2364, -63.6530, worldMatrix, cameraPos)
      console.log(`us7000ty9z at rotation 0: visible=${visible} (expected true)`)
      expect(visible).toBe(true)
    })

    it('Tagbina (mag 4.9) at rotation 0: visible=false', () => {
      const worldMatrix = new THREE.Matrix4() // identidad
      const visible = computeVisibility(8.3996, 126.2112, worldMatrix, cameraPos)
      console.log(`Tagbina at rotation 0: visible=${visible} (expected false)`)
      expect(visible).toBe(false)
    })

    it('lat 0, lon 0 at rotation 0: visible=true (center of view)', () => {
      const worldMatrix = new THREE.Matrix4() // identidad
      const visible = computeVisibility(0, 0, worldMatrix, cameraPos)
      console.log(`lat 0, lon 0 at rotation 0: visible=${visible} (expected true)`)
      expect(visible).toBe(true)
    })

    it('lat 0, lon 0 at rotation PI: visible=false', () => {
      const worldMatrix = new THREE.Matrix4()
      worldMatrix.makeRotationY(Math.PI)
      const visible = computeVisibility(0, 0, worldMatrix, cameraPos)
      expect(visible).toBe(false)
    })

    it('us7000ty9z at rotation 2.3387: visible→oculto, at 6.1697: oculto→visible', () => {
      const changes: number[] = []
      let prevVisible: boolean | null = null

      for (let i = 0; i <= 720; i++) {
        const angle = (i / 720) * 2 * Math.PI
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const visible = computeVisibility(-22.2364, -63.6530, worldMatrix, cameraPos)

        if (prevVisible !== null && visible !== prevVisible) {
          changes.push(angle)
        }
        prevVisible = visible
      }

      expect(changes.length).toBe(2)
      console.log(`us7000ty9z changes at ${changes[0].toFixed(4)} rad and ${changes[1].toFixed(4)} rad`)

      // Dirección del primer cambio: visible→oculto (dot baja por el umbral)
      const worldMatrixA = new THREE.Matrix4()
      worldMatrixA.makeRotationY(changes[0] - 0.005)
      const posA = latLonToVector3(-22.2364, -63.6530, EARTH_RADIUS)
      posA.applyMatrix4(worldMatrixA)
      const dotBeforeA = posA.dot(cameraPos) / (EARTH_RADIUS * d)
      console.log(`us7000ty9z at ${(changes[0] - 0.005).toFixed(4)} rad: dot=${dotBeforeA.toFixed(6)} > threshold=${threshold.toFixed(6)} → visible=true`)

      // Dirección del segundo cambio: oculto→visible (dot sube por el umbral)
      const worldMatrixB = new THREE.Matrix4()
      worldMatrixB.makeRotationY(changes[1] + 0.005)
      const posB = latLonToVector3(-22.2364, -63.6530, EARTH_RADIUS)
      posB.applyMatrix4(worldMatrixB)
      const dotAfterB = posB.dot(cameraPos) / (EARTH_RADIUS * d)
      console.log(`us7000ty9z at ${(changes[1] + 0.005).toFixed(4)} rad: dot=${dotAfterB.toFixed(6)} > threshold=${threshold.toFixed(6)} → visible=true`)

      // En cada cambio, dot debe estar cerca del umbral (0.3125)
      for (const angle of changes) {
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const localPos = latLonToVector3(-22.2364, -63.6530, EARTH_RADIUS)
        localPos.applyMatrix4(worldMatrix)
        const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
        expect(dot).toBeGreaterThanOrEqual(0.3125 - 0.01)
        expect(dot).toBeLessThanOrEqual(0.3125 + 0.01)
      }
    })

    it('Tagbina at rotation 2.8362: oculto→visible, at 5.3320: visible→oculto', () => {
      const changes: number[] = []
      let prevVisible: boolean | null = null

      for (let i = 0; i <= 720; i++) {
        const angle = (i / 720) * 2 * Math.PI
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const visible = computeVisibility(8.3996, 126.2112, worldMatrix, cameraPos)

        if (prevVisible !== null && visible !== prevVisible) {
          changes.push(angle)
        }
        prevVisible = visible
      }

      expect(changes.length).toBe(2)
      console.log(`Tagbina changes at ${changes[0].toFixed(4)} rad and ${changes[1].toFixed(4)} rad`)

      // Afirmación independiente: en rotación 2.8362 rad, dot > umbral
      const worldMatrixHigh = new THREE.Matrix4()
      worldMatrixHigh.makeRotationY(2.8362)
      const posHigh = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
      posHigh.applyMatrix4(worldMatrixHigh)
      const dotHigh = posHigh.dot(cameraPos) / (EARTH_RADIUS * d)
      console.log(`Tagbina at rotation 2.8362 rad: dot=${dotHigh.toFixed(6)} > threshold=${threshold.toFixed(6)} → visible=true`)

      // Afirmación independiente: en rotación 2.8200 rad, dot < umbral
      const worldMatrixLow = new THREE.Matrix4()
      worldMatrixLow.makeRotationY(2.8200)
      const posLow = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
      posLow.applyMatrix4(worldMatrixLow)
      const dotLow = posLow.dot(cameraPos) / (EARTH_RADIUS * d)
      console.log(`Tagbina at rotation 2.8200 rad: dot=${dotLow.toFixed(6)} < threshold=${threshold.toFixed(6)} → visible=false`)

      expect(dotHigh).toBeGreaterThan(threshold)
      expect(dotLow).toBeLessThan(threshold)

      // En cada cambio, dot debe estar cerca del umbral (0.3125)
      for (const angle of changes) {
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const localPos = latLonToVector3(8.3996, 126.2112, EARTH_RADIUS)
        localPos.applyMatrix4(worldMatrix)
        const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
        expect(dot).toBeGreaterThanOrEqual(0.3125 - 0.01)
        expect(dot).toBeLessThanOrEqual(0.3125 + 0.01)
      }
    })

    it('lat 0, lon 0 at rotation 1.2566: visible→oculto, at 5.0353: oculto→visible', () => {
      const changes: number[] = []
      let prevVisible: boolean | null = null

      for (let i = 0; i <= 720; i++) {
        const angle = (i / 720) * 2 * Math.PI
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const visible = computeVisibility(0, 0, worldMatrix, cameraPos)

        if (prevVisible !== null && visible !== prevVisible) {
          changes.push(angle)
        }
        prevVisible = visible
      }

      expect(changes.length).toBe(2)
      console.log(`lat 0, lon 0 changes at ${changes[0].toFixed(4)} rad and ${changes[1].toFixed(4)} rad`)

      // En cada cambio, dot debe estar cerca del umbral (0.3125)
      for (const angle of changes) {
        const worldMatrix = new THREE.Matrix4()
        worldMatrix.makeRotationY(angle)
        const localPos = latLonToVector3(0, 0, EARTH_RADIUS)
        localPos.applyMatrix4(worldMatrix)
        const dot = localPos.dot(cameraPos) / (EARTH_RADIUS * d)
        expect(dot).toBeGreaterThanOrEqual(0.3125 - 0.01)
        expect(dot).toBeLessThanOrEqual(0.3125 + 0.01)
      }
    })
  })
})
