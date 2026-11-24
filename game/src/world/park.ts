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
  /** Comfortable approach speed at the lip, km/h (from the tuning harness). */
  speed?: [number, number]
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
}

/** Size presets for kickers, from small (about 4 m gap) to the Claim Jumper's big line. */
export const KICKERS: Record<'S' | 'M' | 'L' | 'XL', FeatureSpec> = {
  S: { kind: 'kicker', label: 'Small tabletop · 20-30 km/h', speed: [20, 30], height: 1.1, lipDeg: 10, deck: 3, landingDeg: 26, width: 5 },
  M: { kind: 'kicker', label: 'Medium tabletop · 20-35 km/h', speed: [20, 35], height: 1.7, lipDeg: 16, deck: 6, landingDeg: 29, width: 6 },
  L: { kind: 'kicker', label: 'Large tabletop · 20-40 km/h', speed: [20, 40], height: 2.4, lipDeg: 20, deck: 9, landingDeg: 31, width: 7 },
  XL: { kind: 'kicker', label: 'XL gap jump · 25-50 km/h', speed: [25, 50], height: 3.2, lipDeg: 23, deck: 13, landingDeg: 32, width: 8 },
}

export const FEATURES: Record<string, FeatureSpec> = {
  ...Object.fromEntries(Object.entries(KICKERS).map(([k, v]) => [`kicker${k}`, v])),
  rollerS: { kind: 'roller', label: 'Roller', height: 1.5, length: 12, width: 8 },
  rollerL: { kind: 'roller', label: 'Big roller', height: 3, length: 30, width: 10 },
  box: { kind: 'box', label: 'Flat box', height: 0.6, length: 7, width: 0.5 },
  rail: { kind: 'rail', label: 'Flat rail', height: 0.8, length: 7, width: 0.08 },
  downRail: { kind: 'downRail', label: 'Down rail', height: 1.4, length: 9, width: 0.08 },
  flatDownRail: { kind: 'flatDownRail', label: 'Flat-down rail', height: 1.1, length: 10, width: 0.08 },
  stepDown: { kind: 'stepDown', label: 'Step-down', height: 1.2, lipDeg: 20, deck: 3, landingDeg: 26, width: 7 },
}

/** One feature, or a side-by-side row the rider can choose from. */
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
    features: ['rollerS', ['kickerS', 'kickerM'], ['box', 'rail'], ['kickerM', 'kickerL'], ['kickerL', 'kickerXL']],
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
      ['kickerS', 'kickerS', 'kickerM'],
      ['box', 'rail', 'flatDownRail'],
      ['kickerM', 'kickerL'],
      ['kickerL', 'kickerXL', 'downRail'],
    ],
  },
  {
    id: 'claimJumper',
    label: 'Claim Jumper',
    features: ['stepDown', ['kickerL', 'rail'], ['kickerXL', 'flatDownRail'], ['kickerXL', 'downRail', 'kickerM']],
  },
  {
    id: 'prospector',
    label: 'Prospector',
    features: ['rollerS', ['kickerS', 'kickerS'], 'box', ['kickerM', 'rail'], ['kickerM', 'stepDown']],
  },
  {
    id: 'okanagan',
    label: 'Okanagan',
    features: ['rollerS', 'rollerL', ['kickerS', 'kickerM', 'kickerM'], ['rail', 'downRail'], ['kickerM', 'box']],
  },
  {
    id: 'nuggets',
    label: 'Little Nuggets',
    features: ['rollerS', 'rollerS', 'box', 'box', 'rail'],
  },
]

/**
 * Apex parks from the OSM terrain-park ways. Unnamed ways are matched by OSM
 * way id against the resort map (T-Bar area), not by length.
 */
export interface ParkSite {
  id: string
  name: string
  line: Point2[]
  layout: string
}

export const DEFAULT_LAYOUT: Record<string, string> = {
  'Claim Jumper': 'claimJumper',
  Prospector: 'prospector',
  'Okanagan Park': 'okanagan',
  'Little Nuggets': 'nuggets',
  'Boarder Cross': 'rollers',
}

