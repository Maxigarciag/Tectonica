import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { EarthquakeDTO } from './types.ts'
import { colorForMagnitude, colorForMagnitudeCss, MAG_COLORS_MAP } from './colors.ts'
import { EARTH_RADIUS, latLonToVector3, computeVisibility } from './visibility.ts'
const RECENT_MS = 10 * 60 * 1000 // 10 minutos
const MAX_OLD_MS = 6 * 60 * 60 * 1000 // 6 horas
const SPRITE_OFFSET = 1 // 1 unidad fuera de la superficie para evitar oclusión

// Clamp de tamaño en píxeles (calibrado para reflejar magnitudes reales sin saturar).
// Mag < 2 → ~4.5 px, Mag 5+ → ~26 px.
const MIN_PX = 4.5
const MAX_PX = 26
const REF_DIST = 219 // distancia cámara→sprite frontal (referencia de calibración)
const FOV_RAD = 45 * Math.PI / 180
const T1 = Math.log10(2) / Math.log10(11)   // 0.289  (t para mag 1)
const T5 = Math.log10(6) / Math.log10(11)   // 0.747  (t para mag 5)

// PX_FACTOR se calcula dinámicamente desde el renderer (canvasHeight real).
// Se inicializa con 600px como fallback; se actualiza en onWindowResize y primera frame.
let PX_FACTOR = 600 / (2 * Math.tan(FOV_RAD / 2)) // 724.3 fallback

function updatePxFactor(canvasHeight: number): void {
  PX_FACTOR = canvasHeight / (2 * Math.tan(FOV_RAD / 2))
}

// World sizes base (dependen de PX_FACTOR, se recalculan cuando cambia).
// Calibración: mag 1 → 6 px, mag 5 → 22 px @ REF_DIST.
let W1 = MIN_PX * REF_DIST / PX_FACTOR
let W5 = MAX_PX * REF_DIST / PX_FACTOR
let LOG_RATIO = Math.log(W5 / W1) / (T5 - T1)

function recomputeWorldSizes(): void {
  W1 = MIN_PX * REF_DIST / PX_FACTOR
  W5 = MAX_PX * REF_DIST / PX_FACTOR
  LOG_RATIO = Math.log(W5 / W1) / (T5 - T1)
}

function sizeForMagnitude(mag: number): number {
  // Radio base en unidades de mundo (calibrado para REF_DIST = 219).
  // El tamaño final en px se calcula en el render con clamp y distancia real.
  const t = Math.log10(Math.max(mag, 0.1) + 1) / Math.log10(11)
  return W1 * Math.exp(LOG_RATIO * (t - T1))
}

