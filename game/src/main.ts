/**
 * SkiScrapex entry: renderer, scene and player setup, then the frame loop.
 * World assembly lives in app/apexStage.ts, menus, HUD pieces and the trick
 * feed in app/, the ski model in sim/, world data in world/ and drawing in
 * render/.
 */
import { buildDemoPark } from './app/demoPark'
import * as THREE from 'three'
import './style.css'
import './pause.css'
import './presentation.css'
import './menu.css'
import { PHYSICS, PRESETS, advance, beginCrash, createClock, createPreset, createSkier, landingSpot, resetSkier, skiFrame, type SkiState, type SurfaceSample } from './sim'
import { createSkierView, type SkierPose } from './render/rider/skierView'
import { createLandingMarker } from './render/rider/landingMarker'
import { createSlopeView } from './render/terrain/slopeView'
import { sampleRide, type RidePath } from './render/scenery/liftView'
import { SIGHT_LINE } from './render/scenery/forestView'
import { PROGRESS_RENAMES } from './world/corrections'
import { addSceneLights, createLighting, createSky, followSun } from './render/lighting'
import { applyWeather, weatherGust, weatherPreset, type WeatherPreset } from './render/weather'
import { createControls } from './player/input'
import { createCameraRig } from './player/camera'
import { createSkiAudio } from './player/audio'
import { createMusic } from './player/music'
import { createHaptics } from './player/haptics'
import { createGearDrops } from './player/gearDrops'
import { createSnowEffects } from './player/effects'
import { createMinimap } from './ui/minimap'
import { SKI_MODELS, createStylePanel, readOutfit, writeOutfit } from './ui/riderPanel'
import { loadWorld, type World } from './world/loadWorld'
import { chooseCourse, courseForRun, headingFor, liftAtBottom, nearestOnPolyline, pickableRuns, pointAlong, type Course as RunCourse, type Lift, type Run } from './world/resort'
import { approachAim, featureAhead, type ParkSite } from './world/park'
import { pushOutOfRing } from './world/buildings'
import { resolveTreeContact } from './world/treeSkiing'
import { createPerfProbe } from './app/perf'
import { $, getUi } from './app/dom'
import { escapeHtml, formatTime } from './app/format'
import { KEYS, readJson, writeJson } from './app/storage'
import { createTrickFeed } from './app/tricks'
import { buildParkMenu, buildRunMenu, renderTrailDetail, syncTrailListSelection } from './app/menus'
import { createTrailMap, type TrailSelection } from './ui/trailMap'
import { buildApexStage } from './app/apexStage'
import { loadSceneryAssets, type SceneryAssets } from './render/scenery/sceneryAssets'
import type { Stage } from './app/stage'
import { VERSION } from './app/version'
import { createFrameWatch } from './app/adaptive'
import { classifyHardware, probeHardware } from './app/hardware'
import { setSnowDetail } from './fx'
import { setTextureAnisotropy } from './render/textureBudget'
import { QUALITY, createSettingsPanel, lighterQuality, readSettings, resolveQuality, shadowsOn, writeSettings, type QualityLevel, type Settings } from './app/settings'
import { lowerAutoCap, readAutoCap } from './app/autoCap'
import { showGraphicsProblem } from './app/graphicsFail'
import { createSession, type Challenge, type SessionEvent } from './app/session'
import { createGoals, type Goals } from './app/goals'
import { renderChallenges, renderResults, renderTitle, setTitleStatus } from './ui/goalsPanels'
import { GATE_PENALTY, progressAlong } from './world/challenges'
import { createCoach } from './app/tutorial'
import { createNpcs, type Npcs } from './app/npcs'
import { createPauseGuide } from './app/pauseGuide'
import { createMenuNavigation } from './app/menuNavigation'
import { createParkHud } from './app/parkHud'
import type { Point2 } from './world/resort'

const params = new URLSearchParams(location.search)
const turnModel = (params.get('turns') ?? params.get('turn')) === 'wide' ? 'wide' : 'classic'
const perf = createPerfProbe(params.has('perf'))
const ui = getUi()
ui.version.textContent = `v${VERSION}`
ui.hudVersion.textContent = `v${VERSION}`

const controls = createControls(document.body)
const mobile = controls.touch
const settings = readSettings()
let weatherLive: WeatherPreset = weatherPreset(settings.weather)
// Quality is fixed for the session (it shapes geometry and buffers); the rest applies live.
// Auto graphics start from what this machine can do, capped by what it has
// struggled with before (a GPU reset or slow frames).
const hardware = probeHardware(mobile)
const hardwareTier = hardware ? classifyHardware(hardware) : null
const autoCap = readAutoCap()
// `?quality=low|medium|high` tries a level for one load without saving it.
const qualityParam = params.get('quality')
const forcedQuality = qualityParam === 'low' || qualityParam === 'medium' || qualityParam === 'high' ? qualityParam : null
const quality = forcedQuality ? QUALITY[forcedQuality] : resolveQuality(settings, mobile, hardwareTier?.level ?? null, autoCap)
const qualityReason = forcedQuality
  ? 'set by ?quality'
  : settings.quality === 'auto'
    ? `Auto: ${hardwareTier?.reason ?? 'chip unknown'}${autoCap ? `, limited to ${autoCap} on this machine` : ''}`
    : 'chosen in Settings'
