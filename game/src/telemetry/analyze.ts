/**
 * Playtest telemetry: the recording format and the analysis that turns one
 * session into findings. No imports and only erasable types, so the browser
 * recorder (recorder.ts), the tests and the Node report script
 * (scripts/telemetry-report.mjs, which loads this file as is) share it.
 *
 * A session is a meta object plus chunks. Each chunk holds three tracks:
 * `s` state samples at 10 Hz (SAMPLE_COLS), `i` raw controller and keyboard
 * rows written when they change (INPUT_COLS), and `e` events. Units are
 * metres, seconds, m/s and degrees unless a column says otherwise; `t` is
 * always milliseconds since the session started.
 */

export const FORMAT = 1

/** State sample columns, in row order. */
export const SAMPLE_COLS = [
  't',
  'x', 'y', 'z',
  /** m/s */ 'spd',
  /** Ski heading and travel direction, radians (0 faces +Z). */ 'hdg', 'trv',
  /** Fall line heading under the rider, radians, or null on the flat. */ 'fall',
  /** Slope under the rider, degrees. */ 'pit',
  /** Index into MODES. */ 'mode',
  /** FLAG bits. */ 'flags',
  /** Index into SURFACES. */ 'surf',
  /** Edge angle, degrees. */ 'edge',
  'skid', 'grip', 'glide',
  /** The input the sim got this frame: steer -1..1, brake 0..1, air pitch -1..1, BTN bits. */ 'steer', 'brake', 'ipitch', 'ibtn',
  /** Index into CAM_MODES. */ 'camMode',
  /** Camera to rider distance and height above the rider, metres. */ 'camDist', 'camUp',
  /** Camera yaw off the rider's travel direction, radians (0 looks where they go). */ 'camYaw',
  /** Camera look pitch, degrees (negative looks down). */ 'camPitch',
  'fov',
  /** Rider's chest on screen, -1..1 each way (0,0 is the centre; +y is up). */ 'sx', 'sy',
  /** 1 when terrain hides the rider's chest from the camera. */ 'occl',
  /** Camera height above the ground under it, metres. */ 'clear',
  /** Roughness of the ground along the travel line (RMS off a straight fit over 10 m), metres. Moguls are about 0.15 and up. */ 'bump',
  /** Frame time over the sample window, mean and worst, ms. */ 'fAvg', 'fMax',
  /** Index into the session's names table (run or area underfoot). */ 'run',
] as const

/** Raw input columns: left stick, right stick, triggers, pad button bits, key bits. */
export const INPUT_COLS = ['t', 'lx', 'ly', 'rx', 'ry', 'lt', 'rt', 'btn', 'keys'] as const

export const MODES = ['still', 'straight', 'carving', 'skidding', 'braking', 'tucked', 'air', 'rail', 'crashed', 'off-map'] as const
export const SURFACES = ['groomed', 'powder', 'ice', 'park', 'forest', 'rock'] as const
export const CAM_MODES = ['follow', 'first', 'orbit'] as const

export const FLAG = {
  grounded: 1,
  switch: 2,
  tuck: 4,
  poling: 8,
  boosting: 16,
  crashed: 32,
  rail: 64,
  /** On a lift. */
  ride: 128,
  /** A fade between places: physics waits. */
  fade: 256,
  offMap: 512,
  washout: 1024,
  /** A menu, the title or a results card is up: the game is paused. */
  menu: 2048,
  /** The opening film off the chair. */
  film: 4096,
  air: 8192,
  /** The camera is holding a fixed shot (lift arrivals). */
  shot: 16384,
} as const

/** Bits of the `ibtn` column. */
export const BTN = { tuck: 1, jump: 2, grab: 4 } as const

/** Keys tracked in the `keys` column, by bit. Other keys arrive as `key` events. */
export const KEY_BITS = [
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyW', 'KeyS',
  'Space', 'KeyJ', 'KeyK', 'ShiftLeft', 'ShiftRight',
] as const

/** Keys the game uses besides KEY_BITS (menus, camera, restart, the mark key), so they are not reported as guesses. */
export const MAPPED_KEYS = new Set(['KeyR', 'KeyC', 'Backquote', 'KeyI', 'KeyM', 'KeyT', 'KeyO', 'KeyG', 'KeyH', 'KeyP', 'BracketLeft', 'BracketRight', 'Enter', 'Escape', 'KeyF'])

/** Standard-mapping gamepad button names, and what the game does with each while skiing. */
export const PAD_BUTTONS: readonly { name: string; does: string }[] = [
  { name: 'A / Cross', does: 'jump' },
  { name: 'B / Circle', does: 'skip a lift' },
  { name: 'X / Square', does: 'grab' },
  { name: 'Y / Triangle', does: 'second grab' },
  { name: 'LB / L1', does: 'camera' },
  { name: 'RB / R1', does: 'grab' },
  { name: 'LT / L2', does: 'brake' },
  { name: 'RT / R2', does: 'grab' },
  { name: 'Back / Share', does: 'trail map' },
  { name: 'Start / Options', does: 'pause' },
  { name: 'L3 (left stick click)', does: 'mark a moment (test build only)' },
  { name: 'R3 (right stick click)', does: 'music player' },
  { name: 'D-pad up', does: 'rider' },
  { name: 'D-pad down', does: 'minimap' },
  { name: 'D-pad left', does: 'previous track' },
  { name: 'D-pad right', does: 'next track' },
  { name: 'Home', does: '' },
  { name: 'Touchpad', does: '' },
]

export interface TelemetryEvent {
  t: number
  /** What happened: see recorder.ts for the list. */
  k: string
  [key: string]: unknown
}

export interface ChunkPayload {
  /** Sample rows (SAMPLE_COLS). */
  s: (number | null)[][]
  /** Raw input rows (INPUT_COLS). */
  i: number[][]
  e: TelemetryEvent[]
  /** Names added to the names table in this chunk, in index order. */
  n: string[]
}

export interface SessionMeta {
  format: number
  id: string
  /** ISO time the page loaded. */
  started: string
  version: string
  [key: string]: unknown
}

export interface Session {
  meta: SessionMeta
  samples: (number | null)[][]
  input: number[][]
  events: TelemetryEvent[]
  names: string[]
}

/** Put decoded chunks (in order) back together as one session. */
export function buildSession(meta: SessionMeta, chunks: ChunkPayload[]): Session {
  const session: Session = { meta, samples: [], input: [], events: [], names: [] }
  for (const chunk of chunks) {
    for (const row of chunk.s ?? []) session.samples.push(row)
    for (const row of chunk.i ?? []) session.input.push(row)
    for (const event of chunk.e ?? []) session.events.push(event)
    for (const name of chunk.n ?? []) session.names.push(name)
  }
  session.events.sort((a, b) => a.t - b.t)
  return session
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

type Row = (number | null)[]
const S = Object.fromEntries(SAMPLE_COLS.map((name, index) => [name, index])) as Record<(typeof SAMPLE_COLS)[number], number>
const I = Object.fromEntries(INPUT_COLS.map((name, index) => [name, index])) as Record<(typeof INPUT_COLS)[number], number>
const num = (row: Row, col: number) => row[col] ?? 0
const has = (row: Row, flag: number) => (num(row, S.flags) & flag) !== 0
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const deg = (rad: number) => (rad * 180) / Math.PI
const kmh = (ms: number) => ms * 3.6
const round = (v: number, digits = 1) => {
  const k = 10 ** digits
  return Math.round(v * k) / k
}
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
const sd = (values: number[]) => {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}
function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
}
/** m:ss from session milliseconds. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Skiing under the player's control: not a menu, a lift, a fade or the opening film. */
const playing = (row: Row) => !has(row, FLAG.menu | FLAG.ride | FLAG.fade | FLAG.film)

