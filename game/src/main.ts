/**
 * SkiScrapex entry: renderer, scene and player setup, then the frame loop.
 *
 * Session state (stage, skier, course, challenge, lift ride, fade) lives in
 * one `GameState` (app/game/state.ts) that the systems share. Lift rides,
 * challenge flow, the HUD, graphics setup and the frame driver are in
 * app/game/; world assembly in app/apexStage.ts; menus, HUD pieces and the
 * trick feed in app/ and ui/; the ski model in sim/, world data in world/ and
 * drawing in render/. `tick` below runs one frame in a fixed order: menus,
 * music, play (sim, ride or fade), the world around the skier, then drawing.
 */
import { buildDemoPark } from './app/demoPark'
import * as THREE from 'three'
import './ui/theme.css'
import './ui/hud.css'
import './ui/menus.css'
import { PHYSICS, PRESETS, advance, blendState, createClock, createSkiState, createPoseHistory, renderAlpha, createPreset, createSkier, landingSpot, resetSkier, skiFrame, type SkiState, type SurfaceSample } from './sim'
import { createSkierView, type SkierPose } from './render/rider/skierView'
import { createLandingMarker } from './render/rider/landingMarker'
import { createSlopeView } from './render/terrain/slopeView'
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
import { courseForRun, headingFor, pickableRuns, pointAlong, type Course as RunCourse, type Run } from './world/resort'
import { approachAim, type ParkSite } from './world/park'
import { resolveTreeContact } from './world/treeSkiing'
import { createPerfProbe } from './app/perf'
import { $, getUi } from './app/dom'
import { formatTime } from './app/format'
import { KEYS, readJson } from './app/storage'
import { createTrickFeed } from './app/tricks'
import { buildParkMenu, buildRunMenu, renderTrailDetail, syncTrailListSelection } from './app/menus'
import { createTrailMap, type TrailSelection } from './ui/trailMap'
import { courseForGlade } from './world/glades'
import { buildApexStage } from './app/apexStage'
import { loadSceneryAssets, type SceneryAssets } from './render/scenery/sceneryAssets'
import type { Stage } from './app/stage'
import { VERSION } from './app/version'
import { createFrameWatch } from './app/adaptive'
import { classifyHardware, probeHardware } from './app/hardware'
import { setSnowDetail } from './fx'
import { setTextureAnisotropy } from './render/textureBudget'
import { QUALITY, createSettingsPanel, lighterQuality, minimalHud, readSettings, resolveQuality, shadowsOn, writeSettings, type Settings } from './app/settings'
import { lowerAutoCap, readAutoCap } from './app/autoCap'
import { createSession } from './app/session'
import { createRaceDirector } from './app/raceDirector'
import { createRunout } from './app/runout'
import { isRaceFormat } from './world/events'
import { createCompDirector } from './app/compDirector'
import { createRaceHud } from './ui/raceHud'
import { createHudPeek } from './ui/hudPeek'
import { createScreenWake, fullscreenSupported, onFullscreenChange, toggleFullscreen } from './app/screen'
import { createGoals } from './app/goals'
import { renderChallenges, renderTitle, setTitleStatus } from './ui/goalsPanels'
import { holdRiderAsset } from './render/rider/riderSkin'
import { createCoach } from './app/tutorial'
import { createNpcs } from './app/npcs'
import { createPauseGuide } from './app/pauseGuide'
import { createMenuNavigation } from './app/menuNavigation'
import { createParkHud } from './app/parkHud'
import { createPocketPlayer } from './ui/pocketPlayer'
import { createGameState } from './app/game/state'
import { createLiftRides } from './app/game/liftRide'
import { createChallengeFlow } from './app/game/challengeFlow'
import { createHud } from './app/game/hud'
import { startFrameLoop } from './app/game/frameLoop'
import { createRenderer, fitToWindow, nextPaint, recompileMaterials, warmShaders, watchForGpuReset } from './app/game/graphics'
import './ui/hudMinimal.css'

const params = new URLSearchParams(location.search)
const turnModel = (params.get('turns') ?? params.get('turn')) === 'wide' ? 'wide' : 'classic'
const perf = createPerfProbe(params.has('perf'))
const ui = getUi()
ui.version.textContent = `v${VERSION}`
ui.hudVersion.textContent = `v${VERSION}`