perf.graphics({ level: quality.level, reason: qualityReason, renderer: hardware?.renderer ?? '' })
setSnowDetail(quality.snowDetail)
console.info(`SkiScrapex graphics: ${quality.level} (${qualityReason})`, hardware?.renderer ?? '')
const frameWatch = createFrameWatch()
const pixelRatio = Math.min(window.devicePixelRatio, quality.pixelRatioMax)
const renderer = createRenderer()
setTextureAnisotropy(Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy()))
watchForGpuReset()
renderer.setPixelRatio(pixelRatio)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = shadowsOn(settings, quality) && !params.has('noshadows')
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const lighting = createLighting()
const scene = new THREE.Scene()
if (params.has('perf')) Object.assign(window, { __scene: scene })
// `?test`: handles for the headless smoke test.
if (params.has('test')) Object.assign(window, { __game: { scene, get skier() { return skier }, get challenge() { return challenge }, get goals() { return goals }, get npcs() { return npcs }, get snowDeform() { return stage.snowDeform } } })
const sun = addSceneLights(scene, lighting, quality.shadowRange)
sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
const sky = createSky(lighting)
scene.add(sky)
const camera = new THREE.PerspectiveCamera(58, 1, 0.25, 25000)
const rig = createCameraRig(camera, ui.canvas)
const skierView = createSkierView()
skierView.object.traverse((child) => (child.castShadow = true))
scene.add(skierView.object)
const landingMarker = createLandingMarker()
scene.add(landingMarker.object)
const sunFocus = new THREE.Vector3()
const outfit = readOutfit()
skierView.setColours(outfit)
let goals: Goals | null = null
let npcs: Npcs | null = null
const stylePanel = createStylePanel(
  ui.style,
  outfit,
  (next) => {
    skierView.setColours(next)
    effects.setBoard(next.model === 'snowboard')
    writeOutfit(next)
    if (stage) stage.env.ski = SKI_MODELS[next.model]
  },
  () => goals?.unlocked() ?? new Set(),
  (id) => goals?.hint(id) ?? '',
)
/** Side panels open over the game (and the title screen). */
const sidePanels = [ui.runs, ui.style, ui.settings, ui.challenges]
const activeOverlay = () => [...sidePanels, ui.results, ui.titleScreen, ui.menu].find((panel) => !panel.hidden) ?? null
const overlaysOpen = () => Boolean(activeOverlay())
const guide = createPauseGuide(ui.menu)
const menuNavigation = createMenuNavigation()
const parkHud = createParkHud(ui.hint)
const hideOverlays = () => {
  for (const panel of [ui.menu, ui.results, ui.titleScreen, ...sidePanels]) panel.hidden = true
  stylePanel.setVisible(false)
}
const sound = createSkiAudio($<HTMLButtonElement>('#btn-sound'), { onImpact: (level) => music.duck(level), onMute: (muted) => music.setMuted(muted) })
const music = createMusic({ enabled: settings.music, source: settings.musicSource, volume: settings.musicVolume, muted: sound.muted })
// Read-only probe for checking the adaptive music from the console or a test browser.
;(window as unknown as { skiMusic: () => unknown }).skiMusic = () => music.status()
const haptics = createHaptics((weak, strong, ms) => controls.rumble(weak, strong, ms))
const gearDrops = createGearDrops(scene)
const effects = createSnowEffects(scene, lighting, pixelRatio, quality)
effects.setBoard(outfit.model === 'snowboard')
const tricks = createTrickFeed(ui.trick)
const coach = createCoach(ui.coach, () => (controls.gamepad ? 'pad' : mobile ? 'touch' : 'keys'), { onExit: () => (tutorialLine = null), toTop: (message) => transition(message, 1.1, spawn) })
/** The bunny-hill line while the tutorial runs: reaching its end puts you back at the top. */
let tutorialLine: Point2[] | null = null
let setViewDistance: ((scale: number) => void) | null = null
/** Apply one setting (or all of them) without a reload. */
function applySetting(key?: keyof Settings) {
  const all = key === undefined
  if (all || key === 'steering' || key === 'invertPitch') controls.setOptions({ steering: settings.steering, invertPitch: settings.invertPitch })
  if (all || key === 'volume') sound.setVolume(settings.volume)
  if (all || key === 'music') music.setEnabled(settings.music)
  if (all || key === 'musicSource') music.setSource(settings.musicSource)
  if (all || key === 'musicVolume') music.setVolume(settings.musicVolume)
  if (all || key === 'fov') rig.setFov(settings.fov)
  if (all || key === 'cameraShake') {
    rig.setShake(settings.cameraShake ? 1 : 0)
    haptics.setEnabled(settings.cameraShake)
  }
  if (all || key === 'cameraStyle') rig.setStyle(settings.cameraStyle)
  if (all || key === 'weather') {
    weatherLive = applyWeather(settings.weather, lighting, scene, sun, sky)
    effects.setWeather(weatherLive.snowDensity, weatherLive.windEast, weatherLive.windSouth, lighting)
    ui.weatherCue.hidden = settings.weather !== 'flat'
    if (stageReady && stage.snow) {
      stage.snow.setSun(lighting.sunDirection, lighting.sunColor)
      stage.snow.setFog(lighting.fogDensity, lighting.fogColor)
    }
  }
  // Choosing a graphics level by hand clears the step-down after a GPU reset.
  if (key === 'quality') {
    try {
      localStorage.removeItem(KEYS.autoCap)
    } catch {
      /* ignore */
    }
  }
  if (all || key === 'viewDistance') setViewDistance?.(settings.viewDistance)
  if (all || key === 'landingAssist') if (stageReady) stage.env.assist = settings.landingAssist
  if (key === 'npcs') npcs?.setVisible(settings.npcs)
  if (key === 'shadows') {
    renderer.shadowMap.enabled = shadowsOn(settings, quality)
    // Materials compile with or without shadow code; recompile them.
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }
}
createSettingsPanel(ui.settings, settings, quality.level, (next, key) => {
  writeSettings(next)
  applySetting(key)
}, hardwareTier?.reason)
document.body.classList.toggle('touch', mobile)
const defaultHelp = mobile
  ? 'Stick: steer · up tuck · down brake · in the air spin and flip. Hold <b>Jump</b> to crouch, release to pop'
  : '<kbd>WASD</kbd> or arrow keys to ski · <kbd>Space</kbd> jump · <kbd>Esc</kbd> pause'
ui.help.innerHTML = defaultHelp
if (mobile) guide.select('touch')
let padHelpShown = false
/** Follow the last used input without taking away access to other control guides. */
function showPadHelp() {
  if (padHelpShown === controls.gamepad) return
  padHelpShown = controls.gamepad
  document.body.classList.toggle('pad-navigation', padHelpShown)
  $('#btn-resume kbd').textContent = padHelpShown ? 'B / ○' : 'Esc'
  ui.help.innerHTML = padHelpShown
    ? '<kbd>L stick</kbd> ski · <kbd>A</kbd> jump · <kbd>X</kbd>/<kbd>RB</kbd> grab · <kbd>LT</kbd> brake · <kbd>Start</kbd> pause'
    : defaultHelp
}

interface Ride {
  lift: Lift
  path: RidePath
  s: number
  /** Getting off at the top: stand up and glide down the unload ramp. */
  unload: { t: number; from: THREE.Vector3; to: THREE.Vector3; yaw: number } | null
  /** Where the rider leaves the lift and which way they go, worked out once per ride. */
  exit?: { from: THREE.Vector3; yaw: number; lineYaw: number }
}

/** Seconds of ride left after Skip, so you arrive at the top and get off. */
const SKIP_LEAD = 2.2
/** Seconds of chair ride shown when a free-ski session starts. */
const ARRIVAL_SECONDS = 4.5
const UNLOAD_TIME = 1.8
/** Metres past the top terminal where the unload ramp ends. */
const UNLOAD_DISTANCE = { aerial: 10, surface: 5 }

let stage: Stage
let stageReady = false
applySetting()
let course: RunCourse | null = null
let skier: SkiState
const clock = createClock()
let challenge: Challenge = { kind: 'free' }
let session = createSession(challenge)
let pause: { until: number; then: () => void } | null = null
let ride: Ride | null = null
// Free-ski bests by run name; renamed runs keep their best.
const bests = Object.fromEntries(
  Object.entries(readJson<Record<string, number>>(KEYS.bests, {})).map(([name, time]) => [PROGRESS_RENAMES[PROGRESS_RENAMES[name] ?? name] ?? PROGRESS_RENAMES[name] ?? name, time]),
)
let elapsed = 0
let menuWasOpen = false
let titleSpin = 2.4
let titleWasShown = false
let minimap: ReturnType<typeof createMinimap> | null = null
let trailMap: ReturnType<typeof createTrailMap> | null = null
let devView: ReturnType<typeof createSlopeView> | null = null
const ridePoint = new THREE.Vector3()
let pitchLocked = false
let crashShown = false

window.addEventListener('resize', resize)
for (const [id, action] of [
  ['#btn-menu', 'pause'],
  ['#btn-resume', 'pause'],
  ['#btn-reset', 'reset'],
  ['#btn-camera', 'camera'],
  ['#btn-map', 'map'],
  ['#btn-info', 'debug'],
  ['#btn-runs', 'runs'],
  ['#btn-skip', 'skip'],
  ['#btn-close-runs', 'runs'],
  ['#btn-style', 'style'],
  ['#btn-settings', 'settings'],
  ['#btn-challenges', 'challenges'],
  ['#btn-title', 'title'],
] as const) {
  $(id).addEventListener('click', () => controls.push(action))
}
resize()
boot()

function titleActions() {
  return {
    play: () => {
      ui.titleScreen.hidden = true
      arriveByChair()
    },
    learn: () => startTutorial(),
    challenges: () => openChallenges(),
    rider: () => openPanel(ui.style),
    settings: () => openPanel(ui.settings),
  }
}

function showTitle() {
  hideOverlays()
  renderTitle(ui.titleScreen, goals?.summary() ?? null, Boolean(goals), titleActions(), !coach.done)
  ui.titleScreen.hidden = false
}

/**
 * Compile every material's program before the first frames, so the first sight
 * of a new material (park features, cliffs, gear, other skiers) does not stall a
 * frame mid-run. Capped at 4 s; a failure only costs the warm-up, not the game.
 */
async function warmShaders() {
  try {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((resolve) => setTimeout(resolve, 4000))])
  } catch (error) {
    console.warn('Shader warm-up failed; programs will compile on first use.', error)
  }
}

