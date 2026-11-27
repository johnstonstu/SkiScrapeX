import type { Rail, SampleTerrain } from '../sim'
import { pointAlong, polylineLength, type Point2 } from './resort'

/**
 * Terrain park features. Each feature is an analytic height overlay (added
 * to the LiDAR ground inside `sampleTerrain`) and/or a rail polyline.
 * Features are placed along a park line from a swappable layout preset.
 *
 * Kicker shapes follow the jump-design notes in
 * game/research/ski-physics-and-freestyle.md: circular transition to the
 * lip, straight last stretch, flat deck, landing under about 30 degrees.
 */
export type FeatureKind = 'kicker' | 'roller' | 'box' | 'rail' | 'downRail' | 'flatDownRail' | 'stepDown'

export interface FeatureSpec {
  kind: FeatureKind
  /** Label shown on the sign, e.g. "Medium tabletop". */
  label: string
  /** Kicker / step-down: lip height, lip angle, deck length, landing angle. */
  height?: number
  lipDeg?: number
  deck?: number
  landingDeg?: number
  /** Width of a jump or roller, or length of a rail or box. */
  width?: number
  length?: number
}

export interface PlacedFeature {
  spec: FeatureSpec
  /** Local origin on the park line and the downhill direction. */
  x: number
  z: number
  dirX: number
  dirZ: number
  /** Distance along the feature axis it occupies, metres. */
  footprint: number
  /** Half width across the axis. */
  halfWidth: number
  /** Fall of the ground along the axis, degrees (set when the overlay is built). */
  baseDeg?: number
  /** Lane: 0 is the main line on the park's drop-in axis, 1 left of it, 2 right. */
  lane?: number
  /** Jumps, set when the overlay is built: the lip in world space, where the deck ends (knuckle) and the landing ends (toe), metres along the axis. */
  lip?: { x: number; y: number; z: number }
  knuckle?: number
  toe?: number
  /** Jumps: lip speeds (m/s) that land between the knuckle and the toe, from the shape on this slope. */
  window?: [number, number]
}

/** Size presets for kickers, from small (about 4 m gap) to the Claim Jumper's big line. */
export const KICKERS: Record<'S' | 'M' | 'L' | 'XL', FeatureSpec> = {
  S: { kind: 'kicker', label: 'Small tabletop', height: 1.1, lipDeg: 10, deck: 3, landingDeg: 26, width: 5 },
  M: { kind: 'kicker', label: 'Medium tabletop', height: 1.7, lipDeg: 16, deck: 6, landingDeg: 29, width: 6 },
  L: { kind: 'kicker', label: 'Large tabletop', height: 2.4, lipDeg: 20, deck: 9, landingDeg: 31, width: 7 },
  XL: { kind: 'kicker', label: 'XL gap jump', height: 3.2, lipDeg: 23, deck: 13, landingDeg: 32, width: 8 },
}

/** Claim Jumper's biggest table: more lip, a longer gap and a long, steep landing for real air. */
export const PRO_KICKER: FeatureSpec = { kind: 'kicker', label: 'Pro gap jump', height: 3.8, lipDeg: 25, deck: 16, landingDeg: 33, width: 9 }

/**
 * Quarter-pipe step-over: a short, steep, curved kick that throws you up more
 * than out, over a deck onto a landing (Prospector).
 */
export const STEP_OVER: FeatureSpec = { kind: 'kicker', label: 'Quarter-pipe step-over', height: 2.2, lipDeg: 36, deck: 5, landingDeg: 30, width: 7 }

export const FEATURES: Record<string, FeatureSpec> = {
  ...Object.fromEntries(Object.entries(KICKERS).map(([k, v]) => [`kicker${k}`, v])),
  rollerS: { kind: 'roller', label: 'Roller', height: 1.5, length: 12, width: 8 },
  rollerL: { kind: 'roller', label: 'Big roller', height: 3, length: 30, width: 10 },
  box: { kind: 'box', label: 'Flat box', height: 0.6, length: 7, width: 0.5 },
  rail: { kind: 'rail', label: 'Flat rail', height: 0.8, length: 7, width: 0.08 },
  downRail: { kind: 'downRail', label: 'Down rail', height: 1.4, length: 9, width: 0.08 },
  flatDownRail: { kind: 'flatDownRail', label: 'Flat-down rail', height: 1.1, length: 10, width: 0.08 },
  stepDown: { kind: 'stepDown', label: 'Step-down', height: 1.2, lipDeg: 20, deck: 3, landingDeg: 26, width: 7 },
  kickerPro: PRO_KICKER,
  stepOver: STEP_OVER,
}

/**
 * One feature, or a row of side-by-side choices. In a row the first feature
 * is the main line, on the park's drop-in axis; the second sits in the lane
 * to the rider's left and the third in the lane to the right. Every park
 * keeps the same plan (Stu, 2026-11-27): ride straight and the main line
 * flows from feature to feature with no turning; the left lane is the jib
 * line and the right lane the bigger jumps, a turn away.
 */
export type LayoutSlot = string | string[]

