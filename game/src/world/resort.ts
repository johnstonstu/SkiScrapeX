import type { Spawn } from '../sim'

/**
 * Resort features in local metres (+X east, +Z south), independent of the
 * source file. Built from `features.json` (OSM export) or, when that is
 * missing, from the terrain build's `references.json`.
 */
export type Point2 = [number, number]

export interface Run {
  id: string
  name: string
  difficulty: string | null
  /** Ungroomed when OSM says mogul / backcountry / freeride, or difficulty is freeride. */
  wooded?: boolean
  moguls?: boolean
  groomed: boolean
  /** Area runs are filled polygons; line runs are centrelines. */
  kind: 'line' | 'area'
  /** One or more polylines (or rings for areas). Downhill order when known. */
  parts: Point2[][]
}

export interface Lift {
  seats?: number
  id: string
  name: string
  type: string
  /** Lower terminal. Decided from the height grid, not the OSM roles. */
  bottom: Point2
  top: Point2
  /** Bottom to top. */
  line: Point2[]
  towers: Point2[]
}

export interface Peak {
  name: string
  x: number
  z: number
  ele: number | null
}

export interface ParkLine {
  osmId: string
  name: string | null
  line: Point2[]
}

export interface Resort {
  runs: Run[]
  /** OSM terrain-park ways (piste:type=snow_park), downhill order. */
  parks: ParkLine[]
  lifts: Lift[]
  /** Road centrelines (packed snow in winter). */
  roads: Point2[][]
  buildings: FeatureBuildingRef[]
  peaks: Peak[]
  /** Ski-area boundary ring (OSM landuse=winter_sports), when mapped. */
  boundary?: Point2[]
  attribution: string[]
}

/** Raw OSM building footprint, turned into shells by `world/buildings.ts`. */
export interface FeatureBuildingRef {
  id?: string
  name?: string | null
  building?: string
  tags?: Record<string, string>
  points: FeaturePoint[]
}

export interface FeaturePoint { x: number; z: number }
interface FeatureRun {
  id?: string
  name?: string | null
  difficulty?: string | null
  grooming?: string | null
  geometry?: string
  points?: FeaturePoint[]
  members?: { id?: string; points: FeaturePoint[]; difficulty?: string | null; grooming?: string | null }[]
}
interface FeatureLift {
  id?: string
  name?: string | null
  tags?: Record<string, string>
  aerialway?: string
  line?: FeaturePoint[]
  towers?: FeaturePoint[]
}
export interface FeaturesDocument {
  version: number
  runs?: FeatureRun[]
  terrainParks?: FeatureRun[]
  lifts?: FeatureLift[]
  roads?: { points: FeaturePoint[]; highway?: string }[]
  buildings?: FeatureBuildingRef[]
  peaks?: { name?: string; x: number; z: number; ele?: number | null }[]
  boundary?: { points?: FeaturePoint[] }
  source?: { attribution?: string }
}
export interface ReferencesDocument {
  attribution?: string
  lines: { id: number; feature: 'trail' | 'lift'; points: Point2[] }[]
}

const UNGROOMED = new Set(['mogul', 'backcountry', 'freeride', 'scooter', 'no'])
const pt = (p: FeaturePoint): Point2 => [p.x, p.z]

export function resortFromFeatures(doc: FeaturesDocument, heightAt: (x: number, z: number) => number): Resort {
  const runs: Run[] = []
  const all = doc.runs ?? []
  all.forEach((run, index) => {
    const kind = run.geometry === 'area' ? 'area' : 'line'
    const parts = run.points && run.points.length >= 2 && kind === 'line'
      ? [run.points.map(pt)]
      : (run.members ?? []).map((member) => member.points.map(pt))
    const grooming = run.grooming ?? run.members?.find((m) => m.grooming)?.grooming ?? null
    const difficulty = run.difficulty ?? run.members?.find((m) => m.difficulty)?.difficulty ?? null
    runs.push({
      id: run.id ?? `run/${index}`,
      name: run.name ?? 'Unnamed run',
      difficulty,
      wooded: grooming?.split(';').includes('backcountry') || /\bglades?\b/i.test(run.name ?? ''),
      moguls: grooming?.split(';').includes('mogul'),
      groomed: !(grooming && [...grooming.split(';')].some((g) => UNGROOMED.has(g))) && difficulty !== 'freeride',
      kind,
      parts: parts.filter((part) => part.length >= 2).map((part) => (kind === 'line' ? downhill(part, heightAt) : part)),
    })
  })
  const lifts = (doc.lifts ?? [])
    .map((lift, index) => {
      const name = lift.name === "Stock's Chiar" ? "Stock's Chair" : lift.name ?? 'Lift'
      // OSM often omits aerialway:occupancy; Apex locals know Stock's is a triple and Quickdraw a quad.
      const tagged = Number(lift.tags?.['aerialway:occupancy'])
      const seats =
        Number.isFinite(tagged) && tagged > 0
          ? tagged
          : /stock/i.test(name)
            ? 3
            : /quick\s*draw/i.test(name)
              ? 4
              : undefined
      return makeLift(
        lift.id ?? `lift/${index}`,
        name,
        lift.aerialway ?? 'lift',
        (lift.line ?? []).map(pt),
        (lift.towers ?? []).map(pt),
        heightAt,
        seats,
      )
    })
    .filter((lift): lift is Lift => lift !== null)
  return {
    runs: runs.filter((run) => run.parts.length > 0),
    lifts,
    parks: (doc.terrainParks ?? [])
      .map((park, index) => {
        const points = park.points?.length ? park.points : (park.members ?? []).flatMap((m) => m.points)
        // Prefer the OSM way id from the relation member when the park object itself has no id.
        const osmId = park.id ?? park.members?.find((member) => member.id)?.id ?? `park/${index}`
        return { osmId, name: park.name ?? null, line: downhill(points.map(pt), heightAt) }
      })
      .filter((park) => park.line.length >= 2),
    // Tracks are cat tracks and ski trails in winter; only plowed road classes are roads.
    roads: (doc.roads ?? [])
      .filter((road) => road.highway !== 'track')
      .map((road) => road.points.map(pt))
      .filter((line) => line.length >= 2),
    buildings: doc.buildings ?? [],
    peaks: (doc.peaks ?? []).map((peak) => ({ name: peak.name ?? 'Peak', x: peak.x, z: peak.z, ele: peak.ele ?? null })),
    boundary: doc.boundary?.points && doc.boundary.points.length >= 3 ? doc.boundary.points.map(pt) : undefined,
    attribution: [doc.source?.attribution ?? '© OpenStreetMap contributors'],
  }
}