async function boot() {
  // Review links (`?park`, `?ride`, `?at`) and test slopes go straight in.
  const skipTitle = ['dev', 'park', 'ride', 'at', 'perf', 'demo'].some((key) => params.has(key))
  if (skipTitle) ui.titleScreen.hidden = true
  else renderTitle(ui.titleScreen, null, false, titleActions(), !coach.done)
  if (params.has('dev')) {
    startDev('pitch')
  } else {
    try {
      const base = `${import.meta.env.BASE_URL}data/`
      // Hand-modelled scenery loads alongside the world data; it never rejects.
      const [world, scenery] = await Promise.all([
        loadWorld(base, (message) => {
          ui.status.textContent = message
          setTitleStatus(ui.titleScreen, message)
        }),
        loadSceneryAssets(),
      ])
      perf.phase('loadWorld')
      startApex(world, scenery)
      perf.phase('startApex')
      await warmShaders()
      perf.phase('shaders')
      if (!skipTitle) showTitle()
    } catch (error) {
      console.error(error)
      ui.status.textContent = 'Apex data not found. Showing test slopes.'
      startDev('pitch')
      setTimeout(() => (ui.status.textContent = ''), 5000)
    }
  }
  let last = performance.now()
  let smoothed = 16.7
  const frame = (now: number) => {
    const rawMs = now - last
    const dt = Math.min(PHYSICS.maxFrameDt, Math.max(0, rawMs / 1000))
    last = now
    smoothed += (dt * 1000 - smoothed) * 0.05
    if (frameWatch.sample(rawMs, stageReady && !ride && !pause && ui.titleScreen.hidden && !overlaysOpen())) lightenForSlowFrames()
    tick(dt, smoothed)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

function startApex(world: World, scenery?: SceneryAssets) {
  ui.status.textContent = 'Building the village…'
  scene.add(apexRoot)
  const apex = buildApexStage(world, apexRoot, lighting, { quality, viewDistance: settings.viewDistance, ski: SKI_MODELS[outfit.model], phase: perf.phase, scenery })
  stage = apex.stage
  stage.env.assist = settings.landingAssist
  stageReady = true
  applySetting('weather')
  setViewDistance = apex.setViewDistance
  perf.phase('stage')
  goals = createGoals({ world, stage, scene: apexRoot, parkSites: apex.parkSites, runNameAt: apex.surface.runNameAt, version: VERSION })
  perf.phase('goals')
  npcs = createNpcs(apexRoot, goals.routes(), stage.slope.sampleTerrain, { sampleSurface: stage.env.sampleSurface }, quality.npcCount, world.course.spawn)
  npcs.setVisible(settings.npcs)
  perf.phase('npcs')
  stylePanel.refresh()
  course = spawnOverride(world.course, world.resort.runs, apex.surface.runNameAt)
  ui.credits.innerHTML =
    'Elevation and canopy: LidarBC, <a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc">OGL-BC</a>' +
    (world.horizon ? '; horizon: NRCan MRDEM, <a href="https://open.canada.ca/en/open-government-licence-canada">OGL-Canada</a>. ' : '. ') +
    `Runs, lifts and buildings © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.`
  ui.mapPanel.hidden = false
  const { grid, resort } = world
  perf.phase('credits')
  const runs = pickableRuns(resort)
  const skiRun = (run: Run) => {
    leaveDemoPark()
    setFreeSki()
    course = courseForRun(resort, run)
    restartFromMenu()
  }
  const tripTrail = (selection: TrailSelection) => {
    if (!selection) return
    if (selection.kind === 'run') skiRun(selection.run)
    else startPark(selection.site)
  }
  minimap?.dispose()
  minimap = createMinimap(ui.map, ui.mapLocation, apex.surface.runNameAt, { width: grid.width, depth: grid.depth, resort, hillshade: world.hillshade }, {
    runs,
    parks: apex.parkSites,
    onTrip: tripTrail,
  })
  const selectTrail = (selection: TrailSelection) => {
    trailMap?.setSelection(selection)
    syncTrailListSelection(ui.runList, selection)
    renderTrailDetail(ui.trailDetail, selection, { skiRun, skiPark: startPark, lengthOf: (run) => trailMap?.runLength(run) ?? 0 })
  }
  trailMap?.dispose()
  trailMap = createTrailMap(ui.trailMap, { width: grid.width, depth: grid.depth, resort, hillshade: world.hillshade }, {
    runs,
    parks: apex.parkSites,
    onSelect: selectTrail,
    onTrip: tripTrail,
  })
  buildRunMenu(ui.runList, runs, skiRun, (run) => selectTrail({ kind: 'run', run }))
  apexStage = stage
  buildParkMenu(ui.runList, apex.parkSites, startPark, apex.setLayout, enterDemoPark, (site) => selectTrail({ kind: 'park', site }))
  if (params.has('demo')) queueMicrotask(enterDemoPark)
  const parkParam = params.get('park')?.toLowerCase()
  const parkStart = parkParam ? apex.parkSites.find((site) => site.name.toLowerCase().startsWith(parkParam)) : null
  if (parkStart) queueMicrotask(() => startPark(parkStart))
  perf.phase('menus')
  ui.slopes.hidden = true
  ui.status.textContent = ''
  spawn()
  perf.phase('spawn')
  // `?ride=<lift name>` starts on that lift, for review.
  const rideName = params.get('ride')?.toLowerCase()
  const rideLift = rideName ? resort.lifts.find((lift) => lift.name.toLowerCase().startsWith(rideName)) : null
  if (rideLift) startRide(rideLift)
}

function startDev(id: (typeof PRESETS)[number]['id']) {
  devView?.dispose()
  if (devView) scene.remove(devView.object)
  const slope = createPreset(id)
  devView = createSlopeView(slope)
  scene.add(devView.object)
  ui.titleScreen.hidden = true
  stage = { slope, world: null, trunks: null, buildings: null, snow: null, ride: null, features: () => [], env: { ski: SKI_MODELS[outfit.model], assist: settings.landingAssist }, update() {}, describe: () => '' }
  stageReady = true
  course = null
  ui.title.textContent = `Test slope · ${slope.label}`
  if (ui.status.textContent === 'Loading…') ui.status.textContent = ''
  ui.mapPanel.hidden = true
  $('#btn-runs').hidden = true
  $('#btn-map').hidden = true
  ui.slopes.hidden = false
  ui.slopes.innerHTML = ''
  PRESETS.forEach((preset, i) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `${i + 1} ${preset.label}`
    button.setAttribute('aria-pressed', String(preset.id === id))
    button.addEventListener('click', () => startDev(preset.id))
    ui.slopes.append(button)
  })
  spawn()
}

function restartFromMenu() {
  hideOverlays()
  pause = null
  ui.fade.classList.remove('on')
  spawn()
}

/** Apex scenery, goals and other skiers: hidden while in the demo park. */
const apexRoot = new THREE.Group()
let apexStage: Stage | null = null
let demo: ReturnType<typeof buildDemoPark> | null = null

function enterDemoPark() {
  if (!apexStage) return
  setFreeSki()
  if (!demo) {
    demo = buildDemoPark(lighting, SKI_MODELS[outfit.model], settings.landingAssist, quality.level === 'low' ? 0.55 : 0.4)
    scene.add(demo.root)
  }
  demo.stage.env.ski = SKI_MODELS[outfit.model]
  demo.stage.env.assist = settings.landingAssist
  apexRoot.visible = false
  demo.root.visible = true
  stage = demo.stage
  ui.mapPanel.hidden = true
  course = {
    spawn: { ...demo.spawn },
    startLift: null,
    startRun: { id: 'demo-park', name: 'Demo park', difficulty: 'park', groomed: true, kind: 'line', parts: [] },
  }
  restartFromMenu()
}

/** Back to Apex from the demo park (no-op when already there). */
function leaveDemoPark() {
  if (!demo?.root.visible || !apexStage) return
  demo.root.visible = false
  apexRoot.visible = true
  stage = apexStage
  ui.mapPanel.hidden = false
}

function startPark(site: ParkSite) {
  leaveDemoPark()
  setFreeSki()
  const [x, z] = pointAlong(site.line, 4)
  const [ax, az] = pointAlong(site.line, 16)
  course = {
    spawn: { x, z, heading: headingFor(ax - x, az - z) },
    startLift: null,
    startRun: { id: site.id, name: site.name, difficulty: 'park', groomed: true, kind: 'line', parts: [site.line] },
  }
  restartFromMenu()
}

/** `keepCamera`: coming off a lift, ease the camera from its arrival shot instead of cutting. */
function spawn(keepCamera = false) {
  stage.env.turnModel = turnModel
  ride = null
  ui.ride.hidden = true
  if (course) stage.slope.spawn = course.spawn
  if (skier) resetSkier(skier, stage.slope)
  else skier = createSkier(stage.slope)
  clock.accumulator = 0
  session = createSession(challenge)
  goals?.resetGates()
  tricks.resetTotal()
  effects.clear()
  stage.snowDeform?.stamper.reset()
  sound.reset()
  haptics.reset()
  gearDrops.clear()
  skier.missingSkis = false
  skier.missingPoles = false
  if (!keepCamera) rig.snap()
  if (challenge.kind !== 'free') {
    const best = goals?.progress.bests[challenge.id]
    const score = challenge.kind === 'park'
    ui.title.textContent =
      challenge.kind === 'park'
        ? `${challenge.site.name} · score attack`
        : challenge.kind === 'slalom'
          ? `${challenge.run.name} · slalom · gate 1/${challenge.gates.length}`
          : `${challenge.run.name} · timed run`
    ui.best.textContent = best === undefined ? '–' : score ? `${best.toLocaleString()}` : formatTime(best)
  } else if (course?.startRun) {
    const best = bests[course.startRun.name]
    ui.title.textContent = `${course.startRun.name}${course.startLift ? ` · from ${course.startLift.name}` : ''}`
    ui.best.textContent = best ? formatTime(best) : '–'
  }
}

function startTutorial() {
  leaveDemoPark()
  const bunny = goals?.tutorial()
  if (!bunny) return
  setFreeSki()
  course = bunny.course
  tutorialLine = bunny.line
  hideOverlays()
  pause = null
  ui.fade.classList.remove('on')
  spawn()
  coach.start()
}

/** Start (or retry) a challenge from its start line. */
function startChallenge(next: Challenge) {
  leaveDemoPark()
  coach.stop()
  tutorialLine = null
  challenge = next
  goals?.activate(next)
  const start = goals?.courseFor(next)
  if (start) course = start
  hideOverlays()
  pause = null
  ui.fade.classList.remove('on')
  spawn()
}

/** Back to free skiing from wherever the skier is. */
function setFreeSki() {
  if (challenge.kind === 'free') return
  challenge = { kind: 'free' }
  goals?.activate(challenge)
  session = createSession(challenge)
}

function openPanel(panel: HTMLElement) {
  for (const other of sidePanels) other.hidden = other !== panel
  panel.hidden = false
  stylePanel.setVisible(panel === ui.style)
  if (panel === ui.runs) trailMap?.resize()
  panel.querySelector<HTMLButtonElement>('header button, header .close, #btn-close-runs')?.focus()
}

function closeSidePanels() {
  for (const panel of sidePanels) panel.hidden = true
  stylePanel.setVisible(false)
}

function openChallenges() {
  if (!goals) return
  renderChallenges(ui.challenges, goals.challengeData(startChallenge), goals.progress, () => (ui.challenges.hidden = true))
  openPanel(ui.challenges)
}

function onSessionEvent(event: SessionEvent) {
  if (event.type === 'gate') {
    goals?.markGate(event.index, event.result)
    if (event.result === 'miss') tricks.show('Missed gate', `+${GATE_PENALTY} s`, 'crash')
    if (challenge.kind === 'slalom') {
      const next = Math.min(event.index + 2, event.total)
      ui.title.textContent = `${challenge.run.name} · slalom · ${event.index + 1 < event.total ? `gate ${next}/${event.total}` : 'to the finish'}${session.stats.gatesMissed ? ` · ${session.stats.gatesMissed} missed` : ''}`
    }
  } else if (event.type === 'finish') endChallenge(null)
  else endChallenge('Left the course')
}

/** One-time tips the first time something happens. Each shows once ever. */
function coachTips() {
  if (!stage.world || coach.active) return
  const kind = skier.surface.kind
  const pitchDeg = (skier.pitch * 180) / Math.PI
  if (skier.mode === 'crashed') coach.tip('crash', 'Wipeout', `You get back up by yourself. ${mobile ? 'Pause' : '<kbd>R</kbd>'} restarts the run.`)
  else if (skier.missingSkis || skier.missingPoles) {
    coach.tip('gear', 'Yard sale', 'Ski over your scattered gear to pick it up.')
  }
  else if (kind === 'powder' && skier.sink > 0.12)
    coach.tip('powder', 'Deep snow', 'Powder is slower and turns take longer. Keep some speed and make round turns. Powder skis (Rider) float better.')
  else if (kind === 'forest') coach.tip('trees', 'Tree skiing', 'Look for the gap between trunks. Glancing hits slide past. A hard hit can still cause a wipeout.')
  else if (kind === 'ice') coach.tip('ice', 'Wind crust', 'The wind has scoured this snow hard. Edges hold less, so keep turns gentle until you are back on soft snow.')
  else if (kind === 'rock') coach.tip('rock', 'Thin cover', 'Rocks are poking through. It is slow and grabby; pick a line back onto the snow.')
  else if (skier.grounded && Math.abs(pitchDeg) > 28 && skier.speed > 7)
    coach.tip('steep', 'Steep pitch', 'Finish each turn across the hill to control your speed. A skidded turn brakes; a carved one keeps your speed.')
  else if (skier.rail)
    coach.tip(
      'rail',
      'On a rail',
      `Steer gently to stay on. ${mobile || controls.gamepad ? 'Push the stick up or down' : 'Hold <kbd>W</kbd> or <kbd>S</kbd>'} for a nose or tail press: more points, harder to balance. Come onto it sideways for a slide.`,
    )
  else if (stage.features().length && skier.grounded) {
    const travel = Math.hypot(skier.vx, skier.vz)
    const next = travel > 2 ? featureAhead(stage.features(), skier.x, skier.z, skier.vx / travel, skier.vz / travel, 35) : null
    if (next)
      coach.tip('park', 'Terrain park', `The speed window for the next jump shows on screen. Hold ${mobile ? 'Jump' : controls.gamepad ? '<kbd>A</kbd>' : '<kbd>Space</kbd>'} on the run-in and let go at the lip.`)
  }
}

let resultsNext: (() => void) | null = null
function endChallenge(failed: string | null) {
  if (!goals || challenge.kind === 'free') return
  const finished = challenge
  const result = goals.finish(session, tricks.total, failed)
  if (finished.kind === 'park') {
    const { perfect, clean, railMetres, bestName } = tricks.stats
    result.lines.push(['Perfect / clean landings', `${perfect} / ${clean}`], ['Rail and box distance', `${railMetres.toFixed(1)} m`])
    if (bestName) result.lines.push(['Best trick', bestName])
  }
  if (result.unlockedNow.length) stylePanel.refresh()
  resultsNext = () => {
    ui.results.hidden = true
    resultsNext = null
    setFreeSki()
  }
  renderResults(ui.results, result, {
    retry: () => startChallenge(finished),
    next: resultsNext,
    nextLabel: 'Keep skiing',
    challenges: () => {
      ui.results.hidden = true
      setFreeSki()
      openChallenges()
    },
  })
  ui.results.hidden = false
}

let runCardTimer = 0
function showRunCard(name: string, time: number, record: boolean) {
  const { stats } = session
  const points = tricks.total
  ui.runCard.innerHTML =
    `<strong>${escapeHtml(name)}</strong> ${formatTime(time)}${record ? ' · best!' : ''}` +
    `<span>Top ${Math.round(stats.topSpeed * 3.6)} km/h · ${Math.round(stats.distance)} m · ${Math.round(stats.vertical)} m vertical${points ? ` · ${points.toLocaleString()} pts` : ''}</span>`
  ui.runCard.hidden = false
  window.clearTimeout(runCardTimer)
  runCardTimer = window.setTimeout(() => (ui.runCard.hidden = true), 8000)
}

/** Short fade with a message, then `then`. Physics pauses meanwhile. */
function transition(message: string, seconds: number, then: () => void) {
  if (pause) return
  ui.fadeText.textContent = message
  ui.fade.classList.add('on')
  pause = {
    until: elapsed + seconds,
    then: () => {
      then()
      ui.fade.classList.remove('on')
    },
  }
}

function startRide(lift: Lift) {
  setFreeSki()
  coach.tip(
    'lift',
    'Lift ride',
    mobile ? 'Hold Tuck to speed the ride up, or tap Skip to go straight to the top.' : controls.gamepad ? 'Hold the stick up to speed up, or press <kbd>B</kbd> to skip to the top.' : 'Hold <kbd>W</kbd> to speed up. Press <kbd>Enter</kbd> or select Skip to go to the top.',
  )
  const path = stage.ride?.(lift) ?? null
  if (!path) {
    finishRide(lift)
    return
  }
  ride = { lift, path, s: path.boardingDistance, unload: null }
  ui.title.textContent = `Riding ${lift.name}`
  ui.best.textContent = '–'
  ui.ride.hidden = false
  effects.clear()
  stage.snowDeform?.stamper.reset()
  sound.reset()
  haptics.reset()
  rig.snap()
}

/**
 * Free skiing starts at the top of Quickdraw: ride the last few seconds of the
 * chair into the top station and step off, so every session opens with the
 * arrival rather than a skier standing in the snow.
 */
function arriveByChair() {
  const lift = stage.world?.resort.lifts.find((l) => /quickdraw/i.test(l.name))
  if (!lift || !stage.ride) return
  setFreeSki()
  // Lifts do not run behind the title screen: put a chair a few seconds from the top.
  stage.advanceLifts?.(0)
  const path = stage.ride(lift)
  if (!path) return
  const at = Math.max(0, path.total - path.speed * ARRIVAL_SECONDS)
  stage.alignChair?.(lift, at)
  startRide(lift)
  if (!ride) return
  ride.s = at
  arrivalShot(ride)
  rig.snap()
}

/** Skip: jump to just before the top and ride in. A second press steps straight off. */
function skipRide() {
  if (!ride) return
  if (ride.unload) {
    finishRide(ride.lift, ride.unload)
    return
  }
  const lead = ride.path.speed * SKIP_LEAD
  if (ride.s < ride.path.total - lead) {
    // Jump whole chair spacings so the rider is still sitting on a chair.
    const spacing = ride.path.spacing ?? 0
    const jump = ride.path.total - lead - ride.s
    ride.s += spacing > 0 ? Math.floor(jump / spacing) * spacing : jump
    rig.snap()
  } else beginUnload(ride)
}

/**
 * Which way to step off: straight on if the way is open, otherwise the
 * nearest turn that is clear of buildings and trees for a good run-out
 * (the Magic Carpet top faces an apartment block 10 m ahead).
 */
function unloadHeading(from: THREE.Vector3, yaw: number): number {
  let best = yaw
  let bestScore = -Infinity
  for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35]) {
    const heading = yaw + turn
    let clear = 0
    for (let d = 2; d <= 20; d += 1.5) {
      const x = from.x + Math.sin(heading) * d
      const z = from.z + Math.cos(heading) * d
      if (!stage.slope.sampleTerrain(x, z) || stage.buildings?.hit(x, z) || stage.trunks?.hit(x, z, 1)) break
      clear = d
    }
    const score = Math.min(clear, 16) - Math.abs(turn) * 3
    if (score > bestScore) ((bestScore = score), (best = heading))
  }
  return best
}