const controls = createControls(document.body)
/** Touch screen at start-up: picks the graphics level, fixed for the session. */
const touchDevice = controls.touch
/** Session state shared with the systems in app/game/. */
const game = createGameState(controls.touch)
const settings = readSettings()
/** Minimal in-run screen (phones by default): run name, clock and map only when they matter. */
let hudMin = minimalHud(settings, game.mobile)
/** Whether the player wants the resort map; it starts off on the minimal screen. */
let mapWanted = !hudMin
const hudPeek = createHudPeek()
let weatherLive: WeatherPreset = weatherPreset(settings.weather)
// Quality is fixed for the session (it shapes geometry and buffers); the rest applies live.
// Auto graphics start from what this machine can do, capped by what it has
// struggled with before (a GPU reset or slow frames).
const hardware = probeHardware(touchDevice)
const hardwareTier = hardware ? classifyHardware(hardware) : null
const autoCap = readAutoCap()
// `?quality=low|medium|high` tries a level for one load without saving it.
const qualityParam = params.get('quality')
const forcedQuality = qualityParam === 'low' || qualityParam === 'medium' || qualityParam === 'high' ? qualityParam : null
const quality = forcedQuality ? QUALITY[forcedQuality] : resolveQuality(settings, touchDevice, hardwareTier?.level ?? null, autoCap)
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
const renderer = createRenderer(ui.canvas, quality.antialias)
setTextureAnisotropy(Math.min(quality.anisotropy, renderer.capabilities.getMaxAnisotropy()))
watchForGpuReset(ui.canvas, quality, settings)
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
if (params.has('test')) Object.assign(window, { __game: { scene, get camera() { return camera }, get rider() { return skierView.object }, get skier() { return game.skier }, get challenge() { return game.challenge }, get goals() { return game.goals }, get npcs() { return game.npcs }, get snowDeform() { return game.stage.snowDeform }, get tricks() { return tricks }, startEvent(id: string) { const next = game.goals?.eventById(id); if (next) flow.startChallenge(next); return Boolean(next) } } })
const sun = addSceneLights(scene, lighting, quality.shadowRange)
sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize)
const sky = createSky(lighting)
scene.add(sky)
const camera = new THREE.PerspectiveCamera(58, 1, 0.25, 25000)
const rig = createCameraRig(camera, ui.canvas)
// The rider GLB waits for the world data (see boot).
const releaseRiderAsset = holdRiderAsset()
const skierView = createSkierView()
skierView.object.traverse((child) => (child.castShadow = true))
scene.add(skierView.object)
const landingMarker = createLandingMarker()
scene.add(landingMarker.object)
const sunFocus = new THREE.Vector3()
const outfit = readOutfit()
skierView.setColours(outfit)
const stylePanel = createStylePanel(
  ui.style,
  outfit,
  (next) => {
    skierView.setColours(next)
    effects.setBoard(next.model === 'snowboard')
    writeOutfit(next)
    if (game.stage) game.stage.env.ski = SKI_MODELS[next.model]
  },
  () => game.goals?.unlocked() ?? new Set(),
  (id) => game.goals?.hint(id) ?? '',
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
const music = createMusic({ enabled: settings.music, source: settings.musicSource, mix: settings.radioMix, volume: settings.musicVolume, muted: sound.muted })
// Read-only probe for checking the adaptive music from the console or a test browser.
;(window as unknown as { skiMusic: () => unknown }).skiMusic = () => music.status()
const pocket = createPocketPlayer(music, {
  onMix: (mix) => {
    settings.radioMix = mix
    settings.musicSource = 'radio'
    writeSettings(settings)
    applySetting('radioMix')
    applySetting('musicSource')
  },
  onLyrics: (on) => {
    settings.lyrics = on
    writeSettings(settings)
  },
  onPick: (song) => {
    if (song.id.startsWith('synth:')) {
      settings.musicSource = 'procedural'
    } else {
      settings.musicSource = 'radio'
      // Keep the playlist unless the song is not in it.
      if ((settings.radioMix === 'vocal' && !song.lyrics) || (settings.radioMix === 'instrumental' && song.lyrics)) settings.radioMix = 'all'
    }
    writeSettings(settings)
    applySetting('radioMix')
    applySetting('musicSource')
    if (song.id.startsWith('synth:')) music.playSynth(Number(song.id.slice(6)))
    else music.playFile(song.id)
  },
})
const headOnScreen = new THREE.Vector3()
const haptics = createHaptics((weak, strong, ms) => controls.rumble(weak, strong, ms))
const gearDrops = createGearDrops(scene)
const effects = createSnowEffects(scene, lighting, pixelRatio, quality)
effects.setBoard(outfit.model === 'snowboard')
const tricks = createTrickFeed(ui.trick)
const raceHud = createRaceHud()
/** Braking after the finish line before the result shows. */
const runout = createRunout()
const race = createRaceDirector({ hud: raceHud, show: (title, detail, kind) => tricks.show(title, detail, kind), assistOn: () => settings.raceAssist })
const comp = createCompDirector({ hud: raceHud, show: (title, detail, kind) => tricks.show(title, detail, kind), onOut: () => flow.endChallenge('Out of the line: three misses in a row') })
const coach = createCoach(ui.coach, () => (controls.gamepad ? 'pad' : game.mobile ? 'touch' : 'keys'), { onExit: () => (game.tutorialLine = null), toTop: (message) => flow.transition(message, 1.1, spawn) })
// Free-ski bests by run name; renamed runs keep their best.
const bests = Object.fromEntries(
  Object.entries(readJson<Record<string, number>>(KEYS.bests, {})).map(([name, time]) => [PROGRESS_RENAMES[PROGRESS_RENAMES[name] ?? name] ?? PROGRESS_RENAMES[name] ?? name, time]),
)
const lifts = createLiftRides(game, { ui, rig, effects, sound, haptics, coach, controls, setFreeSki: () => flow.setFreeSki(), spawn })
const flow = createChallengeFlow(game, { ui, controls, tricks, race, comp, runout, coach, stylePanel, bests, hideOverlays, leaveDemoPark, openChallenges, spawn, startRide: (lift) => lifts.startRide(lift) })
const hud = createHud(game, { ui, renderer, parkHud, hudPeek, quality, qualityReason, hardware })
let setViewDistance: ((scale: number) => void) | null = null
/** Apply one setting (or all of them) without a reload. */
function applySetting(key?: keyof Settings) {
  const all = key === undefined
  if (all || key === 'steering' || key === 'invertPitch') controls.setOptions({ steering: settings.steering, invertPitch: settings.invertPitch })
  if (all || key === 'volume') sound.setVolume(settings.volume)
  if (all || key === 'music') music.setEnabled(settings.music)
  if (all || key === 'musicSource') music.setSource(settings.musicSource)
  if (all || key === 'radioMix') music.setMix(settings.radioMix)
  if (all || key === 'musicVolume') music.setVolume(settings.musicVolume)
  if (all || key === 'fov') rig.setFov(settings.fov)
  if (all || key === 'hud') {
    hudMin = minimalHud(settings, game.mobile)
    document.body.classList.toggle('hud-min', hudMin)
    if (key === 'hud') {
      mapWanted = !hudMin
      if (game.stageReady && game.stage.world) ui.mapPanel.hidden = !mapWanted
    }
  }
  if (all || key === 'cameraShake') {
    rig.setShake(settings.cameraShake ? 1 : 0)
    haptics.setEnabled(settings.cameraShake)
  }
  if (all || key === 'cameraStyle') rig.setStyle(settings.cameraStyle)
  if (all || key === 'weather') {
    weatherLive = applyWeather(settings.weather, lighting, scene, sun, sky)
    effects.setWeather(weatherLive.snowDensity, weatherLive.windEast, weatherLive.windSouth, lighting)
    ui.weatherCue.hidden = settings.weather !== 'flat'
    if (game.stageReady && game.stage.snow) {
      game.stage.snow.setSun(lighting.sunDirection, lighting.sunColor)
      game.stage.snow.setFog(lighting.fogDensity, lighting.fogColor)
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
  if (all || key === 'landingAssist') if (game.stageReady) game.stage.env.assist = settings.landingAssist
  if (key === 'npcs') game.npcs?.setVisible(settings.npcs)
  if (key === 'shadows') {
    renderer.shadowMap.enabled = shadowsOn(settings, quality)
    // Materials compile with or without shadow code; recompile them.
    recompileMaterials(scene)
  }
}
/** The pocket player's screen and lyrics; on lifts the line sits by the rider's ear. */
function updatePocket() {
  let head: { x: number; y: number } | null = null
  if (game.ride && rig.mode !== 'first') {
    skierView.eye.getWorldPosition(headOnScreen).project(camera)
    const { x, y, z } = headOnScreen
    if (z < 1 && Math.abs(x) < 0.95 && Math.abs(y) < 0.95) head = { x: ((x + 1) / 2) * window.innerWidth, y: ((1 - y) / 2) * window.innerHeight }
  }
  pocket.update({ riding: Boolean(game.ride), head, hideLyrics: menuWasOpen || !ui.titleScreen.hidden, lyricsOn: settings.lyrics })
}
createSettingsPanel(ui.settings, settings, quality.level, (next, key) => {
  writeSettings(next)
  applySetting(key)
}, hardwareTier?.reason)
const TOUCH_HELP = 'Stick: steer · up tuck · down brake · in the air spin and flip. Hold <b>Jump</b> to crouch, release to pop'
const KEYS_HELP = '<kbd>WASD</kbd> or arrow keys to ski · <kbd>Space</kbd> jump · <kbd>Esc</kbd> pause'
let defaultHelp = game.mobile ? TOUCH_HELP : KEYS_HELP
/** Touch or keyboard layout: body class, minimal screen on Auto, hints and the controls guide. */
function applyInputMode() {
  document.body.classList.toggle('touch', game.mobile)
  hudMin = minimalHud(settings, game.mobile)
  document.body.classList.toggle('hud-min', hudMin)
  defaultHelp = game.mobile ? TOUCH_HELP : KEYS_HELP
  if (!controls.gamepad) ui.help.innerHTML = defaultHelp
  guide.select(controls.gamepad ? 'pad' : game.mobile ? 'touch' : 'keys')
  $('#runs .menu-lead').textContent = game.mobile
    ? 'Tap a trail on the map to go there, or pick one from the list.'
    : 'Hover a trail for its name. Click to go there, or pick one from the list.'
}
applyInputMode()
controls.onTouchChange((touch) => {
  game.mobile = touch
  applyInputMode()
})
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



applySetting()
const clock = createClock()
// Render smoothing: the rider and camera draw a blend of the last two physics steps.
clock.history = createPoseHistory()
/** `?nosmooth` draws the newest step as before, for side-by-side comparison. */
const smoothMotion = !params.has('nosmooth')
const viewState = createSkiState()
const viewAir = {} as NonNullable<SkiState['air']>
/** The skier as drawn this frame: the sim state with motion blended between steps. */
function skierForView(): SkiState {
  return smoothMotion ?  blendState(clock.history!, game.skier, renderAlpha(clock), viewState, viewAir) : game.skier
}
let menuWasOpen = false
let titleSpin = 2.4
let titleWasShown = false
let minimap: ReturnType<typeof createMinimap> | null = null
let trailMap: ReturnType<typeof createTrailMap> | null = null
let devView: ReturnType<typeof createSlopeView> | null = null
let pitchLocked = false
let crashShown = false

const resize = () => fitToWindow(camera, renderer)
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
  ['#btn-player', 'player'],
] as const) {
  $(id).addEventListener('click', () => controls.push(action))
}
// Runs on a narrow portrait screen: the map or the list, one at a time.
for (const tab of document.querySelectorAll<HTMLButtonElement>('.runs-view button')) {
  tab.addEventListener('click', () => {
    ui.runs.dataset.view = tab.dataset.view
    for (const other of document.querySelectorAll('.runs-view button')) other.setAttribute('aria-pressed', String(other === tab))
    trailMap?.resize()
  })
}
// Small screens keep the controls guide behind a button in the pause menu.
$('#btn-guide').addEventListener('click', () => {
  const open = ui.menu.classList.toggle('show-guide')
  $('#btn-guide').setAttribute('aria-expanded', String(open))
  if (open) $('.pause-guide').scrollIntoView({ behavior: 'smooth', block: 'start' })
})
// Fullscreen where the browser allows it (not iPhone Safari: add to the home screen there).
if (fullscreenSupported()) {
  const button = $('#btn-fullscreen')
  button.hidden = false
  button.addEventListener('click', () => void toggleFullscreen())
  onFullscreenChange((on) => button.setAttribute('aria-pressed', String(on)))
}
const screenWake = createScreenWake()
// From the pause menu: back to skiing with the player open.
$('#btn-pause-player').addEventListener('click', () => {
  controls.push('pause')
  controls.push('player')
})
resize()
boot()

function titleActions() {
  return {
    play: () => {
      ui.titleScreen.hidden = true
      lifts.arriveByChair()
    },
    learn: () => startTutorial(),
    challenges: () => openChallenges(),
    rider: () => openPanel(ui.style),
    settings: () => openPanel(ui.settings),
  }
}

function showTitle() {
  hideOverlays()
  renderTitle(ui.titleScreen, game.goals?.summary() ?? null, Boolean(game.goals), titleActions(), !coach.done)
  ui.titleScreen.hidden = false
}



async function boot() {
  // Review links (`?park`, `?ride`, `?at`) and test slopes go straight in.
  const skipTitle = ['dev', 'park', 'ride', 'at', 'perf', 'demo'].some((key) => params.has(key))
  if (skipTitle) ui.titleScreen.hidden = true
  else renderTitle(ui.titleScreen, null, false, titleActions(), !coach.done)
  const status = (message: string, done: number) => {
    // The rider GLB starts once the height grids (the bulk of the world data) are in.
    if (done >= 0.5) releaseRiderAsset()
    ui.status.textContent = message
    setTitleStatus(ui.titleScreen, message, done)
  }
  if (params.has('dev')) {
    releaseRiderAsset()
    startDev('pitch')
  } else {
    try {
      const base = `${import.meta.env.BASE_URL}data/`
      // Hand-modelled scenery loads alongside the world data; it never rejects.
      const [world, scenery] = await Promise.all([
        loadWorld(base, status).finally(releaseRiderAsset),
        loadSceneryAssets(),
      ])
      perf.phase('loadWorld')
      // Building the stage blocks the page: paint the message first.
      status('Building the village…', 0.85)
      await nextPaint()
      startApex(world, scenery)
      perf.phase('startApex')
      setTitleStatus(ui.titleScreen, 'Preparing shaders…', 0.95)
      await warmShaders(renderer, scene, camera)
      perf.phase('shaders')
      if (!skipTitle) showTitle()
    } catch (error) {
      releaseRiderAsset()
      console.error(error)
      ui.status.textContent = 'Apex data not found. Showing test slopes.'
      startDev('pitch')
      setTimeout(() => (ui.status.textContent = ''), 5000)
    }
  }
  startFrameLoop((dt, smoothedMs, rawMs) => {
    if (frameWatch.sample(rawMs, game.stageReady && !game.ride && !game.pause && ui.titleScreen.hidden && !overlaysOpen())) lightenForSlowFrames()
    tick(dt, smoothedMs)
  })
}

function startApex(world: World, scenery?: SceneryAssets) {
  ui.status.textContent = 'Building the village…'
  scene.add(apexRoot)
  const apex = buildApexStage(world, apexRoot, lighting, { quality, viewDistance: settings.viewDistance, ski: SKI_MODELS[outfit.model], phase: perf.phase, scenery })
  game.stage = apex.stage
  game.stage.env.assist = settings.landingAssist
  game.stageReady = true
  applySetting('weather')
  setViewDistance = apex.setViewDistance
  perf.phase('stage')
  game.goals = createGoals({ world, stage: game.stage, scene: apexRoot, parkSites: apex.parkSites, runNameAt: apex.surface.runNameAt, version: VERSION })
  perf.phase('goals')
  game.npcs = createNpcs(apexRoot, game.goals.routes(), game.stage.slope.sampleTerrain, { sampleSurface: game.stage.env.sampleSurface }, quality.npcCount, world.course.spawn)
  game.npcs.setVisible(settings.npcs)
  perf.phase('npcs')
  stylePanel.refresh()
  game.course = spawnOverride(world.course, world.resort.runs, apex.surface.runNameAt)
  ui.credits.innerHTML =
    'Elevation and canopy: LidarBC, <a href="https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc">OGL-BC</a>' +
    (world.horizon ? '; horizon: NRCan MRDEM, <a href="https://open.canada.ca/en/open-government-licence-canada">OGL-Canada</a>. ' : '. ') +
    `Runs, lifts and buildings © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors.`
  $('#pause-credits').innerHTML = ui.credits.innerHTML
  ui.mapPanel.hidden = !mapWanted
  const { grid, resort } = world
  perf.phase('credits')
  const runs = pickableRuns(resort)
  // The maps also name the glades (area runs), which are not timed runs.
  const mapRuns = [...runs, ...resort.runs.filter((run) => run.glade)]
  const skiRun = (run: Run) => {
    leaveDemoPark()
    flow.setFreeSki()
    game.course = (run.glade ? courseForGlade(run, grid.heightAt) : null) ?? courseForRun(resort, run)
    restartFromMenu()
  }
  const tripTrail = (selection: TrailSelection) => {
    if (!selection) return
    if (selection.kind === 'run') skiRun(selection.run)
    else startPark(selection.site)
  }
  minimap?.dispose()
  minimap = createMinimap(ui.map, ui.mapLocation, apex.surface.runNameAt, { width: grid.width, depth: grid.depth, resort, hillshade: world.hillshade }, {
    runs: mapRuns,
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
    runs: mapRuns,
    parks: apex.parkSites,
    onSelect: selectTrail,
    onTrip: tripTrail,
  })
  buildRunMenu(ui.runList, runs, skiRun, (run) => selectTrail({ kind: 'run', run }))
  apexStage = game.stage
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
  if (rideLift) lifts.startRide(rideLift)
}

function startDev(id: (typeof PRESETS)[number]['id']) {
  devView?.dispose()
  if (devView) scene.remove(devView.object)
  const slope = createPreset(id)
  devView = createSlopeView(slope)
  scene.add(devView.object)
  ui.titleScreen.hidden = true
  game.stage = { slope, world: null, trunks: null, buildings: null, snow: null, ride: null, features: () => [], env: { ski: SKI_MODELS[outfit.model], assist: settings.landingAssist }, update() {}, describe: () => '' }
  game.stageReady = true
  game.course = null
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
  game.pause = null
  ui.fade.classList.remove('on')
  spawn()
}

/** Apex scenery, goals and other skiers: hidden while in the demo park. */
const apexRoot = new THREE.Group()
let apexStage: Stage | null = null
let demo: ReturnType<typeof buildDemoPark> | null = null

function enterDemoPark() {
  if (!apexStage) return
  flow.setFreeSki()
  if (!demo) {
    demo = buildDemoPark(lighting, SKI_MODELS[outfit.model], settings.landingAssist, quality.level === 'low' ? 0.55 : 0.4)
    scene.add(demo.root)
  }
  demo.stage.env.ski = SKI_MODELS[outfit.model]
  demo.stage.env.assist = settings.landingAssist
  apexRoot.visible = false
  demo.root.visible = true
  game.stage = demo.stage
  ui.mapPanel.hidden = true
  game.course = {
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
  game.stage = apexStage
  ui.mapPanel.hidden = !mapWanted
}

function startPark(site: ParkSite) {
  leaveDemoPark()
  flow.setFreeSki()
  const [x, z] = pointAlong(site.line, 4)
  const [ax, az] = pointAlong(site.line, 16)
  game.course = {
    spawn: { x, z, heading: headingFor(ax - x, az - z) },
    startLift: null,
    startRun: { id: site.id, name: site.name, difficulty: 'park', groomed: true, kind: 'line', parts: [site.line] },
  }
  restartFromMenu()
}

/** `keepCamera`: coming off a lift, ease the camera from its arrival shot instead of cutting. */
function spawn(keepCamera = false) {
  game.stage.env.turnModel = turnModel
  // Judged comps score every air off their features, even a short straight one.
  game.stage.env.judgedAirs = game.challenge.kind === 'event' && !isRaceFormat(game.challenge.course.def.format)
  game.ride = null
  ui.ride.hidden = true
  if (game.course) game.stage.slope.spawn = game.course.spawn
  if (game.skier) resetSkier(game.skier, game.stage.slope)
  else game.skier = createSkier(game.stage.slope)
  clock.accumulator = 0
  game.session = createSession(game.challenge)
  runout.cancel()
  race.begin(game.challenge, game.session)
  comp.begin(game.challenge)
  game.goals?.resetGates()
  hudPeek.poke(performance.now())
  tricks.resetTotal()
  // Races are timed, not judged: no trick cards or combos on the course.
  tricks.setMuted(game.challenge.kind === 'event' && isRaceFormat(game.challenge.course.def.format))
  effects.clear()
  game.stage.snowDeform?.stamper.reset()
  sound.reset()
  haptics.reset()
  gearDrops.clear()
  game.skier.missingSkis = false
  game.skier.missingPoles = false
  if (!keepCamera) {
    // A lift's held shot (arrival or boarding) must not outlive the ride: starting an event from a chair left the camera behind.
    rig.releaseShot()
    rig.snap()
  }
  if (game.challenge.kind !== 'free') {
    const best = game.goals?.progress.bests[game.challenge.id]
    const score = game.challenge.kind === 'park' || (game.challenge.kind === 'event' && ['moguls', 'aerials'].includes(game.challenge.course.def.format))
    ui.title.textContent =
      game.challenge.kind === 'park'
        ? `${game.challenge.site.name} · score attack`
        : game.challenge.kind === 'slalom'
          ? `${game.challenge.run.name} · slalom · gate 1/${game.challenge.gates.length}`
          : game.challenge.kind === 'event'
            ? flow.eventTitle(game.challenge, 0)
            : `${game.challenge.run.name} · timed run`
    ui.best.textContent = best === undefined ? '–' : score ? `${best.toLocaleString()}` : formatTime(best)
  } else if (game.course?.startRun) {
    const best = bests[game.course.startRun.name]
    ui.title.textContent = `${game.course.startRun.name}${game.course.startLift ? ` · from ${game.course.startLift.name}` : ''}`
    ui.best.textContent = best ? formatTime(best) : '–'
  }
}

function startTutorial() {
  leaveDemoPark()
  const bunny = game.goals?.tutorial()
  if (!bunny) return
  flow.setFreeSki()
  game.course = bunny.course
  game.tutorialLine = bunny.line
  hideOverlays()
  game.pause = null
  ui.fade.classList.remove('on')
  spawn()
  coach.start()
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
  if (!game.goals) return
  renderChallenges(ui.challenges, game.goals.challengeData(flow.startChallenge), game.goals.progress, () => (ui.challenges.hidden = true))
  openPanel(ui.challenges)
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
        flow.dismissResults()
        continue
      }
      const closing = !ui.menu.hidden
      ui.menu.hidden = closing
      if (!closing) {
        $('#pause-location').textContent = ui.title.textContent
        ui.menu.classList.remove('show-guide')
        $('#btn-guide').setAttribute('aria-expanded', 'false')
        $('#btn-map').hidden = !game.stage.world
        $('#btn-map').setAttribute('aria-pressed', String(!ui.mapPanel.hidden))
        $('#btn-challenges').hidden = !game.goals
        $('#btn-title').hidden = !apexStage
        guide.select(controls.gamepad ? 'pad' : game.mobile ? 'touch' : 'keys')
        $('#btn-resume').focus()
      }
    } else if (action === 'title') {
      if (!game.stage.world && apexStage?.world) {
        leaveDemoPark()
        flow.setFreeSki()
        game.course = apexStage.world.course
        spawn()
      }
      if (game.stage.world) showTitle()
    } else if (action === 'reset') {
      if (!ui.titleScreen.hidden) continue
      ui.menu.hidden = ui.results.hidden = true
      closeSidePanels()
      game.pause = null
      ui.fade.classList.remove('on')
      spawn()
    } else if (action === 'camera') {
      const next = rig.mode === 'follow' ? 'first' : rig.mode === 'first' ? 'orbit' : 'follow'
      rig.setMode(next, game.skier)
      skierView.setFirstPerson(next === 'first')
      document.body.classList.toggle('first-person', next === 'first')
      $('#camera-label').textContent = `Camera · ${next === 'first' ? 'First person' : next === 'orbit' ? 'Orbit' : 'Follow'}`
    } else if (action === 'player') {
      pocket.toggle()
      $('#btn-player').setAttribute('aria-pressed', String(pocket.open))
    } else if (action === 'prevTrack') {
      music.prev()
    } else if (action === 'nextTrack') {
      music.next()
    } else if (action === 'debug') {
      ui.debug.hidden = !ui.debug.hidden
      $('#btn-info').setAttribute('aria-pressed', String(!ui.debug.hidden))
    } else if (action === 'map' && game.stage.world) {
      mapWanted = ui.mapPanel.hidden
      ui.mapPanel.hidden = !mapWanted
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
    } else if (action === 'skip' && game.ride && !overlaysOpen()) lifts.skipRide()
    else if (action.startsWith('slope') && !game.stage.world) {
      const preset = PRESETS[Number(action.slice(5)) - 1]
      if (preset) startDev(preset.id)
    }
  }
}

