import * as THREE from 'three'

export const EARTH_RADIUS = 100

/**
 * Convierte latitud/longitud a un Vector3 en la superficie de una esfera.
 * Función pura: no depende de Three.js escena, solo de su API de vectores.
 */
export function latLonToVector3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  const x = -radius * Math.cos(theta) * Math.sin(phi)
  const y = radius * Math.cos(phi)
  const z = radius * Math.sin(theta) * Math.sin(phi)
  return new THREE.Vector3(x, y, z)
}

/**
 * Calcula si un evento es visible desde la cámara.
 *
 * Un punto en la superficie de una esfera de radio R es visible desde una
 * cámara a distancia d si:
 *   dot(normalizado(P), normalizado(C)) >= R / d
 *
 * @param lat Latitud del evento en grados
 * @param lon Longitud del evento en grados
 * @param worldMatrix Matriz mundo del grupo Tierra (incluye rotación)
 * @param cameraPos Posición de la cámara en espacio mundial
 * @param earthRadius Radio de la Tierra (default 100)
 * @returns true si el evento es visible (no está oculto por la Tierra)
 */
export function computeVisibility(
  lat: number,
  lon: number,
  worldMatrix: THREE.Matrix4,
  cameraPos: THREE.Vector3,
  earthRadius: number = EARTH_RADIUS
): boolean {
  const localPos = latLonToVector3(lat, lon, earthRadius)
  localPos.applyMatrix4(worldMatrix)
  const d = cameraPos.length()
  const dot = localPos.dot(cameraPos) / (earthRadius * d)
  return dot >= earthRadius / d
}
