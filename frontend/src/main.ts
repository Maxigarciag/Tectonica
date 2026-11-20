import './styles.css'
import { Globe } from './globe.ts'
import { UI } from './ui.ts'
import { initLiquidGlass } from './liquidGlass.ts'
import { startDataClient, stopDataClient, getLastValidResponse, startStatusClient, stopStatusClient } from './data.ts'
import type { EarthquakeDTO, EarthquakesResponse, StatusResponse, Window } from './types.ts'

const ui = new UI()
const globe = new Globe(ui.getGlobeContainer())

// Liquid-glass sobre el fondo del globo (lentes vacías, contenido DOM encima)
initLiquidGlass()

let currentWindow: Window = 'hour'
let detailOpen = false
let lastResponse: EarthquakesResponse | null = null
let showingAllEvents = false
let activeMagBin: number | null = null
const knownNotificationIds = new Set<string>()
let hasInitializedNotifications = false
const MIN_NOTIFICATION_MAG = 2.5

function matchesMagBin(mag: number, bin: number | null): boolean {
  if (bin === null) return true
  if (bin === 0) return mag < 2
  if (bin === 1) return mag >= 2 && mag < 3
  if (bin === 2) return mag >= 3 && mag < 4
  if (bin === 3) return mag >= 4 && mag < 5
  return mag >= 5
}

// Función centralizada para enfocar y mostrar detalle de un evento
function selectAndFocusEvent(event: EarthquakeDTO): void {
  if (!detailOpen) {
    globe.saveCameraState()
    detailOpen = true
  }
  globe.focusOnEvent(event)
  ui.showDetail(event)
  ui.setSelectedEvent(event.id)
  globe.setSelectedEvent(event.id)
}

// Renderizar eventos en el globo y en el panel lateral
function renderResponse(response: EarthquakesResponse): void {
  const filteredEvents =
    activeMagBin === null
      ? response.events
      : response.events.filter((e) => matchesMagBin(e.mag, activeMagBin))

  globe.setEvents(filteredEvents)
  // Sidebar: los 3 eventos más recientes (o todos si se expandió) + botón "Ver todos"
  ui.renderEventsList(
    filteredEvents,
    (event) => {
      selectAndFocusEvent(event)
    },
    showingAllEvents ? undefined : 3
  )
  // Hover sincronizado lista → globo
  ui.setOnEventHover((id) => globe.setHoveredEvent(id))
  // Selección sincronizada globo ↔ lista
  ui.setOnEventSelect((id) => {
    globe.setSelectedEvent(id)
    if (!id && detailOpen) {
      ui.hideDetail()
      globe.restoreCameraState()
      detailOpen = false
    }
  })
  globe.setOnEventSelect((id) => {
    ui.setSelectedEvent(id)
    if (!id && detailOpen) {
      ui.hideDetail()
      globe.restoreCameraState()
      detailOpen = false
    }
  })
  // Click directo en el sismo en el globo 3D
  globe.setOnEventClick((event) => {
    selectAndFocusEvent(event)
  })
  ui.renderMagnitudes(response.events)

  let maxMag: number | null = null
  let maxMagPlace: string | null = null
  let latestEvent: EarthquakeDTO | null = null
  let latestTime = -Infinity
  for (const e of response.events) {
    if (maxMag === null || e.mag > maxMag) {
      maxMag = e.mag
      maxMagPlace = e.place
    }
    const t = new Date(e.time).getTime()
    if (t > latestTime) {
      latestTime = t
      latestEvent = e
    }
  }
  ui.updateStats(response.count, maxMag, maxMagPlace, latestEvent)
}

function handleData(response: EarthquakesResponse): void {
  // Detectar nuevos eventos con magnitud >= 2.5 tras la carga inicial de la ventana
  if (hasInitializedNotifications) {
    const newSignificant = response.events
      .filter((e) => !knownNotificationIds.has(e.id) && e.mag >= MIN_NOTIFICATION_MAG)
      .sort((a, b) => b.mag - a.mag)
      .slice(0, 2)

    for (const ev of newSignificant) {
      ui.showEventNotification(ev, (target) => selectAndFocusEvent(target))
    }
  }

  for (const e of response.events) {
    knownNotificationIds.add(e.id)
  }
  hasInitializedNotifications = true

  lastResponse = response
  renderResponse(response)
  // La pill de estado ahora se alimenta de /api/v1/status (ver handleStatus),
  // no del campo stale del endpoint de eventos.
}

function handleStatus(status: StatusResponse): void {
  const age = Math.floor(status.age_seconds)
  ui.updateStatus(age, status.stale, false)
}

function handleError(_message: string): void {
  // Error de API: estado rojo, age grande para forzar stale
  ui.updateStatus(UI.STALE_THRESHOLD_S, true, true)
  const last = getLastValidResponse()
  if (last) {
    renderResponse(last)
  }
}

ui.setOnWindowChange((window) => {
  currentWindow = window
  showingAllEvents = false
  hasInitializedNotifications = false
  knownNotificationIds.clear()
  void startDataClient(window, { onData: handleData, onError: handleError })
})

ui.setOnViewAllClick(() => {
  if (lastResponse) {
    showingAllEvents = !showingAllEvents
    const filteredEvents =
      activeMagBin === null
        ? lastResponse.events
        : lastResponse.events.filter((e) => matchesMagBin(e.mag, activeMagBin))
    ui.renderEventsList(
      filteredEvents,
      (event) => {
        selectAndFocusEvent(event)
      },
      showingAllEvents ? undefined : 3
    )
  }
})

ui.setOnMagFilterChange((bin) => {
  activeMagBin = bin
  if (lastResponse) {
    renderResponse(lastResponse)
  }
})

// Controles de cámara (dock inferior izquierdo)
let rotationPaused = false
ui.setCameraControls(
  () => {
    rotationPaused = !rotationPaused
    globe.setAutoRotation(!rotationPaused)
    ui.setRotationPaused(rotationPaused)
  },
  () => {
    globe.resetView()
    if (detailOpen) {
      ui.hideDetail()
      detailOpen = false
    }
  },
  (speed) => {
    globe.setRotationSpeed(speed)
  },
  () => {
    globe.zoomBy(0.78)
  },
  () => {
    globe.zoomBy(1.28)
  }
)

// Cámara al cerrar tarjeta de detalle (A3)
ui.setDetailCallbacks(() => {
  globe.restoreCameraState()
  globe.setSelectedEvent(null)
  detailOpen = false
})

// Capas del mapa y configuración visual (barra superior)
ui.setOnLayersChange((layersState) => {
  globe.setEpicentersVisible(layersState.epicenters)
  globe.setWavesEnabled(layersState.waves)
  globe.setTectonicPlatesVisible(layersState.tectonicPlates)
  globe.setDayNightLighting(layersState.dayNight)
  globe.setDensityMapVisible(layersState.density)
})

ui.setOnVisualSettingsChange((visualState) => {
  globe.setTheme(visualState.theme)
  globe.setHudLabelsEnabled(visualState.hudLabels)
})

// Sincronizar tema inicial con la escena 3D
globe.setTheme(ui.getTheme())

// Iniciar con la ventana por defecto (última hora)
void startDataClient(currentWindow, { onData: handleData, onError: handleError })
void startStatusClient({ onStatus: handleStatus, onError: handleError })

// Limpieza al cerrar la pestaña
window.addEventListener('beforeunload', () => {
  stopDataClient()
  stopStatusClient()
  globe.dispose()
  ui.dispose()
})