/**
 * One frame. The order is fixed: menus and actions, music, then either the
 * menu backdrop or play (the sim or a lift ride or a fade), the world around
 * the skier, and last everything drawn (views, camera, effects, HUD).
 */
function tick(dt: number, frameMs: number) {
  const menuOpen = syncMenus()
  updateMusic(dt, menuOpen)
  if (menuOpen) {
    drawMenuBackdrop(dt)
    renderer.render(scene, camera)
    return
  }
  if (titleWasShown) {
    titleWasShown = false
    rig.snap()
  }
  game.elapsed += dt
  const input = readPlayInput()
  const { steps, pose } = stepPlay(dt, input)
  stepWorld(dt)
  present(dt, frameMs, input, pose, steps)
}

/** Gamepad menu navigation, queued actions, and what changes when a menu opens or closes. Returns whether a menu is open. */
function syncMenus(): boolean {
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
  // Keep the screen on while skiing; menus and the title let it sleep.
  screenWake.set(!menuOpen)
  if (menuOpen !== menuWasOpen) {
    controls.clear()
    game.skier.jumpHeld = false
    game.skier.popCharge = 0
    game.skier.windup = 0
    menuWasOpen = menuOpen
    sound.pause(menuOpen)
    document.body.classList.toggle('paused', menuOpen)
    $('#btn-menu').setAttribute('aria-expanded', String(menuOpen))
    if (!menuOpen) ui.canvas.focus()
  }
  return menuOpen
}