export interface ParkLayout {
  id: string
  label: string
  features: LayoutSlot[]
}

/** Swappable lineups. Each park picks one; the menu can switch them live. */
export const LAYOUTS: ParkLayout[] = [
  { id: 'jumps', label: 'Jump line', features: ['kickerS', 'kickerM', 'kickerL'] },
  {
    id: 'big',
    label: 'Big air',
    features: ['rollerS', ['kickerM', 'kickerS', 'kickerL'], ['kickerL', 'box', 'kickerXL'], ['kickerL', 'rail', 'kickerXL'], ['kickerXL', 'downRail', 'kickerPro']],
  },
  { id: 'jib', label: 'Jib line', features: ['box', 'rail', 'downRail', 'flatDownRail'] },
  { id: 'mixed', label: 'Mixed', features: ['rollerS', 'kickerM', 'box', 'rail', 'kickerL', 'downRail'] },
  { id: 'rollers', label: 'Rollers', features: ['rollerS', 'rollerS', 'rollerL', 'rollerS', 'stepDown'] },
  { id: 'progression', label: 'Progression', features: ['rollerS', 'kickerS', 'box', 'kickerS', 'rail'] },
  {
    id: 'lanes',
    label: 'Lane choice',
    features: [
      'rollerS',
      ['kickerS', 'box', 'kickerM'],
      ['kickerM', 'rail', 'kickerL'],
      ['kickerM', 'flatDownRail', 'kickerL'],
      ['kickerL', 'downRail', 'kickerXL'],
    ],
  },
  // Stu (2026-11-24): every station offers two or three features to choose from.
  {
    id: 'claimJumper',
    label: 'Claim Jumper',
    // The XL line: straight down the middle through ever bigger tables, rails on the left, pro jumps on the right.
    features: [
      ['kickerM', 'rail', 'kickerL'],
      ['kickerL', 'downRail', 'kickerXL'],
      ['kickerXL', 'flatDownRail', 'kickerPro'],
      ['kickerXL', 'downRail', 'kickerPro'],
      ['kickerPro', 'rail', 'kickerPro'],
    ],
  },
  {
    id: 'prospector',
    label: 'Prospector',
    // Progression: jumps and jibs take turns down the main line, all jibs on the left, a step-over on the right.
    features: [
      ['box', 'rail', 'kickerS'],
      ['kickerS', 'box', 'kickerM'],
      ['rail', 'downRail', 'stepOver'],
      ['kickerM', 'box', 'kickerL'],
      ['flatDownRail', 'downRail', 'kickerM'],
      ['kickerM', 'rail', 'kickerL'],
    ],
  },
  {
    id: 'aerial',
    label: 'Aerial Site',
    // The aerials venue: kickers down the middle, a softer line left, the big tables right.
    features: [['kickerM', 'kickerS', 'kickerL'], ['kickerL', 'kickerM', 'kickerXL'], ['kickerL', 'kickerM', 'kickerXL']],
  },
  {
    id: 'okanagan',
    label: 'Okanagan',
    features: [
      ['rollerS', 'box', 'rollerL'],
      ['kickerS', 'rail', 'kickerM'],
      ['box', 'downRail', 'kickerM'],
      ['kickerM', 'rail', 'kickerL'],
      ['rail', 'box', 'kickerM'],
      ['kickerM', 'flatDownRail', 'kickerL'],
    ],
  },
  {
    id: 'nuggets',
    label: 'Little Nuggets',
    features: [['rollerS', 'box', 'rollerS'], ['box', 'rollerS', 'rail'], ['kickerS', 'box', 'rollerS']],
  },
]

/** Lane names for the HUD and signs, by lane index. */
export const LANE_NAMES = ['Main line', 'Left lane', 'Right lane'] as const

/**
 * Apex parks from the OSM terrain-park ways. Unnamed ways are matched by OSM
 * way id against the resort map (T-Bar area), not by length.
 */
export interface ParkSite {
  id: string
  name: string
  line: Point2[]
  layout: string
  /**
   * The straight drop-in axis the features sit on (see `dropInLine`): the
   * rider starts at its top, facing straight down it, already rolling.
   */
  featureLine?: Point2[]
}

export const DEFAULT_LAYOUT: Record<string, string> = {
  'Claim Jumper': 'claimJumper',
  Prospector: 'prospector',
  'Aerial Site': 'aerial',
  'Okanagan Park': 'okanagan',
  'Little Nuggets': 'nuggets',
  'Boarder Cross': 'rollers',
}

/** Official names for OSM park ways that lack a name tag (or use a generic one). */
export const PARK_WAY_NAMES: Record<string, string> = {
  'way/374339369': 'Okanagan Park',
  // Stu: this park is the aerial site; Prospector is the blue run beside Claim Jumper (trace L2).
  'way/374339370': 'Aerial Site',
  'way/1105323712': 'Little Nuggets',
  'way/374339381': 'Claim Jumper',
  'way/374339374': 'Boarder Cross',
}