function sunDirectionUtc(): THREE.Vector3 {
  const now = new Date()
  const utcDecimal = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
  const lonDeg = -(utcDecimal - 12) * 15
  return latLonToVector3(0, lonDeg, 1).normalize()
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Configuración de animación de selección (sutil y pausada)
const SELECTION_PULSE_PERIOD = 2.4 // segundos
const SELECTION_PULSE_MAX_SCALE = 1.14 // 114% del tamaño seleccionado

interface LabelData {
  container: HTMLElement
  svgPath: SVGPathElement
  anchorCircle1: SVGCircleElement
  anchorCircle2: SVGCircleElement
  labelElement: HTMLElement
  eventId: string
  event: EarthquakeDTO
}

interface RingData {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  maxScale: number
  startTime: number
  durationMs: number
  maxOpacity: number
  event: EarthquakeDTO
}

export class Globe {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private earthGroup: THREE.Group
  private earthMesh: THREE.Mesh
  private starsMesh: THREE.Points
  private pointsGroup: THREE.Group
  private ringsGroup: THREE.Group
  private textureLoader: THREE.TextureLoader
  private raycaster: THREE.Raycaster
  private pointer: THREE.Vector2
  private onEventClick: ((event: EarthquakeDTO) => void) | null = null
    private onEventSelect: ((id: string | null) => void) | null = null
    private animationFrameId: number | null = null

  // Reutilización de objetos: un sprite por evento, un material por tramo
  private sprites: Map<string, THREE.Sprite> = new Map()
  private spriteScaleFactors: Map<string, number> = new Map()
  private depthLines: Map<string, THREE.Line> = new Map()
  private rings: Map<string, RingData> = new Map()
  private materials: Map<number, THREE.SpriteMaterial> = new Map()
  private eventAge: Map<string, 'recent' | 'normal' | 'old'> = new Map()
  private sharedWaveGeometry: THREE.RingGeometry
  private knownEventIds: Set<string> = new Set()
  private hasInitializedEvents: boolean = false
  private waveCounter: number = 0

  // Capa de mapa de densidad sísmica (heatmap esférico)
  private densityMesh: THREE.Mesh
  private densityCanvas: HTMLCanvasElement
  private densityAccumCanvas: HTMLCanvasElement
  private densityTexture: THREE.CanvasTexture
  private densityLUT: Uint8ClampedArray
  private densityVisible: boolean = false
  private densityDirty: boolean = false
  private lastDensityEvents: EarthquakeDTO[] = []

  // Capa vectorial de placas tectónicas (PB2002)
  private tectonicPlatesMesh: THREE.LineSegments | null = null
  private highlightedPlateMesh: THREE.LineSegments | null = null
  private tectonicFeatures: Array<{ samplePoints: THREE.Vector3[]; positions: Float32Array }> = []
  private tectonicPlatesVisible: boolean = true

  private resizeObserver: ResizeObserver | null = null
  private controls: OrbitControls
  private ambientLight: THREE.AmbientLight
  private hemiLight: THREE.HemisphereLight
  private sunLight: THREE.DirectionalLight
  private sunDirection: THREE.Vector3
  private dayTexture: THREE.Texture | null = null
  private nightTexture: THREE.Texture | null = null
  private roughnessTexture: THREE.Texture | null = null
  private dayNightEnabled: boolean = true
  private currentTheme: 'light' | 'dark' = 'dark'
  private autoRotation: boolean = true
  private manualRotationPause: boolean = false
  private rotationSpeedMultiplier: number = 1
  private currentRotationSpeed: number = 0
  private lastInteractionTime: number = -1800
  private static readonly IDLE_DRIFT_DELAY_MS = 1800
  private hoveredEventId: string | null = null
  private selectedEventId: string | null = null
  private selectionPulseStart: number = 0
  private labels: Map<string, LabelData> = new Map()
  private labelContainer: HTMLElement | null = null
  private radialTexture: THREE.Texture | null = null

  // Animación de cámara cinemática
  private isCamAnimating: boolean = false
  private camAnimStartTime: number = 0
  private camAnimDuration: number = 750
  private camAnimStartPos: THREE.Vector3 = new THREE.Vector3()
  private camAnimEndPos: THREE.Vector3 = new THREE.Vector3()
  private camAnimStartTarget: THREE.Vector3 = new THREE.Vector3()
  private camAnimEndTarget: THREE.Vector3 = new THREE.Vector3()
  private camAnimAxis: THREE.Vector3 = new THREE.Vector3()
  private camAnimAngle: number = 0
  private camAnimStartDist: number = 0
  private camAnimEndDist: number = 0

  // Baliza de hover (anillos radar animados al pasar el cursor)
  private hoverBeaconGroup: THREE.Group
  private hoverBeaconRing1: THREE.Mesh
  private hoverBeaconRing2: THREE.Mesh
  private hoverBeaconMat1: THREE.MeshBasicMaterial
  private hoverBeaconMat2: THREE.MeshBasicMaterial

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x090A0F)

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 1, 2000)
    this.camera.position.set(0, 0, 320)
    this.updateVisibilityThreshold()

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        this.renderer.setSize(container.clientWidth, container.clientHeight)
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.renderer.toneMapping = THREE.ReinhardToneMapping
        container.appendChild(this.renderer.domElement)

        // Contenedor para etiquetas de selección (DOM superpuesto al canvas)
        this.labelContainer = document.createElement('div')
        this.labelContainer.style.position = 'absolute'
        this.labelContainer.style.top = '0'
        this.labelContainer.style.left = '0'
        this.labelContainer.style.width = '100%'
        this.labelContainer.style.height = '100%'
        this.labelContainer.style.pointerEvents = 'none'
        this.labelContainer.style.zIndex = '10'
        container.appendChild(this.labelContainer)

        this.earthGroup = new THREE.Group()
    this.scene.add(this.earthGroup)

    // Luz ambiental y hemisférica (suave en modo claro)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.35)
    this.scene.add(this.ambientLight)
    this.hemiLight = new THREE.HemisphereLight(0xf0f6ff, 0xcbd5e1, 0)
    this.scene.add(this.hemiLight)

    // Luz direccional = sol
    this.sunDirection = sunDirectionUtc()
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.2)
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(500)
    this.sunLight.castShadow = false
    this.scene.add(this.sunLight)

    this.starsMesh = this.createStarField(4000)
    this.scene.add(this.starsMesh)

    this.earthMesh = this.createEarthMesh()
    this.earthGroup.add(this.earthMesh)

    // Capa esférica para mapa de densidad sísmica (desactivada por defecto)
    this.densityCanvas = document.createElement('canvas')
    this.densityCanvas.width = 1024
    this.densityCanvas.height = 512
    this.densityAccumCanvas = document.createElement('canvas')
    this.densityAccumCanvas.width = 1024
    this.densityAccumCanvas.height = 512
    this.densityLUT = this.buildDensityLUT()
    this.densityTexture = new THREE.CanvasTexture(this.densityCanvas)
    this.densityTexture.colorSpace = THREE.SRGBColorSpace
    this.densityTexture.minFilter = THREE.LinearFilter
    this.densityTexture.magFilter = THREE.LinearFilter
    this.densityMesh = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS + 0.35, 64, 64),
      new THREE.MeshBasicMaterial({
        map: this.densityTexture,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        blending: THREE.NormalBlending,
      })
    )
    this.densityMesh.visible = false
    this.earthGroup.add(this.densityMesh)

    this.pointsGroup = new THREE.Group()
    this.earthGroup.add(this.pointsGroup)

    this.ringsGroup = new THREE.Group()
    this.earthGroup.add(this.ringsGroup)

    // Geometría compartida para todas las ondas expansivas (cero fugas de memoria)
    this.sharedWaveGeometry = new THREE.RingGeometry(1.0, 1.32, 48)

    // Baliza sutil de animación para hover (dos anillos radar finos sobre la superficie)
    this.hoverBeaconGroup = new THREE.Group()
    this.hoverBeaconGroup.visible = false
    const beaconGeo = new THREE.RingGeometry(1.15, 1.42, 40)
    this.hoverBeaconMat1 = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.hoverBeaconRing1 = new THREE.Mesh(beaconGeo, this.hoverBeaconMat1)
    this.hoverBeaconGroup.add(this.hoverBeaconRing1)

    this.hoverBeaconMat2 = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.hoverBeaconRing2 = new THREE.Mesh(beaconGeo, this.hoverBeaconMat2)
    this.hoverBeaconGroup.add(this.hoverBeaconRing2)
    this.earthGroup.add(this.hoverBeaconGroup)

    this.textureLoader = new THREE.TextureLoader()
    this.raycaster = new THREE.Raycaster()
    this.pointer = new THREE.Vector2()

    this.createMagnitudeMaterials()
    this.loadTextures()
    this.loadTectonicPlates()

    this.resizeObserver = new ResizeObserver(() => this.onWindowResize())
    this.resizeObserver.observe(container)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 150
    this.controls.maxDistance = 600
    this.controls.enablePan = false

    // Al interactuar manualmente, cancelar animación en vuelo y pausar autorrotación con inercia
    this.controls.addEventListener('start', () => {
      this.isCamAnimating = false
      this.lastInteractionTime = performance.now()
      this.currentRotationSpeed = 0
      if (!this.manualRotationPause) this.autoRotation = false
    })
    this.controls.addEventListener('end', () => {
      this.lastInteractionTime = performance.now()
      if (!this.manualRotationPause) this.autoRotation = true
    })

    // Detección de puntero y clics con umbral de arrastre para evitar selecciones accidentales
    let pointerDownPos = { x: 0, y: 0 }
    let isPointerDown = false

    this.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      pointerDownPos = { x: event.clientX, y: event.clientY }
      isPointerDown = true
    })

    this.renderer.domElement.addEventListener('pointermove', (event: PointerEvent) => {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      // Si el usuario está arrastrando para rotar la esfera, no modificar el hover
      if (isPointerDown) {
        const moveDist = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y)
        if (moveDist > 6) {
          if (this.hoveredEventId) {
            this.setHoveredEvent(null)
          }
          this.renderer.domElement.style.cursor = 'grabbing'
          return
        }
      }

      this.raycaster.setFromCamera(this.pointer, this.camera)
      const visibleSprites = this.pointsGroup.children.filter((obj) => obj.visible)
      const intersects = this.raycaster.intersectObjects(visibleSprites, false)

      if (intersects.length > 0) {
        const obj = intersects[0].object as THREE.Sprite
        if (obj.userData && (obj.userData as EarthquakeDTO).id) {
          const eventData = obj.userData as EarthquakeDTO
          this.renderer.domElement.style.cursor = 'pointer'
          this.setHoveredEvent(eventData.id)
          return
        }
      }

      this.renderer.domElement.style.cursor = 'default'
      this.setHoveredEvent(null)
    })

    this.renderer.domElement.addEventListener('pointerup', (event: PointerEvent) => {
      isPointerDown = false
      const dist = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y)
      if (dist > 6) {
        // Fue un gesto de arrastre (órbita), no un clic directo
        return
      }

      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

      this.raycaster.setFromCamera(this.pointer, this.camera)
      const visibleSprites = this.pointsGroup.children.filter((obj) => obj.visible)
      const intersects = this.raycaster.intersectObjects(visibleSprites, false)

      if (intersects.length > 0) {
        const obj = intersects[0].object as THREE.Sprite
        if (obj.userData && (obj.userData as EarthquakeDTO).id) {
          const eventData = obj.userData as EarthquakeDTO
          this.setSelectedEvent(eventData.id)
          if (this.onEventClick) {
            this.onEventClick(eventData)
          }
          return
        }
      }

      // Clic fuera de cualquier marcador: deseleccionar
      this.setSelectedEvent(null)
    })

    this.renderer.domElement.addEventListener('pointerleave', () => {
      isPointerDown = false
      this.renderer.domElement.style.cursor = 'default'
      this.setHoveredEvent(null)
    })

                  // Escape para deseleccionar
                  window.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key === 'Escape') {
                      this.setSelectedEvent(null)
                    }
                  })

                  this.loadCountriesBorders()

              this.animate()
  }

  /* ─── Materiales compartidos: uno por tramo de magnitud ─── */
  private createMagnitudeMaterials(): void {
    for (const r of MAG_COLORS_MAP) {
      const material = new THREE.SpriteMaterial({
        map: this.getRadialTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: r.color,
      })
      this.materials.set(r.threshold, material)
    }
  }

  private getMaterialForMagnitude(mag: number): THREE.SpriteMaterial {
    for (const r of MAG_COLORS_MAP) {
      if (mag < r.threshold) return this.materials.get(r.threshold)!
    }
    return this.materials.get(MAG_COLORS_MAP[MAG_COLORS_MAP.length - 1].threshold)!
  }

    /* ─── Camera state management & Smooth Flight Animation ─── */
    private savedCameraState: { position: THREE.Vector3; target: THREE.Vector3 } | null = null

    saveCameraState(): void {
      this.savedCameraState = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      }
    }

    private startCameraAnimation(
      targetPos: THREE.Vector3,
      targetTarget: THREE.Vector3,
      durationMs: number = 750
    ): void {
      this.isCamAnimating = true
      this.camAnimStartTime = performance.now()
      this.camAnimDuration = durationMs
      this.camAnimStartPos.copy(this.camera.position)
      this.camAnimEndPos.copy(targetPos)
      this.camAnimStartTarget.copy(this.controls.target)
      this.camAnimEndTarget.copy(targetTarget)

      const v0 = this.camAnimStartPos.clone().normalize()
      const v1 = this.camAnimEndPos.clone().normalize()
      this.camAnimStartDist = this.camAnimStartPos.length()
      this.camAnimEndDist = this.camAnimEndPos.length()

      this.camAnimAngle = v0.angleTo(v1)
      if (this.camAnimAngle > 0.001) {
        this.camAnimAxis.crossVectors(v0, v1).normalize()
        if (this.camAnimAxis.lengthSq() < 0.001) {
          this.camAnimAxis.set(0, 1, 0).cross(v0).normalize()
          if (this.camAnimAxis.lengthSq() < 0.001) {
            this.camAnimAxis.set(1, 0, 0).cross(v0).normalize()
          }
        }
      } else {
        this.camAnimAxis.set(0, 1, 0)
      }
    }

    restoreCameraState(): void {
      if (!this.savedCameraState) return
      this.startCameraAnimation(this.savedCameraState.position, this.savedCameraState.target, 600)
      this.savedCameraState = null
      if (!this.manualRotationPause) {
        this.autoRotation = true
      }
    }

    resetView(): void {
      this.startCameraAnimation(new THREE.Vector3(0, 0, 320), new THREE.Vector3(0, 0, 0), 650)
      if (!this.manualRotationPause) {
        this.autoRotation = true
      }
      this.setSelectedEvent(null)
    }

    /* ─── Categorías de antigüedad (calculado al actualizar datos, no por frame) ─── */
  private getAgeCategory(time: string): 'recent' | 'normal' | 'old' {
    const now = Date.now()
    const ageMs = now - new Date(time).getTime()
    if (ageMs < RECENT_MS) return 'recent'
    if (ageMs < MAX_OLD_MS) return 'normal'
    return 'old'
  }

  private getOpacityForAge(age: 'recent' | 'normal' | 'old'): number {
    switch (age) {
      case 'recent': return 1.0
      case 'normal': return 0.7
      case 'old': return 0.4
    }
  }

  /* ─── Construcción de la escena ─── */
  private createStarField(count: number): THREE.Points {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * 2 * Math.PI
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 700 + Math.random() * 1500
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      sizes[i] = Math.random() * 1.5 + 0.5
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
    })
    return new THREE.Points(geometry, material)
  }

  private createEarthMesh(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(EARTH_RADIUS, 64, 64)
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.0,
      map: this.dayTexture || null,
    })
    return new THREE.Mesh(geometry, material)
  }

  /* ─── Carga de assets ─── */
  private loadTextures(): void {
    const dayUrl = '/earth-day.jpg'
    const nightUrl = '/earth-night.jpg'

    const onDayLoad = (tex: THREE.Texture) => {
      this.dayTexture = tex
      tex.colorSpace = THREE.SRGBColorSpace
      if (tex.image) {
        try {
          this.roughnessTexture = this.buildOceanRoughnessTexture(tex.image as HTMLImageElement)
        } catch {
          this.roughnessTexture = null
        }
      }
      this.updateEarthMaterial()
    }
    const onNightLoad = (tex: THREE.Texture) => {
      this.nightTexture = tex
      tex.colorSpace = THREE.SRGBColorSpace
      this.updateEarthMaterial()
    }
    const onTexError = (url: string) => {
      console.warn(`[globe] No se pudo cargar la textura: ${url}.`)
      if (url === dayUrl) {
        ;(this.earthMesh.material as THREE.MeshStandardMaterial).color.setHex(0x4cc9f0)
        ;(this.earthMesh.material as THREE.MeshStandardMaterial).needsUpdate = true
      }
    }

    this.textureLoader.load(dayUrl, onDayLoad, undefined, () => onTexError(dayUrl))
    this.textureLoader.load(nightUrl, onNightLoad, undefined, () => onTexError(nightUrl))
  }

  /**
   * Genera una máscara de rugosidad oceánica al vuelo desde Blue Marble:
   * océanos con baja rugosidad (reflejo especular solar) y continentes mates.
   */
  private buildOceanRoughnessTexture(img: HTMLImageElement): THREE.CanvasTexture {
    const w = 1024
    const h = 512
    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = w
    srcCanvas.height = h
    const sCtx = srcCanvas.getContext('2d')!
    sCtx.drawImage(img, 0, 0, w, h)

    const imgData = sCtx.getImageData(0, 0, w, h)
    const d = imgData.data
    for (let y = 0; y < h; y++) {
      const lat = 90 - (y / h) * 180
      // Atenuar en latitudes polares extremas para evitar destellos sobre hielo ártico/antártico
      const polarFade = 1 - Math.min(1, Math.max(0, (Math.abs(lat) - 60) / 15))
      const rowOffset = y * w * 4
      for (let x = 0; x < w; x++) {
        const i = rowOffset + x * 4
        const r = d[i]
        const g = d[i + 1]
        const b = d[i + 2]
        const brightness = (r + g + b) / 3
        const blueScore = Math.min(1, Math.max(0, (b - r - 4) / 22))
        const darkScore = Math.min(1, Math.max(0, (150 - brightness) / 55))
        const waterFactor = blueScore * darkScore * polarFade
        // Rugosidad calibrada: continentes mates (~0.94) y océanos satinados (~0.62)
        const roughVal = Math.round(240 - waterFactor * 82)
        d[i] = roughVal
        d[i + 1] = roughVal
        d[i + 2] = roughVal
        d[i + 3] = 255
      }
    }
    sCtx.putImageData(imgData, 0, 0)

    const outCanvas = document.createElement('canvas')
    outCanvas.width = w
    outCanvas.height = h
    const oCtx = outCanvas.getContext('2d')!
    oCtx.filter = 'blur(1px)'
    oCtx.drawImage(srcCanvas, 0, 0)

    const tex = new THREE.CanvasTexture(outCanvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    return tex
  }

  private updateEarthMaterial(): void {
    const mat = this.earthMesh.material as THREE.MeshStandardMaterial
    if (this.dayTexture) mat.map = this.dayTexture
    if (this.roughnessTexture) {
      mat.roughnessMap = this.roughnessTexture
      mat.roughness = 1.0
      mat.metalness = 0.0
    }
    if (this.nightTexture && this.dayNightEnabled) {
      mat.emissiveMap = this.nightTexture
      mat.emissive = new THREE.Color(0xffffff)
      mat.emissiveIntensity = 0.6
    } else {
      mat.emissiveMap = null
      mat.emissive = new THREE.Color(0x000000)
      mat.emissiveIntensity = 0
    }
    mat.needsUpdate = true
  }

  private loadTectonicPlates(): void {
    fetch('/tectonic-plates.json')
      .then((r) => {
        if (!r.ok) throw new Error('tectonic-plates.json no disponible')
        return r.json()
      })
      .then((geojson: any) => {
        if (!geojson?.features?.length) return
        const positions: number[] = []
        this.tectonicFeatures = []
        const r = EARTH_RADIUS + 0.22

        for (const feature of geojson.features) {
          const geom = feature?.geometry
          if (!geom) continue
          const featurePositions: number[] = []
          const samplePoints: THREE.Vector3[] = []

          const addLine = (coords: number[][]) => {
            for (let i = 0; i < coords.length - 1; i++) {
              const [lon1, lat1] = coords[i]
              const [lon2, lat2] = coords[i + 1]
              // Evitar trazos que crucen el globo al saltar el antimeridiano (±180°)
              if (Math.abs(lon2 - lon1) > 180) continue
              const span = Math.max(Math.abs(lat2 - lat1), Math.abs(lon2 - lon1))
              const steps = Math.max(1, Math.ceil(span / 3))
              for (let s = 0; s < steps; s++) {
                const t0 = s / steps
                const t1 = (s + 1) / steps
                const p0 = latLonToVector3(lat1 + (lat2 - lat1) * t0, lon1 + (lon2 - lon1) * t0, r)
                const p1 = latLonToVector3(lat1 + (lat2 - lat1) * t1, lon1 + (lon2 - lon1) * t1, r)
                positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
                featurePositions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
                if (s === 0 && (i % 3 === 0 || i === coords.length - 2)) {
                  samplePoints.push(p0)
                }
              }
            }
            if (coords.length > 0) {
              const [lastLon, lastLat] = coords[coords.length - 1]
              samplePoints.push(latLonToVector3(lastLat, lastLon, r))
            }
          }

          if (geom.type === 'LineString') {
            addLine(geom.coordinates)
          } else if (geom.type === 'MultiLineString') {
            for (const line of geom.coordinates) addLine(line)
          }

          if (featurePositions.length > 0 && samplePoints.length > 0) {
            this.tectonicFeatures.push({
              samplePoints,
              positions: new Float32Array(featurePositions),
            })
          }
        }

        if (positions.length === 0) return
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        const isLight = this.currentTheme === 'light'
        const mat = new THREE.LineBasicMaterial({
          color: isLight ? 0xb45309 : 0xf59e0b,
          transparent: true,
          opacity: isLight ? 0.42 : 0.34,
          depthWrite: false,
        })
        this.tectonicPlatesMesh = new THREE.LineSegments(geo, mat)
        this.tectonicPlatesMesh.visible = this.tectonicPlatesVisible
        this.earthGroup.add(this.tectonicPlatesMesh)

        const hiGeo = new THREE.BufferGeometry()
        const hiMat = new THREE.LineBasicMaterial({
          color: isLight ? 0xd97706 : 0xfbbf24,
          transparent: true,
          opacity: isLight ? 0.92 : 0.88,
          depthWrite: false,
        })
        this.highlightedPlateMesh = new THREE.LineSegments(hiGeo, hiMat)
        this.highlightedPlateMesh.scale.setScalar((EARTH_RADIUS + 0.28) / r)
        this.highlightedPlateMesh.visible = false
        this.earthGroup.add(this.highlightedPlateMesh)
      })
      .catch(() => {
        // Silencioso: sin placas tectónicas si el dataset no está disponible
      })
  }

  private loadCountriesBorders(): void {
    fetch('/countries.geojson')
      .then((r) => {
        if (!r.ok) throw new Error('countries.geojson no disponible')
        return r.json()
      })
      .then((geojson: any) => {
        const group = new THREE.Group()
        geojson.features.forEach((feature: any) => {
          if (feature.geometry?.type !== 'Polygon' && feature.geometry?.type !== 'MultiPolygon') return
          const coords = feature.geometry.coordinates
          const rings = feature.geometry.type === 'Polygon' ? [coords] : coords
          rings.forEach((ring: number[][]) => {
            const pts: number[] = []
            for (const [lon, lat] of ring) {
              const p = latLonToVector3(lat, lon, EARTH_RADIUS + 0.5)
              pts.push(p.x, p.y, p.z)
            }
            const first = latLonToVector3(ring[0][1], ring[0][0], EARTH_RADIUS + 0.5)
            pts.push(first.x, first.y, first.z)
            const geo = new THREE.BufferGeometry()
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2a3a4a, transparent: true, opacity: 0.15 }))
            group.add(line)
          })
        })
        this.scene.add(group)
      })
      .catch(() => {
        // Silencioso: sin fronteras si no hay archivo
      })
  }

  /* ─── Textura radial compartida con halo visible ─── */
    private getRadialTexture(): THREE.Texture {
      if (this.radialTexture) return this.radialTexture
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      const center = 64
      const radius = 64
      // Gradiente para AdditiveBlending - halo visible hasta el 75% del radio:
      // Alpha: 1.0@0% → 0.9@25% → 0.6@50% → 0.25@75% → 0@100%
      // Núcleo blanco puro 0-8%, halo fuerte hasta 50%, caída suave hasta 100%
      const gradient = ctx.createRadialGradient(center, center, radius * 0.08, center, center, radius)
      gradient.addColorStop(0.00, 'rgba(255,255,255,1.0)')   // 0%   (r=0-5.1)  núcleo
      gradient.addColorStop(0.08, 'rgba(255,255,255,1.0)')   // 8%   (r=5.1)   fin núcleo
      gradient.addColorStop(0.25, 'rgba(255,255,255,0.9)')   // 25%  (r=16)    halo fuerte
      gradient.addColorStop(0.50, 'rgba(255,255,255,0.6)')   // 50%  (r=32)    halo medio
      gradient.addColorStop(0.75, 'rgba(255,255,255,0.25)')  // 75%  (r=48)    halo tenue
      gradient.addColorStop(1.00, 'rgba(255,255,255,0.0)')   // 100% (r=64)    borde
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 128, 128)
      this.radialTexture = new THREE.CanvasTexture(canvas)
      this.radialTexture.needsUpdate = true
      return this.radialTexture
    }

  /* ─── Crear sprite de evento ─── */
  private createSprite(event: EarthquakeDTO): THREE.Sprite {
    const material = this.getMaterialForMagnitude(event.mag)
    const size = sizeForMagnitude(event.mag)
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(size, size, 1)
    return sprite
  }

  private updateSprite(sprite: THREE.Sprite, event: EarthquakeDTO, pos: THREE.Vector3, isFarSide: boolean, age: 'recent' | 'normal' | 'old'): void {
        // Sprite por fuera de la superficie para evitar oclusión por el planeta
        const surfacePos = pos.clone().normalize().multiplyScalar(EARTH_RADIUS + SPRITE_OFFSET)
        sprite.position.copy(surfacePos)
        sprite.lookAt(new THREE.Vector3(0, 0, 0))
        sprite.visible = !isFarSide
        const baseSize = sizeForMagnitude(event.mag)
        const isHovered = this.hoveredEventId === event.id
        const isSelected = this.selectedEventId === event.id
        const hoverScale = isHovered ? 1.25 : 1.0
        const selectScale = isSelected ? 1.5 : 1.0
        const hoverOpacity = isHovered ? 1.0 : this.getOpacityForAge(age)
        const selectOpacity = isSelected ? 1.0 : hoverOpacity
        // Aplicar clamp con distancia real (decisión 011).
        const dist = surfacePos.distanceTo(this.camera.position)
        const minScale = MIN_PX * dist / PX_FACTOR
        const maxScale = MAX_PX * dist / PX_FACTOR
        const clampedBase = Math.min(Math.max(baseSize, minScale), maxScale)
        let scale = clampedBase * hoverScale * selectScale

        // Animación de pulso para el seleccionado (decisión: 1.6s, 130% máx, respeta clamp 22px)
        if (isSelected && !prefersReducedMotion && this.selectionPulseStart > 0) {
          const elapsed = (performance.now() - this.selectionPulseStart) / 1000
          const pulseProgress = (Math.sin((elapsed / SELECTION_PULSE_PERIOD) * 2 * Math.PI) + 1) / 2 // 0 a 1
          const pulseScale = 1 + pulseProgress * (SELECTION_PULSE_MAX_SCALE - 1) // 1.0 a 1.3
          const targetScale = clampedBase * hoverScale * selectScale * pulseScale
          // Respetar clamp máximo (22px): convertir a px, clamp, volver a world units
          const targetPx = targetScale * PX_FACTOR / dist
          const clampedPx = Math.min(targetPx, MAX_PX)
          scale = clampedPx * dist / PX_FACTOR
        }
        const opacity = isSelected ? selectOpacity : hoverOpacity
        sprite.scale.set(scale, scale, 1)
        ;(sprite.material as THREE.SpriteMaterial).opacity = opacity
        sprite.userData = event
      }

  private removeSprite(id: string): void {
    const sprite = this.sprites.get(id)
    if (!sprite) return
    this.pointsGroup.remove(sprite)
    this.sprites.delete(id)
    this.spriteScaleFactors.delete(id)
    this.eventAge.delete(id)
    // No se .dispose() el material: es compartido (uno por tramo)
  }

  /* ─── Ondas expansivas sísmicas (doble onda P + S con limpieza automática) ─── */
  private spawnSeismicWaves(event: EarthquakeDTO): void {
    if (prefersReducedMotion) return
    const now = performance.now()
    const pos = latLonToVector3(event.lat, event.lon, EARTH_RADIUS + SPRITE_OFFSET + 0.15)
    const mag = Math.max(event.mag, 0.5)
    const magColor = colorForMagnitude(event.mag)

    // Onda P (primaria, rápida y sutil)
    this.addWaveRing(event, pos, {
      color: 0xe2e8f0,
      maxScale: 2.6 + mag * 0.65,
      startTime: now,
      durationMs: 2600,
      maxOpacity: 0.36,
    })

    // Onda S (secundaria, más lenta y con color de magnitud)
    this.addWaveRing(event, pos, {
      color: magColor,
      maxScale: 2.0 + mag * 0.52,
      startTime: now + 350,
      durationMs: 3500,
      maxOpacity: 0.52,
    })
  }

  private addWaveRing(
    event: EarthquakeDTO,
    pos: THREE.Vector3,
    opts: { color: number; maxScale: number; startTime: number; durationMs: number; maxOpacity: number }
  ): void {
    const material = new THREE.MeshBasicMaterial({
      color: opts.color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: this.currentTheme === 'light' ? THREE.NormalBlending : THREE.AdditiveBlending,
    })
    const mesh = new THREE.Mesh(this.sharedWaveGeometry, material)
    mesh.position.copy(pos)
    mesh.lookAt(new THREE.Vector3(0, 0, 0))
    mesh.scale.set(1, 1, 1)
    mesh.visible = false
    this.ringsGroup.add(mesh)

    const waveId = `${event.id}_w${++this.waveCounter}`
    this.rings.set(waveId, {
      mesh,
      material,
      maxScale: opts.maxScale,
      startTime: opts.startTime,
      durationMs: opts.durationMs,
      maxOpacity: opts.maxOpacity,
      event,
    })
  }

  private removeRing(id: string): void {
    const ring = this.rings.get(id)
    if (!ring) return
    this.ringsGroup.remove(ring.mesh)
    ring.material.dispose()
    this.rings.delete(id)
  }

  /* ─── Visibilidad basada en la distancia de la cámara ─── */
  private updateVisibilityThreshold(): void {
    // No-op: el umbral se calcula directamente en updateSpriteVisibilityFromCamera y setEvents
  }

  private updateSpriteVisibilityFromCamera(): void {
    const cameraPos = this.camera.position
    const now = performance.now()
    const lerpSpeed = prefersReducedMotion ? 1.0 : 0.14

    this.sprites.forEach((sprite, id) => {
      const event = sprite.userData as EarthquakeDTO
      const visible = computeVisibility(
        event.lat,
        event.lon,
        this.earthGroup.matrixWorld,
        cameraPos
      )
      sprite.visible = visible
      if (visible) {
        const baseSize = sizeForMagnitude(event.mag)
        const dist = sprite.position.distanceTo(cameraPos)
        const minScale = (MIN_PX * dist) / PX_FACTOR
        const maxScale = (MAX_PX * dist) / PX_FACTOR
        const clampedBase = Math.min(Math.max(baseSize, minScale), maxScale)

        const isHovered = this.hoveredEventId === id
        const isSelected = this.selectedEventId === id

        let targetFactor = 1.0
        if (isSelected) {
          targetFactor = 1.38
          if (!prefersReducedMotion && this.selectionPulseStart > 0) {
            const elapsed = (now - this.selectionPulseStart) / 1000
            const pulseProgress = (Math.sin((elapsed / SELECTION_PULSE_PERIOD) * 2 * Math.PI) + 1) / 2
            targetFactor *= 1 + pulseProgress * (SELECTION_PULSE_MAX_SCALE - 1)
          }
        } else if (isHovered) {
          targetFactor = 1.32
        }

        const prevFactor = this.spriteScaleFactors.get(id) ?? 1.0
        const currentFactor = prevFactor + (targetFactor - prevFactor) * lerpSpeed
        this.spriteScaleFactors.set(id, currentFactor)

        const finalScale = clampedBase * currentFactor
        sprite.scale.set(finalScale, finalScale, 1)
      }
      if (this.depthLines.has(id)) {
        this.depthLines.get(id)!.visible = visible
      }
    })

    this.rings.forEach((ring) => {
      const visible = computeVisibility(
        ring.event.lat,
        ring.event.lon,
        this.earthGroup.matrixWorld,
        cameraPos
      )
      ring.mesh.visible = visible && now >= ring.startTime
    })
  }

  /* ─── Eventos sísmicos (reutiliza sprites existentes) ─── */
  setEvents(events: EarthquakeDTO[]): void {
    this.updateVisibilityThreshold()
    const currentIds = new Set(events.map((e) => e.id))

    // Eliminar sprites que ya no están en los datos
    this.sprites.forEach((_, id) => {
      if (!currentIds.has(id)) this.removeSprite(id)
    })

    // Eliminar líneas de profundidad que ya no están (con dispose)
    this.depthLines.forEach((_, id) => {
      if (!currentIds.has(id)) this.removeDepthLine(id)
    })

    // Eliminar ondas cuyos eventos ya no están en la ventana actual (con dispose)
    const orphanWaves: string[] = []
    this.rings.forEach((ring, waveId) => {
      if (!currentIds.has(ring.event.id)) orphanWaves.push(waveId)
    })
    for (const waveId of orphanWaves) {
      this.removeRing(waveId)
    }

    // Conteo por tramo y color (una vez al cargar datos)
    const bins: Record<string, { count: number; color: string }> = {
      '<2': { count: 0, color: MAG_COLORS_MAP[0].color },
      '2-3': { count: 0, color: MAG_COLORS_MAP[1].color },
      '3-4': { count: 0, color: MAG_COLORS_MAP[2].color },
      '4-5': { count: 0, color: MAG_COLORS_MAP[3].color },
      '>=5': { count: 0, color: MAG_COLORS_MAP[4].color },
    }
    for (const event of events) {
      if (event.mag < 2) bins['<2'].count++
      else if (event.mag < 3) bins['2-3'].count++
      else if (event.mag < 4) bins['3-4'].count++
      else if (event.mag < 5) bins['4-5'].count++
      else bins['>=5'].count++
    }
    console.log('[globe] Conteo por tramo de magnitud:', bins)

    this.earthGroup.updateMatrixWorld(true)

    for (const event of events) {
      const visible = computeVisibility(event.lat, event.lon, this.earthGroup.matrixWorld, this.camera.position)
      const localPos = latLonToVector3(event.lat, event.lon, EARTH_RADIUS)
      const surfacePos = localPos.clone().normalize().multiplyScalar(EARTH_RADIUS + SPRITE_OFFSET)
      const isFarSide = !visible
      const age = this.getAgeCategory(event.time)
      this.eventAge.set(event.id, age)

      // Detectar sismo genuinamente nuevo (tras la carga inicial) y disparar ondas expansivas
      const isNewDetection = this.hasInitializedEvents && !this.knownEventIds.has(event.id)
      this.knownEventIds.add(event.id)

      // Reutilizar o crear sprite
      let sprite = this.sprites.get(event.id)
      if (!sprite) {
        sprite = this.createSprite(event)
        this.sprites.set(event.id, sprite)
        this.pointsGroup.add(sprite)
      }
      this.updateSprite(sprite, event, surfacePos, isFarSide, age)

      // Línea de profundidad: reutilizar o crear
      let depthLine = this.depthLines.get(event.id)
      const depth = event.depth_km ?? 0
      const depthLen = Math.min(depth / 10, 3)
      if (depthLen > 0.1) {
        if (!depthLine) {
          const start = localPos.clone().normalize().multiplyScalar(EARTH_RADIUS + SPRITE_OFFSET)
          const end = localPos.clone().normalize().multiplyScalar(Math.max(EARTH_RADIUS - depthLen * 4 + SPRITE_OFFSET, 12))
          const lineGeo = new THREE.BufferGeometry().setFromPoints([start, end])
          const lineMat = new THREE.LineBasicMaterial({
            color: colorForMagnitude(event.mag),
            transparent: true,
            opacity: 0.25,
          })
          depthLine = new THREE.Line(lineGeo, lineMat)
          this.depthLines.set(event.id, depthLine)
          this.pointsGroup.add(depthLine)
        }
        depthLine.visible = !isFarSide
      } else if (depthLine) {
        this.removeDepthLine(event.id)
      }

      if (isNewDetection) {
        this.spawnSeismicWaves(event)
      }
    }

    this.hasInitializedEvents = true
    this.lastDensityEvents = events
    if (this.densityVisible) {
      this.updateDensityTexture(events)
      this.densityDirty = false
    } else {
      this.densityDirty = true
    }
  }

  private removeDepthLine(id: string): void {
    const line = this.depthLines.get(id)
    if (!line) return
    this.pointsGroup.remove(line)
    line.geometry.dispose()
    ;(line.material as THREE.Material).dispose()
    this.depthLines.delete(id)
  }

  /* ─── Animación ─── */
    private onWindowResize(): void {
      const container = this.renderer.domElement.parentElement!
      this.camera.aspect = container.clientWidth / container.clientHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(container.clientWidth, container.clientHeight)
      // Actualizar PX_FACTOR con la altura real del canvas
      updatePxFactor(container.clientHeight)
      recomputeWorldSizes()
    }

    private animate(): void {
      this.animationFrameId = requestAnimationFrame(() => this.animate())

      // Primera frame: asegurar PX_FACTOR con altura real del canvas
      if (PX_FACTOR === 600 / (2 * Math.tan(FOV_RAD / 2))) {
        const canvasHeight = this.renderer.domElement.clientHeight
        if (canvasHeight > 0) {
          updatePxFactor(canvasHeight)
          recomputeWorldSizes()
        }
      }

      const nowPerf = performance.now()

      // Animación fluida de cámara hacia el objetivo (vuelo cinemático esférico)
      if (this.isCamAnimating) {
        const rawProgress = (nowPerf - this.camAnimStartTime) / this.camAnimDuration
        const t = Math.min(Math.max(rawProgress, 0), 1)
        // Ease-in-out cubic para transición más suave entre marcadores
        const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

        if (this.camAnimAngle > 0.001) {
          const v0 = this.camAnimStartPos.clone().normalize()
          const currentDir = v0.applyAxisAngle(this.camAnimAxis, this.camAnimAngle * easeT)
          const currentDist = THREE.MathUtils.lerp(this.camAnimStartDist, this.camAnimEndDist, easeT)
          const arcBump = Math.sin(easeT * Math.PI) * 14
          this.camera.position.copy(currentDir.multiplyScalar(currentDist + arcBump))
        } else {
          this.camera.position.lerpVectors(this.camAnimStartPos, this.camAnimEndPos, easeT)
        }

        this.controls.target.lerpVectors(this.camAnimStartTarget, this.camAnimEndTarget, easeT)
        this.camera.lookAt(this.controls.target)

        if (t >= 1) {
          this.isCamAnimating = false
          this.camera.position.copy(this.camAnimEndPos)
          this.controls.target.copy(this.camAnimEndTarget)
          this.camera.lookAt(this.controls.target)
        }
      }

      const nowMs = performance.now()
      const idleReady = nowMs - this.lastInteractionTime >= Globe.IDLE_DRIFT_DELAY_MS
      const shouldDrift =
        this.autoRotation &&
        !this.manualRotationPause &&
        !this.isCamAnimating &&
        !this.selectedEventId &&
        idleReady
      const targetSpeed = shouldDrift ? 0.0012 * this.rotationSpeedMultiplier : 0
      this.currentRotationSpeed += (targetSpeed - this.currentRotationSpeed) * 0.04
      if (this.currentRotationSpeed > 0.000005) {
        this.earthGroup.rotation.y += this.currentRotationSpeed
      }

      this.controls.update()

      // Recalcular visibilidad en cada frame (la cámara puede haber rotado)
      this.earthGroup.updateMatrixWorld(true)
      this.updateSpriteVisibilityFromCamera()

      // Animación sutil de la baliza de hover (anillos radar discretos)
      if (this.hoveredEventId && !prefersReducedMotion) {
        const sprite = this.sprites.get(this.hoveredEventId)
        if (sprite && sprite.visible) {
          const event = sprite.userData as EarthquakeDTO
          this.hoverBeaconGroup.visible = true
          const localPos = latLonToVector3(event.lat, event.lon, EARTH_RADIUS + SPRITE_OFFSET + 0.1)
          this.hoverBeaconGroup.position.copy(localPos)
          this.hoverBeaconGroup.lookAt(new THREE.Vector3(0, 0, 0))

          const magColor = colorForMagnitude(event.mag)
          this.hoverBeaconMat1.color.set(magColor)
          this.hoverBeaconMat2.color.set(magColor)

          const cycleMs = 1800
          const t = (nowPerf % cycleMs) / cycleMs
          const p1 = t
          const p2 = (t + 0.5) % 1.0

          const s1 = 1.0 + p1 * 2.4
          const o1 = Math.sin((1.0 - p1) * Math.PI * 0.5) * 0.45
          this.hoverBeaconRing1.scale.set(s1, s1, 1)
          this.hoverBeaconMat1.opacity = Math.max(0, o1)

          const s2 = 1.0 + p2 * 2.4
          const o2 = Math.sin((1.0 - p2) * Math.PI * 0.5) * 0.45
          this.hoverBeaconRing2.scale.set(s2, s2, 1)
          this.hoverBeaconMat2.opacity = Math.max(0, o2)
        } else {
          this.hoverBeaconGroup.visible = false
        }
      } else {
        this.hoverBeaconGroup.visible = false
      }

      // Actualizar ondas expansivas sísmicas (con limpieza automática de recursos al finalizar)
      const toRemove: string[] = []
      this.rings.forEach((ring, id) => {
        if (nowPerf < ring.startTime) return
        const elapsed = nowPerf - ring.startTime
        const progress = Math.min(elapsed / ring.durationMs, 1)
        const eased = 1 - Math.pow(1 - progress, 2)
        const scale = 1 + eased * (ring.maxScale - 1)
        const fadeIn = Math.min(progress * 5, 1)
        const fadeOut = Math.pow(1 - progress, 1.5)
        const opacity = fadeIn * fadeOut * ring.maxOpacity
        ring.mesh.scale.set(scale, scale, 1)
        ring.material.opacity = Math.max(0, opacity)
        if (progress >= 1) {
          toRemove.push(id)
        }
      })
      for (const id of toRemove) {
        this.removeRing(id)
      }

      this.renderer.render(this.scene, this.camera)

      // Actualizar posiciones de etiquetas de selección
      this.updateLabelPositions()
    }

  /* ─── Interacción ─── */
  focusOnEvent(event: EarthquakeDTO): void {
    // 1. Pausar autorrotación mientras está enfocado en un sismo
    this.autoRotation = false

    // 2. Obtener posición exacta en el espacio MUNDO teniendo en cuenta la rotación actual del globo
    this.earthGroup.updateMatrixWorld(true)
    let worldPos = new THREE.Vector3()
    const sprite = this.sprites.get(event.id)
    if (sprite) {
      sprite.getWorldPosition(worldPos)
    } else {
      const localPos = latLonToVector3(event.lat, event.lon, EARTH_RADIUS)
      worldPos = localPos.applyMatrix4(this.earthGroup.matrixWorld)
    }

    // 3. Dirección desde el centro del planeta hacia el sismo
    const dir = worldPos.clone().normalize()

    // 4. Ubicar la cámara a distancia de zoom 185 en esa misma línea de visión
    // y apuntar a (0, 0, 0). Esto sitúa matemáticamente el sismo en el centro exacto de la pantalla.
    const zoomDist = 185
    const targetCamPos = dir.clone().multiplyScalar(zoomDist)
    const targetLookAt = new THREE.Vector3(0, 0, 0)

    // 5. Iniciar vuelo suave de cámara (850ms ease-in-out) y emitir ondas P + S en el epicentro
    this.startCameraAnimation(targetCamPos, targetLookAt, 850)
    this.spawnSeismicWaves(event)
  }

  setOnEventClick(callback: (event: EarthquakeDTO) => void): void {
    this.onEventClick = callback
  }

  setOnEventSelect(callback: (id: string | null) => void): void {
    this.onEventSelect = callback
  }

  setAutoRotation(enabled: boolean): void {
    this.autoRotation = enabled
    this.manualRotationPause = !enabled
    if (enabled) {
      this.lastInteractionTime = 0
    } else {
      this.currentRotationSpeed = 0
    }
  }

  setRotationSpeed(multiplier: number): void {
    this.rotationSpeedMultiplier = Math.max(0.25, Math.min(4, multiplier))
  }

  zoomBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const currentDist = offset.length()
    if (currentDist < 1) return
    const nextDist = Math.max(155, Math.min(580, currentDist * factor))
    const targetPos = this.controls.target.clone().add(offset.normalize().multiplyScalar(nextDist))
    this.startCameraAnimation(targetPos, this.controls.target.clone(), 280)
  }

  setEpicentersVisible(visible: boolean): void {
    this.pointsGroup.visible = visible
    if (!visible) {
      this.hoverBeaconGroup.visible = false
    }
  }

  setWavesEnabled(enabled: boolean): void {
    this.ringsGroup.visible = enabled
  }

  setDensityMapVisible(visible: boolean): void {
    this.densityVisible = visible
    this.densityMesh.visible = visible
    if (visible && this.densityDirty) {
      this.updateDensityTexture(this.lastDensityEvents)
      this.densityDirty = false
    }
  }

  private buildDensityLUT(): Uint8ClampedArray {
    const lut = new Uint8ClampedArray(256 * 4)
    const stops: Array<{ pos: number; r: number; g: number; b: number; a: number }> = [
      { pos: 0, r: 245, g: 158, b: 11, a: 0 },      // ámbar transparente (se funde sin halo frío)
      { pos: 40, r: 251, g: 191, b: 36, a: 55 },    // dorado suave
      { pos: 105, r: 249, g: 115, b: 22, a: 145 },  // naranja cálido
      { pos: 180, r: 239, g: 68, b: 68, a: 205 },   // rojo sísmico
      { pos: 255, r: 248, g: 113, b: 113, a: 230 }, // núcleo de alta densidad
    ]
    for (let i = 0; i < 256; i++) {
      let s0 = stops[0]
      let s1 = stops[stops.length - 1]
      for (let j = 0; j < stops.length - 1; j++) {
        if (i >= stops[j].pos && i <= stops[j + 1].pos) {
          s0 = stops[j]
          s1 = stops[j + 1]
          break
        }
      }
      const span = Math.max(1, s1.pos - s0.pos)
      const t = (i - s0.pos) / span
      const off = i * 4
      lut[off] = Math.round(s0.r + (s1.r - s0.r) * t)
      lut[off + 1] = Math.round(s0.g + (s1.g - s0.g) * t)
      lut[off + 2] = Math.round(s0.b + (s1.b - s0.b) * t)
      lut[off + 3] = Math.round(s0.a + (s1.a - s0.a) * t)
    }
    return lut
  }

  private updateDensityTexture(events: EarthquakeDTO[]): void {
    const w = this.densityAccumCanvas.width
    const h = this.densityAccumCanvas.height
    const accCtx = this.densityAccumCanvas.getContext('2d')!
    const outCtx = this.densityCanvas.getContext('2d')!

    // Fondo negro sólido para que la suma aditiva acumule gradiente real en R/G/B (0..255)
    accCtx.globalCompositeOperation = 'source-over'
    accCtx.fillStyle = '#000000'
    accCtx.fillRect(0, 0, w, h)
    outCtx.clearRect(0, 0, w, h)

    if (events.length === 0) {
      this.densityTexture.needsUpdate = true
      return
    }

    accCtx.globalCompositeOperation = 'lighter'

    for (const ev of events) {
      const u = (ev.lon + 180) / 360
      const v = (90 - ev.lat) / 180
      const px = u * w
      const py = v * h
      const radius = 8 + Math.min(Math.max(ev.mag, 0.5), 7.5) * 2.1
      const weight = Math.min(0.4, 0.11 + Math.max(ev.mag, 0) * 0.045)
      const cosLat = Math.max(Math.cos((ev.lat * Math.PI) / 180), 0.3)

      accCtx.save()
      accCtx.translate(px, py)
      accCtx.scale(1 / cosLat, 1)

      // Caída gaussiana progresiva para evitar bordes duros
      const grad = accCtx.createRadialGradient(0, 0, 0, 0, 0, radius)
      grad.addColorStop(0.0, `rgba(255,255,255,${weight.toFixed(3)})`)
      grad.addColorStop(0.22, `rgba(255,255,255,${(weight * 0.7).toFixed(3)})`)
      grad.addColorStop(0.48, `rgba(255,255,255,${(weight * 0.32).toFixed(3)})`)
      grad.addColorStop(0.74, `rgba(255,255,255,${(weight * 0.09).toFixed(3)})`)
      grad.addColorStop(1.0, 'rgba(255,255,255,0)')
      accCtx.fillStyle = grad
      accCtx.beginPath()
      accCtx.arc(0, 0, radius, 0, Math.PI * 2)
      accCtx.fill()
      accCtx.restore()
    }

    const src = accCtx.getImageData(0, 0, w, h)
    const dst = outCtx.createImageData(w, h)
    const sData = src.data
    const dData = dst.data
    const lut = this.densityLUT

    for (let i = 0; i < sData.length; i += 4) {
      const intensity = sData[i] // ahora sí varía suavemente de 0 a 255
      if (intensity <= 2) continue
      const lutOff = intensity * 4
      dData[i] = lut[lutOff]
      dData[i + 1] = lut[lutOff + 1]
      dData[i + 2] = lut[lutOff + 2]
      dData[i + 3] = lut[lutOff + 3]
    }

    outCtx.putImageData(dst, 0, 0)
    this.densityTexture.needsUpdate = true
  }

  setTectonicPlatesVisible(visible: boolean): void {
    this.tectonicPlatesVisible = visible
    if (this.tectonicPlatesMesh) {
      this.tectonicPlatesMesh.visible = visible
    }
    if (!visible && this.highlightedPlateMesh) {
      this.highlightedPlateMesh.visible = false
    } else if (visible && this.selectedEventId) {
      const sprite = this.sprites.get(this.selectedEventId)
      this.updateHighlightedPlate(sprite ? (sprite.userData as EarthquakeDTO) : null)
    }
  }

  setDayNightLighting(enabled: boolean): void {
    this.dayNightEnabled = enabled
    this.applyLighting()
    this.updateEarthMaterial()
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.currentTheme = theme
    const isLight = theme === 'light'

    // Fondo de escena: transparente en modo claro para mostrar el gradiente estudio CSS
    this.scene.background = isLight ? null : new THREE.Color(0x090A0F)
    this.starsMesh.visible = !isLight

    this.applyLighting()

    // Blending de marcadores, ondas y baliza de hover según el fondo
    const targetBlending = isLight ? THREE.NormalBlending : THREE.AdditiveBlending
    this.materials.forEach((mat) => {
      if (mat.blending !== targetBlending) {
        mat.blending = targetBlending
        mat.needsUpdate = true
      }
    })
    this.rings.forEach((ring) => {
      if (ring.material.blending !== targetBlending) {
        ring.material.blending = targetBlending
        ring.material.needsUpdate = true
      }
    })
    if (this.hoverBeaconMat1.blending !== targetBlending) {
      this.hoverBeaconMat1.blending = targetBlending
      this.hoverBeaconMat1.needsUpdate = true
    }
    if (this.hoverBeaconMat2.blending !== targetBlending) {
      this.hoverBeaconMat2.blending = targetBlending
      this.hoverBeaconMat2.needsUpdate = true
    }

    // Placas tectónicas con mayor contraste sobre fondo claro
    if (this.tectonicPlatesMesh) {
      const mat = this.tectonicPlatesMesh.material as THREE.LineBasicMaterial
      mat.color.setHex(isLight ? 0xb45309 : 0xf59e0b)
      mat.opacity = this.selectedEventId ? (isLight ? 0.28 : 0.2) : (isLight ? 0.42 : 0.34)
    }
    if (this.highlightedPlateMesh) {
      const hiMat = this.highlightedPlateMesh.material as THREE.LineBasicMaterial
      hiMat.color.setHex(isLight ? 0xd97706 : 0xfbbf24)
      hiMat.opacity = isLight ? 0.92 : 0.88
    }
  }

  private applyLighting(): void {
    if (this.currentTheme === 'light') {
      if (this.dayNightEnabled) {
        this.ambientLight.intensity = 0.85
        this.sunLight.intensity = 0.95
        this.hemiLight.intensity = 0.55
      } else {
        this.ambientLight.intensity = 1.35
        this.sunLight.intensity = 0.45
        this.hemiLight.intensity = 0.35
      }
    } else {
      this.hemiLight.intensity = 0
      if (this.dayNightEnabled) {
        this.ambientLight.intensity = 0.35
        this.sunLight.intensity = 1.2
      } else {
        this.ambientLight.intensity = 1.35
        this.sunLight.intensity = 0.35
      }
    }
  }

  setHudLabelsEnabled(enabled: boolean): void {
    if (this.labelContainer) {
      this.labelContainer.style.display = enabled ? 'block' : 'none'
    }
  }

  setHoveredEvent(id: string | null): void {
    if (this.hoveredEventId === id) return
    this.hoveredEventId = id
    if (!id) {
      this.hoverBeaconGroup.visible = false
    }
  }

  setSelectedEvent(id: string | null): void {
    if (this.selectedEventId === id) return
    const prevId = this.selectedEventId
    this.selectedEventId = id

    if (prevId) {
      this.removeLabel(prevId)
    }

    if (id) {
      const sprite = this.sprites.get(id)
      if (sprite) {
        const event = sprite.userData as EarthquakeDTO
        this.createLabel(id, event)
        this.selectionPulseStart = performance.now()
        this.updateHighlightedPlate(event)
      }
    } else {
      this.updateHighlightedPlate(null)
    }

    if (this.onEventSelect) this.onEventSelect(id)
  }

  private updateHighlightedPlate(event: EarthquakeDTO | null): void {
    if (!this.highlightedPlateMesh || !this.tectonicPlatesMesh) return
    const isLight = this.currentTheme === 'light'
    const baseMat = this.tectonicPlatesMesh.material as THREE.LineBasicMaterial
    baseMat.opacity = event && this.tectonicPlatesVisible
      ? (isLight ? 0.28 : 0.2)
      : (isLight ? 0.42 : 0.34)

    if (!event || !this.tectonicPlatesVisible || this.tectonicFeatures.length === 0) {
      this.highlightedPlateMesh.visible = false
      return
    }

    const evPos = latLonToVector3(event.lat, event.lon, EARTH_RADIUS)
    const nearby: Float32Array[] = []
    let closestPositions: Float32Array | null = null
    let closestDist = Infinity

    for (const feat of this.tectonicFeatures) {
      let minDist = Infinity
      for (const pt of feat.samplePoints) {
        const d = pt.distanceTo(evPos)
        if (d < minDist) minDist = d
      }
      if (minDist < 16) {
        nearby.push(feat.positions)
      }
      if (minDist < closestDist) {
        closestDist = minDist
        closestPositions = feat.positions
      }
    }

    const chosen = nearby.length > 0 ? nearby : closestDist < 28 && closestPositions ? [closestPositions] : []
    if (chosen.length === 0) {
      this.highlightedPlateMesh.visible = false
      return
    }

    let totalLen = 0
    for (const arr of chosen) totalLen += arr.length
    const merged = new Float32Array(totalLen)
    let offset = 0
    for (const arr of chosen) {
      merged.set(arr, offset)
      offset += arr.length
    }

    this.highlightedPlateMesh.geometry.setAttribute('position', new THREE.BufferAttribute(merged, 3))
    this.highlightedPlateMesh.geometry.computeBoundingSphere()
    this.highlightedPlateMesh.visible = true
  }

      private createLabel(id: string, event: EarthquakeDTO): void {
        if (!this.labelContainer) return

        const container = document.createElement('div')
        container.className = 'hud-callout-container'
        container.style.position = 'absolute'
        container.style.top = '0'
        container.style.left = '0'
        container.style.width = '100%'
        container.style.height = '100%'
        container.style.pointerEvents = 'none'
        container.style.opacity = '0'
        container.style.transition = 'opacity 0.2s ease-out'

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('class', 'hud-callout-svg')
        svg.style.position = 'absolute'
        svg.style.top = '0'
        svg.style.left = '0'
        svg.style.width = '100%'
        svg.style.height = '100%'
        svg.style.overflow = 'visible'
        svg.style.pointerEvents = 'none'

        const magColor = colorForMagnitudeCss(event.mag)

        // Círculo concéntrico exterior en el epicentro (SISMO)
        const anchorCircle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        anchorCircle2.setAttribute('r', '7')
        anchorCircle2.setAttribute('fill', 'none')
        anchorCircle2.setAttribute('stroke', magColor)
        anchorCircle2.setAttribute('stroke-width', '1.2')
        anchorCircle2.setAttribute('opacity', '0.7')
        svg.appendChild(anchorCircle2)

        // Punto central del epicentro
        const anchorCircle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        anchorCircle1.setAttribute('r', '3')
        anchorCircle1.setAttribute('fill', magColor)
        svg.appendChild(anchorCircle1)

        // Línea líder diagonal + estante horizontal
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', magColor)
        path.setAttribute('stroke-width', '1.5')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('stroke-linejoin', 'round')
        svg.appendChild(path)

        container.appendChild(svg)

        const label = document.createElement('div')
        label.className = 'hud-callout-card'
        label.style.position = 'absolute'
        label.style.top = '0'
        label.style.left = '0'
        label.style.pointerEvents = 'auto'
        label.style.cursor = 'pointer'

        const placeParts = event.place.split(',').map((p) => p.trim())
        const placeMain = placeParts.slice(0, -1).join(', ') || event.place
        const placeRegion = placeParts.length > 1 ? placeParts[placeParts.length - 1] : ''

        label.innerHTML = `
          <span class="hud-callout-mag tabular-nums mono" style="background-color: ${magColor}">${event.mag.toFixed(1)}</span>
          <div class="hud-callout-info">
            <span class="hud-callout-title" title="${event.place}">${placeMain}</span>
            ${placeRegion ? `<span class="hud-callout-sub">${placeRegion}</span>` : ''}
          </div>
        `

        label.addEventListener('click', (e) => {
          e.stopPropagation()
          if (this.onEventClick) {
            this.onEventClick(event)
          }
        })

        container.appendChild(label)
        this.labelContainer.appendChild(container)

        this.labels.set(id, {
          container,
          svgPath: path,
          anchorCircle1,
          anchorCircle2,
          labelElement: label,
          eventId: id,
          event
        })

        this.updateLabelPositions()

        requestAnimationFrame(() => {
          container.style.opacity = '1'
        })
      }

      private removeLabel(id: string): void {
        const labelData = this.labels.get(id)
        if (!labelData) return

        const container = labelData.container
        container.style.opacity = '0'
        container.style.transition = 'opacity 0.15s ease-in'

        setTimeout(() => {
          container.remove()
          this.labels.delete(id)
        }, 160)
      }

      private updateLabelPositions(): void {
        if (!this.labelContainer || this.labels.size === 0) return

        const canvas = this.renderer.domElement
        const rect = canvas.getBoundingClientRect()
        const cameraPos = this.camera.position

        this.labels.forEach((labelData, id) => {
          const sprite = this.sprites.get(id)
          if (!sprite || !sprite.visible) {
            labelData.container.style.display = 'none'
            return
          }

          // Posición exacta en coordenadas globales (incluye rotación actual de earthGroup)
          const worldPos = new THREE.Vector3()
          sprite.getWorldPosition(worldPos)

          // Comprobar si el punto está de cara a la cámara (no en la cara oculta del globo)
          const normal = worldPos.clone().normalize()
          const camDir = cameraPos.clone().sub(worldPos).normalize()
          const dot = normal.dot(camDir)

          if (dot <= 0.05) {
            labelData.container.style.display = 'none'
            return
          }

          // Proyectar a coordenadas de pantalla (píxeles reales)
          const projected = worldPos.clone().project(this.camera)
          if (projected.z > 1) {
            labelData.container.style.display = 'none'
            return
          }

          labelData.container.style.display = 'block'

          const x = (projected.x * 0.5 + 0.5) * rect.width
          const y = (-projected.y * 0.5 + 0.5) * rect.height

          // Posicionar círculos concéntricos en el epicentro exacto
          labelData.anchorCircle1.setAttribute('cx', x.toFixed(1))
          labelData.anchorCircle1.setAttribute('cy', y.toFixed(1))
          labelData.anchorCircle2.setAttribute('cx', x.toFixed(1))
          labelData.anchorCircle2.setAttribute('cy', y.toFixed(1))

          // Dimensiones de la etiqueta para el estante horizontal
          const labelRect = labelData.labelElement.getBoundingClientRect()
          const labelW = Math.max(labelRect.width || 150, 140)
          const labelH = Math.max(labelRect.height || 32, 28)

          // Decisión de orientación:
          // La barra lateral ocupa los 350px derechos. Si x está a la derecha, doblar a la izquierda.
          // De lo contrario, doblar a la derecha (como en el boceto del usuario).
          const goLeft = (x + 40 + labelW > rect.width - 360) || (x > rect.width * 0.65)
          const goDown = (y - 45 < 75)

          const dirX = goLeft ? -1 : 1
          const dirY = goDown ? 1 : -1

          // Geometría del líder según boceto:
          // 1. Epicentro (x, y)
          // 2. Codo diagonal (kneeX, kneeY)
          // 3. Extremo del estante horizontal (shelfEndX, kneeY)
          const kneeX = x + dirX * 38
          const kneeY = y + dirY * 30
          const shelfW = labelW + 10
          const shelfEndX = kneeX + dirX * shelfW

          labelData.svgPath.setAttribute(
            'd',
            `M ${x.toFixed(1)},${y.toFixed(1)} L ${kneeX.toFixed(1)},${kneeY.toFixed(1)} L ${shelfEndX.toFixed(1)},${kneeY.toFixed(1)}`
          )

          // Posicionar la tarjeta de texto justo sobre el estante
          const labelX = goLeft ? (shelfEndX + 4) : (kneeX + 4)
          const labelY = goDown ? (kneeY + 4) : (kneeY - labelH - 3)

          labelData.labelElement.style.transform = `translate(${labelX.toFixed(1)}px, ${labelY.toFixed(1)}px)`
        })
      }

      dispose(): void {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId)
        this.resizeObserver?.disconnect()
        this.controls.dispose()
        this.renderer.dispose()
        this.labels.forEach((_, id) => this.removeLabel(id))
        this.labels.clear()
        if (this.labelContainer) {
          this.labelContainer.remove()
          this.labelContainer = null
        }

        // Limpiar ondas expansivas activas y geometría compartida
        Array.from(this.rings.keys()).forEach((id) => this.removeRing(id))
        this.sharedWaveGeometry.dispose()

        // Limpiar líneas de profundidad y sprites
        Array.from(this.depthLines.keys()).forEach((id) => this.removeDepthLine(id))
        Array.from(this.sprites.keys()).forEach((id) => this.removeSprite(id))
        this.knownEventIds.clear()

        // Limpiar materiales compartidos y texturas
        this.materials.forEach((mat) => mat.dispose())
        this.materials.clear()
        if (this.radialTexture) {
          this.radialTexture.dispose()
          this.radialTexture = null
        }

        // Limpiar baliza de hover y mallas base
        this.hoverBeaconRing1.geometry.dispose()
        this.hoverBeaconMat1.dispose()
        this.hoverBeaconMat2.dispose()
        if (this.tectonicPlatesMesh) {
          this.tectonicPlatesMesh.geometry.dispose()
          ;(this.tectonicPlatesMesh.material as THREE.Material).dispose()
          this.tectonicPlatesMesh = null
        }
        if (this.highlightedPlateMesh) {
          this.highlightedPlateMesh.geometry.dispose()
          ;(this.highlightedPlateMesh.material as THREE.Material).dispose()
          this.highlightedPlateMesh = null
        }
        this.tectonicFeatures = []
        if (this.roughnessTexture) {
          this.roughnessTexture.dispose()
          this.roughnessTexture = null
        }
        this.earthMesh.geometry.dispose()
        ;(this.earthMesh.material as THREE.Material).dispose()
        this.densityMesh.geometry.dispose()
        ;(this.densityMesh.material as THREE.Material).dispose()
        this.densityTexture.dispose()
        this.starsMesh.geometry.dispose()
        ;(this.starsMesh.material as THREE.Material).dispose()
      }
    }