function updateMusic(dt: number, menuOpen: boolean) {
  music.update({
    dt,
    menu: menuOpen,
    riding: Boolean(game.ride),
    speed: game.skier.speed,
    slopeDeg: (game.skier.pitch * 180) / Math.PI,
    airborne: !game.skier.grounded && !game.skier.rail,
    airTime: game.skier.air?.time ?? 0,
    onRail: Boolean(game.skier.rail),
    inPark: game.skier.surface.kind === 'park',
    crashed: game.skier.crashed > 0,
    trickSeq: game.skier.trick?.seq ?? 0,
  })
}

/** Behind the title: a slow pan from where the skier stands. Behind other menus: the paused follow camera. */
function drawMenuBackdrop(dt: number) {
  if (!ui.titleScreen.hidden && game.stage.world) {
    // Title backdrop: a slow pan around the view from where the skier stands.
    titleSpin += dt * 0.035
    camera.position.set(game.skier.x, game.skier.y + 16, game.skier.z)
    camera.lookAt(game.skier.x + Math.sin(titleSpin) * 500, game.skier.y - 70, game.skier.z + Math.cos(titleSpin) * 500)
    sky.position.copy(camera.position)
    SIGHT_LINE.from.value.copy(camera.position)
    SIGHT_LINE.to.value.copy(camera.position)
    game.stage.update(camera.position)
    if (settings.npcs) game.npcs?.update(dt, camera.position, game.skier)
    titleWasShown = true
  } else {
    if (titleWasShown) {
      titleWasShown = false
      rig.snap()
    }
    rig.update(skierForView(), game.stage.slope.sampleTerrain, 0, game.ride ? undefined : cameraBlocked, skierView.eye, skierView.object, null)
  }
}

