/**
 * Challenge rules with no rendering: medal targets, the pace bot that sets
 * run times, slalom gates, progress along a run, and gold nugget placement.
 */
import { FIXED_DT, createSkiState, stepSkier, type SampleTerrain, type SkiEnv } from '../sim'
import { LAYOUTS } from './park'
import { headingFor, pointAlong, polylineLength, runHalfWidth, type Point2, type Resort, type Run } from './resort'

export type Medal = 'gold' | 'silver' | 'bronze'
export const MEDALS: Medal[] = ['gold', 'silver', 'bronze']
export const MEDAL_RANK: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1 }

/** Seconds for timed challenges (lower is better), points for score attacks (higher is better). */
export interface MedalTargets {
  gold: number
  silver: number
  bronze: number
}

export function medalForTime(time: number, targets: MedalTargets): Medal | null {
  return MEDALS.find((medal) => time <= targets[medal]) ?? null
}

export function medalForScore(score: number, targets: MedalTargets): Medal | null {
  return MEDALS.find((medal) => score >= targets[medal]) ?? null
}

export function betterMedal(a: Medal | null | undefined, b: Medal | null | undefined): Medal | null {
  if (!a) return b ?? null
  if (!b) return a
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b
}

/** The pace bot's time sets gold; silver and bronze give 20 and 50 percent more. Rounded up to 0.5 s. */
export function timeTargets(botSeconds: number): MedalTargets {
  const up = (s: number) => Math.ceil(s * 2) / 2
  return { gold: up(botSeconds), silver: up(botSeconds * 1.2), bronze: up(botSeconds * 1.5) }
}

/** The longest polyline of a run: the one timed challenges use. */
export function mainLine(run: Run): Point2[] {
  return run.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
}

/** The line from `start` metres along to its end. */
export function trimLine(line: Point2[], start: number): Point2[] {
  if (start <= 0) return line
  const out: Point2[] = [pointAlong(line, start)]
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    travelled += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    if (travelled > start + 0.5) out.push(line[i])
  }
  return out.length > 1 ? out : line
}

/**
 * A challenge course: the run's main line, starting at least `minStart`
 * metres down (clear of the lift terminal and the hut) at the first spot
 * where `blocked` finds nothing within 4 m.
 */
export function courseLine(line: Point2[], blocked: (x: number, z: number) => boolean, minStart = 15): Point2[] {
  const total = polylineLength(line)
  for (let s = minStart; s < Math.min(90, total * 0.4); s += 5) {
    const [x, z] = pointAlong(line, s)
    const clear = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].every(([dx, dz]) => !blocked(x + dx, z + dz))
    if (clear) return trimLine(line, s)
  }
  return trimLine(line, minStart)
}

/** Timed runs start on the first point and finish within this many metres of the last. */
export const FINISH_RADIUS = 15
/** Runs shorter than this are not worth a timed challenge. */
export const MIN_TIMED_LENGTH = 180

export const BOT_SPEED_CAP = 22

/**
 * The pace bot: from a standstill on the first point, steer at a point 25 m
 * ahead on the line, tuck below 70 percent of the cap and brake above it.
 * A generator so the game can spread the work over frames; returns the
 * finishing time, or null when the bot gets stuck or leaves the map.
 */