/** The end of the ride and the way off it: straight on for chairs if clear; to the side for surface lifts. */
function exitPlan(current: Ride): NonNullable<Ride['exit']> {
  if (current.exit) return current.exit
  const from = new THREE.Vector3()
  const lineYaw = sampleRide(current.path, current.path.total, from)
  let yaw: number
  if (current.path.aerial) {
    yaw = unloadHeading(from, lineYaw)
  } else {
    // Let go of the T (or step off the belt) and stand aside, away from the lift line,
    // so the bar can swing round the bullwheel behind you.
    const line = current.lift.line
    const away = (turn: number) => {
      const x = from.x + Math.sin(lineYaw + turn) * 4
      const z = from.z + Math.cos(lineYaw + turn) * 4
      return nearestOnPolyline(x, z, line).distanceSq
    }
    const side = away(Math.PI / 2) > away(-Math.PI / 2) ? 1 : -1
    yaw = unloadHeading(from, lineYaw + side * 1.25)
  }
  current.exit = { from, yaw, lineYaw }
  return current.exit
}

/** Off the chair (or the T-bar) at the top: glide from the seat to the end of the ramp. */
function beginUnload(current: Ride) {
  const { from, yaw } = exitPlan(current)
  const reach = current.path.aerial ? UNLOAD_DISTANCE.aerial : UNLOAD_DISTANCE.surface
  const x = from.x + Math.sin(yaw) * reach
  const z = from.z + Math.cos(yaw) * reach
  const ground = stage.slope.sampleTerrain(x, z)
  if (!ground) {
    finishRide(current.lift)
    return
  }
  current.unload = { t: 0, from: from.clone(), to: new THREE.Vector3(x, ground.height, z), yaw }
  ui.rideText.textContent = `Top of ${current.lift.name}`
}