function readPlayInput() {
  const input = controls.read()
  // A tuck (W) held into a jump should not become a flip: flips need a fresh press in the air.
  if (game.skier && !game.skier.grounded) {
    if (pitchLocked && !input.pitch) pitchLocked = false
    if (pitchLocked) input.pitch = 0
  } else pitchLocked = Boolean(input.pitch)
  return input
}

/** Advance play one frame: a lift ride, a fade, the start gate, or the ski sim and what reacts to it. */
function stepPlay(dt: number, input: ReturnType<typeof controls.read>): { steps: number; pose: SkierPose } {
  let steps = 0
  game.stage.advanceLifts?.(dt, game.ride && input.tuck ? game.ride.lift.id : undefined)
  let pose: SkierPose = 'ski'
  if (game.ride) {
    pose = lifts.stepRide(dt, input.tuck)
    if (game.ride) lifts.arrivalShot(game.ride)
  } else if (game.pause) {
    if (game.elapsed >= game.pause.until) {
      const done = game.pause.then
      game.pause = null
      done()
    }
  } else if ((race.input(input, game.skier, dt), comp.input(input, game.skier, race.holding, dt), runout.input(input), race.holding)) {
    // Held in the start gate until GO.
  } else {
    perf.begin()
    steps = advance(clock, game.skier, input, game.stage.slope.sampleTerrain, dt, game.stage.env, game.stage.trunks ? checkTreeContact : undefined)
    perf.lap('sim')
    if (tricks.onTrick(game.skier.trick) && game.skier.trick?.kind === 'air') {
      comp.onTrick(game.skier.trick)
      rig.landingImpulse(game.skier.trick)
      haptics.landing(game.skier.trick)
    }
    tricks.update(dt, game.skier.grounded && !game.skier.rail)
    if (game.skier.mode === 'crashed' && !crashShown) {
      crashShown = true
      tricks.drop()
      // Speed events: a fall between start and finish is a DNF, as in a real race.
      if (game.challenge.kind === 'event' && game.challenge.course.def.bailIsDnf && game.session.timing && !game.session.finished) flow.endChallenge('Crashed: DNF')
    }
    if (game.skier.mode !== 'crashed') crashShown = false
    for (const event of game.session.step(game.skier, dt)) flow.onSessionEvent(event)
    runout.step(game.skier, dt)
    race.record(game.skier)
    coach.update(game.skier, input, dt)
    flow.coachTips()
    flow.checkEvents()
  }
  return { steps, pose }
}