/** Official names for OSM park ways that lack a name tag (or use a generic one). */
export const PARK_WAY_NAMES: Record<string, string> = {
  'way/374339369': 'Okanagan Park',
  'way/374339370': 'Prospector',
  'way/1105323712': 'Little Nuggets',
  'way/374339381': 'Claim Jumper',
  'way/374339374': 'Boarder Cross',
}

export function parkSitesFromLines(lines: { name: string | null; line: Point2[]; osmId: string }[]): ParkSite[] {
  return lines.map((l) => {
    const fromWay = PARK_WAY_NAMES[l.osmId]
    const name = fromWay ?? (l.name === 'Park' ? 'Little Nuggets' : l.name ?? 'Park')
    return { id: l.osmId, name, line: l.line, layout: DEFAULT_LAYOUT[name] ?? 'mixed' }
  })
}

/** Lay a lineup along a park line, leaving run-in and run-out between features. */
export function placeFeatures(site: ParkSite, layoutId: string): PlacedFeature[] {
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0]
  return placeLineup(site.line, layout.features)
}

/** The demo park's lineup: a long progression from rollers to XL jumps, with a jib between most kickers. */
export const DEMO_LINEUP: LayoutSlot[] = [
  'rollerS', 'kickerS', 'box', 'kickerS', 'rail', 'rollerS', 'kickerM', 'flatDownRail', 'kickerM', 'downRail',
  'rollerL', 'kickerM', 'box', 'stepDown', 'kickerL', 'rail', 'kickerL', 'downRail', 'rollerS', 'kickerL',
  'flatDownRail', 'kickerXL', 'rollerS', 'kickerXL',
]

const laneSpacing = 7.5

/** Lay feature ids along a line. A slot may be a row of side-by-side choices. */
export function placeLineup(line: Point2[], featureIds: LayoutSlot[], gap?: number): PlacedFeature[] {
  const total = polylineLength(line)
  const rows = featureIds
    .map((slot) => (Array.isArray(slot) ? slot : [slot]).map((id) => FEATURES[id]).filter(Boolean))
    .filter((row) => row.length > 0)
  const footprints = rows.map((row) => Math.max(...row.map((spec) => footprintOf(spec))))
  const used = footprints.reduce((a, b) => a + b, 0)
  gap ??= Math.max(14, (total - 40 - used) / Math.max(1, rows.length))
  const placed: PlacedFeature[] = []
  let at = 32
  rows.forEach((row, i) => {
    if (at + footprints[i] > total - 5) return
    const [x, z] = pointAlong(line, at)
    const [x2, z2] = pointAlong(line, at + Math.min(footprints[i], 10))
    const length = Math.hypot(x2 - x, z2 - z) || 1
    const dirX = (x2 - x) / length
    const dirZ = (z2 - z) / length
    const sideX = -dirZ
    const sideZ = dirX
    row.forEach((spec, lane) => {
      const lateral = (lane - (row.length - 1) / 2) * laneSpacing
      placed.push({
        spec,
        x: x + sideX * lateral,
        z: z + sideZ * lateral,
        dirX,
        dirZ,
        footprint: footprints[i],
        halfWidth: (spec.kind === 'box' || spec.kind.toLowerCase().includes('rail') ? 2.5 : (spec.width ?? 6)) / 2 + 2,
      })
    })
    at += footprints[i] + gap
  })
  return placed
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
    if (!f.spec.speed) continue
    const { ramp } = kickerRamp(f.spec, f.baseDeg)
    const dx = f.x + f.dirX * ramp - x
    const dz = f.z + f.dirZ * ramp - z
    const ahead = dx * dirX + dz * dirZ
    const side = Math.abs(-dx * dirZ + dz * dirX)
    if (ahead > 0 && ahead < (best?.distance ?? range) && side < f.halfWidth + 4) best = { feature: f, distance: ahead }
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