/**
 * Arrival shot: the camera waits beside the top station's exit and watches the
 * rider come out and step off, instead of following through the terminal.
 */
function arrivalShot(current: Ride) {
  const { from, yaw } = exitPlan(current)
  const aerial = current.path.aerial
  const remaining = current.path.total - current.s
  if (!current.unload && remaining > (aerial ? 30 : 8) && !rig.holding) {
    rig.releaseShot()
    return
  }
  // Ahead of the exit, off to the left of the way out (the operator hut sits on the right at Quickdraw).
  const ahead = aerial ? 16 : 9
  const aside = aerial ? -9 : -6
  const sx = Math.cos(yaw)
  const sz = -Math.sin(yaw)
  shotPos.set(from.x + Math.sin(yaw) * ahead + sx * aside, 0, from.z + Math.cos(yaw) * ahead + sz * aside)
  const ground = stage.slope.sampleTerrain(shotPos.x, shotPos.z)?.height ?? from.y
  shotPos.y = Math.max(ground + 3.4, from.y + 1.6)
  shotLook.set(skier.x, skier.y + 1.1, skier.z)
  rig.holdShot(shotPos, shotLook)
}
const shotPos = new THREE.Vector3()
const shotLook = new THREE.Vector3()

/**
 * Top of the lift: you are standing at the end of the unload ramp, free to
 * pick a way down. The course (for the HUD and run times) is the run that
 * starts nearest, as before.
 */
function finishRide(lift: Lift, at?: { to: THREE.Vector3; yaw: number }) {
  ride = null
  ui.ride.hidden = true
  const world = stage.world
  if (world) course = chooseCourse(world.resort, world.grid.heightAt, lift.name, course?.startRun?.name ?? 'Grandfather')
  if (course && at) course = { ...course, spawn: { x: at.to.x, z: at.to.z, heading: Math.atan2(-Math.sin(at.yaw), Math.cos(at.yaw)) } }
  spawn(Boolean(at))
  if (at) {
    ui.title.textContent = `Top of ${lift.name}`
    // Off a chair, keep the glide off the ramp going; off a T-bar you stand and choose.
    const glide = /t-?bar|platter|drag|carpet|rope_tow/i.test(lift.type) ? 0.3 : 2
    skier.vx = Math.sin(at.yaw) * glide
    skier.vz = Math.cos(at.yaw) * glide
    rig.releaseShot()
  }
}