/** Other skiers, goals and the ghost: they run during rides too, not in a fade. */
function stepWorld(dt: number) {
  if (settings.npcs && !game.pause) {
    for (const contact of game.npcs?.update(dt, camera.position, game.skier) ?? []) {
      if (contact.kind === 'nearMiss') {
        sound.nearMiss(contact.closing)
        haptics.nearMiss(contact.closing)
      } else if (contact.kind === 'bump') {
        sound.nearMiss(contact.closing * 0.7)
        haptics.nearMiss(contact.closing * 0.85)
      }
    }
  }
  game.goals?.setGhost(race.ghost())
  if (game.goals && !game.pause) {
    const found = game.goals.frame(game.skier, dt, Boolean(game.ride), camera.position)
    if (found) {
      tricks.show(found.title, found.detail, 'bank')
      if (found.detail.includes('unlocked')) stylePanel.refresh()
    }
  }

}

/** Everything drawn this frame, from the smoothed skier: rider, gear, camera, light, scenery, sound, effects, HUD. */
function present(dt: number, frameMs: number, input: ReturnType<typeof controls.read>, pose: SkierPose, steps: number) {
  const ground = game.ride ? null : game.stage.slope.sampleTerrain(game.skier.x, game.skier.z)
  const view = skierForView()
  skierView.update(view, input, game.ride ? null : game.stage.slope.sampleTerrain(view.x, view.z), pose, dt)
  if (!game.pause) {
    gearDrops.update(
      game.skier,
      (x, z) => game.stage.slope.sampleTerrain(x, z)?.height ?? null,
      outfit.model === 'snowboard',
      dt,
    )
  }
  const travel = Math.hypot(game.skier.vx, game.skier.vz)
  const approach =
    !game.ride && !game.pause && game.skier.grounded && !game.skier.rail && game.skier.crashed <= 0 && travel > 3
      ? approachAim(
          game.stage.features(),
          game.stage.env.rails ?? [],
          game.skier.x,
          game.skier.z,
          game.skier.vx / travel,
          game.skier.vz / travel,
          40,
        )
      : null
  rig.update(
    view,
    game.stage.slope.sampleTerrain,
    dt,
    game.ride ? undefined : cameraBlocked,
    skierView.eye,
    skierView.object,
    approach ? { x: approach.x, z: approach.z, strength: approach.kind === 'rail' ? 0.2 : 0.14 } : null,
  )
  sky.position.copy(camera.position)
  // Shadow box sits ahead of the skier along the view.
  sunFocus.set(view.x - camera.position.x, 0, view.z - camera.position.z).setLength(35)
  sunFocus.x += view.x
  sunFocus.y += view.y
  sunFocus.z += view.z
  followSun(sun, lighting, sunFocus)
  perf.begin()
  SIGHT_LINE.from.value.copy(camera.position)
  SIGHT_LINE.to.value.set(view.x, view.y + 1.1, view.z)
  game.stage.update(camera.position)
  perf.lap('update')
  sound.update(game.skier, Boolean(game.ride))
  if (!game.ride && !game.pause) haptics.update(game.skier, performance.now())
  const gust = weatherGust(weatherLive, performance.now() * 0.001)
  effects.setWeather(weatherLive.snowDensity * (1 + gust.strength * 0.2), gust.windEast, gust.windSouth, lighting)
  if (scene.fog instanceof THREE.Fog) scene.fog.far = gust.fogFar
  effects.update(dt, view, game.ride ? null : ground, camera, game.stage.snow, !renderer.shadowMap.enabled && rig.mode !== 'first')
  stepDeepSnow(dt, game.ride ? null : ground)
  // The landing ring is a third-person aid; in first person it fills the view.
  landingMarker.update(settings.landingRing && rig.mode !== 'first' && game.skier.air && !game.ride ? landingSpot(game.skier, game.skier.air, game.stage.slope.sampleTerrain, PHYSICS.gravity) : null, game.skier.air?.time ?? 0, dt)
  if (!ui.mapPanel.hidden) {
    const focus = rig.focus
    minimap?.draw(game.skier, game.ride?.lift.name, focus ? { x: camera.position.x, z: camera.position.z, tx: focus.x, tz: focus.z } : undefined)
  }
  hud.update(frameMs, steps)
  updatePocket()
  perf.begin()
  renderer.render(scene, camera)
  perf.lap('render')
  perf.end(renderer, frameMs)
}