export function parkSitesFromLines(
  lines: { name: string | null; line: Point2[]; osmId: string }[],
  heightAt?: (x: number, z: number) => number,
): ParkSite[] {
  return lines.map((l) => {
    const fromWay = PARK_WAY_NAMES[l.osmId]
    const name = fromWay ?? (l.name === 'Park' ? 'Little Nuggets' : l.name ?? 'Park')
    const site: ParkSite = { id: l.osmId, name, line: l.line, layout: DEFAULT_LAYOUT[name] ?? 'mixed' }
    site.featureLine = straightAxis(l.line, heightAt)
    return site
  })
}

/** The drop-in axis from the terrain when there is one, else the chord from the park's start to its end. */
function straightAxis(line: Point2[], heightAt?: (x: number, z: number) => number, avoid: Point2[][] = []): Point2[] {
  const found = heightAt ? dropInLine(line, heightAt, { avoid }) : null
  return found ?? [line[0], line[line.length - 1]]
}

/** Least distance between two parks' drop-in axes, metres: room for both parks' outer lanes and their features. */
export const PARK_CLEARANCE = 34

/** Distance from a point to a polyline, metres. */
function distanceToLine(line: Point2[], x: number, z: number): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const dx = bx - ax
    const dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z))
  }
  return best
}

/**
 * The straight drop-in line for a park: the longest chord of its mapped line
 * that stays within `maxDev` metres of it and falls all the way down (no flat
 * or uphill stretch), so the rider drops in on one axis and can hit the main
 * line of features without turning. Null when nothing straight is long enough.
 */
export function dropInLine(
  line: Point2[],
  heightAt: (x: number, z: number) => number,
  options: { maxDev?: number; minDeg?: number; minLength?: number; maxFlat?: number; avoid?: Point2[][]; clearance?: number } = {},
): Point2[] | null {
  const { avoid = [], clearance = PARK_CLEARANCE } = options
  const tooClose = (x: number, z: number) => avoid.some((other) => distanceToLine(other, x, z) < clearance)
  // A short flat (a natural deck, as on the Aerial Site) is allowed if the line falls steadily overall.
  const { maxDev = 16, minDeg = 4, minLength = 80, maxFlat = 20 } = options
  const total = polylineLength(line)
  const step = 5
  const pts: Point2[] = []
  for (let s = 0; s <= total; s += step) pts.push(pointAlong(line, s))
  const minDrop = Math.tan((minDeg * Math.PI) / 180) * 10
  let best: [number, number] | null = null
  let bestLength = minLength
  for (let i = 0; i < pts.length; i++) {
    for (let j = pts.length - 1; j > i; j--) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[j]
      const length = Math.hypot(bx - ax, bz - az)
      if (length <= bestLength) break
      const dx = (bx - ax) / length
      const dz = (bz - az) / length
      let ok = true
      for (let k = i + 1; k < j && ok; k++) if (Math.abs(-(pts[k][0] - ax) * dz + (pts[k][1] - az) * dx) > maxDev) ok = false
      // Falls the whole way: every 10 m along the chord drops at least `minDeg`, but for up to `maxFlat` m of level ground.
      let flat = 0
      for (let u = 0; u + 10 <= length && ok; u += 5) {
        const h0 = heightAt(ax + dx * u, az + dz * u)
        const h1 = heightAt(ax + dx * (u + 10), az + dz * (u + 10))
        if (!(h0 - h1 >= minDrop)) {
          flat += 5
          if (!(h0 - h1 >= -0.2) || flat > maxFlat) ok = false
        }
      }
      if (ok && heightAt(ax, az) - heightAt(bx, bz) < Math.tan((8 * Math.PI) / 180) * length) ok = false
      // Keep clear of a neighbouring park's lanes.
      for (let u = 0; u <= length && ok && avoid.length; u += 5) if (tooClose(ax + dx * u, az + dz * u)) ok = false
      if (ok) {
        best = [i, j]
        bestLength = length
        break
      }
    }
  }
  return best ? [pts[best[0]], pts[best[1]]] : null
}

/** A park laid on a run line, drawn downhill, its axis from that line. */
export function parkOnRun(name: string, line: Point2[], heightAt: (x: number, z: number) => number): ParkSite {
  const downhill = heightAt(...line[0]) >= heightAt(...line[line.length - 1]) ? line : [...line].reverse()
  return { id: `run/${name}`, name, line: downhill, layout: DEFAULT_LAYOUT[name] ?? 'mixed', featureLine: straightAxis(downhill, heightAt) }
}

/**
 * A park side by side with another (Prospector on Claim Jumper's skier's
 * left, as at Apex): its axis runs parallel to the neighbour's,
 * `PARK_CLEARANCE` metres over (`side` -1 left, +1 right), from the top for
 * at most `maxLength` metres and only as far as it keeps falling. `line` is
 * the mapped run, kept for the park snow and the trail map.
 */