function handleActions() {
  for (const action of controls.takeActions()) {
    if (action === 'pause') {
      const side = sidePanels.find((panel) => !panel.hidden)
      if (side) {
        closeSidePanels()
        if (!ui.menu.hidden) $('#btn-resume').focus()
        continue
      }
      if (!ui.titleScreen.hidden) continue
      if (!ui.results.hidden) {
        resultsNext?.()
        continue
      }
      const closing = !ui.menu.hidden
      ui.menu.hidden = closing
      if (!closing) {
        $('#pause-location').textContent = ui.title.textContent
        $('#btn-map').hidden = !stage.world
        $('#btn-map').setAttribute('aria-pressed', String(!ui.mapPanel.hidden))
        $('#btn-challenges').hidden = !goals
        $('#btn-title').hidden = !apexStage
        guide.select(controls.gamepad ? 'pad' : mobile ? 'touch' : 'keys')
        $('#btn-resume').focus()
      }
    } else if (action === 'title') {
      if (!stage.world && apexStage?.world) {
        leaveDemoPark()
        setFreeSki()
        course = apexStage.world.course
        spawn()
      }
      if (stage.world) showTitle()
    } else if (action === 'reset') {
      if (!ui.titleScreen.hidden) continue
      ui.menu.hidden = ui.results.hidden = true
      closeSidePanels()
      pause = null
      ui.fade.classList.remove('on')
      spawn()
    } else if (action === 'camera') {
      const next = rig.mode === 'follow' ? 'first' : rig.mode === 'first' ? 'orbit' : 'follow'
      rig.setMode(next, skier)
      skierView.setFirstPerson(next === 'first')
      document.body.classList.toggle('first-person', next === 'first')
      $('#camera-label').textContent = `Camera · ${next === 'first' ? 'First person' : next === 'orbit' ? 'Orbit' : 'Follow'}`
    } else if (action === 'debug') {
      ui.debug.hidden = !ui.debug.hidden
      $('#btn-info').setAttribute('aria-pressed', String(!ui.debug.hidden))
    } else if (action === 'map' && stage.world) {
      ui.mapPanel.hidden = !ui.mapPanel.hidden
      $('#btn-map').setAttribute('aria-pressed', String(!ui.mapPanel.hidden))
    } else if (action === 'runs' || action === 'style' || action === 'settings' || action === 'challenges') {
      if ((action === 'runs' || action === 'challenges') && !apexStage) continue
      const panel = { runs: ui.runs, style: ui.style, settings: ui.settings, challenges: ui.challenges }[action]
      if (panel.hidden) {
        if (action === 'challenges') openChallenges()
        else openPanel(panel)
      } else {
        closeSidePanels()
        if (!ui.menu.hidden) $('#btn-resume').focus()
      }
    } else if (action === 'skip' && ride && !overlaysOpen()) skipRide()
    else if (action.startsWith('slope') && !stage.world) {
      const preset = PRESETS[Number(action.slice(5)) - 1]
      if (preset) startDev(preset.id)
    }
  }
}

function tick(dt: number, frameMs: number) {
  const overlay = activeOverlay()
  menuNavigation.sync(overlay)
  for (const command of controls.pollGamepad(Boolean(overlay))) {
    if (command === 'back') controls.push('pause')
    else menuNavigation.move(command)
  }
  handleActions()
  const nextOverlay = activeOverlay()
  menuNavigation.sync(nextOverlay)
  showPadHelp()
  const menuOpen = Boolean(nextOverlay)
  if (menuOpen !== menuWasOpen) {
    controls.clear()
    skier.jumpHeld = false
    skier.popCharge = 0
    skier.windup = 0
    menuWasOpen = menuOpen
    sound.pause(menuOpen)
    document.body.classList.toggle('paused', menuOpen)
    $('#btn-menu').setAttribute('aria-expanded', String(menuOpen))
    if (!menuOpen) ui.canvas.focus()
  }
  music.update({
    dt,
    menu: menuOpen,
    riding: Boolean(ride),
    speed: skier.speed,
    slopeDeg: (skier.pitch * 180) / Math.PI,
    airborne: !skier.grounded && !skier.rail,
    airTime: skier.air?.time ?? 0,
    onRail: Boolean(skier.rail),
    inPark: skier.surface.kind === 'park',
    crashed: skier.crashed > 0,
    trickSeq: skier.trick?.seq ?? 0,
  })
  if (menuOpen) {
    if (!ui.titleScreen.hidden && stage.world) {
      // Title backdrop: a slow pan around the view from where the skier stands.
      titleSpin += dt * 0.035
      camera.position.set(skier.x, skier.y + 16, skier.z)
      camera.lookAt(skier.x + Math.sin(titleSpin) * 500, skier.y - 70, skier.z + Math.cos(titleSpin) * 500)
      sky.position.copy(camera.position)
      SIGHT_LINE.from.value.copy(camera.position)
      SIGHT_LINE.to.value.copy(camera.position)
      stage.update(camera.position)
      if (settings.npcs) npcs?.update(dt, camera.position, skier)
      titleWasShown = true
    } else {
      if (titleWasShown) {
        titleWasShown = false
        rig.snap()
      }
      rig.update(skier, stage.slope.sampleTerrain, 0, ride ? undefined : cameraBlocked, skierView.eye, skierView.object, null)
    }
    renderer.render(scene, camera)
    return
  }
  if (titleWasShown) {
    titleWasShown = false
    rig.snap()
  }
  elapsed += dt
  const input = controls.read()
  // A tuck (W) held into a jump should not become a flip: flips need a fresh press in the air.
  if (skier && !skier.grounded) {
    if (pitchLocked && !input.pitch) pitchLocked = false
    if (pitchLocked) input.pitch = 0
  } else pitchLocked = Boolean(input.pitch)
  let steps = 0
  stage.advanceLifts?.(dt, ride && input.tuck ? ride.lift.id : undefined)
  let pose: SkierPose = 'ski'
  if (ride) {
    pose = stepRide(dt, input.tuck)
    if (ride) arrivalShot(ride)
  } else if (pause) {
    if (elapsed >= pause.until) {
      const done = pause.then
      pause = null
      done()
    }
  } else {
    perf.begin()
    steps = advance(clock, skier, input, stage.slope.sampleTerrain, dt, stage.env, stage.trunks ? checkTreeContact : undefined)
    perf.lap('sim')
    if (tricks.onTrick(skier.trick) && skier.trick?.kind === 'air') {
      rig.landingImpulse(skier.trick)
      haptics.landing(skier.trick)
    }
    tricks.update(dt, skier.grounded && !skier.rail)
    if (skier.mode === 'crashed' && !crashShown) {
      crashShown = true
      tricks.drop()
    }
    if (skier.mode !== 'crashed') crashShown = false
    for (const event of session.step(skier, dt)) onSessionEvent(event)
    coach.update(skier, input, dt)
    coachTips()
    checkEvents()
  }
  if (settings.npcs && !pause) {
    for (const contact of npcs?.update(dt, camera.position, skier) ?? []) {
      if (contact.kind === 'nearMiss') {
        sound.nearMiss(contact.closing)
        haptics.nearMiss(contact.closing)
      } else if (contact.kind === 'bump') {
        sound.nearMiss(contact.closing * 0.7)
        haptics.nearMiss(contact.closing * 0.85)
      }
    }
  }
  if (goals && !pause) {
    const found = goals.frame(skier, dt, Boolean(ride), camera.position)
    if (found) {
      tricks.show(found.title, found.detail, 'bank')
      if (found.detail.includes('unlocked')) stylePanel.refresh()
    }
  }

  const ground = ride ? null : stage.slope.sampleTerrain(skier.x, skier.z)
  skierView.update(skier, input, ground, pose, dt)
  if (!pause) {
    gearDrops.update(
      skier,
      (x, z) => stage.slope.sampleTerrain(x, z)?.height ?? null,
      outfit.model === 'snowboard',
      dt,
    )
  }
  const travel = Math.hypot(skier.vx, skier.vz)
  const approach =
    !ride && !pause && skier.grounded && !skier.rail && skier.crashed <= 0 && travel > 3
      ? approachAim(
          stage.features(),
          stage.env.rails ?? [],
          skier.x,
          skier.z,
          skier.vx / travel,
          skier.vz / travel,
          40,
        )
      : null
  rig.update(
    skier,
    stage.slope.sampleTerrain,
    dt,
    ride ? undefined : cameraBlocked,
    skierView.eye,
    skierView.object,
    approach ? { x: approach.x, z: approach.z, strength: approach.kind === 'rail' ? 0.2 : 0.14 } : null,
  )
  sky.position.copy(camera.position)
  // Shadow box sits ahead of the skier along the view.
  sunFocus.set(skier.x - camera.position.x, 0, skier.z - camera.position.z).setLength(35)
  sunFocus.x += skier.x
  sunFocus.y += skier.y
  sunFocus.z += skier.z
  followSun(sun, lighting, sunFocus)
  perf.begin()
  SIGHT_LINE.from.value.copy(camera.position)
  SIGHT_LINE.to.value.set(skier.x, skier.y + 1.1, skier.z)
  stage.update(camera.position)
  perf.lap('update')
  sound.update(skier, Boolean(ride))
  if (!ride && !pause) haptics.update(skier, performance.now())
  const gust = weatherGust(weatherLive, performance.now() * 0.001)
  effects.setWeather(weatherLive.snowDensity * (1 + gust.strength * 0.2), gust.windEast, gust.windSouth, lighting)
  if (scene.fog instanceof THREE.Fog) scene.fog.far = gust.fogFar
  effects.update(dt, skier, ride ? null : ground, camera, stage.snow, !renderer.shadowMap.enabled && rig.mode !== 'first')
  stepDeepSnow(dt, ride ? null : ground)
  // The landing ring is a third-person aid; in first person it fills the view.
  landingMarker.update(settings.landingRing && rig.mode !== 'first' && skier.air && !ride ? landingSpot(skier, skier.air, stage.slope.sampleTerrain, PHYSICS.gravity) : null, skier.air?.time ?? 0, dt)
  if (!ui.mapPanel.hidden) {
    const focus = rig.focus
    minimap?.draw(skier, ride?.lift.name, focus ? { x: camera.position.x, z: camera.position.z, tx: focus.x, tz: focus.z } : undefined)
  }
  updateHud(frameMs, steps)
  perf.begin()
  renderer.render(scene, camera)
  perf.lap('render')
  perf.end(renderer, frameMs)
}

