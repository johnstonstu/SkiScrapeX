/**
 * The playtest recorder (test builds only: see index.ts). It watches the game
 * from outside and writes three tracks (analyze.ts has the format):
 *
 * - state samples at 10 Hz: where the rider is, how they are moving, what the
 *   sim was told, where the camera is and how the rider sits on screen, the
 *   frame time;
 * - raw controller and keyboard rows, written the frame they change, so stick
 *   timing survives;
 * - events: menus, lifts, the opening film, spawns, takeoffs and landings,
 *   tricks, crashes, cards and prompts shown, actions (pause, restart, camera),
 *   clicks, errors, and moments the player marks (F, or a click of the left
 *   stick).
 *
 * Nothing here changes how the game plays. The one touch is wrapping
 * `controls.takeActions` to see the actions go by.
 */
import { fallLineHeading, type SkiInput } from '../sim'
import { BTN, CAM_MODES, FLAG, FORMAT, KEY_BITS, MODES, SURFACES, type ChunkPayload, type SessionMeta, type TelemetryEvent } from './analyze'
import { createSink } from './sink'
import type { Telemetry, TelemetryContext } from './index'

const SAMPLE_MS = 100
const FLUSH_MS = 15000
const MARK_KEY = 'KeyF'
const MARK_BUTTON = 10

const round = (value: number, digits = 2) => {
  const k = 10 ** digits
  return Math.round(value * k) / k
}
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
/** Stick and trigger values to 0.02, with a small dead centre so a resting stick writes nothing. */
const axis = (value: number | undefined) => (value === undefined || Math.abs(value) < 0.05 ? 0 : Math.round(value * 50) / 50)