export interface Finding {
  /** `high`: probably hurting the feel; `medium`: worth a look; `info`: context. */
  level: 'high' | 'medium' | 'info'
  area: 'flow' | 'stalls' | 'switch' | 'crashes' | 'tricks' | 'camera' | 'controls' | 'performance' | 'marks'
  title: string
  detail: string
}

export interface Stall {
  t: number
  seconds: number
  x: number
  z: number
  run: string
  pitchDeg: number
  surface: string
  /** Degrees between the skis and the fall line (90 is straight across the hill); null on the flat. */
  offFallLineDeg: number | null
  cause: 'not started yet' | 'after a crash' | 'braked to a stop' | 'across the slope' | 'ran out of slope' | 'uphill' | 'in deep snow' | 'other'
  /** How it ended. */
  exit: 'moved off' | 'poled' | 'reset' | 'menu' | 'lift' | 'end of recording'
}

export interface SwitchEpisode {
  t: number
  seconds: number
  x: number
  z: number
  run: string
  entrySpeedKmh: number
  exitSpeedKmh: number
  /** The trick that put the rider switch, when one was scored just before. */
  from: string
  exit: 'stopped' | 'crashed' | 'jumped' | 'lift or menu' | 'end of recording'
}

export interface SpinOut {
  t: number
  seconds: number
  x: number
  z: number
  run: string
  speedKmh: number
  /** Riding switch when the skis came round. */
  switch: boolean
  surface: string
  /** Largest angle between the skis and the direction of travel, degrees. */
  maxSlipDeg: number
}

export interface CameraSlice {
  label: string
  seconds: number
  /** Share of the time, 0..1. */
  hidden: number
  offScreen: number
  /** Rider height on screen: mean and spread (-1 bottom, 1 top). */
  screenY: number
  screenYSpread: number
  /** How fast the rider moves up and down the screen, screen heights per second (0.5 is the whole screen in a second). */
  bounce: number
  /** How fast the view pitches, degrees per second. */
  pitchRate: number
  /** Share of the time the camera looks more than 60 degrees off the travel direction. */
  lookingAway: number
  /** Lowest camera height above the snow, metres. */
  minClear: number
}

export interface Analysis {
  meta: SessionMeta
  seconds: number
  time: Record<'menus' | 'lifts' | 'film' | 'skiing' | 'air' | 'crashed' | 'stalled' | 'switch', number>
  distanceKm: number
  verticalM: number
  topSpeedKmh: number
  speedKmh: { median: number; p90: number }
  device: { pad: number; keys: number; touch: number; padName: string }
  firstMinute: { t: number; what: string }[]
  runs: { run: string; seconds: number; km: number; avgKmh: number; topKmh: number; crashes: number; stalls: number }[]
  stalls: Stall[]
  switches: SwitchEpisode[]
  spinOuts: SpinOut[]
  crashes: { t: number; x: number; z: number; run: string; speedKmh: number; cause: string; downSeconds: number; resetAfter: boolean }[]
  airs: {
    count: number
    charged: number
    medianSeconds: number
    withSpin: number
    withFlip: number
    withGrab: number
    crashed: number
    grades: Record<string, number>
    grabs: Record<string, number>
    tricks: Record<string, number>
    /** Places jumped three times or more. */
    retries: { x: number; z: number; run: string; attempts: number; crashed: number }[]
  }
  camera: { slices: CameraSlice[]; modeChanges: number; worst: { t: number; x: number; z: number; run: string; why: string }[] }
  controls: {
    /** Share of skiing time at each stick deflection band (|x|: 0-0.1, 0.1-0.5, 0.5-0.9, 0.9-1). */
    steerBands: number[]
    reversalsPerMinute: number
    tuckShare: number
    brakeShare: number
    /** Share of turning time (|steer| over 0.5) in which the stick also tripped tuck or brake. */
    turnWithTuck: number
    turnWithBrake: number
    triggerBrakeShare: number
    rightStickSeconds: number
    jumpHolds: { count: number; medianSeconds: number; taps: number }
    buttons: { index: number; name: string; does: string; presses: number }[]
    otherKeys: Record<string, number>
    actions: Record<string, number>
  }
  menus: { name: string; opens: number; seconds: number }[]
  resets: { t: number; after: string }[]
  /** Control prompts shown, and how long until the player did what each asks (null: never, or it timed out). */
  hints: { t: number; text: string; doneAfter: number | null }[]
  cards: Record<string, number>
  performance: { fps: number; fpsP5: number; longFrames: number; worstRuns: { run: string; fps: number }[]; errors: string[] }
  marks: { t: number; x: number; z: number; run: string; speedKmh: number; note: string }[]
  findings: Finding[]
}

/** Samples closer together than this are continuous play; a longer gap is a hidden tab or a stall in the page. */
const MAX_GAP = 0.5
/** Below this the rider counts as stopped, m/s. */
const STOP_SPEED = 0.8
/** A stop shorter than this is a pause, not a stall, seconds. */
const STALL_SECONDS = 1.5
/** Ground rougher than this (RMS metres over 10 m) counts as bumps or moguls. */
const BUMPY = 0.12

