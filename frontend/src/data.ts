/**
 * Cliente de datos para el endpoint /api/v1/earthquakes.
 *
 * - Consulta solo la API (nunca al USGS directamente).
 * - Refresca cada 30 s, coincidiendo con el max-age de la API.
 * - Ante error de red, conserva el último dato válido y lo sigue exponiendo.
 */

import type { EarthquakesResponse, StatusResponse, Window } from './types.ts'

const API_BASE = '/api/v1/earthquakes'
const STATUS_BASE = '/api/v1/status'

export interface DataClientCallbacks {
  onData: (response: EarthquakesResponse) => void
  onError: (message: string) => void
}

export interface StatusCallbacks {
  onStatus: (status: StatusResponse) => void
  onError: (message: string) => void
}

let lastValidResponse: EarthquakesResponse | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let isRefreshing = false

const REFRESH_MS = 30_000

async function fetchEarthquakes(window: Window): Promise<EarthquakesResponse> {
  const res = await fetch(`${API_BASE}?window=${window}`, { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`API respondió ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as EarthquakesResponse
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${STATUS_BASE}`, { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`API respondió ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as StatusResponse
}

export function startDataClient(window: Window, callbacks: DataClientCallbacks): void {
  // Carga inicial
  void fetchEarthquakes(window)
    .then((data) => {
      lastValidResponse = data
      callbacks.onData(data)
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      callbacks.onError(msg)
      if (lastValidResponse) {
        callbacks.onData(lastValidResponse)
      }
    })

  // Refresco periódico
  function schedule() {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(async () => {
      if (isRefreshing) {
        schedule()
        return
      }
      isRefreshing = true
      try {
        const data = await fetchEarthquakes(window)
        lastValidResponse = data
        callbacks.onData(data)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        callbacks.onError(msg)
        if (lastValidResponse) {
          callbacks.onData(lastValidResponse)
        }
      } finally {
        isRefreshing = false
        schedule()
      }
    }, REFRESH_MS)
  }
  schedule()
}

export function stopDataClient(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

export function getLastValidResponse(): EarthquakesResponse | null {
  return lastValidResponse
}

/* ─── Cliente de estado: /api/v1/status ─── */
let statusTimer: ReturnType<typeof setTimeout> | null = null
let statusRefreshing = false

export function startStatusClient(callbacks: StatusCallbacks): void {
  function schedule() {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(async () => {
      if (statusRefreshing) {
        schedule()
        return
      }
      statusRefreshing = true
      try {
        const status = await fetchStatus()
        callbacks.onStatus(status)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        callbacks.onError(msg)
      } finally {
        statusRefreshing = false
        schedule()
      }
    }, REFRESH_MS)
  }
  schedule()
}

export function stopStatusClient(): void {
  if (statusTimer) {
    clearTimeout(statusTimer)
    statusTimer = null
  }
}
