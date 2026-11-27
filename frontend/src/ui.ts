import type { EarthquakeDTO, Window } from './types.ts'
import { cssColor, MAG_COLORS_MAP } from './colors.ts'
import { moon, sun, pause, play, reset, close, chevronRight, chevronDown, externalLink, layers, sliders, zoomIn, zoomOut, eye, eyeOff } from './icons.ts'

export interface LayerState {
  epicenters: boolean
  waves: boolean
  tectonicPlates: boolean
  dayNight: boolean
  density: boolean
}

export interface VisualSettingsState {
  theme: 'light' | 'dark'
  hudLabels: boolean
}

export class UI {
  private container: HTMLElement
  private globeContainer!: HTMLElement
  private windowValue: Window = 'hour'
  private theme: 'light' | 'dark' = 'light'
  private statusIndicator!: HTMLElement
  private statusDot!: HTMLSpanElement
  private statusText!: HTMLSpanElement
  private themeToggle!: HTMLButtonElement
  private layersMenu!: HTMLElement
  private settingsMenu!: HTMLElement
  private layersBtn!: HTMLButtonElement
  private settingsBtn!: HTMLButtonElement
  private layerState: LayerState = {
    epicenters: true,
    waves: true,
    tectonicPlates: true,
    dayNight: true,
    density: false,
  }
  private visualState: VisualSettingsState = {
    theme: 'dark',
    hudLabels: true,
  }
  private onLayersChange: ((state: LayerState) => void) | null = null
  private onVisualSettingsChange: ((state: VisualSettingsState) => void) | null = null
  private activeMagBin: number | null = null
  private onMagFilterChange: ((binIndex: number | null) => void) | null = null
  private magFilterClearBtn!: HTMLButtonElement
  private countLabel!: HTMLElement
  private countBadge!: HTMLElement
  private maxMagLabel!: HTMLElement
  private maxMagBadge!: HTMLElement
  private maxMagPlace!: HTMLElement
  private lastEventValue!: HTMLElement
  private activityBadge!: HTMLElement
  private activityDot!: HTMLElement
  private activityText!: HTMLElement
  private sidebar!: HTMLElement
  private sidebarReopenBtn!: HTMLButtonElement
  private magRowsInitialized: boolean = false
  private eventsList!: HTMLElement
  private viewAllBtn!: HTMLButtonElement
  private pauseBtn!: HTMLButtonElement
  private resetBtn!: HTMLButtonElement
  private speedBtn!: HTMLButtonElement
  private zoomInBtn!: HTMLButtonElement
  private zoomOutBtn!: HTMLButtonElement
  private epicentersBtn!: HTMLButtonElement
  private rotationSpeeds = [0.5, 1, 2]
  private rotationSpeedIdx = 1
  private detailPanel!: HTMLElement
  private detailCollapse!: HTMLButtonElement
  private detailClose!: HTMLButtonElement
  private detailContent!: HTMLElement
  private detailCollapsed: boolean = false
  private toastContainer!: HTMLElement
  private onWindowChange: ((window: Window) => void) | null = null
  private onViewAll: (() => void) | null = null
  private onDetailClose: (() => void) | null = null
  private onEventHover: ((id: string | null) => void) | null = null
  private onEventSelect: ((id: string | null) => void) | null = null
  private selectedEventId: string | null = null

  // Estado reactivo del listado de eventos
  private lastEvents: EarthquakeDTO[] = []
  private lastOnEventClick: ((event: EarthquakeDTO) => void) | null = null
  private currentLimit: number | undefined = 3
  private isShowingAll: boolean = false

  // Umbrales de estado de actualización (constantes en un solo lugar)
    public static readonly FRESH_THRESHOLD_S = 120 // < 120s = verde
    public static readonly STALE_THRESHOLD_S = 300 // ≥ 300s = gris (si no stale antes)

  constructor() {
    this.container = document.getElementById('app')!
    this.applyTheme()
    this.buildHeader()
    this.buildMain()
    this.buildDetailPanel()
    this.buildToastContainer()
    this.buildFooter()
  }

  /* ─── Tema claro/oscuro (persistido en localStorage, por defecto oscuro) ─── */
  private applyTheme(): void {
    let stored: string | null = null
    try {
      stored = localStorage.getItem('theme')
    } catch {
      // localStorage no disponible o bloqueado: se usa el valor por defecto
    }
    this.theme = (stored === 'light' || stored === 'dark') ? stored : 'dark'
    this.visualState.theme = this.theme
    document.documentElement.dataset.theme = this.theme
    if (this.themeToggle) {
      this.setThemeIcon()
    }
  }

  private setThemeIcon(): void {
    if (!this.themeToggle) return
    this.themeToggle.innerHTML = this.theme === 'dark' ? sun() : moon()
    this.themeToggle.setAttribute('title', this.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro')
  }

  private setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme
    this.visualState.theme = theme
    document.documentElement.dataset.theme = theme
    this.setThemeIcon()
    if (this.themeToggle) {
      this.themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false')
    }
    try {
      localStorage.setItem('theme', theme)
    } catch {
      // localStorage no disponible: se ignora la persistencia
    }
    this.syncVisualSettingsMenu()
    if (this.onVisualSettingsChange) this.onVisualSettingsChange({ ...this.visualState })
  }

  private toggleTheme(): void {
    this.setTheme(this.theme === 'light' ? 'dark' : 'light')
  }

  getTheme(): 'light' | 'dark' {
    return this.theme
  }

  private closeHeaderMenus(except?: HTMLElement): void {
    if (this.layersMenu && this.layersMenu !== except) {
      this.layersMenu.classList.add('hidden')
      this.layersBtn.setAttribute('aria-expanded', 'false')
    }
    if (this.settingsMenu && this.settingsMenu !== except) {
      this.settingsMenu.classList.add('hidden')
      this.settingsBtn.setAttribute('aria-expanded', 'false')
    }
  }