export function analyze(session: Session): Analysis {
  const { samples, events, input, names } = session
  const runName = (row: Row) => names[num(row, S.run)] ?? ''
  const last = samples[samples.length - 1]
  const seconds = last ? num(last, S.t) / 1000 : 0
  const time = { menus: 0, lifts: 0, film: 0, skiing: 0, air: 0, crashed: 0, stalled: 0, switch: 0 }
  let distance = 0
  let vertical = 0
  let topSpeed = 0
  const speeds: number[] = []
  const runStats = new Map<string, { seconds: number; metres: number; top: number; crashes: number; stalls: number }>()
  const runOf = (name: string) => {
    let entry = runStats.get(name)
    if (!entry) runStats.set(name, (entry = { seconds: 0, metres: 0, top: 0, crashes: 0, stalls: 0 }))
    return entry
  }
  /** Seconds each sample stands for (the gap to the next one, capped). */
  const span = samples.map((row, index) => {
    const next = samples[index + 1]
    return next ? Math.min(MAX_GAP, Math.max(0, (num(next, S.t) - num(row, S.t)) / 1000)) : 0
  })

  samples.forEach((row, index) => {
    const dt = span[index]
    if (has(row, FLAG.menu)) time.menus += dt
    else if (has(row, FLAG.film)) time.film += dt
    else if (has(row, FLAG.ride)) time.lifts += dt
    else if (!has(row, FLAG.fade)) {
      time.skiing += dt
      if (has(row, FLAG.air)) time.air += dt
      if (has(row, FLAG.crashed)) time.crashed += dt
      if (has(row, FLAG.switch)) time.switch += dt
      const next = samples[index + 1]
      const speed = num(row, S.spd)
      const stats = runOf(runName(row))
      stats.seconds += dt
      stats.top = Math.max(stats.top, speed)
      topSpeed = Math.max(topSpeed, speed)
      if (speed > 1) speeds.push(speed)
      if (next && dt > 0 && dt < MAX_GAP && playing(next)) {
        const step = Math.hypot(num(next, S.x) - num(row, S.x), num(next, S.z) - num(row, S.z))
        // A respawn moves the rider a long way in one sample: not skiing.
        if (step < 12) {
          distance += step
          stats.metres += step
          if (num(next, S.y) < num(row, S.y)) vertical += num(row, S.y) - num(next, S.y)
        }
      }
    }
  })

  /** The sample at or just before `t`. */
  const sampleAt = (t: number): Row | null => {
    let low = 0
    let high = samples.length - 1
    if (high < 0) return null
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (num(samples[mid], S.t) <= t) low = mid
      else high = mid - 1
    }
    return samples[low]
  }
  const eventsOf = (kind: string) => events.filter((event) => event.k === kind)
  const eventNear = (kind: string, from: number, to: number) => events.find((event) => event.k === kind && event.t >= from && event.t <= to)

  // --- Stalls -------------------------------------------------------------
  const stalls: Stall[] = []
  {
    let start = -1
    let moved = false
    const close = (endIndex: number, endOfData: boolean) => {
      const first = samples[start]
      const end = samples[endIndex]
      const stalledFor = (num(end, S.t) - num(first, S.t)) / 1000
      if (stalledFor >= STALL_SECONDS) {
        const t = num(first, S.t)
        const before = samples.slice(Math.max(0, start - 25), start)
        const during = samples.slice(start, endIndex + 1)
        const fall = first[S.fall]
        const off = fall === null || fall === undefined ? null : Math.abs(deg(wrap(num(first, S.hdg) - fall)))
        const pitch = num(first, S.pit)
        const crashedBefore = before.some((row) => has(row, FLAG.crashed)) || Boolean(eventNear('crash', t - 6000, t))
        const braked = before.filter((row) => num(row, S.brake) > 0.5).length >= 5
        const climbed = before.length > 5 && num(first, S.y) - num(before[0], S.y) > 0.4
        const surface = SURFACES[num(first, S.surf)] ?? ''
        const cause: Stall['cause'] = !moved
          ? 'not started yet'
          : crashedBefore
            ? 'after a crash'
            : braked
              ? 'braked to a stop'
              : climbed
                ? 'uphill'
                : pitch < 5
                  ? 'ran out of slope'
                  : off !== null && off > 55 && off < 125
                    ? 'across the slope'
                    : surface === 'powder' || surface === 'forest'
                      ? 'in deep snow'
                      : 'other'
        const after = samples[Math.min(samples.length - 1, endIndex + 1)]
        const exit: Stall['exit'] = endOfData
          ? 'end of recording'
          : eventNear('action', num(end, S.t) - 600, num(end, S.t) + 600)?.a === 'reset'
            ? 'reset'
            : has(after, FLAG.menu)
              ? 'menu'
              : has(after, FLAG.ride | FLAG.fade)
                ? 'lift'
                : during.some((row) => has(row, FLAG.poling))
                  ? 'poled'
                  : 'moved off'
        stalls.push({ t, seconds: round(stalledFor), x: num(first, S.x), z: num(first, S.z), run: runName(first), pitchDeg: round(pitch), surface, offFallLineDeg: off === null ? null : Math.round(off), cause, exit })
        if (cause !== 'not started yet') {
          time.stalled += stalledFor
          runOf(runName(first)).stalls++
        }
      }
      start = -1
    }
    samples.forEach((row, index) => {
      const stopped = playing(row) && has(row, FLAG.grounded) && !has(row, FLAG.crashed) && num(row, S.spd) < STOP_SPEED
      if (stopped && start < 0) start = index
      if (!stopped && start >= 0) close(index - 1, false)
      // A spawn or a lift puts the rider somewhere new: standing there is "not started yet" until they move.
      if (has(row, FLAG.ride | FLAG.fade)) moved = false
      else if (playing(row) && num(row, S.spd) > 3) moved = true
    })
    if (start >= 0) close(samples.length - 1, true)
    for (const event of eventsOf('spawn')) {
      // Standing still after a restart is also a fresh start.
      const stall = stalls.find((entry) => entry.t >= event.t - 300 && entry.t < event.t + 1500)
      if (stall && stall.cause !== 'not started yet') {
        time.stalled -= stall.seconds
        runOf(stall.run).stalls--
        stall.cause = 'not started yet'
      }
    }
  }

  // --- Switch riding and spin-outs ----------------------------------------
  const switches: SwitchEpisode[] = []
  {
    let start = -1
    const close = (endIndex: number, endOfData: boolean) => {
      const first = samples[start]
      const end = samples[endIndex]
      const after = samples[Math.min(samples.length - 1, endIndex + 1)]
      const t = num(first, S.t)
      const trick = [...eventsOf('trick')].reverse().find((event) => event.t <= t + 300 && event.t > t - 1500)
      const exit: SwitchEpisode['exit'] = endOfData
        ? 'end of recording'
        : has(after, FLAG.crashed)
          ? 'crashed'
          : has(after, FLAG.air)
            ? 'jumped'
            : !playing(after)
              ? 'lift or menu'
              : 'stopped'
      switches.push({
        t,
        seconds: round((num(end, S.t) - t) / 1000 + 0.1),
        x: num(first, S.x),
        z: num(first, S.z),
        run: runName(first),
        entrySpeedKmh: Math.round(kmh(num(first, S.spd))),
        exitSpeedKmh: Math.round(kmh(num(end, S.spd))),
        from: typeof trick?.name === 'string' ? trick.name : '',
        exit,
      })
      start = -1
    }
    samples.forEach((row, index) => {
      const on = playing(row) && has(row, FLAG.switch) && has(row, FLAG.grounded)
      if (on && start < 0) start = index
      // In the air the switch flag carries over from the takeoff; the episode is the time on the snow.
      if (!on && start >= 0) close(index - 1, false)
    })
    if (start >= 0) close(samples.length - 1, true)
  }

  const spinOuts: SpinOut[] = []
  {
    let start = -1
    let worst = 0
    const close = (endIndex: number) => {
      const first = samples[start]
      const seconds = (num(samples[endIndex], S.t) - num(first, S.t)) / 1000 + 0.1
      if (seconds >= 0.3) {
        spinOuts.push({
          t: num(first, S.t),
          seconds: round(seconds),
          x: num(first, S.x),
          z: num(first, S.z),
          run: runName(first),
          speedKmh: Math.round(kmh(num(first, S.spd))),
          switch: has(first, FLAG.switch),
          surface: SURFACES[num(first, S.surf)] ?? '',
          maxSlipDeg: Math.round(worst),
        })
      }
      start = -1
      worst = 0
    }
    samples.forEach((row, index) => {
      // The skis more than 70 degrees off the way the rider is going, at speed, on the snow: sliding sideways or backwards.
      const stance = has(row, FLAG.switch) ? Math.PI : 0
      const slip = Math.abs(deg(wrap(num(row, S.hdg) + stance - num(row, S.trv))))
      const out = playing(row) && has(row, FLAG.grounded) && !has(row, FLAG.crashed | FLAG.rail) && num(row, S.spd) > 3 && slip > 70 && num(row, S.brake) < 0.5
      if (out) {
        if (start < 0) start = index
        worst = Math.max(worst, slip)
      } else if (start >= 0) close(index - 1)
    })
    if (start >= 0) close(samples.length - 1)
  }

  // --- Crashes ------------------------------------------------------------
  const resets = eventsOf('action').filter((event) => event.a === 'reset')
  const crashes = eventsOf('crash').map((event) => {
    const row = sampleAt(event.t)
    const up = events.find((next) => next.k === 'up' && next.t > event.t)
    const downSeconds = up ? (up.t - event.t) / 1000 : 0
    const card = eventNear('card', event.t - 400, event.t + 800)
    const tree = typeof card?.title === 'string' && /tree/i.test(card.title)
    const cause = tree ? 'hit a tree' : event.air ? 'landing' : event.rail ? 'off a rail' : event.wash ? 'edge washed out' : typeof event.mode === 'string' ? `while ${event.mode}` : 'on the snow'
    const run = row ? runName(row) : ''
    runOf(run).crashes++
    return {
      t: event.t,
      x: Number(event.x ?? 0),
      z: Number(event.z ?? 0),
      run,
      speedKmh: Math.round(kmh(Number(event.spd ?? 0))),
      cause,
      downSeconds: round(downSeconds),
      resetAfter: resets.some((reset) => reset.t > event.t && reset.t < event.t + 6000),
    }
  })

  // --- Airs and tricks ----------------------------------------------------
  const airEvents = eventsOf('air')
  // A landing that ends in a crash: the recorder flags it when it can, and a crash right after says the same.
  const lands: TelemetryEvent[] = eventsOf('land').map((event) => ({ ...event, crashed: Boolean(event.crashed) || Boolean(eventNear('crash', event.t, event.t + 500)) }))
  const tricks = eventsOf('trick')
  const realAirs = lands.filter((event) => Number(event.dur ?? 0) >= 0.35)
  const count = (values: unknown[]) => {
    const out: Record<string, number> = {}
    for (const value of values) if (typeof value === 'string' && value) out[value] = (out[value] ?? 0) + 1
    return out
  }
  const retries: Analysis['airs']['retries'] = []
  for (const air of airEvents) {
    const x = Number(air.x ?? 0)
    const z = Number(air.z ?? 0)
    const land = lands.find((event) => event.t > air.t)
    if (!land || Number(land.dur ?? 0) < 0.35) continue
    let spot = retries.find((entry) => Math.hypot(entry.x - x, entry.z - z) < 18)
    if (!spot) retries.push((spot = { x, z, run: typeof air.run === 'string' ? air.run : '', attempts: 0, crashed: 0 }))
    spot.attempts++
    if (land.crashed) spot.crashed++
  }
  const airs: Analysis['airs'] = {
    count: realAirs.length,
    charged: airEvents.filter((event) => Number(event.pop ?? 0) > 0.25).length,
    medianSeconds: round(quantile(realAirs.map((event) => Number(event.dur ?? 0)), 0.5), 2),
    withSpin: realAirs.filter((event) => Math.abs(Number(event.spin ?? 0)) >= 150).length,
    withFlip: realAirs.filter((event) => Math.abs(Number(event.flip ?? 0)) >= 300).length,
    withGrab: realAirs.filter((event) => Boolean(event.grab)).length,
    crashed: realAirs.filter((event) => Boolean(event.crashed)).length,
    grades: count(tricks.map((event) => event.grade)),
    grabs: count(tricks.map((event) => event.grab)),
    tricks: count(tricks.map((event) => event.name)),
    retries: retries.filter((entry) => entry.attempts >= 3).sort((a, b) => b.attempts - a.attempts),
  }

  // --- Camera -------------------------------------------------------------
  const follow = (row: Row) => playing(row) && num(row, S.camMode) === 0 && !has(row, FLAG.shot)
  const slice = (label: string, pick: (row: Row) => boolean): CameraSlice => {
    let total = 0
    let hidden = 0
    let off = 0
    let away = 0
    let bounce = 0
    let pitchRate = 0
    let rateTime = 0
    let minClear = Infinity
    const ys: number[] = []
    samples.forEach((row, index) => {
      if (!follow(row) || !pick(row)) return
      const dt = span[index]
      total += dt
      if (num(row, S.occl)) hidden += dt
      const sx = num(row, S.sx)
      const sy = num(row, S.sy)
      if (Math.abs(sx) > 0.85 || sy > 0.85 || sy < -0.9) off += dt
      if (num(row, S.spd) > 5 && Math.abs(num(row, S.camYaw)) > Math.PI / 3) away += dt
      minClear = Math.min(minClear, num(row, S.clear))
      ys.push(sy)
      const next = samples[index + 1]
      if (next && dt > 0 && dt < MAX_GAP && follow(next) && pick(next)) {
        bounce += Math.abs(num(next, S.sy) - sy) / 2
        pitchRate += Math.abs(num(next, S.camPitch) - num(row, S.camPitch))
        rateTime += dt
      }
    })
    return {
      label,
      seconds: round(total),
      hidden: total ? round(hidden / total, 3) : 0,
      offScreen: total ? round(off / total, 3) : 0,
      screenY: round(mean(ys), 2),
      screenYSpread: round(sd(ys), 2),
      bounce: rateTime ? round(bounce / rateTime, 2) : 0,
      pitchRate: rateTime ? round(pitchRate / rateTime, 1) : 0,
      lookingAway: total ? round(away / total, 3) : 0,
      minClear: Number.isFinite(minClear) ? round(minClear) : 0,
    }
  }
  const onSnow = (row: Row) => has(row, FLAG.grounded) && !has(row, FLAG.crashed) && num(row, S.spd) > 3
  const traverse = (row: Row) => {
    const fall = row[S.fall]
    return fall !== null && fall !== undefined && Math.abs(deg(wrap(num(row, S.trv) - fall))) > 55
  }
  const slices = [
    slice('All skiing', () => true),
    slice('Smooth snow', (row) => onSnow(row) && num(row, S.bump) < BUMPY * 0.6),
    slice('Bumps and moguls', (row) => onSnow(row) && num(row, S.bump) >= BUMPY),
    slice('In the air', (row) => has(row, FLAG.air)),
    slice('Riding switch', (row) => onSnow(row) && has(row, FLAG.switch)),
    slice('Traverses', (row) => onSnow(row) && !has(row, FLAG.switch) && traverse(row)),
    slice('Steeps (over 25°)', (row) => onSnow(row) && num(row, S.pit) > 25),
    slice('Fast (over 60 km/h)', (row) => onSnow(row) && kmh(num(row, S.spd)) > 60),
  ].filter((entry) => entry.seconds > 0)
  const worst: Analysis['camera']['worst'] = []
  {
    let start = -1
    let why = ''
    const reason = (row: Row) =>
      !follow(row) || has(row, FLAG.crashed)
        ? ''
        : num(row, S.occl)
          ? 'the snow hid the rider'
          : Math.abs(num(row, S.sx)) > 0.85 || num(row, S.sy) > 0.85 || num(row, S.sy) < -0.9
            ? 'the rider left the screen'
            : num(row, S.spd) > 5 && Math.abs(num(row, S.camYaw)) > (Math.PI * 100) / 180
              ? 'the camera faced back up the hill'
              : ''
    samples.forEach((row, index) => {
      const now = reason(row)
      if (now && start < 0) {
        start = index
        why = now
      }
      if ((!now || now !== why) && start >= 0) {
        const first = samples[start]
        const seconds = (num(samples[index - 1], S.t) - num(first, S.t)) / 1000 + 0.1
        if (seconds >= 0.4) worst.push({ t: num(first, S.t), x: num(first, S.x), z: num(first, S.z), run: runName(first), why: `${why} for ${round(seconds)} s${num(first, S.bump) >= BUMPY ? ' (bumps)' : ''}${has(first, FLAG.air) ? ' (in the air)' : ''}` })
        start = now ? index : -1
        why = now
      }
    })
  }
  const modeChanges = eventsOf('action').filter((event) => event.a === 'camera').length

  // --- Controls -----------------------------------------------------------
  const skiingRows = samples.map((row, index) => ({ row, dt: span[index] })).filter(({ row }) => playing(row) && !has(row, FLAG.crashed))
  const skiingTime = skiingRows.reduce((sum, { dt }) => sum + dt, 0) || 1
  const steerBands = [0, 0, 0, 0]
  let reversals = 0
  let lastSign = 0
  let tuckTime = 0
  let brakeTime = 0
  let turnTime = 0
  let turnTuck = 0
  let turnBrake = 0
  for (const { row, dt } of skiingRows) {
    const steer = num(row, S.steer)
    const size = Math.abs(steer)
    steerBands[size < 0.1 ? 0 : size < 0.5 ? 1 : size < 0.9 ? 2 : 3] += dt / skiingTime
    const sign = size > 0.3 ? Math.sign(steer) : 0
    if (sign && lastSign && sign !== lastSign) reversals++
    if (sign) lastSign = sign
    const grounded = has(row, FLAG.grounded)
    if (num(row, S.ibtn) & BTN.tuck && grounded) tuckTime += dt
    if (num(row, S.brake) > 0.3 && grounded) brakeTime += dt
    if (size > 0.5 && grounded) {
      turnTime += dt
      if (num(row, S.ibtn) & BTN.tuck) turnTuck += dt
      if (num(row, S.brake) > 0.3) turnBrake += dt
    }
  }
  // Raw input: which device, the right stick, the trigger, and every button.
  let padTime = 0
  let keyTime = 0
  let rightStick = 0
  let triggerBrake = 0
  const presses = new Map<number, number>()
  const jumpHolds: number[] = []
  let jumpDownAt = -1
  // Held values (a stick pushed over, a trigger squeezed) write one row and then nothing, so time them against the samples.
  {
    let at = -1
    samples.forEach((sample, index) => {
      while (at + 1 < input.length && input[at + 1][I.t] <= num(sample, S.t)) at++
      const row = at >= 0 ? input[at] : null
      if (!row || !playing(sample)) return
      const dt = span[index]
      if (Math.abs(row[I.lx]) > 0.15 || Math.abs(row[I.ly]) > 0.15 || row[I.btn] !== 0 || row[I.lt] > 0.1 || row[I.rt] > 0.1) padTime += dt
      if (row[I.keys]) keyTime += dt
      if (Math.hypot(row[I.rx], row[I.ry]) > 0.35) rightStick += dt
      if (row[I.lt] > 0.3) triggerBrake += dt
    })
  }
  input.forEach((row, index) => {
    const t = row[I.t]
    const state = sampleAt(t)
    const inPlay = state ? playing(state) : false
    const before = index ? input[index - 1] : null
    const pressed = row[I.btn] & ~(before ? before[I.btn] : 0)
    for (let bit = 0; bit < 20; bit++) if (pressed & (1 << bit) && inPlay) presses.set(bit, (presses.get(bit) ?? 0) + 1)
    const spaceBit = 1 << KEY_BITS.indexOf('Space')
    const jumpNow = Boolean(row[I.btn] & 1) || Boolean(row[I.keys] & spaceBit)
    if (jumpNow && jumpDownAt < 0) jumpDownAt = t
    if (!jumpNow && jumpDownAt >= 0) {
      if (inPlay) jumpHolds.push((t - jumpDownAt) / 1000)
      jumpDownAt = -1
    }
  })
  const modeEvents = eventsOf('inputmode')
  const touchTime = modeEvents.reduce((sum, event, index) => sum + (event.mode === 'touch' ? ((modeEvents[index + 1]?.t ?? seconds * 1000) - event.t) / 1000 : 0), 0)
  const lastMode = [...modeEvents].reverse().find((event) => event.pad)
  const buttons = [...presses.entries()]
    .map(([index, pressCount]) => ({ index, name: PAD_BUTTONS[index]?.name ?? `Button ${index}`, does: PAD_BUTTONS[index]?.does ?? '', presses: pressCount }))
    .sort((a, b) => b.presses - a.presses)
  const actions = count(eventsOf('action').map((event) => event.a))
  const otherKeys = count(eventsOf('key').map((event) => event.code).filter((code) => typeof code === 'string' && !MAPPED_KEYS.has(code) && !/^(Digit\d|F\d+|Meta|Alt|Control|Tab|OS)/.test(code)))

  // --- Menus and flow -----------------------------------------------------
  const menuEvents = eventsOf('menu')
  const menuStats = new Map<string, { opens: number; seconds: number }>()
  menuEvents.forEach((event, index) => {
    if (typeof event.to !== 'string' || !event.to) return
    const next = menuEvents[index + 1]
    const entry = menuStats.get(event.to) ?? { opens: 0, seconds: 0 }
    entry.opens++
    entry.seconds += ((next?.t ?? num(last ?? [0], S.t)) - event.t) / 1000
    menuStats.set(event.to, entry)
  })
  const menus = [...menuStats.entries()].map(([name, entry]) => ({ name, opens: entry.opens, seconds: round(entry.seconds) }))
  const resetList = resets.map((event) => {
    const crash = crashes.find((entry) => entry.t < event.t && entry.t > event.t - 8000)
    const stall = stalls.find((entry) => entry.t < event.t && entry.t + entry.seconds * 1000 > event.t - 1500 && entry.cause !== 'not started yet')
    const air = lands.find((entry) => entry.t < event.t && entry.t > event.t - 5000)
    return { t: event.t, after: crash ? `a crash (${crash.cause})` : stall ? `a stall (${stall.cause})` : air ? 'a jump' : 'skiing' }
  })
  // A prompt shows, then turns to `done` when the player does what it asks.
  const hintEvents = eventsOf('hint').filter((event) => typeof event.text === 'string' && event.text)
  const hints = hintEvents
    .filter((event, index) => event.state !== 'done' && hintEvents[index - 1]?.text !== event.text)
    .map((event) => {
      const done = hintEvents.find((next) => next.t > event.t && next.text === event.text && next.state === 'done')
      return { t: event.t, text: String(event.text), doneAfter: done ? round((done.t - event.t) / 1000) : null }
    })
  const cards = count(eventsOf('card').map((event) => event.title))

  // First minute: from the page loading to a few seconds of real skiing.
  const firstMinute: Analysis['firstMinute'] = []
  {
    const firstSki = samples.find((row) => playing(row) && num(row, S.spd) > 4)
    const until = firstSki ? num(firstSki, S.t) + 20000 : 90000
    const firstInput = input.find((row) => row[I.btn] || row[I.keys] || Math.abs(row[I.lx]) > 0.3 || Math.abs(row[I.ly]) > 0.3)
    const firstClick = eventsOf('click')[0]
    const ready = eventsOf('ready')[0]
    if (ready) firstMinute.push({ t: ready.t, what: 'Game loaded, title screen ready' })
    if (firstInput) firstMinute.push({ t: firstInput[I.t], what: 'First controller or key press' })
    if (firstClick) firstMinute.push({ t: firstClick.t, what: `First click: ${String(firstClick.label ?? '')}` })
    for (const event of events) {
      if (event.t > until) break
      if (event.k === 'menu') firstMinute.push({ t: event.t, what: event.to ? `Screen: ${String(event.to)}${event.view ? ` (${String(event.view)})` : ''}` : 'Into the game' })
      else if (event.k === 'film') firstMinute.push({ t: event.t, what: event.on ? 'Opening film starts' : `Opening film ends${event.skipped ? ' (skipped)' : ''}` })
      else if (event.k === 'ride') firstMinute.push({ t: event.t, what: event.on ? `On ${String(event.lift ?? 'a lift')}` : `Off the lift${event.skipped ? ' (skipped)' : ''}` })
      else if (event.k === 'crash') firstMinute.push({ t: event.t, what: 'First crash' })
      else if (event.k === 'pick') firstMinute.push({ t: event.t, what: `Picked ${String(event.what ?? '')}` })
    }
    for (const hint of hints) {
      if (hint.t > until) break
      firstMinute.push({ t: hint.t, what: `Prompt: ${hint.text}` })
      if (hint.doneAfter !== null) firstMinute.push({ t: hint.t + hint.doneAfter * 1000, what: `Did it: ${hint.text}` })
    }
    const control = samples.find((row) => playing(row))
    if (control) firstMinute.push({ t: num(control, S.t), what: 'Player has control' })
    const firstTurn = samples.find((row) => playing(row) && Math.abs(num(row, S.steer)) > 0.3)
    if (firstTurn) firstMinute.push({ t: num(firstTurn, S.t), what: 'First steering input' })
    if (firstSki) firstMinute.push({ t: num(firstSki, S.t), what: 'Moving (over 15 km/h)' })
    firstMinute.sort((a, b) => a.t - b.t)
  }

  // --- Performance --------------------------------------------------------
  const frameTimes = samples.filter((row) => playing(row) && num(row, S.fAvg) > 0).map((row) => num(row, S.fAvg))
  const fps = frameTimes.length ? 1000 / mean(frameTimes) : 0
  const fpsP5 = frameTimes.length ? 1000 / quantile(frameTimes, 0.95) : 0
  const runFrames = new Map<string, number[]>()
  for (const row of samples) {
    if (!playing(row) || num(row, S.fAvg) <= 0) continue
    const list = runFrames.get(runName(row)) ?? []
    list.push(num(row, S.fAvg))
    runFrames.set(runName(row), list)
  }
  const worstRuns = [...runFrames.entries()]
    .filter(([, list]) => list.length >= 50)
    .map(([run, list]) => ({ run, fps: Math.round(1000 / mean(list)) }))
    .sort((a, b) => a.fps - b.fps)
    .slice(0, 5)
  const errors = [...new Set(eventsOf('error').map((event) => String(event.message ?? '')))].slice(0, 10)

  const marks = eventsOf('mark').map((event) => {
    const row = sampleAt(event.t)
    const lead = samples.filter((sample) => num(sample, S.t) >= event.t - 5000 && num(sample, S.t) <= event.t)
    const notes: string[] = []
    if (lead.some((sample) => has(sample, FLAG.crashed))) notes.push('just crashed')
    if (lead.some((sample) => has(sample, FLAG.air))) notes.push('just jumped')
    if (lead.some((sample) => has(sample, FLAG.switch))) notes.push('riding switch')
    if (lead.some((sample) => num(sample, S.occl))) notes.push('rider hidden by the snow')
    if (lead.some((sample) => num(sample, S.bump) >= BUMPY)) notes.push('on bumps')
    if (lead.length && Math.max(...lead.map((sample) => num(sample, S.spd))) < 1.5) notes.push('stopped')
    return { t: event.t, x: Number(event.x ?? 0), z: Number(event.z ?? 0), run: row ? runName(row) : '', speedKmh: row ? Math.round(kmh(num(row, S.spd))) : 0, note: notes.join(', ') }
  })

  const runs = [...runStats.entries()]
    .filter(([, entry]) => entry.seconds >= 3)
    .map(([run, entry]) => ({ run: run || '(unnamed)', seconds: Math.round(entry.seconds), km: round(entry.metres / 1000, 2), avgKmh: Math.round(kmh(entry.metres / Math.max(1, entry.seconds))), topKmh: Math.round(kmh(entry.top)), crashes: entry.crashes, stalls: entry.stalls }))
    .sort((a, b) => b.seconds - a.seconds)

  const analysis: Analysis = {
    meta: session.meta,
    seconds: round(seconds),
    time: Object.fromEntries(Object.entries(time).map(([key, value]) => [key, round(value)])) as Analysis['time'],
    distanceKm: round(distance / 1000, 2),
    verticalM: Math.round(vertical),
    topSpeedKmh: Math.round(kmh(topSpeed)),
    speedKmh: { median: Math.round(kmh(quantile(speeds, 0.5))), p90: Math.round(kmh(quantile(speeds, 0.9))) },
    device: { pad: round(padTime), keys: round(keyTime), touch: round(touchTime), padName: String(lastMode?.pad ?? eventsOf('pad').find((event) => event.id)?.id ?? '') },
    firstMinute,
    runs,
    stalls,
    switches,
    spinOuts,
    crashes,
    airs,
    camera: { slices, modeChanges, worst: worst.slice(0, 40) },
    controls: {
      steerBands: steerBands.map((share) => round(share, 3)),
      reversalsPerMinute: round((reversals / skiingTime) * 60),
      tuckShare: round(tuckTime / skiingTime, 3),
      brakeShare: round(brakeTime / skiingTime, 3),
      turnWithTuck: turnTime ? round(turnTuck / turnTime, 3) : 0,
      turnWithBrake: turnTime ? round(turnBrake / turnTime, 3) : 0,
      triggerBrakeShare: round(triggerBrake / skiingTime, 3),
      rightStickSeconds: round(rightStick),
      jumpHolds: { count: jumpHolds.length, medianSeconds: round(quantile(jumpHolds, 0.5), 2), taps: jumpHolds.filter((held) => held < 0.15).length },
      buttons,
      otherKeys,
      actions,
    },
    menus,
    resets: resetList,
    hints,
    cards,
    performance: { fps: Math.round(fps), fpsP5: Math.round(fpsP5), longFrames: eventsOf('longframe').length, worstRuns, errors },
    marks,
    findings: [],
  }
  analysis.findings = findingsFor(analysis)
  return analysis
}

