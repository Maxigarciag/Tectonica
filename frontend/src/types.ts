/** Tipos que coinciden con el DTO de la API (ver docs/decisiones/003-api-y-cache.md). */

export interface EarthquakeDTO {
  id: string
  mag: number
  place: string
  time: string // ISO 8601 UTC
  lat: number
  lon: number
  depth_km: number | null
  updated: number // epoch ms
}

export interface EarthquakesResponse {
  events: EarthquakeDTO[]
  count: number
  window: string
  stale: boolean
}

export interface StatusResponse {
  stale: boolean
  age_seconds: number
}

export type Window = 'hour' | 'day'