export function parkBeside(
  name: string,
  line: Point2[],
  neighbour: ParkSite,
  heightAt: (x: number, z: number) => number,
  side: -1 | 1 = -1,
  maxLength = 230,
): ParkSite {
  const site = parkOnRun(name, line, heightAt)
  const axis = neighbour.featureLine ?? [neighbour.line[0], neighbour.line[neighbour.line.length - 1]]
  const [ax, az] = axis[0]
  const [bx, bz] = axis[axis.length - 1]
  const length = Math.hypot(bx - ax, bz - az)
  const dx = (bx - ax) / length
  const dz = (bz - az) / length
  // Right of travel is (-dz, dx).
  const ox = -dz * side * PARK_CLEARANCE
  const oz = dx * side * PARK_CLEARANCE
  const span = Math.min(length, maxLength)
  const offset: Point2[] = [[ax + ox, az + oz], [ax + ox + dx * span, az + oz + dz * span]]
  site.featureLine = dropInLine(offset, heightAt, { maxDev: 1, minLength: 60 }) ?? offset
  return site
}

/** Speed the rider drops into a park with, m/s (about 22 km/h): rolling, never a standing start. */
export const DROP_IN_SPEED = 6

/** Where a park run starts: the top of its drop-in axis, facing straight down it, with the drop-in speed. */
export function dropInSpawn(site: ParkSite): { x: number; z: number; heading: number; speed: number } {
  const axis = site.featureLine ?? site.line
  const [x, z] = axis[0]
  const [ax, az] = pointAlong(axis, 10)
  return { x, z, heading: Math.atan2(-(ax - x), az - z), speed: DROP_IN_SPEED }
}

/**
 * Lay a lineup on the park's drop-in axis. With the terrain, rows are paced:
 * each sits where a rider coming straight down the main line with no input
 * reaches its lip at a speed that lands it (see `pacedRows`).
 */
export function placeFeatures(site: ParkSite, layoutId: string, heightAt?: (x: number, z: number) => number): PlacedFeature[] {
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  const line = site.featureLine ?? site.line
  return placeLineup(line, layout.features, undefined, heightAt ? { heightAt, entrySpeed: DROP_IN_SPEED } : undefined)
}

/** The demo park's lineup: a long progression from rollers to XL jumps, with a jib between most kickers. */
export const DEMO_LINEUP: LayoutSlot[] = [
  'rollerS', 'kickerS', 'box', 'kickerS', 'rail', 'rollerS', 'kickerM', 'flatDownRail', 'kickerM', 'downRail',
  'rollerL', 'kickerM', 'box', 'stepDown', 'kickerL', 'rail', 'kickerL', 'downRail', 'rollerS', 'kickerL',
  'flatDownRail', 'kickerXL', 'rollerS', 'kickerXL',
]

/** Lateral gap between side-by-side lane choices, metres. */
export const LANE_SPACING = 9

/** Offset of a lane from the main line, metres to the rider's right: main 0, left -9, right +9. */
export function laneOffset(lane: number): number {
  return lane === 0 ? 0 : lane === 1 ? -LANE_SPACING : LANE_SPACING
}

/** Pacing input for `placeLineup`: the ground under the line and the speed the rider starts with. */
export interface Pacing {
  heightAt: (x: number, z: number) => number
  entrySpeed: number
}

/** Metres of run-in from the drop-in to the first feature, and the least room between features. */
const RUN_IN = 24
const MIN_GAP = 10

/**
 * Lay feature ids along a line. A slot may be a row of side-by-side choices
 * (main line first, then left and right lanes). Without pacing the rows are
 * spread evenly with at least `gap` metres between them.
 */
export function placeLineup(line: Point2[], featureIds: LayoutSlot[], gap?: number, pacing?: Pacing): PlacedFeature[] {
  const total = polylineLength(line)
  const rows = featureIds
    .map((slot) => (Array.isArray(slot) ? slot : [slot]).map((id) => FEATURES[id]).filter(Boolean))
    .filter((row) => row.length > 0)
  const footprints = rows.map((row) => Math.max(...row.map((spec) => footprintOf(spec))))
  let starts: number[]
  if (pacing) starts = pacedRows(line, rows, pacing)
  else {
    const used = footprints.reduce((a, b) => a + b, 0)
    gap ??= Math.max(14, (total - 40 - used) / Math.max(1, rows.length))
    starts = []
    let at = 32
    for (let i = 0; i < rows.length; i++) {
      if (at + footprints[i] > total - 5) break
      starts.push(at)
      at += footprints[i] + gap
    }
  }
  const placed: PlacedFeature[] = []
  starts.forEach((at, i) => {
    const row = rows[i]
    const [x, z] = pointAlong(line, at)
    const [x2, z2] = pointAlong(line, at + Math.min(footprints[i], 10))
    const length = Math.hypot(x2 - x, z2 - z) || 1
    const dirX = (x2 - x) / length
    const dirZ = (z2 - z) / length
    const sideX = -dirZ
    const sideZ = dirX
    row.forEach((spec, lane) => {
      const lateral = laneOffset(lane)
      placed.push({
        spec,
        x: x + sideX * lateral,
        z: z + sideZ * lateral,
        dirX,
        dirZ,
        lane,
        footprint: footprints[i],
        halfWidth: (spec.kind === 'box' || spec.kind.toLowerCase().includes('rail') ? 2.5 : (spec.width ?? 6)) / 2 + 2,
      })
    })
  })
  return placed
}