  private syncVisualSettingsMenu(): void {
    if (!this.settingsMenu) return
    const themeBtns = this.settingsMenu.querySelectorAll<HTMLButtonElement>('[data-setting-theme]')
    themeBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.settingTheme === this.visualState.theme)
    })
    const labelsCheck = this.settingsMenu.querySelector<HTMLInputElement>('[data-setting-labels]')
    if (labelsCheck) labelsCheck.checked = this.visualState.hudLabels
  }

  /* ─── Cabecera en tres zonas: marca | segmentado | estado + capas + configuración ─── */
  private buildHeader(): void {
    const header = document.createElement('header')
    header.className = 'header liquid-glass'

    const lens = document.createElement('div')
    lens.id = 'lens-header'
    lens.className = 'liquid-glass__lens'
    lens.setAttribute('aria-hidden', 'true')
    header.appendChild(lens)

    const content = document.createElement('div')
    content.className = 'liquid-glass__content'

    /* Zona izquierda: marca tipográfica Pulso de la Tierra (sin ícono/logo) */
    const brandZone = document.createElement('div')
    brandZone.className = 'brand-zone'

    const brandText = document.createElement('div')
    brandText.className = 'brand-text'

    const title = document.createElement('h1')
    title.textContent = 'Tectonica'
    brandText.appendChild(title)

    const sub = document.createElement('span')
    sub.className = 'brand-sub'
    sub.textContent = 'Monitor sísmico en tiempo real'
    brandText.appendChild(sub)

    brandZone.appendChild(brandText)

    /* Zona centro: selector temporal integrado */
    const segmentedZone = document.createElement('div')
    segmentedZone.className = 'segmented-zone'

    const segmented = document.createElement('div')
    segmented.className = 'segmented-control'

    const btnHour = document.createElement('button')
    btnHour.type = 'button'
    btnHour.className = 'seg active'
    btnHour.dataset.window = 'hour'
    btnHour.textContent = 'Última hora'
    segmented.appendChild(btnHour)

    const btnDay = document.createElement('button')
    btnDay.type = 'button'
    btnDay.className = 'seg'
    btnDay.dataset.window = 'day'
    btnDay.textContent = 'Últimas 24 h'
    segmented.appendChild(btnDay)

    segmented.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as HTMLButtonElement
      if (!target.classList.contains('seg')) return
      const val = target.dataset.window as Window
      if (val === this.windowValue) return
      btnHour.classList.toggle('active', val === 'hour')
      btnDay.classList.toggle('active', val === 'day')
      this.windowValue = val
      if (this.onWindowChange) this.onWindowChange(val)
    })

    segmentedZone.appendChild(segmented)

    /* Zona derecha: estado + selector de capas + configuración visual */
    const statusZone = document.createElement('div')
    statusZone.className = 'status-zone'

    this.statusIndicator = document.createElement('span')
    this.statusIndicator.id = 'status-indicator'
    this.statusIndicator.setAttribute('aria-live', 'polite')

    this.statusDot = document.createElement('span')
    this.statusDot.className = 'status-dot'
    this.statusIndicator.appendChild(this.statusDot)

    this.statusText = document.createElement('span')
    this.statusText.className = 'status-text'
    this.statusText.textContent = 'Cargando…'
    this.statusIndicator.appendChild(this.statusText)

    statusZone.appendChild(this.statusIndicator)

    /* Selector de capas del mapa */
    const layersWrap = document.createElement('div')
    layersWrap.className = 'header-popover-wrap'

    this.layersBtn = document.createElement('button')
    this.layersBtn.type = 'button'
    this.layersBtn.className = 'header-pill-btn'
    this.layersBtn.setAttribute('aria-haspopup', 'true')
    this.layersBtn.setAttribute('aria-expanded', 'false')
    this.layersBtn.setAttribute('title', 'Capas del mapa')
    this.layersBtn.innerHTML = `${layers()}<span>Capas</span>`
    layersWrap.appendChild(this.layersBtn)

    this.layersMenu = document.createElement('div')
    this.layersMenu.className = 'header-popover liquid-glass hidden'
    this.layersMenu.innerHTML = `
      <div class="header-popover-title">CAPAS DEL GLOBO</div>
      <label class="popover-toggle-row">
        <span>Epicentros sísmicos</span>
        <input type="checkbox" data-layer="epicenters" checked />
      </label>
      <label class="popover-toggle-row">
        <span>Ondas expansivas</span>
        <input type="checkbox" data-layer="waves" checked />
      </label>
      <label class="popover-toggle-row">
        <span>Placas tectónicas</span>
        <input type="checkbox" data-layer="tectonicPlates" checked />
      </label>
      <label class="popover-toggle-row">
        <span>Iluminación día / noche</span>
        <input type="checkbox" data-layer="dayNight" checked />
      </label>
      <label class="popover-toggle-row">
        <span>Mapa de densidad</span>
        <input type="checkbox" data-layer="density" />
      </label>
    `
    layersWrap.appendChild(this.layersMenu)

    this.layersBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const willOpen = this.layersMenu.classList.contains('hidden')
      this.closeHeaderMenus(willOpen ? this.layersMenu : undefined)
      this.layersMenu.classList.toggle('hidden', !willOpen)
      this.layersBtn.setAttribute('aria-expanded', String(willOpen))
    })

    this.layersMenu.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement
      const key = input.dataset.layer as keyof LayerState | undefined
      if (!key) return
      this.layerState[key] = input.checked
      if (key === 'epicenters') this.syncEpicentersUI()
      if (this.onLayersChange) this.onLayersChange({ ...this.layerState })
    })

    statusZone.appendChild(layersWrap)

    /* Botón de configuración visual mejorado (popover + toggle rápido de tema) */
    const settingsWrap = document.createElement('div')
    settingsWrap.className = 'header-popover-wrap'

    this.settingsBtn = document.createElement('button')
    this.settingsBtn.type = 'button'
    this.settingsBtn.className = 'header-icon-btn'
    this.settingsBtn.setAttribute('aria-label', 'Configuración visual')
    this.settingsBtn.setAttribute('title', 'Configuración visual')
    this.settingsBtn.setAttribute('aria-haspopup', 'true')
    this.settingsBtn.setAttribute('aria-expanded', 'false')
    this.settingsBtn.innerHTML = sliders()
    settingsWrap.appendChild(this.settingsBtn)

    this.settingsMenu = document.createElement('div')
    this.settingsMenu.className = 'header-popover liquid-glass hidden'
    this.settingsMenu.innerHTML = `
      <div class="header-popover-title">CONFIGURACIÓN VISUAL</div>
      <div class="popover-group">
        <span class="popover-label">Tema</span>
        <div class="popover-seg">
          <button type="button" data-setting-theme="dark">Oscuro</button>
          <button type="button" data-setting-theme="light">Claro</button>
        </div>
      </div>
      <label class="popover-toggle-row">
        <span>Etiquetas en el globo</span>
        <input type="checkbox" data-setting-labels checked />
      </label>
    `
    settingsWrap.appendChild(this.settingsMenu)

    this.settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const willOpen = this.settingsMenu.classList.contains('hidden')
      this.closeHeaderMenus(willOpen ? this.settingsMenu : undefined)
      this.settingsMenu.classList.toggle('hidden', !willOpen)
      this.settingsBtn.setAttribute('aria-expanded', String(willOpen))
    })

    this.settingsMenu.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button')
      if (!btn) return
      const themeChoice = btn.dataset.settingTheme as 'light' | 'dark' | undefined
      if (themeChoice) {
        this.setTheme(themeChoice)
      }
    })

    this.settingsMenu.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement
      if (input.hasAttribute('data-setting-labels')) {
        this.visualState.hudLabels = input.checked
        if (this.onVisualSettingsChange) this.onVisualSettingsChange({ ...this.visualState })
      }
    })

    this.syncVisualSettingsMenu()
    statusZone.appendChild(settingsWrap)

    // Botón directo de tema (mantenido para acceso rápido de 1 clic)
    this.themeToggle = document.createElement('button')
    this.themeToggle.type = 'button'
    this.themeToggle.className = 'theme-toggle'
    this.themeToggle.setAttribute('aria-label', 'Alternar tema claro/oscuro')
    this.themeToggle.setAttribute('aria-pressed', String(this.theme === 'dark'))
    this.setThemeIcon()
    this.themeToggle.addEventListener('click', () => this.toggleTheme())
    statusZone.appendChild(this.themeToggle)

    // Cerrar popovers al hacer clic fuera o pulsar Escape
    document.addEventListener('click', (e) => {
      const target = e.target as Node
      if (!layersWrap.contains(target) && !settingsWrap.contains(target)) {
        this.closeHeaderMenus()
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeHeaderMenus()
    })

    content.appendChild(brandZone)
    content.appendChild(segmentedZone)
    content.appendChild(statusZone)
    header.appendChild(content)
    this.container.appendChild(header)
  }

  /* ─── Área principal: globo como fondo + barra lateral overlay ─── */
  private buildMain(): void {
    this.buildGlobeContainer()
    this.buildSidebar()
  }

  private syncEpicentersUI(): void {
    const visible = this.layerState.epicenters
    if (this.epicentersBtn) {
      this.epicentersBtn.innerHTML = visible ? eye() : eyeOff()
      this.epicentersBtn.classList.toggle('is-active', visible)
      this.epicentersBtn.setAttribute('aria-pressed', String(visible))
      const title = visible ? 'Ocultar epicentros' : 'Mostrar epicentros'
      this.epicentersBtn.setAttribute('aria-label', title)
      this.epicentersBtn.setAttribute('title', title)
    }
    if (this.layersMenu) {
      const checkbox = this.layersMenu.querySelector<HTMLInputElement>('input[data-layer="epicenters"]')
      if (checkbox) checkbox.checked = visible
    }
  }

  private buildGlobeContainer(): void {
    this.globeContainer = document.createElement('div')
    this.globeContainer.id = 'globe'
    this.globeContainer.className = 'liquid-glass'
    this.container.appendChild(this.globeContainer)

    // Barra flotante inferior izquierda de controles del globo
    const controls = document.createElement('div')
    controls.className = 'camera-controls liquid-glass'

    const controlsLens = document.createElement('div')
    controlsLens.id = 'lens-controls'
    controlsLens.className = 'liquid-glass__lens'
    controlsLens.setAttribute('aria-hidden', 'true')
    controls.appendChild(controlsLens)

    const controlsBody = document.createElement('div')
    controlsBody.className = 'liquid-glass__content camera-controls-inner'

    this.pauseBtn = document.createElement('button')
    this.pauseBtn.id = 'camera-pause'
    this.pauseBtn.type = 'button'
    this.pauseBtn.className = 'icon-btn'
    this.pauseBtn.setAttribute('aria-label', 'Pausar rotación automática')
    this.pauseBtn.setAttribute('title', 'Pausar rotación')
    this.pauseBtn.setAttribute('aria-pressed', 'false')
    this.pauseBtn.innerHTML = pause()
    controlsBody.appendChild(this.pauseBtn)

    this.resetBtn = document.createElement('button')
    this.resetBtn.id = 'camera-reset'
    this.resetBtn.type = 'button'
    this.resetBtn.className = 'icon-btn'
    this.resetBtn.setAttribute('aria-label', 'Reiniciar vista del globo')
    this.resetBtn.setAttribute('title', 'Reiniciar vista')
    this.resetBtn.innerHTML = reset()
    controlsBody.appendChild(this.resetBtn)

    this.speedBtn = document.createElement('button')
    this.speedBtn.id = 'camera-speed'
    this.speedBtn.type = 'button'
    this.speedBtn.className = 'dock-speed-btn tabular-nums mono'
    this.speedBtn.setAttribute('aria-label', 'Velocidad de rotación: 1x')
    this.speedBtn.setAttribute('title', 'Cambiar velocidad (0.5x / 1x / 2x)')
    this.speedBtn.textContent = '1x'
    controlsBody.appendChild(this.speedBtn)

    const sep1 = document.createElement('span')
    sep1.className = 'dock-sep'
    sep1.setAttribute('aria-hidden', 'true')
    controlsBody.appendChild(sep1)

    this.zoomInBtn = document.createElement('button')
    this.zoomInBtn.id = 'camera-zoom-in'
    this.zoomInBtn.type = 'button'
    this.zoomInBtn.className = 'icon-btn'
    this.zoomInBtn.setAttribute('aria-label', 'Acercar zoom')
    this.zoomInBtn.setAttribute('title', 'Acercar (+)')
    this.zoomInBtn.innerHTML = zoomIn()
    controlsBody.appendChild(this.zoomInBtn)

    this.zoomOutBtn = document.createElement('button')
    this.zoomOutBtn.id = 'camera-zoom-out'
    this.zoomOutBtn.type = 'button'
    this.zoomOutBtn.className = 'icon-btn'
    this.zoomOutBtn.setAttribute('aria-label', 'Alejar zoom')
    this.zoomOutBtn.setAttribute('title', 'Alejar (−)')
    this.zoomOutBtn.innerHTML = zoomOut()
    controlsBody.appendChild(this.zoomOutBtn)

    const sep2 = document.createElement('span')
    sep2.className = 'dock-sep'
    sep2.setAttribute('aria-hidden', 'true')
    controlsBody.appendChild(sep2)

    this.epicentersBtn = document.createElement('button')
    this.epicentersBtn.id = 'camera-epicenters'
    this.epicentersBtn.type = 'button'
    this.epicentersBtn.className = 'icon-btn is-active'
    this.epicentersBtn.addEventListener('click', () => {
      this.layerState.epicenters = !this.layerState.epicenters
      this.syncEpicentersUI()
      if (this.onLayersChange) this.onLayersChange({ ...this.layerState })
    })
    controlsBody.appendChild(this.epicentersBtn)
    this.syncEpicentersUI()

    controls.appendChild(controlsBody)
    this.globeContainer.appendChild(controls)
  }

  private setSidebarCollapsed(collapsed: boolean): void {
    this.sidebar.classList.toggle('collapsed', collapsed)
    this.sidebar.setAttribute('aria-hidden', String(collapsed))
    this.sidebarReopenBtn.classList.toggle('visible', collapsed)
    this.sidebarReopenBtn.setAttribute('aria-expanded', String(!collapsed))
  }

  private buildSidebar(): void {
    const sidebar = document.createElement('aside')
    sidebar.className = 'sidebar liquid-glass'
    this.sidebar = sidebar

    const lens = document.createElement('div')
    lens.id = 'lens-sidebar'
    lens.className = 'liquid-glass__lens'
    lens.setAttribute('aria-hidden', 'true')
    sidebar.appendChild(lens)

    const content = document.createElement('div')
    content.className = 'liquid-glass__content'

    /* Encabezado del panel + botón plegable responsivo */
    const panelHeader = document.createElement('div')
    panelHeader.className = 'panel-header'

    const panelHeaderText = document.createElement('div')
    panelHeaderText.className = 'panel-header-text'

    const panelTitle = document.createElement('h2')
    panelTitle.textContent = 'TABLERO DE SISMOS'
    panelHeaderText.appendChild(panelTitle)

    const panelSub = document.createElement('span')
    panelSub.className = 'panel-sub'
    panelSub.textContent = 'Monitoreo y telemetría global'
    panelHeaderText.appendChild(panelSub)

    panelHeader.appendChild(panelHeaderText)

    const collapseBtn = document.createElement('button')
    collapseBtn.type = 'button'
    collapseBtn.className = 'detail-icon-btn sidebar-collapse-btn'
    collapseBtn.setAttribute('aria-label', 'Ocultar tablero')
    collapseBtn.setAttribute('title', 'Ocultar tablero')
    collapseBtn.innerHTML = chevronRight()
    collapseBtn.addEventListener('click', () => this.setSidebarCollapsed(true))
    panelHeader.appendChild(collapseBtn)

    content.appendChild(panelHeader)

    /* ─── Sección A: Resumen general ─── */
    const sectionA = document.createElement('section')
    sectionA.className = 'dashboard-section'

    const resumenTitle = document.createElement('h3')
    resumenTitle.className = 'section-title'
    resumenTitle.textContent = 'Resumen general'
    sectionA.appendChild(resumenTitle)

    const kpiGrid = document.createElement('div')
    kpiGrid.className = 'kpi-grid'

    const countKpi = document.createElement('div')
    countKpi.className = 'kpi-card'

    this.countLabel = document.createElement('div')
    this.countLabel.className = 'kpi-label'
    this.countLabel.textContent = 'SISMOS REGISTRADOS'
    countKpi.appendChild(this.countLabel)

    this.countBadge = document.createElement('div')
    this.countBadge.className = 'kpi-value count tabular-nums'
    this.countBadge.textContent = '0'
    countKpi.appendChild(this.countBadge)
    kpiGrid.appendChild(countKpi)

    const maxMagKpi = document.createElement('div')
    maxMagKpi.className = 'kpi-card'

    this.maxMagLabel = document.createElement('div')
    this.maxMagLabel.className = 'kpi-label'
    this.maxMagLabel.textContent = 'MAGNITUD MÁXIMA'
    maxMagKpi.appendChild(this.maxMagLabel)

    this.maxMagBadge = document.createElement('div')
    this.maxMagBadge.className = 'kpi-value max-mag tabular-nums mono'
    this.maxMagBadge.textContent = '—'
    maxMagKpi.appendChild(this.maxMagBadge)

    this.maxMagPlace = document.createElement('div')
    this.maxMagPlace.className = 'kpi-place'
    this.maxMagPlace.textContent = ''
    maxMagKpi.appendChild(this.maxMagPlace)
    kpiGrid.appendChild(maxMagKpi)

    sectionA.appendChild(kpiGrid)

    /* Fila de contexto: Último evento + Indicador de actividad */
    const metaGrid = document.createElement('div')
    metaGrid.className = 'summary-meta-grid'

    const lastEventCell = document.createElement('div')
    lastEventCell.className = 'summary-meta-card'

    const lastEventLabel = document.createElement('span')
    lastEventLabel.className = 'kpi-label'
    lastEventLabel.textContent = 'ÚLTIMO EVENTO'
    lastEventCell.appendChild(lastEventLabel)

    this.lastEventValue = document.createElement('span')
    this.lastEventValue.className = 'summary-meta-value tabular-nums mono'
    this.lastEventValue.textContent = '—'
    lastEventCell.appendChild(this.lastEventValue)
    metaGrid.appendChild(lastEventCell)

    const activityCell = document.createElement('div')
    activityCell.className = 'summary-meta-card'

    const activityLabel = document.createElement('span')
    activityLabel.className = 'kpi-label'
    activityLabel.textContent = 'ACTIVIDAD'
    activityCell.appendChild(activityLabel)

    this.activityBadge = document.createElement('div')
    this.activityBadge.className = 'activity-badge'
    this.activityDot = document.createElement('span')
    this.activityDot.className = 'activity-dot'
    this.activityText = document.createElement('span')
    this.activityText.className = 'activity-text'
    this.activityText.textContent = 'Normal'
    this.activityBadge.appendChild(this.activityDot)
    this.activityBadge.appendChild(this.activityText)
    activityCell.appendChild(this.activityBadge)
    metaGrid.appendChild(activityCell)

    sectionA.appendChild(metaGrid)
    content.appendChild(sectionA)

    const divAB = document.createElement('div')
    divAB.className = 'dashboard-divider'
    content.appendChild(divAB)

    /* ─── Sección B: Distribución por magnitud ─── */
    const sectionB = document.createElement('section')
    sectionB.className = 'dashboard-section'

    const magSectionTitle = document.createElement('h3')
    magSectionTitle.className = 'section-title'
    magSectionTitle.textContent = 'Distribución por magnitud'
    sectionB.appendChild(magSectionTitle)

    const magnitudeSection = document.createElement('div')
    magnitudeSection.className = 'magnitude-section'
    sectionB.appendChild(magnitudeSection)
    content.appendChild(sectionB)

    const divBC = document.createElement('div')
    divBC.className = 'dashboard-divider'
    content.appendChild(divBC)

    /* ─── Sección C: Actividad reciente ─── */
    const sectionC = document.createElement('section')
    sectionC.className = 'dashboard-section dashboard-section--events'

    const recientesHeader = document.createElement('div')
    recientesHeader.className = 'section-title-row'

    const recientesTitle = document.createElement('h3')
    recientesTitle.className = 'section-title'
    recientesTitle.textContent = 'Actividad reciente'
    recientesHeader.appendChild(recientesTitle)

    this.magFilterClearBtn = document.createElement('button')
    this.magFilterClearBtn.type = 'button'
    this.magFilterClearBtn.className = 'mag-filter-clear hidden'
    this.magFilterClearBtn.textContent = 'Limpiar filtro'
    this.magFilterClearBtn.addEventListener('click', () => {
      this.setMagFilterBin(null)
    })
    recientesHeader.appendChild(this.magFilterClearBtn)

    sectionC.appendChild(recientesHeader)

    const eventsSection = document.createElement('div')
    eventsSection.className = 'events-section'

    this.eventsList = document.createElement('div')
    this.eventsList.className = 'events-list'
    eventsSection.appendChild(this.eventsList)

    this.viewAllBtn = document.createElement('button')
    this.viewAllBtn.type = 'button'
    this.viewAllBtn.className = 'view-all-btn'
    this.viewAllBtn.innerHTML = `<span>Ver todos</span>${chevronRight()}`
    this.viewAllBtn.addEventListener('click', () => {
      if (this.onViewAll) this.onViewAll()
    })
    eventsSection.appendChild(this.viewAllBtn)

    sectionC.appendChild(eventsSection)
    content.appendChild(sectionC)

    sidebar.appendChild(content)
    this.container.appendChild(sidebar)

    /* Botón flotante discreto para reabrir el tablero cuando está plegado */
    this.sidebarReopenBtn = document.createElement('button')
    this.sidebarReopenBtn.type = 'button'
    this.sidebarReopenBtn.className = 'sidebar-reopen-btn liquid-glass'
    this.sidebarReopenBtn.setAttribute('aria-label', 'Mostrar tablero de sismos')
    this.sidebarReopenBtn.setAttribute('aria-expanded', 'true')
    this.sidebarReopenBtn.innerHTML = `<span>Tablero</span>${chevronRight()}`
    this.sidebarReopenBtn.addEventListener('click', () => this.setSidebarCollapsed(false))
    this.container.appendChild(this.sidebarReopenBtn)
  }

  /* ─── Panel de detalle (tarjeta flotante HUD de cristal) ─── */
  private buildDetailPanel(): void {
    this.detailPanel = document.createElement('aside')
    this.detailPanel.id = 'detail-panel'
    this.detailPanel.className = 'detail hidden liquid-glass'
    this.detailPanel.setAttribute('role', 'dialog')
    this.detailPanel.setAttribute('aria-modal', 'false')
    this.detailPanel.setAttribute('aria-labelledby', 'detail-title')
    this.detailPanel.tabIndex = -1

    const lens = document.createElement('div')
    lens.id = 'lens-detail'
    lens.className = 'liquid-glass__lens'
    lens.setAttribute('aria-hidden', 'true')
    this.detailPanel.appendChild(lens)

    const content = document.createElement('div')
    content.className = 'liquid-glass__content detail-inner'

    const topBar = document.createElement('div')
    topBar.className = 'detail-top-bar'

    const tag = document.createElement('div')
    tag.className = 'detail-tag'
    tag.innerHTML = '<span class="detail-tag-dot"></span><span>DETALLE DE SISMO</span>'
    topBar.appendChild(tag)

    const actions = document.createElement('div')
    actions.className = 'detail-top-actions'

    this.detailCollapse = document.createElement('button')
    this.detailCollapse.id = 'detail-collapse'
    this.detailCollapse.type = 'button'
    this.detailCollapse.className = 'detail-icon-btn detail-collapse-btn'
    this.detailCollapse.setAttribute('aria-label', 'Plegar detalle')
    this.detailCollapse.setAttribute('aria-expanded', 'true')
    this.detailCollapse.setAttribute('title', 'Plegar / desplegar')
    this.detailCollapse.innerHTML = chevronDown()
    actions.appendChild(this.detailCollapse)

    this.detailClose = document.createElement('button')
    this.detailClose.id = 'detail-close'
    this.detailClose.type = 'button'
    this.detailClose.className = 'detail-icon-btn detail-close-btn'
    this.detailClose.setAttribute('aria-label', 'Cerrar detalle')
    this.detailClose.setAttribute('title', 'Cerrar')
    this.detailClose.innerHTML = close()
    actions.appendChild(this.detailClose)

    topBar.appendChild(actions)
    content.appendChild(topBar)

    this.detailContent = document.createElement('div')
    this.detailContent.className = 'detail-body'
    content.appendChild(this.detailContent)

    this.detailPanel.appendChild(content)

    this.detailCollapse.addEventListener('click', () => this.setDetailCollapsed(!this.detailCollapsed))
    this.detailClose.addEventListener('click', () => this.hideDetail())
    this.detailPanel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideDetail()
    })

    this.container.appendChild(this.detailPanel)
  }

  private buildToastContainer(): void {
    this.toastContainer = document.createElement('div')
    this.toastContainer.className = 'toast-stack'
    this.toastContainer.setAttribute('aria-live', 'polite')
    this.container.appendChild(this.toastContainer)
  }

  showEventNotification(event: EarthquakeDTO, onInspect: (ev: EarthquakeDTO) => void): void {
    if (!this.toastContainer) return

    // Limitar a máximo 2 notificaciones simultáneas para no saturar
    while (this.toastContainer.children.length >= 2) {
      this.toastContainer.firstElementChild?.remove()
    }

    const magColor = cssColor(`--mag-range-${this.magRangeIndex(event.mag)}`)
    const placeParts = event.place.split(',').map((p) => p.trim())
    const placeShort = placeParts.slice(0, 2).join(', ') || event.place

    const toast = document.createElement('div')
    toast.className = 'event-toast liquid-glass'
    toast.setAttribute('role', 'status')
    toast.style.setProperty('--mag-color', magColor)

    toast.innerHTML = `
      <span class="event-toast-dot"></span>
      <span class="event-toast-mag tabular-nums mono">M ${event.mag.toFixed(1)}</span>
      <span class="event-toast-text" title="${event.place}">Nuevo sismo · ${placeShort}</span>
      <button type="button" class="event-toast-action">Ver</button>
      <button type="button" class="event-toast-close" aria-label="Descartar aviso">${close()}</button>
    `

    let dismissTimer: number | undefined
    const dismiss = () => {
      if (dismissTimer) clearTimeout(dismissTimer)
      toast.classList.add('is-leaving')
      window.setTimeout(() => toast.remove(), 200)
    }

    const scheduleDismiss = () => {
      dismissTimer = window.setTimeout(dismiss, 6500)
    }

    toast.addEventListener('mouseenter', () => {
      if (dismissTimer) clearTimeout(dismissTimer)
    })
    toast.addEventListener('mouseleave', scheduleDismiss)

    const actionBtn = toast.querySelector<HTMLButtonElement>('.event-toast-action')
    actionBtn?.addEventListener('click', () => {
      onInspect(event)
      dismiss()
    })

    const closeBtn = toast.querySelector<HTMLButtonElement>('.event-toast-close')
    closeBtn?.addEventListener('click', dismiss)

    this.toastContainer.appendChild(toast)
    requestAnimationFrame(() => toast.classList.add('is-visible'))
    scheduleDismiss()
  }

  /* ─── Pie de página (líquido-glass) ─── */
  private buildFooter(): void {
    const footer = document.createElement('footer')
    footer.className = 'footer liquid-glass'

    const lens = document.createElement('div')
    lens.id = 'lens-footer'
    lens.className = 'liquid-glass__lens'
    lens.setAttribute('aria-hidden', 'true')
    footer.appendChild(lens)

    const content = document.createElement('div')
    content.className = 'liquid-glass__content'
    content.innerHTML = '<p>Datos: <a href="https://www.usgs.gov/" target="_blank" rel="noopener noreferrer">U.S. Geological Survey</a></p>'
    footer.appendChild(content)

    this.container.appendChild(footer)
  }

  /* ─── API pública (estable; main.ts depende de ella) ─── */
  getGlobeContainer(): HTMLElement {
    return this.globeContainer
  }

  setGlobeContainer(): void {
    // No-op: el contenedor del globo se crea una sola vez en buildGlobeContainer()
  }

  setOnWindowChange(callback: (window: Window) => void): void {
    this.onWindowChange = callback
  }

  setOnViewAllClick(callback: () => void): void {
      this.onViewAll = callback
    }

    setOnEventHover(callback: (id: string | null) => void): void {
        this.onEventHover = callback
      }

      setOnEventSelect(callback: (id: string | null) => void): void {
            this.onEventSelect = callback
          }

  setSelectedEvent(id: string | null): void {
    if (this.selectedEventId === id) return
    this.selectedEventId = id
    this.updateListSelection()
    if (this.onEventSelect) this.onEventSelect(id)
  }

        getWindow(): Window {
    return this.windowValue
  }

  setCameraControls(
    onPause: () => void,
    onReset: () => void,
    onSpeedChange?: (speed: number) => void,
    onZoomIn?: () => void,
    onZoomOut?: () => void
  ): void {
    this.pauseBtn.addEventListener('click', onPause)
    this.resetBtn.addEventListener('click', onReset)

    this.speedBtn.addEventListener('click', () => {
      this.rotationSpeedIdx = (this.rotationSpeedIdx + 1) % this.rotationSpeeds.length
      const nextSpeed = this.rotationSpeeds[this.rotationSpeedIdx]
      this.speedBtn.textContent = `${nextSpeed}x`
      this.speedBtn.setAttribute('aria-label', `Velocidad de rotación: ${nextSpeed}x`)
      if (onSpeedChange) onSpeedChange(nextSpeed)
    })

    if (onZoomIn) this.zoomInBtn.addEventListener('click', onZoomIn)
    if (onZoomOut) this.zoomOutBtn.addEventListener('click', onZoomOut)
  }

  setRotationPaused(paused: boolean): void {
    this.pauseBtn.innerHTML = paused ? play() : pause()
    this.pauseBtn.setAttribute('aria-pressed', String(paused))
    const label = paused ? 'Reanudar rotación' : 'Pausar rotación'
    this.pauseBtn.setAttribute('aria-label', label)
    this.pauseBtn.setAttribute('title', label)
  }

  setDetailCallbacks(onClose: () => void): void {
    this.onDetailClose = onClose
  }

  setOnLayersChange(callback: (state: LayerState) => void): void {
    this.onLayersChange = callback
  }

  setOnVisualSettingsChange(callback: (state: VisualSettingsState) => void): void {
    this.onVisualSettingsChange = callback
  }

  setOnMagFilterChange(callback: (binIndex: number | null) => void): void {
    this.onMagFilterChange = callback
  }

  private setMagFilterBin(binIndex: number | null): void {
    this.activeMagBin = binIndex
    const container = document.querySelector('.magnitude-section') as HTMLElement | null
    if (container) {
      container.classList.toggle('has-filter', binIndex !== null)
      const rows = container.querySelectorAll<HTMLElement>('.mag-row')
      rows.forEach((row, idx) => {
        const active = binIndex === idx
        row.classList.toggle('is-active', active)
        row.setAttribute('aria-pressed', String(active))
      })
    }
    if (this.magFilterClearBtn) {
      this.magFilterClearBtn.classList.toggle('hidden', binIndex === null)
    }
    if (this.onMagFilterChange) {
      this.onMagFilterChange(binIndex)
    }
  }

  updateStatus(ageSeconds: number, stale: boolean, error: boolean = false): void {
      // Determinar estado según umbrales
      let state: 'fresh' | 'warning' | 'stale' | 'error'
      let text: string

      if (error) {
        state = 'error'
        text = 'Error de conexión'
      } else if (stale || ageSeconds >= UI.STALE_THRESHOLD_S) {
        state = 'stale'
        text = 'Desactualizado'
      } else if (ageSeconds < UI.FRESH_THRESHOLD_S) {
        state = 'fresh'
        text = ageSeconds === 0 ? 'Actualizado hace 0 s' : `Actualizado hace ${ageSeconds} s`
      } else {
        state = 'warning'
        text = `Actualizado hace ${ageSeconds} s`
      }

      this.statusText.textContent = text
      this.statusIndicator.className = state
    }

  updateStats(
    count: number,
    maxMag: number | null,
    maxMagPlace: string | null = null,
    latestEvent: EarthquakeDTO | null = null
  ): void {
    this.countBadge.textContent = String(count)
    if (maxMag === null) {
      this.maxMagBadge.textContent = '—'
      this.maxMagBadge.style.color = 'var(--accent)'
      this.maxMagPlace.textContent = ''
    } else {
      this.maxMagBadge.textContent = maxMag.toFixed(1)
      this.maxMagBadge.style.color = cssColor(`--mag-range-${this.magRangeIndex(maxMag)}`)
      this.maxMagPlace.textContent = maxMagPlace ? maxMagPlace : ''
    }

    // Último evento detectado
    if (latestEvent) {
      const minsAgo = Math.max(0, Math.floor((Date.now() - new Date(latestEvent.time).getTime()) / 60_000))
      const rel = this.formatRelativeMinutes(minsAgo)
      this.lastEventValue.textContent = `M ${latestEvent.mag.toFixed(1)} · ${rel}`
    } else {
      this.lastEventValue.textContent = '—'
    }

    // Indicador dinámico de actividad (según tasa en la ventana activa)
    const ratePerHour = this.windowValue === 'hour' ? count : count / 24
    let level: 'low' | 'normal' | 'high'
    let label: string
    if (count === 0 || ratePerHour < 4) {
      level = 'low'
      label = 'Baja'
    } else if (ratePerHour <= 14) {
      level = 'normal'
      label = 'Normal'
    } else {
      level = 'high'
      label = 'Elevada'
    }
    this.activityBadge.className = `activity-badge activity-${level}`
    this.activityText.textContent = label
  }

  /* ─── Renderizar magnitudes combinadas (barras finas animadas + porcentaje) ─── */
  renderMagnitudes(events: EarthquakeDTO[]): void {
    const container = document.querySelector('.magnitude-section') as HTMLElement | null
    if (!container) return

    const magBins = [0, 0, 0, 0, 0] // <2, 2-3, 3-4, 4-5, >=5
    events.forEach((e) => {
      if (e.mag < 2) magBins[0]++
      else if (e.mag < 3) magBins[1]++
      else if (e.mag < 4) magBins[2]++
      else if (e.mag < 5) magBins[3]++
      else magBins[4]++
    })
    const total = Math.max(events.length, 1)
    const maxVal = Math.max(...magBins, 1)

    if (!this.magRowsInitialized || container.children.length !== MAG_COLORS_MAP.length) {
      container.innerHTML = ''
      for (let i = 0; i < MAG_COLORS_MAP.length; i++) {
        const r = MAG_COLORS_MAP[i]
        const row = document.createElement('div')
        row.className = 'mag-row'
        row.setAttribute('role', 'button')
        row.tabIndex = 0
        row.setAttribute('aria-pressed', String(this.activeMagBin === i))
        row.setAttribute('title', `Filtrar por magnitud: ${r.label}`)
        row.addEventListener('click', () => {
          this.setMagFilterBin(this.activeMagBin === i ? null : i)
        })
        row.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            this.setMagFilterBin(this.activeMagBin === i ? null : i)
          }
        })

        const dot = document.createElement('span')
        dot.className = 'mag-dot'
        dot.style.backgroundColor = r.color
        row.appendChild(dot)

        const label = document.createElement('span')
        label.className = 'mag-label tabular-nums'
        label.textContent = r.label
        row.appendChild(label)

        const bar = document.createElement('div')
        bar.className = 'mag-bar'
        bar.style.setProperty('--fill', '0%')
        bar.style.setProperty('--mag-color', r.color)
        row.appendChild(bar)

        const metrics = document.createElement('div')
        metrics.className = 'mag-metrics tabular-nums mono'

        const countEl = document.createElement('span')
        countEl.className = 'mag-count'
        countEl.textContent = '0'
        metrics.appendChild(countEl)

        const pctEl = document.createElement('span')
        pctEl.className = 'mag-pct'
        pctEl.textContent = '0%'
        metrics.appendChild(pctEl)

        row.appendChild(metrics)
        container.appendChild(row)
      }
      this.magRowsInitialized = true
    }

    const rows = container.querySelectorAll<HTMLElement>('.mag-row')
    requestAnimationFrame(() => {
      for (let i = 0; i < MAG_COLORS_MAP.length; i++) {
        const row = rows[i]
        if (!row) continue
        const bar = row.querySelector('.mag-bar') as HTMLElement | null
        const countEl = row.querySelector('.mag-count')
        const pctEl = row.querySelector('.mag-pct')
        const countVal = magBins[i]
        const pctVal = events.length > 0 ? Math.round((countVal / total) * 100) : 0
        const barWidthPct = events.length > 0 ? (countVal / maxVal) * 100 : 0

        if (bar) {
          bar.style.setProperty('--fill', `${barWidthPct.toFixed(1)}%`)
        }
        if (countEl) countEl.textContent = String(countVal)
        if (pctEl) pctEl.textContent = `${pctVal}%`
      }
    })
  }

  /* ─── Renderizar lista de eventos (opcionalmente limitada) ─── */
  renderEventsList(events: EarthquakeDTO[], onEventClick: (event: EarthquakeDTO) => void, limit?: number): void {
    this.lastEvents = events
    this.lastOnEventClick = onEventClick
    this.currentLimit = limit
    this.isShowingAll = limit === undefined
    this.refreshEventsList()
  }

  private refreshEventsList(): void {
    if (!this.eventsList) return
    this.eventsList.innerHTML = ''
    const sorted = [...this.lastEvents].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    const now = Date.now()

    let toShow: EarthquakeDTO[]
    if (this.currentLimit !== undefined && !this.isShowingAll) {
      toShow = sorted.slice(0, this.currentLimit)
      // Si hay un evento seleccionado y no está entre los primeros, incluirlo para mantener sincronía mapa ↔ lista
      if (this.selectedEventId && !toShow.some((e) => e.id === this.selectedEventId)) {
        const selectedEv = sorted.find((e) => e.id === this.selectedEventId)
        if (selectedEv) {
          toShow = [...toShow, selectedEv]
        }
      }
    } else {
      toShow = sorted
    }

    if (toShow.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'event-item empty'
      empty.textContent = 'Sin eventos'
      this.eventsList.appendChild(empty)
      return
    }

    for (const event of toShow) {
      const item = document.createElement('div')
      item.dataset.id = event.id
      const isSelected = this.selectedEventId === event.id
      item.className = 'event-item' + (isSelected ? ' selected' : '')
      const eventTimeMs = new Date(event.time).getTime()
      const minsAgo = Math.max(0, Math.floor((now - eventTimeMs) / 60_000))
      const timeLabel = this.formatRelativeMinutes(minsAgo)
      const depth = event.depth_km === null ? 'N/A' : `${event.depth_km.toFixed(0)} km`
      const magColor = cssColor(`--mag-range-${this.magRangeIndex(event.mag)}`)

      // Separar lugar de región (último segmento tras coma)
      const placeParts = event.place.split(',').map((p) => p.trim())
      const placeMain = placeParts.slice(0, -1).join(', ') || event.place
      const placeRegion = placeParts.length > 1 ? placeParts[placeParts.length - 1] : ''
      const metaSub = placeRegion ? `${placeRegion} · ${timeLabel} · ${depth}` : `${timeLabel} · ${depth}`

      item.style.setProperty('--mag-color', magColor)
      item.title = event.place
      item.innerHTML = `
        <div class="event-item-mag tabular-nums mono" style="color:${magColor}">${event.mag.toFixed(1)}</div>
        <div class="event-item-info">
          <div class="event-item-place" title="${event.place}">${placeMain}</div>
          <div class="event-item-meta">${metaSub}</div>
        </div>
      `
      // Click en tarjeta: seleccionar y notificar
      item.addEventListener('click', () => {
        this.setSelectedEvent(event.id)
        if (this.lastOnEventClick) {
          this.lastOnEventClick(event)
        }
      })
      // Hover sincronizado lista → globo
      item.addEventListener('mouseenter', () => {
        if (this.onEventHover) this.onEventHover(event.id)
      })
      item.addEventListener('mouseleave', () => {
        if (this.onEventHover) this.onEventHover(null)
      })
      this.eventsList.appendChild(item)
    }

    if (this.viewAllBtn) {
      if (this.isShowingAll) {
        this.viewAllBtn.innerHTML = `<span>Mostrar menos</span>`
      } else {
        this.viewAllBtn.innerHTML = `<span>Ver todos</span>${chevronRight()}`
      }
    }
  }

  private updateListSelection(): void {
    if (!this.eventsList) return

    const items = this.eventsList.querySelectorAll<HTMLElement>('.event-item')
    let found = false

    items.forEach((item) => {
      if (this.selectedEventId && item.dataset.id === this.selectedEventId) {
        item.classList.add('selected')
        found = true
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } else {
        item.classList.remove('selected')
      }
    })

    // Si el sismo seleccionado no está en el listado visible (por limit), refrescar para incluirlo
    if (this.selectedEventId && !found && this.lastEvents.length > 0) {
      this.refreshEventsList()
    } else if (!this.selectedEventId && items.length > (this.currentLimit ?? 3) && !this.isShowingAll) {
      this.refreshEventsList()
    }
  }

  private magRangeIndex(mag: number): number {
    if (mag < 2) return 1
    if (mag < 3) return 2
    if (mag < 4) return 3
    if (mag < 5) return 4
    return 5
  }

  private getMagnitudeClassification(mag: number): string {
    if (mag < 2) return 'Micro'
    if (mag < 3) return 'Menor'
    if (mag < 4) return 'Leve'
    if (mag < 5) return 'Moderado'
    if (mag < 6) return 'Fuerte'
    return 'Mayor'
  }

  private getDepthZone(depthKm: number | null): string {
    if (depthKm === null) return 'Sin registro'
    if (depthKm < 70) return 'Superficial'
    if (depthKm < 300) return 'Intermedio'
    return 'Profundo'
  }

  private formatRelativeMinutes(minsAgo: number): string {
    if (minsAgo <= 0) return 'ahora mismo'
    if (minsAgo < 60) return `hace ${minsAgo} min`
    const hours = Math.floor(minsAgo / 60)
    const remMins = minsAgo % 60
    return remMins > 0 ? `hace ${hours} h ${remMins} min` : `hace ${hours} h`
  }

  private setDetailCollapsed(collapsed: boolean): void {
    this.detailCollapsed = collapsed
    this.detailPanel.classList.toggle('collapsed', collapsed)
    this.detailCollapse.setAttribute('aria-expanded', String(!collapsed))
    this.detailCollapse.setAttribute('aria-label', collapsed ? 'Desplegar detalle' : 'Plegar detalle')
  }

  showDetail(event: EarthquakeDTO): void {
    const utcDate = new Date(event.time)
    const utcISO = utcDate.toISOString()
    const localTime = utcDate.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const localDate = utcDate.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
    const now = Date.now()
    const elapsedMs = Math.max(0, now - utcDate.getTime())
    const minsAgo = Math.floor(elapsedMs / 60_000)
    const relativeTime = this.formatRelativeMinutes(minsAgo)
    const magColor = cssColor(`--mag-range-${this.magRangeIndex(event.mag)}`)
    const magClassification = this.getMagnitudeClassification(event.mag)
    const depth = event.depth_km === null ? 'N/A' : `${event.depth_km.toFixed(1)} km`
    const depthZone = this.getDepthZone(event.depth_km)

    // Línea temporal relativa a la ventana activa
    const windowMs = this.windowValue === 'hour' ? 60 * 60_000 : 24 * 60 * 60_000
    const windowStartLabel = this.windowValue === 'hour' ? '−60 min' : '−24 h'
    const timelinePosPct = Math.max(3, Math.min(97, (1 - elapsedMs / windowMs) * 100))

    // Separar lugar de región
    const placeParts = event.place.split(',').map((p) => p.trim())
    const placeMain = placeParts.slice(0, -1).join(', ') || event.place
    const placeRegion = placeParts.length > 1 ? placeParts[placeParts.length - 1] : 'Ubicación regional'

    // Actualizar el punto indicador del tag con el color de magnitud
    const tagDot = this.detailPanel.querySelector('.detail-tag-dot') as HTMLElement | null
    if (tagDot) {
      tagDot.style.backgroundColor = magColor
    }

    this.setDetailCollapsed(false)

    this.detailContent.innerHTML = `
      <div class="detail-location-section">
        <div class="detail-mag-showcase">
          <div class="detail-mag-hero tabular-nums mono" style="--mag-color:${magColor}">
            <span class="detail-mag-prefix">M</span>
            <span class="detail-mag-number">${event.mag.toFixed(1)}</span>
          </div>
          <div class="detail-mag-meta">
            <span class="detail-mag-class-label">CLASIFICACIÓN DE MAGNITUD</span>
            <span class="detail-mag-class-pill" style="--mag-color:${magColor}">${magClassification}</span>
          </div>
        </div>

        <div class="detail-location-block">
          <h2 id="detail-title" class="detail-place" title="${event.place}">${placeMain}</h2>
          <span class="detail-region">${placeRegion}</span>
        </div>
      </div>

      <div class="detail-divider" aria-hidden="true"></div>

      <div class="detail-technical-section">
        <div class="detail-timeline">
          <div class="detail-timeline-header">
            <span class="detail-cell-label">LÍNEA TEMPORAL</span>
            <span class="detail-timeline-relative">${relativeTime}</span>
          </div>
          <div class="detail-timeline-track">
            <div class="detail-timeline-fill" style="width:${timelinePosPct.toFixed(1)}%; background:${magColor}"></div>
            <div class="detail-timeline-marker" style="left:${timelinePosPct.toFixed(1)}%; background:${magColor}"></div>
          </div>
          <div class="detail-timeline-scale tabular-nums">
            <span>${windowStartLabel}</span>
            <span>Ahora</span>
          </div>
        </div>

        <div class="detail-primary-metrics">
          <div class="detail-cell detail-cell--primary">
            <span class="detail-cell-label">PROFUNDIDAD</span>
            <span class="detail-cell-value detail-cell-value--lg tabular-nums mono">${depth}</span>
            <span class="detail-cell-sub">${depthZone}</span>
          </div>
          <div class="detail-cell detail-cell--primary">
            <span class="detail-cell-label">HORA DEL EVENTO</span>
            <span class="detail-cell-value detail-cell-value--lg tabular-nums mono">${localTime}</span>
            <span class="detail-cell-sub tabular-nums mono">${localDate} · ${utcISO.slice(11, 19)} UTC</span>
          </div>
        </div>

        <div class="detail-secondary-metrics">
          <div class="detail-cell detail-cell--compact">
            <span class="detail-cell-label">COORDENADAS</span>
            <span class="detail-cell-value tabular-nums mono">${event.lat.toFixed(4)}, ${event.lon.toFixed(4)}</span>
          </div>
          <div class="detail-cell detail-cell--compact">
            <span class="detail-cell-label">ID USGS</span>
            <span class="detail-cell-value tabular-nums mono">${event.id}</span>
          </div>
        </div>

        <a class="detail-link-btn" href="https://earthquake.usgs.gov/earthquakes/eventpage/${event.id}" target="_blank" rel="noopener noreferrer">
          <span>Ver informe en USGS</span>
          ${externalLink()}
        </a>
      </div>
    `

    this.detailPanel.classList.remove('hidden')
    this.detailPanel.removeAttribute('aria-hidden')
    this.detailPanel.focus()
  }

  hideDetail(): void {
    this.detailPanel.classList.add('hidden')
    this.detailPanel.setAttribute('aria-hidden', 'true')
    if (this.onDetailClose) this.onDetailClose()
  }

  dispose(): void {
    this.hideDetail()
  }
}