export function* paceBot(
  line: Point2[],
  terrain: SampleTerrain,
  env: SkiEnv,
  cap = BOT_SPEED_CAP,
  maxSeconds = 420,
  stepsPerYield = 240,
): Generator<void, number | null> {
  const [x0, z0] = line[0]
  const [x1, z1] = line[Math.min(3, line.length - 1)]
  const s = createSkiState({ x: x0, z: z0, heading: headingFor(x1 - x0, z1 - z0) })
  const ground = terrain(x0, z0)
  if (!ground) return null
  s.y = ground.height
  const [ex, ez] = line[line.length - 1]
  let nearest = 0
  let steps = 0
  for (let t = 0; t < maxSeconds; t += FIXED_DT) {
    // The nearest vertex only moves forward, so search a short window ahead of the last one.
    let best = Infinity
    for (let i = nearest, end = Math.min(line.length, nearest + 12); i < end; i++) {
      const d = (line[i][0] - s.x) ** 2 + (line[i][1] - s.z) ** 2
      if (d < best) ((best = d), (nearest = i))
    }
    let k = nearest
    for (let ahead = 0; k < line.length - 1 && ahead < 25; k++) ahead += Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])
    const want = headingFor(line[k][0] - s.x, line[k][1] - s.z)
    const error = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading))
    const steer = s.grounded ? Math.max(-1, Math.min(1, error * 2.5)) : 0
    stepSkier(s, { steer, brake: s.speed > cap ? 1 : 0, tuck: s.speed < cap * 0.7 }, terrain, FIXED_DT, env)
    if (s.offMap) return null
    if (Math.hypot(ex - s.x, ez - s.z) < FINISH_RADIUS) return t
    if (++steps % stepsPerYield === 0) yield
  }
  return null
}

/** Run the pace bot to the end in one go. */
export function paceBotSync(line: Point2[], terrain: SampleTerrain, env: SkiEnv, cap = BOT_SPEED_CAP): number | null {
  const bot = paceBot(line, terrain, env, cap, 420, Infinity)
  let step = bot.next()
  while (!step.done) step = bot.next()
  return step.value
}

/**
 * Par points per feature for park score attacks: about one clean, grabbed,
 * mid-sized trick. Gold needs combos; bronze is roughly landing half the line.
 * Provisional until playtested.
 */
const FEATURE_PAR: Record<string, number> = {
  kickerS: 450,
  kickerM: 750,
  kickerL: 1000,
  kickerXL: 1400,
  rollerS: 150,
  rollerL: 300,
  box: 400,
  rail: 450,
  downRail: 550,
  flatDownRail: 550,
  stepDown: 450,
}

export function parkTargets(layoutId: string): MedalTargets {
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  const ids = layout.features.flatMap((slot) => (Array.isArray(slot) ? slot : [slot]))
  const par = ids.reduce((sum, id) => sum + (FEATURE_PAR[id] ?? 300), 0)
  const round = (n: number) => Math.round(n / 50) * 50
  return { gold: round(par * 2.5), silver: round(par * 1.4), bronze: round(par * 0.6) }
}

/** A slalom gate: a pair of poles across the line. Ski between them. */
export interface Gate {
  /** Gate centre. */
  x: number
  z: number
  /** Unit direction of travel at the gate. */
  dirX: number
  dirZ: number
  /** Which side of the run line the gate is set to: -1 left, 1 right. */
  side: -1 | 1
  /** Distance along the line, metres. */
  s: number
  /** Pole spacing either side of the centre; GATE_HALF_WIDTH when unset. */
  halfWidth?: number
}

/** Pole spacing either side of the gate centre. */
export const GATE_HALF_WIDTH = 3
/** Each missed gate adds this many seconds. */
export const GATE_PENALTY = 3

/**
 * Gates every `spacing` metres from `start` to 30 m before the end, set
 * alternately left and right of the line by `offset` so the course needs
 * a turn at each gate.
 */
export function buildSlalom(line: Point2[], options: { start?: number; spacing?: number; offset?: number } = {}): Gate[] {
  const { start = 25, spacing = 28, offset = 5 } = options
  const total = polylineLength(line)
  const gates: Gate[] = []
  let side: -1 | 1 = 1
  for (let s = start; s <= total - 30; s += spacing) {
    const [ax, az] = pointAlong(line, s - 2)
    const [bx, bz] = pointAlong(line, s + 2)
    const length = Math.hypot(bx - ax, bz - az) || 1
    const dirX = (bx - ax) / length
    const dirZ = (bz - az) / length
    const [cx, cz] = pointAlong(line, s)
    // Offset along the perpendicular (dirZ, -dirX); the side only needs to alternate.
    gates.push({ x: cx + side * offset * dirZ, z: cz - side * offset * dirX, dirX, dirZ, side, s })
    side = side === 1 ? -1 : 1
  }
  return gates
}