/** Reverse a centreline that the height grid says climbs. */
export function downhill(line: Point2[], heightAt: (x: number, z: number) => number): Point2[] {
  const first = heightAt(line[0][0], line[0][1])
  const last = heightAt(line[line.length - 1][0], line[line.length - 1][1])
  return Number.isFinite(first) && Number.isFinite(last) && last > first + 1 ? [...line].reverse() : line
}

export function resortFromReferences(doc: ReferencesDocument, heightAt: (x: number, z: number) => number): Resort {
  const runs: Run[] = []
  const trail = doc.lines.filter((line) => line.feature === 'trail')
  if (trail.length) {
    runs.push({
      id: 'grandfathers',
      name: "Grandfather's Trail",
      difficulty: null,
      groomed: true,
      kind: 'line',
      parts: [trail.flatMap((line, index) => (index === 0 ? line.points : line.points.slice(1)))],
    })
  }
  const lifts = doc.lines
    .filter((line) => line.feature === 'lift')
    .map((line) => makeLift(`way/${line.id}`, 'Quickdraw', 'chair_lift', line.points, [], heightAt))
    .filter((lift): lift is Lift => lift !== null)
  return { runs, lifts, parks: [], roads: [], buildings: [], peaks: [], attribution: [doc.attribution ?? '© OpenStreetMap contributors'] }
}

function makeLift(
  id: string,
  name: string,
  type: string,
  line: Point2[],
  towers: Point2[],
  heightAt: (x: number, z: number) => number,
  seats?: number,
): Lift | null {
  if (line.length < 2) return null
  const first = heightAt(line[0][0], line[0][1])
  const last = heightAt(line[line.length - 1][0], line[line.length - 1][1])
  // Unknown heights keep the mapped direction.
  const ordered = Number.isFinite(first) && Number.isFinite(last) && first > last ? [...line].reverse() : line
  const orderedTowers = ordered === line ? towers : [...towers].reverse()
  return {
    id,
    name,
    type,
    seats,
    bottom: ordered[0],
    top: ordered[ordered.length - 1],
    line: ordered,
    towers: orderedTowers.length ? orderedTowers : interpolatedTowers(ordered, 90),
  }
}

/** Evenly spaced towers when OSM does not tag pylons. */
export function interpolatedTowers(line: Point2[], spacing: number): Point2[] {
  const total = polylineLength(line)
  const count = Math.max(0, Math.floor(total / spacing) - 1)
  const towers: Point2[] = []
  for (let i = 1; i <= count; i++) towers.push(pointAlong(line, (total * i) / (count + 1)))
  return towers
}

export function polylineLength(line: Point2[]): number {
  let total = 0
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
  return total
}

export function pointAlong(line: Point2[], distance: number): Point2 {
  let remaining = Math.max(0, distance)
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const segment = Math.hypot(bx - ax, bz - az)
    if (remaining <= segment && segment > 0) {
      const t = remaining / segment
      return [ax + (bx - ax) * t, az + (bz - az) * t]
    }
    remaining -= segment
  }
  return line[line.length - 1]
}

/** Skier heading (0 faces +Z, positive to the skier's right) for a travel direction. */
export function headingFor(dx: number, dz: number): number {
  return Math.atan2(-dx, dz)
}

export interface Course {
  spawn: Spawn
  startLift: Lift | null
  startRun: Run | null
}

/**
 * Start at the top of Quickdraw (or the highest lift top when Quickdraw is
 * missing), a little way down the run that begins nearest that terminal.
 */