/** Ski imprints into the deformable snow field, and the patch that draws them. */
function stepDeepSnow(dt: number, ground: SurfaceSample | null) {
  const deep = stage.snowDeform
  if (!deep) return
  if (ground && !skier.offMap) {
    const board = outfit.model === 'snowboard'
    const { side } = skiFrame(skier.heading, ground.normal)
    const fast = Math.min(1, skier.speed / 6)
    deep.stamper.push({
      x: skier.x,
      z: skier.z,
      sideX: side.x,
      sideZ: side.z,
      stance: board ? 0 : 0.16,
      boardWidth: board ? 0.27 : 0,
      sink: skier.sink,
      loose: skier.surface.depth,
      skid: Math.min(1, (skier.mode === 'braking' ? Math.max(skier.skid, 0.7) : skier.skid) * fast),
      grounded: skier.grounded && !skier.rail && skier.crashed <= 0 && skier.y - ground.height < 0.4,
      crashed: skier.crashed > 0 && skier.grounded,
    })
  }
  deep.stamper.step(dt)
  deep.patch?.update(skier.x, skier.z)
  effects.setDeepSnowPatch(Boolean(deep.patch?.mesh.visible))
}

/** Move the rider along the lift. Hold tuck to fast-forward. */
function stepRide(dt: number, fast: boolean): SkierPose {
  const current = ride!
  if (current.unload) return stepUnload(current, current.unload, dt)
  const speed = current.path.speed * (fast ? 6 : 1)
  current.s += speed * dt
  const yaw = sampleRide(current.path, current.s, ridePoint)
  Object.assign(skier, {
    x: ridePoint.x + (current.path.aerial ? Math.cos(yaw) * 0.32 : 0),
    y: ridePoint.y,
    z: ridePoint.z - (current.path.aerial ? Math.sin(yaw) * 0.32 : 0),
    vx: Math.sin(yaw) * speed,
    vy: 0,
    vz: Math.cos(yaw) * speed,
    speed,
    heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)),
  })
  ui.rideText.textContent = `Riding ${current.lift.name} · ${Math.ceil(Math.max(0, current.path.total - current.s) / speed)} s${fast ? ' ▸▸' : mobile ? ' · hold Tuck to speed up' : ' · hold W to speed up'}`
  if (current.s >= current.path.total) beginUnload(current)
  return current.path.aerial ? 'sit' : 'stand'
}

/** Stand up off the seat and glide down the ramp, then hand over control. */
function stepUnload(current: Ride, unload: NonNullable<Ride['unload']>, dt: number): SkierPose {
  unload.t += dt
  if (!current.path.aerial) return stepSurfaceUnload(current, unload)
  const k = Math.min(1, unload.t / UNLOAD_TIME)
  // Ease in from the seat, carry a little speed off the end.
  const along = k * k * (3 - 2 * k) * 0.7 + k * 0.3
  const x = unload.from.x + (unload.to.x - unload.from.x) * along
  const z = unload.from.z + (unload.to.z - unload.from.z) * along
  const ground = stage.slope.sampleTerrain(x, z)?.height ?? unload.to.y
  // Off a chair the seat drops to the snow in the first third; a T-bar is already on it.
  const drop = current.path.aerial ? Math.min(1, along * 3) : 1
  const y = Math.max(ground, unload.from.y + (ground - unload.from.y) * drop)
  const speed = 2.5
  Object.assign(skier, {
    x,
    y,
    z,
    vx: Math.sin(unload.yaw) * speed,
    vy: 0,
    vz: Math.cos(unload.yaw) * speed,
    speed,
    heading: Math.atan2(-Math.sin(unload.yaw), Math.cos(unload.yaw)),
  })
  if (k >= 1) finishRide(current.lift, unload)
  // Sitting until the skis touch, then standing: the rider view crossfades between them.
  return current.path.aerial && drop < 0.6 ? 'sit' : 'stand'
}

/**
 * T-bar and carpet: hold on to the top, let the bar go so it swings round the
 * bullwheel, and drift aside to a stop facing away from the lift, ready to
 * pick a way down.
 */
function stepSurfaceUnload(current: Ride, unload: NonNullable<Ride['unload']>): SkierPose {
  const hold = 0.45
  const total = 2.1
  const lineYaw = current.exit?.lineYaw ?? unload.yaw
  const t = unload.t
  let x: number
  let z: number
  let yaw: number
  let speed: number
  if (t < hold) {
    // Still holding the bar: a last metre along the lift line.
    const k = t / hold
    x = unload.from.x + Math.sin(lineYaw) * k
    z = unload.from.z + Math.cos(lineYaw) * k
    yaw = lineYaw
    speed = current.path.speed
  } else {
    // Let go: carry on, curving aside, slowing to a stop.
    const k = Math.min(1, (t - hold) / (total - hold))
    const e = 1 - (1 - k) * (1 - k)
    const startX = unload.from.x + Math.sin(lineYaw)
    const startZ = unload.from.z + Math.cos(lineYaw)
    yaw = lineYaw + Math.atan2(Math.sin(unload.yaw - lineYaw), Math.cos(unload.yaw - lineYaw)) * e
    x = startX + (unload.to.x - startX) * e
    z = startZ + (unload.to.z - startZ) * e
    speed = current.path.speed * (1 - k) + 0.3 * k
  }
  const ground = stage.slope.sampleTerrain(x, z)?.height ?? unload.to.y
  Object.assign(skier, {
    x,
    y: ground,
    z,
    vx: Math.sin(yaw) * speed,
    vy: 0,
    vz: Math.cos(yaw) * speed,
    speed,
    heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)),
  })
  if (t >= total) finishRide(current.lift, { to: new THREE.Vector3(x, ground, z), yaw })
  return t < hold ? 'stand' : 'ski'
}

function cameraBlocked(x: number, z: number): boolean {
  return Boolean(stage.trunks?.hit(x, z, 1.6) || stage.buildings?.hit(x, z))
}