/**
 * Did the move from (px, pz) to (x, z) cross the gate's line? 'pass' when
 * between the poles, 'miss' when outside them, null when not crossed yet.
 * Only crossings in the direction of travel count.
 */
export function gateCrossing(px: number, pz: number, x: number, z: number, gate: Gate): 'pass' | 'miss' | null {
  const lateral = gateLateral(px, pz, x, z, gate)
  if (lateral === null) return null
  return Math.abs(lateral) <= (gate.halfWidth ?? GATE_HALF_WIDTH) ? 'pass' : 'miss'
}

/**
 * Where across the gate line the move from (px, pz) to (x, z) crossed it,
 * metres along (dirZ, -dirX) from the gate centre, or null when it did not
 * cross in the direction of travel.
 */
export function gateLateral(px: number, pz: number, x: number, z: number, gate: Gate): number | null {
  const before = (px - gate.x) * gate.dirX + (pz - gate.z) * gate.dirZ
  const after = (x - gate.x) * gate.dirX + (z - gate.z) * gate.dirZ
  if (!(before < 0 && after >= 0)) return null
  const t = before / (before - after)
  const cx = px + (x - px) * t - gate.x
  const cz = pz + (z - pz) * t - gate.z
  return cx * gate.dirZ - cz * gate.dirX
}

/** Distance along a polyline of the nearest point, and how far off the line the point is. */
export function progressAlong(x: number, z: number, line: Point2[]): { s: number; off: number } {
  let bestSq = Infinity
  let bestS = 0
  let travelled = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz
    const length = Math.sqrt(lengthSq)
    if (!lengthSq) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
    const d = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2
    if (d < bestSq) {
      bestSq = d
      bestS = travelled + t * length
    }
    travelled += length
  }
  return { s: bestS, off: Math.sqrt(bestSq) }
}

export interface Nugget {
  id: string
  x: number
  z: number
}

/**
 * Hidden gold nuggets, the same every load: just off the edges of named
 * runs, in the trees or the margins, at least 150 m apart. `blocked`
 * rejects spots inside trunks or buildings.
 */
export function placeNuggets(
  runs: Run[],
  bounds: { width: number; depth: number },
  blocked: (x: number, z: number) => boolean,
  count = 12,
  seed = 1851,
): Nugget[] {
  let state = seed
  const random = () => ((state = (state * 16807) % 2147483647) / 2147483647)
  const candidates = runs.filter((run) => polylineLength(mainLine(run)) > 250)
  const nuggets: Nugget[] = []
  for (let attempt = 0; attempt < count * 60 && nuggets.length < count && candidates.length; attempt++) {
    const run = candidates[Math.floor(random() * candidates.length)]
    const line = mainLine(run)
    const total = polylineLength(line)
    const s = total * (0.15 + random() * 0.75)
    const [ax, az] = pointAlong(line, s - 3)
    const [bx, bz] = pointAlong(line, s + 3)
    const length = Math.hypot(bx - ax, bz - az) || 1
    const side = random() < 0.5 ? -1 : 1
    const out = runHalfWidth(run) + 6 + random() * 22
    const [cx, cz] = pointAlong(line, s)
    const x = cx + side * out * ((bz - az) / length)
    const z = cz - side * out * ((bx - ax) / length)
    if (x < 20 || z < 20 || x > bounds.width - 20 || z > bounds.depth - 20) continue
    if (blocked(x, z)) continue
    if (nuggets.some((n) => Math.hypot(n.x - x, n.z - z) < 150)) continue
    nuggets.push({ id: `n${nuggets.length + 1}`, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 })
  }
  return nuggets
}

/** A run counts as skied once this share of its length has been covered while on it. */
export const SKIED_SHARE = 0.5

export function runLengths(resort: Resort): Map<string, number> {
  const lengths = new Map<string, number>()
  for (const run of resort.runs) {
    if (run.kind !== 'line' || run.name === 'Unnamed run') continue
    lengths.set(run.name, Math.max(lengths.get(run.name) ?? 0, polylineLength(mainLine(run))))
  }
  return lengths
}