export function createRecorder(context: TelemetryContext): Telemetry {
  const { game, controls, camera, ui } = context
  const started = new Date(performance.timeOrigin || Date.now())
  const stamp = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  const meta: SessionMeta = {
    format: FORMAT,
    id: `${stamp}-${Math.random().toString(36).slice(2, 6)}`,
    started: started.toISOString(),
    version: context.version,
    sampleMs: SAMPLE_MS,
    userAgent: navigator.userAgent,
    screen: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
    query: location.search,
    ...context.describe(),
  }
  const sink = createSink(meta)

  let samples: ChunkPayload['s'] = []
  let inputRows: ChunkPayload['i'] = []
  let events: TelemetryEvent[] = []
  let newNames: string[] = []
  const names = new Map<string, number>()
  const nameIndex = (name: string) => {
    let index = names.get(name)
    if (index === undefined) {
      index = names.size
      names.set(name, index)
      newNames.push(name)
    }
    return index
  }
  const summary = { seconds: 0, crashes: 0, jumps: 0, tricks: 0, marks: 0, restarts: 0, errors: 0 }

  const now = () => Math.round(performance.now())
  const skierReady = () => game.stageReady && Boolean(game.skier)
  /** Record an event; `here` adds the rider's position and the run underfoot. */
  function event(kind: string, data: Record<string, unknown> = {}, here = false) {
    const entry: TelemetryEvent = { t: now(), k: kind, ...data }
    if (here && skierReady()) {
      entry.x = round(game.skier.x, 1)
      entry.z = round(game.skier.z, 1)
      entry.run = context.runNameAt(game.skier.x, game.skier.z)
    }
    events.push(entry)
    return entry
  }

  // --- Flushing -----------------------------------------------------------
  let lastFlush = performance.now()
  function flush() {
    lastFlush = performance.now()
    if (!samples.length && !inputRows.length && !events.length) return
    const times = [samples[0]?.[0], inputRows[0]?.[0], events[0]?.t].filter((t): t is number => typeof t === 'number')
    const payload: ChunkPayload = { s: samples, i: inputRows, e: events, n: newNames }
    samples = []
    inputRows = []
    events = []
    newNames = []
    summary.seconds = Math.round(performance.now() / 1000)
    void sink.push(payload, Math.min(...times), now(), { ...summary })
  }
  document.addEventListener('visibilitychange', () => {
    event('visible', { on: document.visibilityState === 'visible' })
    if (document.visibilityState === 'hidden') flush()
  })
  window.addEventListener('pagehide', flush)
  // The frame loop stops in a hidden tab; this keeps the tail from being lost.
  window.setInterval(() => {
    if (performance.now() - lastFlush > FLUSH_MS * 2) flush()
  }, FLUSH_MS)

  // --- Raw input ----------------------------------------------------------
  let keyMask = 0
  let lastRow: number[] = [0, 0, 0, 0, 0, 0, 0, 0]
  let padId = ''
  let padBlocked = false
  let lastButtons = 0
  const pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, btn: 0 }
  function writeInput() {
    const row = [pad.lx, pad.ly, pad.rx, pad.ry, pad.lt, pad.rt, pad.btn, keyMask]
    if (row.every((value, index) => value === lastRow[index])) return
    lastRow = row
    inputRows.push([now(), ...row])
  }
  function pollPad() {
    if (padBlocked) return
    let pads: (Gamepad | null)[] = []
    try {
      pads = Array.from(navigator.getGamepads?.() ?? [])
    } catch (error) {
      // An embedding page can deny the Gamepad API: worth knowing when the pad seems dead.
      padBlocked = true
      event('padblocked', { message: String((error as Error).message ?? error) })
      return
    }
    const active = pads.find((candidate) => candidate?.connected && candidate.axes.length >= 2 && candidate.buttons.length >= 10) ?? null
    if ((active?.id ?? '') !== padId) {
      padId = active?.id ?? ''
      event('pad', active ? { id: active.id, mapping: active.mapping, axes: active.axes.length, buttons: active.buttons.length } : { id: '' })
    }
    let buttons = 0
    if (active) for (let index = 0; index < Math.min(20, active.buttons.length); index++) if (active.buttons[index]?.pressed) buttons |= 1 << index
    pad.lx = axis(active?.axes[0])
    pad.ly = axis(active?.axes[1])
    pad.rx = axis(active?.axes[2])
    pad.ry = axis(active?.axes[3])
    pad.lt = axis(active?.buttons[6]?.value)
    pad.rt = axis(active?.buttons[7]?.value)
    pad.btn = buttons
    if (buttons & (1 << MARK_BUTTON) && !(lastButtons & (1 << MARK_BUTTON))) mark()
    lastButtons = buttons
    writeInput()
  }
  const typing = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
  window.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.repeat || typing(keyEvent.target)) return
    const bit = (KEY_BITS as readonly string[]).indexOf(keyEvent.code)
    if (bit >= 0) {
      keyMask |= 1 << bit
      writeInput()
    } else {
      event('key', { code: keyEvent.code })
      if (keyEvent.code === MARK_KEY) mark()
    }
  }, true)
  window.addEventListener('keyup', (keyEvent) => {
    const bit = (KEY_BITS as readonly string[]).indexOf(keyEvent.code)
    if (bit < 0 || !(keyMask & (1 << bit))) return
    keyMask &= ~(1 << bit)
    writeInput()
  }, true)
  window.addEventListener('blur', () => {
    keyMask = 0
    writeInput()
  })
  document.addEventListener('click', (click) => {
    if (!(click.target instanceof Element)) return
    const control = click.target.closest('button, a[href], summary, select, input, [role="button"]')
    if (!control || control.closest('#telemetry-pill')) return
    const label = (control.getAttribute('aria-label') || control.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48)
    event('click', { label, id: control.id || control.className.toString().slice(0, 32) })
  }, true)

  // Actions (pause, restart, camera, ...) as the game takes them.
  const take = controls.takeActions.bind(controls)
  let skipSeen = 0
  controls.takeActions = () => {
    const taken = take()
    for (const action of taken) {
      event('action', { a: action }, true)
      if (action === 'reset') summary.restarts++
      if (action === 'skip') skipSeen = performance.now()
    }
    return taken
  }

  // --- What the screen says -----------------------------------------------
  const watch = (element: HTMLElement | null, kind: string, read: (element: HTMLElement) => Record<string, unknown> | null) => {
    if (!element) return
    let lastSeen = ''
    new MutationObserver(() => {
      const data = read(element)
      const key = JSON.stringify(data)
      if (!data || key === lastSeen) return
      lastSeen = key
      event(kind, data, true)
    }).observe(element, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-state'] })
  }
  const text = (element: Element | null | undefined) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  watch(ui.trick, 'card', (element) => {
    if (!/\bon\b/.test(element.className)) return null
    return { title: text(element.querySelector('strong')), detail: text(element.querySelector('.trick-detail')), points: text(element.querySelector('.trick-points')), kind: element.className.replace(/\bon\b/, '').trim() }
  })
  watch(ui.help, 'hint', (element) => (text(element) ? { text: text(element), state: element.dataset.state ?? '' } : null))
  watch(ui.coach, 'coach', (element) => (element.hidden || !text(element) ? null : { text: text(element) }))
  watch(ui.hint, 'parkcue', (element) => (element.hidden || !text(element) ? null : { text: text(element) }))
  watch(ui.title, 'title', (element) => (text(element) ? { text: text(element) } : null))
  let errorCount = 0
  const onError = (message: string) => {
    summary.errors++
    if (errorCount++ < 50) event('error', { message: message.slice(0, 300) })
  }
  window.addEventListener('error', (error) => onError(`${error.message} @ ${error.filename?.split('/').pop() ?? ''}:${error.lineno}`))
  window.addEventListener('unhandledrejection', (rejection) => onError(`Unhandled: ${String((rejection.reason as Error)?.message ?? rejection.reason)}`))

  // --- The pill and marking -----------------------------------------------
  const pill = document.createElement('div')
  pill.id = 'telemetry-pill'
  pill.style.cssText =
    'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 6px);transform:translateX(-50%);z-index:60;display:none;align-items:center;gap:.6em;' +
    'padding:.3em .8em;border-radius:999px;background:rgba(10,16,24,.78);color:#dfe8f2;font:500 12px/1.3 system-ui,sans-serif;white-space:nowrap;pointer-events:auto'
  const pillText = document.createElement('span')
  const pillSave = document.createElement('button')
  pillSave.type = 'button'
  pillSave.textContent = 'Download'
  pillSave.tabIndex = -1
  pillSave.style.cssText = 'font:inherit;color:inherit;background:rgba(255,255,255,.14);border:0;border-radius:999px;padding:.15em .7em;cursor:pointer'
  pillSave.addEventListener('click', () => {
    flush()
    void sink.download()
  })
  pill.append(pillText, pillSave)
  document.body.append(pill)
  let toastUntil = 0
  function mark() {
    summary.marks++
    event('mark', {}, true)
    toastUntil = performance.now() + 1600
  }
  let pillShown = ''
  function updatePill(menuOpen: boolean) {
    const toast = performance.now() < toastUntil
    const state = sink.status
    const saved = state.mode === 'db' ? (state.savedAt ? `saved ${new Date(state.savedAt).toLocaleTimeString()}` : 'saving as you play') : state.mode === 'memory' ? 'kept in this page: use Download before closing' : 'starting'
    const next = toast ? 'toast' : menuOpen ? `menu ${saved}` : ''
    if (next === pillShown) return
    pillShown = next
    pill.style.display = next ? 'flex' : 'none'
    pillSave.style.display = toast ? 'none' : ''
    pillText.textContent = toast ? '● Moment marked' : `● Test build: recording how you play (${saved}). F or left-stick click marks a moment.`
  }

  // --- Per-frame watching ---------------------------------------------------
  let frames = 0
  let frameSum = 0
  let frameMax = 0
  let longFrames = 0
  let lastSample = 0
  let ready = false
  let overlayKey = ''
  let ride: unknown = null
  let rideLift = ''
  let film = false
  let session: unknown = null
  let wasAir = false
  let airSeen = { time: 0, spin: 0, flip: 0, grab: '' as string | null }
  let lastLand: TelemetryEvent | null = null
  let airEndedAt = -1e9
  let railEndedAt = -1e9
  let charge = 0
  let windup = 0
  let trickSeq = 0
  let wasCrashed = false
  let lastMode = ''
  let lastWashout = 0
  let inputMode = ''
  let described = JSON.stringify(context.describe())
  const point = camera.position.clone()
  const look = camera.position.clone()

  function watchGame(time: number) {
    const overlay = context.overlay()
    const view = overlay === ui.titleScreen && ui.titleScreen.classList.contains('picking') ? 'pick' : overlay === ui.runs ? (ui.runs.dataset.view ?? '') : ''
    const key = overlay ? `${overlay.id}:${view}` : ''
    if (key !== overlayKey) {
      const opening = !overlayKey && Boolean(key)
      overlayKey = key
      event('menu', { to: overlay?.id ?? '', view, ...(overlay === ui.results ? { text: text(overlay) } : {}) }, true)
      // A menu opening is a natural break (and often the last thing before the tab closes): save now.
      if (opening) flush()
      if (!key) {
        const next = JSON.stringify(context.describe())
        if (next !== described) {
          described = next
          event('settings', context.describe())
        }
      }
    }
    const mode = controls.gamepad ? 'pad' : game.mobile ? 'touch' : 'keys'
    if (mode !== inputMode) {
      inputMode = mode
      event('inputmode', { mode, pad: padId })
    }
    if (!skierReady()) return
    if (!ready) {
      ready = true
      event('ready', { loadMs: Math.round(time) })
    }
    const skier = game.skier
    const skipped = performance.now() - skipSeen < 1500
    const nowFilm = Boolean(game.ride?.opening)
    if (game.ride !== ride) {
      if (game.ride) event('ride', { on: true, lift: game.ride.lift.name, opening: nowFilm })
      else event('ride', { on: false, lift: rideLift, skipped }, true)
      ride = game.ride
      rideLift = game.ride?.lift.name ?? ''
    }
    if (nowFilm !== film) {
      film = nowFilm
      event('film', { on: film, ...(film ? {} : { skipped }) })
    }
    if (game.session !== session) {
      session = game.session
      event('spawn', { title: text(ui.title), challenge: game.challenge.kind }, true)
    }
    if (game.ride || game.pause) return

    // Takeoffs and landings.
    if (skier.grounded && skier.jumpHeld) {
      charge = Math.max(charge, skier.popCharge)
      windup = skier.windup
    }
    const air = skier.air
    if (air) {
      if (!wasAir) {
        summary.jumps++
        event('air', { spd: round(skier.speed, 1), sw: skier.switchTakeoff, pop: round(charge), wind: round(windup), rail: time - railEndedAt < 300 }, true)
        charge = 0
        windup = 0
      }
      airSeen = { time: air.time, spin: air.spin, flip: air.flip, grab: air.grab ?? airSeen.grab }
      wasAir = true
    } else if (wasAir) {
      wasAir = false
      airEndedAt = time
      lastLand = event('land', { dur: round(airSeen.time), spin: Math.round((airSeen.spin * 180) / Math.PI), flip: Math.round((airSeen.flip * 180) / Math.PI), grab: airSeen.grab ?? '', crashed: skier.crashed > 0, rail: Boolean(skier.rail), sw: skier.ridingSwitch }, true)
      airSeen = { time: 0, spin: 0, flip: 0, grab: '' }
    }
    if (skier.rail) railEndedAt = time
    if (!skier.jumpHeld && skier.grounded && !air) charge = 0

    const trick = skier.trick
    if (trick && trick.seq !== trickSeq) {
      trickSeq = trick.seq
      summary.tricks++
      event('trick', { name: trick.name, kind: trick.kind, points: trick.points, grade: trick.grade, efh: round(trick.efh), airTime: round(trick.airTime), spinDeg: trick.spinDeg, flips: trick.flips, grab: trick.grab ?? '', grabTime: round(trick.grabTime), sw: trick.switchLanding, railMetres: round(trick.railMetres, 1) }, true)
    }
    if (!trick) trickSeq = 0

    const crashed = skier.crashed > 0
    if (crashed && !wasCrashed) {
      summary.crashes++
      const fromAir = time - airEndedAt < 400
      if (fromAir && lastLand) lastLand.crashed = true
      event('crash', { spd: round(skier.crashSpeed, 1), air: fromAir, rail: time - railEndedAt < 400, wash: lastWashout > 0, mode: lastMode, surf: skier.surface.kind, sw: skier.ridingSwitch }, true)
    } else if (!crashed && wasCrashed) event('up', {}, true)
    wasCrashed = crashed
    if (skier.mode !== 'crashed') lastMode = skier.mode
    lastWashout = skier.washout
  }

  function sample(time: number, input: SkiInput | null) {
    if (!skierReady()) return
    const skier = game.skier
    const sampleTerrain = game.stage.slope.sampleTerrain
    const menuOpen = Boolean(context.overlay())
    const planar = Math.hypot(skier.vx, skier.vz)
    const travel = planar > 0.5 ? Math.atan2(-skier.vx, skier.vz) : skier.heading
    const ground = sampleTerrain(skier.x, skier.z)
    const fall = ground ? fallLineHeading(ground.normal) : null
    let flags = 0
    if (skier.grounded) flags |= FLAG.grounded
    if (skier.ridingSwitch) flags |= FLAG.switch
    if (skier.tuck) flags |= FLAG.tuck
    if (skier.poling) flags |= FLAG.poling
    if (skier.boosting) flags |= FLAG.boosting
    if (skier.crashed > 0) flags |= FLAG.crashed
    if (skier.rail) flags |= FLAG.rail
    if (game.ride) flags |= FLAG.ride
    if (game.pause) flags |= FLAG.fade
    if (skier.offMap) flags |= FLAG.offMap
    if (skier.washout > 0) flags |= FLAG.washout
    if (menuOpen) flags |= FLAG.menu
    if (game.ride?.opening) flags |= FLAG.film
    if (skier.air) flags |= FLAG.air
    if (context.rig.holding) flags |= FLAG.shot

    // The camera, and how the rider sits in the picture.
    const dx = camera.position.x - skier.x
    const dy = camera.position.y - skier.y
    const dz = camera.position.z - skier.z
    camera.getWorldDirection(look)
    const camYaw = wrap(Math.atan2(-look.x, look.z) - travel)
    const camPitch = (Math.asin(Math.max(-1, Math.min(1, look.y))) * 180) / Math.PI
    point.set(skier.x, skier.y + 1, skier.z).project(camera)
    const behind = point.z > 1
    let hidden = 0
    for (let step = 1; step <= 5; step++) {
      const k = step / 6
      const under = sampleTerrain(camera.position.x - dx * k, camera.position.z - dz * k)
      if (under && under.height > camera.position.y - (dy - 1) * k + 0.1) hidden = 1
    }
    const underCamera = sampleTerrain(camera.position.x, camera.position.z)
    // Roughness of the snow along the line of travel: the spread of the heights off a straight fit over 10 m.
    let bump = 0
    if (ground && skier.grounded && !game.ride && planar > 2) {
      const fx = -Math.sin(travel)
      const fz = Math.cos(travel)
      const heights: number[] = []
      for (let s = -5; s <= 5; s++) heights.push(sampleTerrain(skier.x + fx * s, skier.z + fz * s)?.height ?? ground.height)
      const meanHeight = heights.reduce((a, b) => a + b, 0) / heights.length
      let slopeTop = 0
      for (let index = 0; index < heights.length; index++) slopeTop += (index - 5) * (heights[index] - meanHeight)
      const slope = slopeTop / 110
      bump = Math.sqrt(heights.reduce((sum, height, index) => sum + (height - meanHeight - slope * (index - 5)) ** 2, 0) / heights.length)
    }
    const buttons = input ? (input.tuck ? BTN.tuck : 0) | (input.jump ? BTN.jump : 0) | (input.grab ? BTN.grab : 0) : 0
    samples.push([
      Math.round(time),
      round(skier.x, 1), round(skier.y, 1), round(skier.z, 1),
      round(skier.speed, 1),
      round(skier.heading), round(travel),
      fall === null ? null : round(fall),
      round((skier.pitch * 180) / Math.PI, 1),
      Math.max(0, (MODES as readonly string[]).indexOf(skier.mode)),
      flags,
      Math.max(0, (SURFACES as readonly string[]).indexOf(skier.surface.kind)),
      Math.round((skier.edgeAngle * 180) / Math.PI),
      round(skier.skid), round(Math.min(9, skier.gripRatio)), round(skier.gliding),
      round(input?.steer ?? 0), round(input?.brake ?? 0), round(input?.pitch ?? 0), buttons,
      Math.max(0, (CAM_MODES as readonly string[]).indexOf(context.rig.mode)),
      round(Math.hypot(dx, dy, dz), 1), round(dy, 1),
      round(camYaw), round(camPitch, 1),
      round(camera.fov, 1),
      behind ? 9 : round(point.x), behind ? 9 : round(point.y),
      hidden,
      underCamera ? round(camera.position.y - underCamera.height, 1) : 0,
      round(bump),
      frames ? round(frameSum / frames, 1) : 0, round(frameMax, 1),
      nameIndex(game.ride ? game.ride.lift.name : context.runNameAt(skier.x, skier.z)),
    ])
    frames = 0
    frameSum = 0
    frameMax = 0
  }

  Object.assign(window, { __telemetry: { export: () => (flush(), sink.export()), flush, status: sink.status, meta } })
  event('start', { visible: document.visibilityState })

  return {
    frame(rawMs, input) {
      const time = performance.now()
      // A long gap after a hidden tab is not a slow frame.
      if (rawMs < 2000) {
        frames++
        frameSum += rawMs
        frameMax = Math.max(frameMax, rawMs)
        if (rawMs > 100 && ready && longFrames++ < 300) event('longframe', { ms: Math.round(rawMs) }, true)
      }
      pollPad()
      watchGame(time)
      if (time - lastSample >= SAMPLE_MS) {
        lastSample = time
        sample(time, input)
      }
      if (time - lastFlush >= FLUSH_MS) flush()
      updatePill(Boolean(context.overlay()))
    },
  }
}