function checkTreeContact(fromX: number, fromZ: number) {
  const impact = resolveTreeContact(skier, fromX, fromZ, stage.trunks!, stage.slope.sampleTerrain)
  if (impact !== null) tricks.show('Tree!', `${Math.round(impact * 3.6)} km/h impact`, 'crash')
}

function checkEvents() {
  if (skier.offMap) {
    transition('Off the map', 1.2, spawn)
    return
  }
  const world = stage.world
  if (!world) return
  const wipe = (what: string, into: number) => {
    const kmh = Math.round(Math.max(into, skier.speed) * 3.6)
    beginCrash(skier, Math.max(into, Math.hypot(skier.vx, skier.vz)))
    skier.vx *= -0.15
    skier.vz *= -0.15
    tricks.show(what, `${kmh} km/h`, 'crash')
  }
  if (skier.crashed > 0) return
  const building = stage.buildings?.hit(skier.x, skier.z)
  if (building) {
    // Step back outside the wall so getting up (or a slow nudge) is not another hit.
    const out = pushOutOfRing(skier.x, skier.z, building.ring)
    const into = skier.vx * -out.nx + skier.vz * -out.nz
    skier.x = out.x
    skier.z = out.z
    const ground = stage.slope.sampleTerrain(skier.x, skier.z)
    if (ground && skier.grounded) skier.y = ground.height
    if (into * 3.6 > 15) {
      wipe('Ran into a building', into)
      return
    }
    // Slow: lose the speed into the wall and slide along it.
    if (into > 0) {
      skier.vx += out.nx * into
      skier.vz += out.nz * into
    }
  }
  // Trail-head posts: same placement as signView (skier's right, ~6 m down the line).
  if (skier.grounded && skier.speed > 6) {
    for (const run of world.resort.runs) {
      if (run.kind !== 'line' || !run.name || run.name === 'Unnamed run' || !run.parts[0]) continue
      const line = run.parts[0]
      const [x0, z0] = pointAlong(line, 6)
      const [x1, z1] = pointAlong(line, 14)
      const length = Math.hypot(x1 - x0, z1 - z0) || 1
      const sx = x0 - ((z1 - z0) / length) * 9
      const sz = z0 + ((x1 - x0) / length) * 9
      if (Math.hypot(skier.x - sx, skier.z - sz) > 0.9) continue
      const nx = (skier.x - sx) / Math.max(0.05, Math.hypot(skier.x - sx, skier.z - sz))
      const nz = (skier.z - sz) / Math.max(0.05, Math.hypot(skier.x - sx, skier.z - sz))
      const into = Math.max(0, -(skier.vx * nx + skier.vz * nz))
      if (into < 4) {
        skier.x = sx + nx * 1.05
        skier.z = sz + nz * 1.05
        skier.vx += nx * into
        skier.vz += nz * into
        break
      }
      skier.x = sx + nx * 1.1
      skier.z = sz + nz * 1.1
      wipe('Hit a trail sign', into)
      return
    }
  }
  // Tutorial: the bottom of the bunny hill sends you back to the top.
  if (tutorialLine && coach.active) {
    const { off } = progressAlong(skier.x, skier.z, tutorialLine)
    const end = tutorialLine[tutorialLine.length - 1]
    if (Math.hypot(end[0] - skier.x, end[1] - skier.z) < 18 || off > 70) {
      transition('Back to the top', 0.9, spawn)
      return
    }
    return
  }
  if (challenge.kind === 'free' && session.stats.time > 10) {
    const lift = liftAtBottom(world.resort, skier.x, skier.z, 24)
    if (lift) {
      const time = session.total
      const name = course?.startRun?.name ?? 'Apex'
      const record = !bests[name] || time < bests[name]
      if (record) {
        bests[name] = time
        writeJson(KEYS.bests, bests)
      }
      goals?.freeRun(session)
      showRunCard(name, time, record)
      transition(`${name}\n${formatTime(time)}${record ? ' · best!' : ''}`, 1.8, () => startRide(lift))
    }
  }
}

function updateHud(frameMs: number, steps: number) {
  ui.speed.textContent = `${Math.round(skier.speed * 3.6)}`
  parkHud.update(skier, stage.features(), !ride && !pause, stage.env.rails ?? [])
  ui.time.textContent = formatTime(session.total)
  if (!ui.debug.hidden) {
    const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`
    const world = stage.world
    const ground = world?.grid.heightAt(skier.x, skier.z)
    const elevation = world && ground !== undefined ? `${Math.round(ground + world.manifest.originElevation)} m` : '–'
    ui.debug.textContent = [
      `${skier.mode} · pitch ${deg(skier.pitch)} · edge ${deg(Math.abs(skier.edgeAngle))} · skid ${Math.round(skier.skid * 100)}%`,
      `elev ${elevation} · x ${skier.x.toFixed(0)} z ${skier.z.toFixed(0)}`,
      `${frameMs.toFixed(1)} ms · ${steps} steps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`,
      stage.describe(),
      `graphics ${quality.level} (${qualityReason}) · shadows ${renderer.shadowMap.enabled ? 'on' : 'off'} · pixel ratio ${renderer.getPixelRatio().toFixed(2)}`,
      hardware?.renderer ?? 'graphics chip unknown',
      `v${VERSION}`,
    ].join('\n')
  }
}

/** `?at=x,z[,heading°]` spawns there, titled with the run underfoot. */
function spawnOverride(start: RunCourse, runs: readonly Run[], runNameAt: (x: number, z: number) => string): RunCourse {
  const at = params.get('at')?.split(',').map(Number)
  if (!at || at.length < 2 || at.some((v) => !Number.isFinite(v))) return start
  const name = runNameAt(at[0], at[1])
  const run = runs.find((r) => r.name === name) ?? null
  if (!run) ui.title.textContent = name
  return { spawn: { x: at[0], z: at[1], heading: ((at[2] ?? 0) * Math.PI) / 180 }, startLift: null, startRun: run }
}

function resize() {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}

/**
 * The WebGL renderer, or a clear message when the browser will not give us
 * one. Chrome refuses new WebGL contexts for a while after its graphics
 * process crashes or resets repeatedly; only restarting the browser clears it.
 */
function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: quality.antialias, powerPreference: 'high-performance' })
  } catch (error) {
    showGraphicsProblem(
      '3D graphics are not available',
      'The browser would not start WebGL. If the game worked before, the browser has probably switched 3D off after a graphics crash: quit it completely and reopen it. ' +
        'Otherwise check that hardware acceleration is turned on in the browser settings.',
      false,
    )
    throw error
  }
}

/**
 * A lost WebGL context (the graphics chip reset, often from running out of
 * time or memory) leaves menus and sound working over a blank screen. Say so,
 * remember the level that was running so Auto starts lighter next time, and
 * offer a reload.
 */
function watchForGpuReset() {
  ui.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lowerAutoCap(lighterQuality(quality.level))
    const next = lighterQuality(quality.level)
    const auto = settings.quality === 'auto'
    if (!auto && next !== quality.level) {
      settings.quality = next
      writeSettings(settings)
    }
    showGraphicsProblem(
      'The graphics chip reset',
      quality.level === 'low'
        ? 'This happened on Low graphics. Reload to try again; if it keeps happening, quit and reopen the browser.'
        : `Reload to continue on ${QUALITY[next].level[0].toUpperCase()}${QUALITY[next].level.slice(1)} graphics, which is lighter on this computer. You can change it back in Settings.`,
      true,
    )
  })
}

/**
 * Auto graphics found the game too slow to play: render fewer pixels and drop
 * shadows now, and start a level lighter next time.
 */
function lightenForSlowFrames() {
  if (settings.quality !== 'auto' || forcedQuality) return
  renderer.setPixelRatio(Math.max(0.6, renderer.getPixelRatio() * 0.7))
  resize()
  if (renderer.shadowMap.enabled) {
    renderer.shadowMap.enabled = false
    scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }
  const next = lighterQuality(quality.level)
  lowerAutoCap(next)
  tricks.show('Smoother graphics', next === quality.level ? 'Lower resolution for this computer' : `Lower resolution now, ${next} graphics from next time`, 'bank')
}