export function chooseCourse(
  resort: Resort,
  heightAt: (x: number, z: number) => number,
  preferredLift = 'Quickdraw',
  preferredRun = 'Grandfather',
): Course {
  const lift =
    resort.lifts.find((candidate) => candidate.name.toLowerCase() === preferredLift.toLowerCase()) ??
    [...resort.lifts].sort((a, b) => heightAt(b.top[0], b.top[1]) - heightAt(a.top[0], a.top[1]))[0] ??
    null
  if (!lift) return { spawn: { x: 0, z: 0, heading: 0 }, startLift: null, startRun: null }
  const [tx, tz] = lift.top
  const lineRuns = resort.runs.filter((run) => run.kind === 'line')
  const startDistance = (run: Run) => Math.hypot(run.parts[0][0][0] - tx, run.parts[0][0][1] - tz)
  const named = lineRuns.find((run) => run.name.toLowerCase().includes(preferredRun.toLowerCase()))
  const nearest = [...lineRuns].sort((a, b) => startDistance(a) - startDistance(b))[0]
  const run = named && startDistance(named) < 250 ? named : nearest && startDistance(nearest) < 250 ? nearest : null

  if (run) {
    const line = run.parts[0]
    const [sx, sz] = pointAlong(line, 40)
    const [ax, az] = pointAlong(line, 60)
    return { spawn: { x: sx, z: sz, heading: headingFor(ax - sx, az - sz) }, startLift: lift, startRun: run }
  }
  // No run: step off the terminal down the lift line and face downhill.
  const back = lift.line[lift.line.length - 2]
  const dx = back[0] - tx
  const dz = back[1] - tz
  const length = Math.hypot(dx, dz) || 1
  const sx = tx + (dx / length) * 15 + (dz / length) * 12
  const sz = tz + (dz / length) * 15 - (dx / length) * 12
  return { spawn: { x: sx, z: sz, heading: headingFor(dx, dz) }, startLift: lift, startRun: null }
}

/** The lift whose bottom terminal is within `radius` metres, if any. */
export function liftAtBottom(resort: Resort, x: number, z: number, radius: number): Lift | null {
  let best: Lift | null = null
  let bestDistance = radius
  for (const lift of resort.lifts) {
    const distance = Math.hypot(lift.bottom[0] - x, lift.bottom[1] - z)
    if (distance <= bestDistance) {
      best = lift
      bestDistance = distance
    }
  }
  return best
}

/** Squared distance from a point to a polyline, plus that segment's unit direction. */
export function nearestOnPolyline(x: number, z: number, line: Point2[]): { distanceSq: number; dirX: number; dirZ: number } {
  let distanceSq = Infinity
  let dirX = 0
  let dirZ = 1
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz
    if (!lengthSq) continue
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
    const d = (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2
    if (d < distanceSq) {
      distanceSq = d
      const length = Math.sqrt(lengthSq)
      dirX = dx / length
      dirZ = dz / length
    }
  }
  return { distanceSq, dirX, dirZ }
}

export function pointInRing(x: number, z: number, ring: Point2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]
    const [xj, zj] = ring[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Half-width of a mapped run centreline, metres. Rough Apex defaults by difficulty. */
export function runHalfWidth(run: Run): number {
  // From the footage: groomers like Grandfather's and Okanagan are 40 m or more wide,
  // steeps like Gunbarrel and Chute about 15 to 20 m. Ungroomed runs stay narrow.
  const groomed = run.groomed !== false
  switch (run.difficulty) {
    case 'novice':
    case 'easy':
      return groomed ? 22 : 14
    case 'intermediate':
      return groomed ? 20 : 13
    case 'advanced':
      return groomed ? 15 : 10.5
    default:
      return 9.5
  }
}

/** Start a little way down a run, facing along it. The lift is the one whose top is nearest. */
export function courseForRun(resort: Resort, run: Run): Course {
  const line = run.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
  const [sx, sz] = pointAlong(line, Math.min(25, polylineLength(line) * 0.2))
  const [ax, az] = pointAlong(line, Math.min(45, polylineLength(line) * 0.4))
  const lift =
    [...resort.lifts].sort(
      (a, b) => Math.hypot(a.top[0] - line[0][0], a.top[1] - line[0][1]) - Math.hypot(b.top[0] - line[0][0], b.top[1] - line[0][1]),
    )[0] ?? null
  return { spawn: { x: sx, z: sz, heading: headingFor(ax - sx, az - sz) }, startLift: lift, startRun: run }
}

/** Named line runs, one entry per name, longest first within each difficulty. */
export function pickableRuns(resort: Resort): Run[] {
  const order = ['novice', 'easy', 'intermediate', 'advanced', 'expert', 'freeride']
  const byName = new Map<string, Run>()
  for (const run of resort.runs) {
    if (run.kind !== 'line' || run.name === 'Unnamed run') continue
    const length = Math.max(...run.parts.map(polylineLength))
    if (length < 120) continue
    const existing = byName.get(run.name)
    if (!existing || Math.max(...existing.parts.map(polylineLength)) < length) byName.set(run.name, run)
  }
  const rank = (run: Run) => {
    const index = order.indexOf(run.difficulty ?? '')
    return index < 0 ? order.length : index
  }
  return [...byName.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