/** Upright drag over mass (1/m), as in the sim: ½ ρ CdA / m. */
const DRAG_K = (0.5 * 1.05 * 0.66) / 80
const PARK_MU = 0.03
const G = 9.81

/** Speed squared after `ds` metres of snow falling `drop` metres, with snow friction and upright drag. */
export function coast(v2: number, drop: number, ds: number): number {
  return Math.max(0.25, v2 + 2 * G * drop - 2 * PARK_MU * G * ds - 2 * DRAG_K * v2 * ds)
}

/** Speed (m/s) a rider at `v` reaches at a point `ds` metres ahead and `drop` metres lower, coasting straight. */
export function coastTo(v: number, drop: number, ds: number): number {
  return Math.sqrt(coast(v * v, drop, ds))
}

function isJump(spec: FeatureSpec) {
  return spec.kind === 'kicker' || spec.kind === 'stepDown'
}

function isSlide(spec: FeatureSpec) {
  return spec.kind === 'box' || spec.kind === 'rail' || spec.kind === 'downRail' || spec.kind === 'flatDownRail'
}

/** Slide speeds that ride a box or rail cleanly with no input, m/s. */
const SLIDE_SPEED: [number, number] = [4, 10]

/**
 * Where each row starts along the line, walking down it with a coasting
 * rider: the main-line feature goes where its lip speed sits in the middle
 * of its landing window (a rail or box once the rider is rolling at slide
 * speed), at least `MIN_GAP` after the last. Rows that no longer fit are
 * dropped. Landings lose a little speed; the rest of a feature rides like
 * the slope under it.
 */
function pacedRows(line: Point2[], rows: FeatureSpec[][], pacing: Pacing): number[] {
  const total = polylineLength(line)
  const h = (s: number) => {
    const [x, z] = pointAlong(line, s)
    return pacing.heightAt(x, z)
  }
  const starts: number[] = []
  let s = 0
  let v2 = pacing.entrySpeed ** 2
  let earliest = RUN_IN
  for (const row of rows) {
    const main = row[0]
    const footprint = Math.max(...row.map((spec) => footprintOf(spec)))
    let chosen = -1
    let bestLip = -1
    let bestAt = -1
    const advance = (to: number) => {
      for (; s < to; s += 1) v2 = coast(v2, h(s) - h(s + 1), 1)
    }
    for (let at = earliest; at + footprint <= total - 5; at += 1) {
      advance(at)
      const v = Math.sqrt(v2)
      if (isJump(main)) {
        const base = (Math.atan(Math.max(0, (h(at) - h(at + 8)) / 8)) * 180) / Math.PI
        const [lo, hi] = jumpWindow(main, base)
        const ramp = kickerRamp(main, base).ramp
        // Up the transition: the lip is `height` above the slope at the end of the ramp.
        const lip = Math.sqrt(coast(v2, h(at) - h(at + ramp) - (main.height ?? 1), ramp))
        if (lip >= lo + (hi - lo) * 0.45 || lip > hi) {
          chosen = at
          break
        }
        if (lip > bestLip) ((bestLip = lip), (bestAt = lip >= lo ? at : -1))
      } else if (isSlide(main)) {
        if (v >= SLIDE_SPEED[0] + 1) {
          chosen = at
          break
        }
        if (v > bestLip) ((bestLip = v), (bestAt = v >= SLIDE_SPEED[0] ? at : -1))
      } else {
        chosen = at
        break
      }
    }
    if (chosen < 0) chosen = bestAt
    if (chosen < 0) break
    advance(chosen)
    starts.push(chosen)
    // Through the feature: like the slope, less what the landing or the slide takes.
    advance(chosen + footprint)
    v2 *= isJump(main) ? 0.9 : isSlide(main) ? 0.92 : 0.97
    earliest = chosen + footprint + MIN_GAP
  }
  return starts
}

/**
 * Where a straight air off a jump comes down, metres along the feature's
 * axis, for a lip speed (m/s) on a slope of `baseDeg`, plus an optional pop
 * (m/s, up). Drag is left out: over a second of air it is a few per cent.
 */
export function landingAt(spec: FeatureSpec, baseDeg: number, speed: number, pop = 0): number {
  const probe: PlacedFeature = { spec, x: 0, z: 0, dirX: 1, dirZ: 0, footprint: footprintOf(spec, baseDeg), halfWidth: 20, baseDeg }
  const tanBase = Math.tan((baseDeg * Math.PI) / 180)
  const { ramp } = kickerRamp(spec, baseDeg)
  const y0 = (spec.height ?? 1) - ramp * tanBase
  const lip = ((spec.lipDeg ?? 25) * Math.PI) / 180
  const vu = speed * Math.cos(lip)
  const vy = speed * Math.sin(lip) + pop
  for (let t = 0.02; t < 6; t += 0.005) {
    const u = ramp + vu * t
    const y = y0 + vy * t - 0.5 * G * t * t
    if (y <= overlayHeight(probe, u, 0) - u * tanBase) return u
  }
  return Infinity
}