/** Ski imprints into the deformable snow field, and the patch that draws them. */
function stepDeepSnow(dt: number, ground: SurfaceSample | null) {
  const deep = game.stage.snowDeform
  if (!deep) return
  if (ground && !game.skier.offMap) {
    const board = outfit.model === 'snowboard'
    const { side } = skiFrame(game.skier.heading, ground.normal)
    const fast = Math.min(1, game.skier.speed / 6)
    deep.stamper.push({
      x: game.skier.x,
      z: game.skier.z,
      sideX: side.x,
      sideZ: side.z,
      stance: board ? 0 : 0.16,
      boardWidth: board ? 0.27 : 0,
      sink: game.skier.sink,
      loose: game.skier.surface.depth,
      skid: Math.min(1, (game.skier.mode === 'braking' ? Math.max(game.skier.skid, 0.7) : game.skier.skid) * fast),
      grounded: game.skier.grounded && !game.skier.rail && game.skier.crashed <= 0 && game.skier.y - ground.height < 0.4,
      crashed: game.skier.crashed > 0 && game.skier.grounded,
    })
  }
  deep.stamper.step(dt)
  deep.patch?.update(game.skier.x, game.skier.z)
  effects.setDeepSnowPatch(Boolean(deep.patch?.mesh.visible))
}




function cameraBlocked(x: number, z: number): boolean {
  return Boolean(game.stage.trunks?.hit(x, z, 1.6) || game.stage.buildings?.hit(x, z))
}

function checkTreeContact(fromX: number, fromZ: number) {
  const hit = resolveTreeContact(game.skier, fromX, fromZ, game.stage.trunks!, game.stage.slope.sampleTerrain)
  if (hit?.kind === 'crash') tricks.show('Tree!', `${Math.round(hit.into * 3.6)} km/h impact`, 'crash')
  else if (hit?.kind === 'brush') {
    // Knocked aside, still riding: a thump like a skier bump, no crash.
    sound.nearMiss(hit.into * 0.8)
    haptics.nearMiss(hit.into * 1.2)
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
    recompileMaterials(scene)
  }
  const next = lighterQuality(quality.level)
  lowerAutoCap(next)
  tricks.show('Smoother graphics', next === quality.level ? 'Lower resolution for this computer' : `Lower resolution now, ${next} graphics from next time`, 'bank')
}