const pct = (share: number) => `${Math.round(share * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** The commonest values of a field, as "name (n)". */
function top<T>(items: T[], key: (item: T) => string, limit = 3): string {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, n]) => `${name || 'unnamed'} (${n})`).join(', ')
}

/** The headline list: what in this session looks like a feel problem. Thresholds are first guesses; tune them against real sessions. */
function findingsFor(a: Analysis): Finding[] {
  const out: Finding[] = []
  const minutes = Math.max(1, a.time.skiing / 60)

  const stalls = a.stalls.filter((stall) => stall.cause !== 'not started yet')
  if (stalls.length) {
    const unforced = stalls.filter((stall) => stall.cause !== 'braked to a stop')
    const reset = stalls.filter((stall) => stall.exit === 'reset').length
    out.push({
      level: unforced.length / minutes > 0.4 || reset > 1 ? 'high' : unforced.length ? 'medium' : 'info',
      area: 'stalls',
      title: `Stopped ${plural(stalls.length, 'time')} mid-run (${round(a.time.stalled)} s stuck in all)`,
      detail: `Causes: ${top(stalls, (stall) => stall.cause, 5)}. Where: ${top(stalls, (stall) => stall.run)}. ${reset ? `${plural(reset, 'stall')} ended with a restart, which reads as giving up. ` : ''}Longest: ${round(Math.max(...stalls.map((stall) => stall.seconds)))} s.`,
    })
  }
  const slowStart = a.stalls.filter((stall) => stall.cause === 'not started yet' && stall.seconds > 6)
  if (slowStart.length)
    out.push({ level: 'info', area: 'flow', title: `Stood at the start for more than 6 s ${plural(slowStart.length, 'time')}`, detail: `Longest wait ${round(Math.max(...slowStart.map((stall) => stall.seconds)))} s. Either reading the view or unsure how to get going: check against what was on screen.` })

  if (a.switches.length) {
    const short = a.switches.filter((episode) => episode.seconds < 3 && (episode.exit === 'stopped' || episode.exit === 'crashed'))
    out.push({
      level: short.length >= 2 && short.length / a.switches.length > 0.4 ? 'high' : 'info',
      area: 'switch',
      title: `Rode switch ${plural(a.switches.length, 'time')}; ${short.length} ended within 3 s by stopping or crashing`,
      detail: `Median ${round(quantile(a.switches.map((episode) => episode.seconds), 0.5))} s switch. Ended by: ${top(a.switches, (episode) => episode.exit, 4)}. Came from: ${top(a.switches, (episode) => episode.from || 'no trick scored')}.`,
    })
  }
  if (a.spinOuts.length) {
    const fromSwitch = a.spinOuts.filter((spin) => spin.switch).length
    out.push({
      level: a.spinOuts.length / minutes > 0.5 ? 'high' : 'medium',
      area: 'switch',
      title: `Skis came round sideways or backwards ${plural(a.spinOuts.length, 'time')} (${fromSwitch} while switch)`,
      detail: `That is ${round(a.spinOuts.length / minutes)} a minute of skiing. Snow: ${top(a.spinOuts, (spin) => spin.surface)}. Where: ${top(a.spinOuts, (spin) => spin.run)}. Typical speed ${Math.round(quantile(a.spinOuts.map((spin) => spin.speedKmh), 0.5))} km/h.`,
    })
  }

  if (a.crashes.length) {
    const perTen = (a.crashes.length / minutes) * 10
    const resetAfter = a.crashes.filter((crash) => crash.resetAfter).length
    out.push({
      level: perTen > 6 ? 'high' : perTen > 3 ? 'medium' : 'info',
      area: 'crashes',
      title: `${plural(a.crashes.length, 'crash', 'crashes')} (${round(perTen)} per 10 minutes of skiing)`,
      detail: `Causes: ${top(a.crashes, (crash) => crash.cause, 5)}. Where: ${top(a.crashes, (crash) => crash.run)}. On the ground ${round(mean(a.crashes.map((crash) => crash.downSeconds)))} s on average${resetAfter ? `; ${resetAfter} followed by a restart instead of getting up` : ''}.`,
    })
  }

  if (a.airs.count) {
    const bailRate = a.airs.crashed / a.airs.count
    out.push({
      level: bailRate > 0.35 ? 'high' : bailRate > 0.2 ? 'medium' : 'info',
      area: 'tricks',
      title: `${plural(a.airs.count, 'jump')}: ${a.airs.crashed} crashed (${pct(bailRate)}), ${a.airs.withSpin} with a spin, ${a.airs.withFlip} with a flip, ${a.airs.withGrab} with a grab`,
      detail: `${a.airs.charged} takeoffs used a charged pop. Landings: ${Object.entries(a.airs.grades).map(([grade, n]) => `${grade} ${n}`).join(', ') || 'none scored'}. ${a.airs.retries.length ? `Went back to the same takeoff: ${a.airs.retries.slice(0, 3).map((spot) => `${spot.run || 'unnamed'} ×${spot.attempts} (${spot.crashed} crashed)`).join(', ')}.` : ''}`,
    })
    const plain = a.airs.count - Math.max(a.airs.withSpin, a.airs.withGrab, a.airs.withFlip)
    if (a.airs.count >= 6 && plain / a.airs.count > 0.7)
      out.push({ level: 'medium', area: 'tricks', title: `${pct(plain / a.airs.count)} of jumps had no trick input`, detail: 'Either the trick controls were not found or the airs are too short to use them. Compare with the prompts shown and the median air time.' })
  }

  const all = a.camera.slices.find((entry) => entry.label === 'All skiing')
  const smooth = a.camera.slices.find((entry) => entry.label === 'Smooth snow')
  for (const entry of a.camera.slices) {
    if (entry.seconds < 4 || entry.label === 'All skiing' || entry.label === 'Smooth snow') continue
    const problems: string[] = []
    if (entry.hidden > 0.04) problems.push(`the snow hides the rider ${pct(entry.hidden)} of the time`)
    if (entry.offScreen > 0.04) problems.push(`the rider is off screen ${pct(entry.offScreen)} of the time`)
    if (smooth && smooth.seconds > 10 && entry.bounce > Math.max(0.12, smooth.bounce * 2.2)) problems.push(`the rider bounces ${round(entry.bounce / Math.max(0.01, smooth.bounce))}× as much on screen as on smooth snow`)
    if (smooth && smooth.seconds > 10 && entry.pitchRate > Math.max(8, smooth.pitchRate * 2.2)) problems.push(`the view pitches ${entry.pitchRate}°/s against ${smooth.pitchRate}°/s on smooth snow`)
    if (entry.lookingAway > 0.15) problems.push(`the view is more than 60° off the direction of travel ${pct(entry.lookingAway)} of the time`)
    if (entry.minClear < 0.5) problems.push(`the camera got within ${entry.minClear} m of the snow`)
    if (problems.length) out.push({ level: problems.length > 1 || entry.hidden > 0.1 ? 'high' : 'medium', area: 'camera', title: `Camera, ${entry.label.toLowerCase()} (${Math.round(entry.seconds)} s): ${problems[0]}`, detail: problems.slice(1).join('; ') || `Rider sits at ${entry.screenY} on screen (0 centre, -1 bottom), spread ${entry.screenYSpread}.` })
  }
  if (all && a.camera.modeChanges >= 3)
    out.push({ level: 'medium', area: 'camera', title: `Changed camera ${a.camera.modeChanges} times`, detail: 'Hunting for a view that works. See which moments came just before each change in the camera section.' })

  const c = a.controls
  if (c.turnWithBrake > 0.08) out.push({ level: 'high', area: 'controls', title: `Brake came on during ${pct(c.turnWithBrake)} of hard turns`, detail: 'The stick is drifting down while turning and catching the brake. The dead zone between turn and brake may be too small for this pad.' })
  if (c.turnWithTuck > 0.15) out.push({ level: 'medium', area: 'controls', title: `Tuck came on during ${pct(c.turnWithTuck)} of hard turns`, detail: 'The stick drifts up while turning. May be on purpose (carving in a tuck) or the same dead-zone issue as the brake.' })
  if (c.rightStickSeconds > 3) out.push({ level: 'medium', area: 'controls', title: `Moved the right stick for ${round(c.rightStickSeconds)} s`, detail: 'The right stick does nothing in the game. The player expects it to do something, most likely move the camera.' })
  const dead = c.buttons.filter((button) => !button.does && button.presses >= 2)
  if (dead.length) out.push({ level: 'medium', area: 'controls', title: `Pressed buttons that do nothing: ${dead.map((button) => `${button.name} ×${button.presses}`).join(', ')}`, detail: 'Each is a guess at where a control should be.' })
  if (c.steerBands[3] > 0.45) out.push({ level: 'medium', area: 'controls', title: `Stick at full lock ${pct(c.steerBands[3])} of the time`, detail: 'Steering is being used as on or off. Either turns need more than the stick gives, or the response curve has no useful middle.' })
  if (c.jumpHolds.count >= 5 && c.jumpHolds.taps / c.jumpHolds.count > 0.7) out.push({ level: 'info', area: 'controls', title: `${pct(c.jumpHolds.taps / c.jumpHolds.count)} of jump presses were quick taps`, detail: 'Holding to charge the pop is not being used much.' })
  const unknownKeys = Object.entries(c.otherKeys).filter(([, n]) => n >= 2)
  if (unknownKeys.length) out.push({ level: 'info', area: 'controls', title: `Keys pressed that do nothing: ${unknownKeys.map(([code, n]) => `${code} ×${n}`).join(', ')}`, detail: 'Guesses at controls that are not there.' })

  if (a.resets.length) out.push({ level: a.resets.length / minutes > 0.5 ? 'medium' : 'info', area: 'flow', title: `Restarted ${plural(a.resets.length, 'time')}`, detail: `After: ${top(a.resets, (reset) => reset.after, 4)}.` })
  const film = a.firstMinute.find((step) => step.what.startsWith('Opening film ends'))
  if (film?.what.includes('skipped')) out.push({ level: 'info', area: 'flow', title: 'Skipped the opening film', detail: `At ${clock(film.t)}.` })
  const control = a.firstMinute.find((step) => step.what === 'Player has control')
  const moving = a.firstMinute.find((step) => step.what.startsWith('Moving'))
  if (control && moving && moving.t - control.t > 12000) out.push({ level: 'medium', area: 'flow', title: `Took ${Math.round((moving.t - control.t) / 1000)} s from getting control to moving`, detail: 'The first seconds on the snow are slow: check the stalls list for the start and which prompt was up.' })

  const ignored = a.hints.filter((hint) => hint.doneAfter === null)
  if (ignored.length) out.push({ level: 'info', area: 'flow', title: `${plural(ignored.length, 'control prompt')} shown but not acted on`, detail: ignored.map((hint) => `${clock(hint.t)} "${hint.text}"`).slice(0, 6).join('; ') })
  if (a.performance.fps && a.performance.fpsP5 < 45) out.push({ level: a.performance.fpsP5 < 30 ? 'high' : 'medium', area: 'performance', title: `Frame rate ${a.performance.fps} fps on average, ${a.performance.fpsP5} fps in the slowest 5%`, detail: `${a.performance.longFrames} frames over 100 ms. Slowest areas: ${a.performance.worstRuns.map((entry) => `${entry.run || 'unnamed'} ${entry.fps} fps`).join(', ')}.` })
  if (a.performance.errors.length) out.push({ level: 'high', area: 'performance', title: `${plural(a.performance.errors.length, 'script error')}`, detail: a.performance.errors.join(' | ') })
  if (a.marks.length) out.push({ level: 'high', area: 'marks', title: `Marked ${plural(a.marks.length, 'moment')} as worth a look`, detail: a.marks.map((mark) => `${clock(mark.t)} ${mark.run || 'unnamed'}${mark.note ? ` (${mark.note})` : ''}`).join('; ') })

  const order = { high: 0, medium: 1, info: 2 }
  return out.sort((x, y) => order[x.level] - order[y.level])
}

/** The analysis as a Markdown report. */
export function report(a: Analysis): string {
  const lines: string[] = []
  const table = (head: string[], rows: (string | number)[][]) => {
    if (!rows.length) return
    lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`), '')
  }
  const where = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`
  lines.push(`# Playtest session ${a.meta.id}`, '')
  lines.push(`Version ${a.meta.version}, started ${a.meta.started}. ${clock(a.seconds * 1000)} recorded: ${clock(a.time.skiing * 1000)} skiing, ${clock(a.time.lifts * 1000)} on lifts, ${clock(a.time.menus * 1000)} in menus, ${clock(a.time.film * 1000)} of opening film.`)
  lines.push(`${a.distanceKm} km skied, ${a.verticalM} m vertical, top speed ${a.topSpeedKmh} km/h (median ${a.speedKmh.median}, 90th percentile ${a.speedKmh.p90}). Input: controller ${Math.round(a.device.pad)} s, keyboard ${Math.round(a.device.keys)} s${a.device.padName ? ` (${a.device.padName})` : ''}.`, '')

  lines.push('## Findings', '')
  if (!a.findings.length) lines.push('Nothing stood out against the current thresholds.', '')
  for (const finding of a.findings) lines.push(`- **${finding.level.toUpperCase()} · ${finding.area}: ${finding.title}.** ${finding.detail}`)
  lines.push('')

  if (a.marks.length) {
    lines.push('## Marked moments', '')
    table(['Time', 'Run', 'Where (x,z)', 'km/h', 'Context'], a.marks.map((mark) => [clock(mark.t), mark.run, where(mark.x, mark.z), mark.speedKmh, mark.note]))
  }

  lines.push('## First minute', '')
  table(['Time', 'What'], a.firstMinute.map((step) => [clock(step.t), step.what]))

  lines.push('## Stalls and stops', '')
  table(['Time', 'Seconds', 'Run', 'Where (x,z)', 'Slope °', 'Snow', 'Off fall line °', 'Cause', 'Ended by'], a.stalls.map((stall) => [clock(stall.t), stall.seconds, stall.run, where(stall.x, stall.z), stall.pitchDeg, stall.surface, stall.offFallLineDeg ?? '', stall.cause, stall.exit]))

  lines.push('## Switch riding and spin-outs', '')
  table(['Time', 'Seconds', 'Run', 'In km/h', 'Out km/h', 'From', 'Ended by'], a.switches.map((episode) => [clock(episode.t), episode.seconds, episode.run, episode.entrySpeedKmh, episode.exitSpeedKmh, episode.from, episode.exit]))
  table(['Time', 'Seconds', 'Run', 'Where (x,z)', 'km/h', 'Switch', 'Snow', 'Max slip °'], a.spinOuts.map((spin) => [clock(spin.t), spin.seconds, spin.run, where(spin.x, spin.z), spin.speedKmh, spin.switch ? 'yes' : '', spin.surface, spin.maxSlipDeg]))

  lines.push('## Crashes', '')
  table(['Time', 'Run', 'Where (x,z)', 'km/h', 'Cause', 'Down s', 'Restarted'], a.crashes.map((crash) => [clock(crash.t), crash.run, where(crash.x, crash.z), crash.speedKmh, crash.cause, crash.downSeconds, crash.resetAfter ? 'yes' : '']))

  lines.push('## Jumps and tricks', '')
  lines.push(`${a.airs.count} jumps (median ${a.airs.medianSeconds} s in the air), ${a.airs.charged} charged takeoffs; with a spin ${a.airs.withSpin}, a flip ${a.airs.withFlip}, a grab ${a.airs.withGrab}; crashed ${a.airs.crashed}.`, '')
  table(['Trick', 'Count'], Object.entries(a.airs.tricks).sort((x, y) => y[1] - x[1]).slice(0, 15))
  table(['Takeoff (x,z)', 'Run', 'Attempts', 'Crashed'], a.airs.retries.map((spot) => [where(spot.x, spot.z), spot.run, spot.attempts, spot.crashed]))

  lines.push('## Camera', '')
  table(
    ['When', 'Seconds', 'Rider hidden', 'Off screen', 'Screen y', 'Spread', 'Bounce /s', 'Pitch °/s', 'Looking away', 'Min clearance m'],
    a.camera.slices.map((entry) => [entry.label, Math.round(entry.seconds), pct(entry.hidden), pct(entry.offScreen), entry.screenY, entry.screenYSpread, entry.bounce, entry.pitchRate, pct(entry.lookingAway), entry.minClear]),
  )
  lines.push(`Camera view changed ${a.camera.modeChanges} times.`, '')
  table(['Time', 'Run', 'Where (x,z)', 'What'], a.camera.worst.map((entry) => [clock(entry.t), entry.run, where(entry.x, entry.z), entry.why]))

  lines.push('## Controls', '')
  const c = a.controls
  lines.push(`Stick: centred ${pct(c.steerBands[0])}, light ${pct(c.steerBands[1])}, firm ${pct(c.steerBands[2])}, full lock ${pct(c.steerBands[3])} of skiing time. ${c.reversalsPerMinute} turn changes a minute.`)
  lines.push(`Tuck ${pct(c.tuckShare)}, brake ${pct(c.brakeShare)} of the time (trigger brake ${pct(c.triggerBrakeShare)}). In hard turns: tuck on ${pct(c.turnWithTuck)}, brake on ${pct(c.turnWithBrake)}. Right stick moved for ${c.rightStickSeconds} s.`)
  lines.push(`Jump presses: ${c.jumpHolds.count}, median hold ${c.jumpHolds.medianSeconds} s, ${c.jumpHolds.taps} quick taps.`, '')
  table(['Button', 'Does', 'Presses'], c.buttons.map((button) => [button.name, button.does || 'nothing', button.presses]))
  table(['Action', 'Count'], Object.entries(c.actions))

  lines.push('## Runs', '')
  table(['Run', 'Time', 'km', 'Avg km/h', 'Top km/h', 'Crashes', 'Stalls'], a.runs.map((run) => [run.run, clock(run.seconds * 1000), run.km, run.avgKmh, run.topKmh, run.crashes, run.stalls]))

  lines.push('## Menus, restarts and prompts', '')
  table(['Screen', 'Opened', 'Seconds'], a.menus.map((menu) => [menu.name, menu.opens, menu.seconds]))
  table(['Restart at', 'After'], a.resets.map((reset) => [clock(reset.t), reset.after]))
  table(['Prompt shown at', 'Text', 'Done after s'], a.hints.map((hint) => [clock(hint.t), hint.text, hint.doneAfter ?? 'not done']))

  lines.push('## Performance', '')
  lines.push(`${a.performance.fps} fps on average while skiing, ${a.performance.fpsP5} fps in the slowest 5%, ${a.performance.longFrames} frames over 100 ms. Graphics: ${String(a.meta.quality ?? '')}.`, '')
  table(['Slowest areas', 'fps'], a.performance.worstRuns.map((entry) => [entry.run, entry.fps]))
  if (a.performance.errors.length) lines.push('Errors:', ...a.performance.errors.map((message) => `- ${message}`), '')
  return lines.join('\n')
}