/** Knuckle (end of the deck) and toe (bottom of the landing), metres along a jump's axis. */
export function jumpShape(spec: FeatureSpec, baseDeg: number): { ramp: number; knuckle: number; toe: number } {
  const { ramp } = kickerRamp(spec, baseDeg)
  const knuckle = ramp + (spec.deck ?? 0)
  const deckHeight = spec.kind === 'stepDown' ? (spec.height ?? 1) * 0.4 : spec.height ?? 1
  return { ramp, knuckle, toe: knuckle + deckHeight / Math.tan(relativeLanding(spec, baseDeg)) }
}

/** The sweet spot starts this share of the deck before the knuckle: landing on the end of the deck rides away fine. */
const SWEET_DECK = 0.3

/**
 * Lip speeds (m/s) that come down in the sweet spot: from the end of the
 * deck to the toe of the landing. Slower cases the deck, faster overshoots
 * onto the flat below (a harder landing).
 */
export function jumpWindow(spec: FeatureSpec, baseDeg: number): [number, number] {
  const { knuckle, toe } = jumpShape(spec, baseDeg)
  const near = knuckle - (spec.deck ?? 0) * SWEET_DECK
  const far = toe
  const solve = (target: number) => {
    let lo = 1
    let hi = 40
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (landingAt(spec, baseDeg, mid) < target) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  return [solve(near), solve(far)]
}

export type JumpOutcome = 'cased' | 'sweet' | 'overshot'

/** Where a jump landed, from the touchdown point: on the deck, on the landing, or past it. */
export function jumpOutcome(f: PlacedFeature, x: number, z: number): JumpOutcome | null {
  if (f.knuckle === undefined || f.toe === undefined) return null
  const u = (x - f.x) * f.dirX + (z - f.z) * f.dirZ
  if (u < f.knuckle - (f.spec.deck ?? 0) * SWEET_DECK - 0.3) return 'cased'
  if (u > f.toe + 0.8) return 'overshot'
  return 'sweet'
}

/** The sign under a feature: what it is and how to ride it. */
export function featureSign(f: PlacedFeature): [string, string] {
  if (f.window) return [f.spec.label, `${Math.round(f.window[0] * 3.6)}-${Math.round(f.window[1] * 3.6)} km/h at the lip`]
  if (isSlide(f.spec)) return [f.spec.label, 'Pop on · balance · pop off']
  return [f.spec.label, 'Absorb the crest']
}

export function footprintOf(spec: FeatureSpec, baseDeg = 0): number {
  const h = spec.height ?? 1
  switch (spec.kind) {
    case 'kicker':
    case 'stepDown': {
      const { ramp } = kickerRamp(spec, baseDeg)
      return ramp + (spec.deck ?? 0) + h / Math.tan(relativeLanding(spec, baseDeg)) + 3
    }
    case 'roller':
      return spec.length ?? 12
    default:
      // Take-on ramp plus the slide.
      return railRampLength(spec) + (spec.length ?? 7) + 1
  }
}

/**
 * Lip and landing angles in the specs are absolute (from horizontal), as a
 * builder would measure them; the overlay sits on sloping ground, so convert.
 */
function relativeLip(spec: FeatureSpec, baseDeg: number): number {
  return (((spec.lipDeg ?? 25) + baseDeg) * Math.PI) / 180
}
function relativeLanding(spec: FeatureSpec, baseDeg: number): number {
  return (Math.max(8, (spec.landingDeg ?? 27) - baseDeg) * Math.PI) / 180
}

function kickerRamp(spec: FeatureSpec, baseDeg = 0): { radius: number; ramp: number } {
  const h = spec.height ?? 1
  const lip = relativeLip(spec, baseDeg)
  const radius = h / (1 - Math.cos(lip))
  return { radius, ramp: radius * Math.sin(lip) }
}

function railRampLength(spec: FeatureSpec): number {
  const top = spec.kind === 'downRail' || spec.kind === 'flatDownRail' ? spec.height ?? 1 : spec.height ?? 0.7
  return (top - 0.05) / Math.tan((14 * Math.PI) / 180)
}

/** Height added at local (u along the axis, v across) for one feature. */
export function overlayHeight(f: PlacedFeature, u: number, v: number): number {
  const spec = f.spec
  if (u < 0 || u > f.footprint) return 0
  let h = 0
  let halfWidth = (spec.width ?? 6) / 2
  switch (spec.kind) {
    case 'kicker':
    case 'stepDown': {
      const H = spec.height ?? 1
      const base = f.baseDeg ?? 0
      const { radius, ramp } = kickerRamp(spec, base)
      const deck = spec.deck ?? 0
      const land = Math.tan(relativeLanding(spec, base))
      // A step-down drops to a deck lower than the lip.
      const deckHeight = spec.kind === 'stepDown' ? H * 0.4 : H
      if (u <= ramp) h = radius - Math.sqrt(Math.max(0, radius * radius - u * u))
      else if (u <= ramp + deck) h = spec.kind === 'stepDown' && u > ramp + 0.6 ? deckHeight : H
      else h = Math.max(0, deckHeight - (u - ramp - deck) * land)
      // Round the knuckle and the landing's foot over about a metre.
      const knuckle = ramp + deck
      if (u > knuckle - 0.8 && u < knuckle + 0.8 && spec.kind === 'kicker') {
        const t = (u - (knuckle - 0.8)) / 1.6
        h = Math.min(h, H - 0.25 * t * t)
      }
      break
    }
    case 'roller': {
      const L = spec.length ?? 12
      const c = Math.cos((Math.PI * (u - L / 2)) / L)
      h = (spec.height ?? 1.5) * c * c
      break
    }
    default: {
      // Snow take-on ramp up to the start of the box or rail.
      const ramp = railRampLength(spec)
      const top = (spec.kind === 'box' ? spec.height ?? 0.6 : spec.height ?? 0.8) - 0.1
      halfWidth = 1.4
      h = u <= ramp ? (u / ramp) * top : 0
      if (u > ramp + 0.3) return 0
    }
  }
  // Steep side walls.
  const edge = halfWidth - Math.abs(v)
  return Math.max(0, h + Math.min(0, edge) * 1.6)
}

/** Rails and boxes as slide polylines in world space. */
export function featureRails(f: PlacedFeature, baseHeight: (x: number, z: number) => number, id: string): Rail | null {
  const spec = f.spec
  if (!['box', 'rail', 'downRail', 'flatDownRail'].includes(spec.kind)) return null
  const start = railRampLength(spec)
  const length = spec.length ?? 7
  const steps = Math.ceil(length / 0.5)
  const points = []
  const h0 = spec.height ?? 0.8
  for (let i = 0; i <= steps; i++) {
    const u = start + (length * i) / steps
    const x = f.x + f.dirX * u
    const z = f.z + f.dirZ * u
    const t = i / steps
    let rise = h0
    if (spec.kind === 'downRail') rise = h0 - (h0 - 0.5) * t
    if (spec.kind === 'flatDownRail') rise = t < 0.35 ? h0 : h0 - (h0 - 0.45) * ((t - 0.35) / 0.65)
    // Rails follow the slope at the start then hold their own line.
    points.push({ x, y: baseHeight(f.x + f.dirX * start, f.z + f.dirZ * start) - (u - start) * slopeAlong(f, baseHeight, start) + rise, z })
  }
  // Keep the rail above the snow everywhere along it.
  for (const p of points) p.y = Math.max(p.y, baseHeight(p.x, p.z) + 0.35)
  return { id, kind: spec.kind === 'box' ? 'box' : 'rail', points, width: spec.width ?? 0.08 }
}

function slopeAlong(f: PlacedFeature, baseHeight: (x: number, z: number) => number, u: number): number {
  const a = baseHeight(f.x + f.dirX * u, f.z + f.dirZ * u)
  const b = baseHeight(f.x + f.dirX * (u + 8), f.z + f.dirZ * (u + 8))
  return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / 8 : 0
}

/** The next takeoff lip within `range` metres in the direction of travel. */
export function featureAhead(features: PlacedFeature[], x: number, z: number, dirX: number, dirZ: number, range = 45) {
  let best: { feature: PlacedFeature; distance: number } | null = null
  for (const f of features) {
    if (!isJump(f.spec)) continue
    const { ramp } = kickerRamp(f.spec, f.baseDeg)
    const dx = f.x + f.dirX * ramp - x
    const dz = f.z + f.dirZ * ramp - z
    const ahead = dx * dirX + dz * dirZ
    const side = Math.abs(-dx * dirZ + dz * dirX)
    if (ahead > 0 && ahead < (best?.distance ?? range) && side < f.halfWidth + 4) best = { feature: f, distance: ahead }
  }
  return best
}

export type ApproachAim = {
  x: number
  z: number
  distance: number
  label: string
  kind: 'jump' | 'rail'
}

/** Look target for the next park feature or rail ahead of the skier. */
export function approachAim(
  features: PlacedFeature[],
  rails: readonly Rail[],
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  range = 42,
): ApproachAim | null {
  const jump = featureAhead(features, x, z, dirX, dirZ, range)
  let best: ApproachAim | null = jump
    ? (() => {
        const { ramp } = kickerRamp(jump.feature.spec, jump.feature.baseDeg)
        return {
          x: jump.feature.x + jump.feature.dirX * ramp,
          z: jump.feature.z + jump.feature.dirZ * ramp,
          distance: jump.distance,
          label: jump.feature.spec.label,
          kind: 'jump' as const,
        }
      })()
    : null
  for (const f of features) {
    const railish = f.spec.kind === 'box' || f.spec.kind === 'rail' || f.spec.kind === 'downRail' || f.spec.kind === 'flatDownRail'
    if (!railish) continue
    const dx = f.x - x
    const dz = f.z - z
    const ahead = dx * dirX + dz * dirZ
    const side = Math.abs(-dx * dirZ + dz * dirX)
    if (ahead > 1.5 && ahead < (best?.distance ?? range) && side < f.halfWidth + 6) {
      best = {
        x: f.x + f.dirX * Math.min(2, f.footprint * 0.2),
        z: f.z + f.dirZ * Math.min(2, f.footprint * 0.2),
        distance: ahead,
        label: f.spec.label,
        kind: 'rail',
      }
    }
  }
  if (!best && rails.length) {
    for (const rail of rails) {
      const mid = rail.points[Math.floor(rail.points.length / 2)] ?? rail.points[0]
      if (!mid) continue
      const dx = mid.x - x
      const dz = mid.z - z
      const ahead = dx * dirX + dz * dirZ
      const side = Math.abs(-dx * dirZ + dz * dirX)
      const dist = Math.hypot(dx, dz)
      if (ahead > 2 && dist < (best?.distance ?? range) && side < 14) {
        best = {
          x: mid.x,
          z: mid.z,
          distance: dist,
          label: rail.kind === 'box' ? 'Box' : 'Rail',
          kind: 'rail',
        }
      }
    }
  }
  return best
}

export interface ParkOverlay {
  features: PlacedFeature[]
  rails: Rail[]
  /** Total overlay height at a world point. */
  heightAt: (x: number, z: number) => number
  /** Base sampler plus the overlay, with normals from finite differences on the overlay. */
  sampleTerrain: SampleTerrain
  /** True inside any feature footprint (for the surface mask and trees). */
  inside: (x: number, z: number) => boolean
}

export function buildParkOverlay(
  features: PlacedFeature[],
  base: SampleTerrain,
  baseHeight: (x: number, z: number) => number,
): ParkOverlay {
  for (const f of features) {
    f.baseDeg = (Math.atan(Math.max(0, slopeAlong(f, baseHeight, 0))) * 180) / Math.PI
    f.footprint = footprintOf(f.spec, f.baseDeg)
    if (isJump(f.spec)) {
      const shape = jumpShape(f.spec, f.baseDeg)
      const x = f.x + f.dirX * shape.ramp
      const z = f.z + f.dirZ * shape.ramp
      f.lip = { x, y: baseHeight(x, z) + (f.spec.height ?? 1), z }
      f.knuckle = shape.knuckle
      f.toe = shape.toe
      f.window = jumpWindow(f.spec, f.baseDeg)
    }
  }
  const rails = features
    .map((f, i) => featureRails(f, baseHeight, `rail/${i}`))
    .filter((r): r is Rail => r !== null)
  // Coarse buckets so most samples skip every feature.
  const cell = 32
  const buckets = new Map<number, PlacedFeature[]>()
  const key = (cx: number, cz: number) => cx * 100003 + cz
  for (const f of features) {
    const ends = [
      [f.x, f.z],
      [f.x + f.dirX * f.footprint, f.z + f.dirZ * f.footprint],
    ]
    const minX = Math.min(ends[0][0], ends[1][0]) - f.halfWidth
    const maxX = Math.max(ends[0][0], ends[1][0]) + f.halfWidth
    const minZ = Math.min(ends[0][1], ends[1][1]) - f.halfWidth
    const maxZ = Math.max(ends[0][1], ends[1][1]) + f.halfWidth
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
        const k = key(cx, cz)
        const list = buckets.get(k)
        if (list) list.push(f)
        else buckets.set(k, [f])
      }
    }
  }
  const heightAt = (x: number, z: number) => {
    let h = 0
    for (const f of buckets.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const dx = x - f.x
      const dz = z - f.z
      const u = dx * f.dirX + dz * f.dirZ
      const v = -dx * f.dirZ + dz * f.dirX
      if (Math.abs(v) > f.halfWidth) continue
      h = Math.max(h, overlayHeight(f, u, v))
    }
    return h
  }
  const eps = 0.2
  const sampleTerrain: SampleTerrain = (x, z) => {
    const ground = base(x, z)
    if (!ground) return null
    const o = heightAt(x, z)
    if (o <= 0) {
      // Near a feature edge the overlay still bends the normal; check cheaply.
      if (heightAt(x + eps, z) <= 0 && heightAt(x, z + eps) <= 0 && heightAt(x - eps, z) <= 0 && heightAt(x, z - eps) <= 0) {
        return ground
      }
    }
    const dodx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps)
    const dodz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps)
    // Combine the base slope (from its normal) with the overlay slope.
    const n = ground.normal
    const bx = -n.x / n.y
    const bz = -n.z / n.y
    const gx = bx + dodx
    const gz = bz + dodz
    const length = Math.hypot(gx, 1, gz)
    return { height: ground.height + o, normal: { x: -gx / length, y: 1 / length, z: -gz / length } }
  }
  const inside = (x: number, z: number) => {
    for (const f of buckets.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
      const dx = x - f.x
      const dz = z - f.z
      const u = dx * f.dirX + dz * f.dirZ
      const v = -dx * f.dirZ + dz * f.dirX
      if (u >= -2 && u <= f.footprint + 2 && Math.abs(v) <= f.halfWidth + 2) return true
    }
    return false
  }
  return { features, rails, heightAt, sampleTerrain, inside }
}
