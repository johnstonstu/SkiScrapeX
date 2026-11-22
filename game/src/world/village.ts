import type { TerrainGrid } from './terrainGrid'
import type { Canopy } from './surface'
import type { Building } from './buildings'
import { makeRandom } from './forest'
import { nearestOnPolyline, pointInRing, type Lift, type Point2, type Run } from './resort'

/**
 * Village props as pure data: parking lots found in the LiDAR (flat, open,
 * treeless ground beside the plowed roads near buildings), parked cars,
 * decks on the downhill side of buildings and the Billy Goat Hut on the
 * summit. `render/villageView.ts` draws them.
 */
export interface ParkedCar {
  x: number
  z: number
  heading: number
  /** 0 sedan, 1 SUV, 2 pickup. */
  body: 0 | 1 | 2
  colour: number
}

export interface Deck {
  /** Outer wall corners of the deck, counter-clockwise, and the floor height. */
  corners: Point2[]
  floor: number
  /** Restaurants and bars get patio tables. */
  patio: boolean
}

export interface Hut {
  x: number
  z: number
  /** Facing, radians (0 faces +Z). */
  heading: number
}

export interface Village {
  lots: { cells: number; centre: Point2 }[]
  cars: ParkedCar[]
  decks: Deck[]
  hut: Hut | null
}

const CAR_COLOURS = [0xf2f5f8, 0x1b1f24, 0x8a929b, 0xa31d1d, 0x2b4f86, 0x3f5a3a, 0xc9b896, 0x5b6470, 0xe8e8e2, 0x23272c]
const PATIO = /saloon|bistro|inn|lodge|cafe|bar|longshot/i

export function buildVillage(
  grid: TerrainGrid,
  canopy: Canopy | null,
  roads: Point2[][],
  runs: Run[],
  buildings: Building[],
  lifts: Lift[],
  seed = 7331,
): Village {
  const random = makeRandom(seed)
  const lots = canopy ? findLots(grid, canopy, roads, runs, buildings) : []
  const cars: ParkedCar[] = []
  for (const lot of lots) cars.push(...fillLot(lot, grid, random))
  return {
    lots: lots.map((lot) => ({ cells: lot.cells.length, centre: lot.centre })),
    cars,
    decks: buildings.flatMap((b) => deckFor(b, grid) ?? []),
    hut: placeHut(lifts, runs, grid),
  }
}

interface Lot {
  cells: number[]
  centre: Point2
  /** Unit vector along the lot's long axis. */
  axis: Point2
}

/** Flat (under 5°), treeless (cover under 10%) ground within 40 m of a road, 250 m of a building, off the runs. */
export function findLots(grid: TerrainGrid, canopy: Canopy, roads: Point2[][], runs: Run[], buildings: Building[]): Lot[] {
  const { columns, rows, step } = grid
  if (!buildings.length || !roads.length) return []
  const centres = buildings.map((b) => centroid(b.ring))
  const minX = Math.min(...centres.map((c) => c[0])) - 250, maxX = Math.max(...centres.map((c) => c[0])) + 250
  const minZ = Math.min(...centres.map((c) => c[1])) - 250, maxZ = Math.max(...centres.map((c) => c[1])) + 250
  const ok = new Uint8Array(columns * rows)
  const runLines = runs.filter((r) => r.kind === 'line').flatMap((r) => r.parts)
  for (let row = Math.max(1, Math.floor(minZ / step)); row < Math.min(rows - 1, maxZ / step); row++) {
    for (let col = Math.max(1, Math.floor(minX / step)); col < Math.min(columns - 1, maxX / step); col++) {
      const i = row * columns + col
      const x = col * step, z = row * step
      if (canopy.cover[i] >= 0.1) continue
      const h = grid.heights
      const dx = (h[i + 1] - h[i - 1]) / (2 * step), dz = (h[i + columns] - h[i - columns]) / (2 * step)
      if (Math.hypot(dx, dz) > Math.tan((5 * Math.PI) / 180)) continue
      if (!centres.some(([cx, cz]) => (cx - x) ** 2 + (cz - z) ** 2 < 250 * 250)) continue
      const road = Math.min(...roads.map((line) => nearestOnPolyline(x, z, line).distanceSq))
      if (road > 40 * 40 || road < 5 * 5) continue
      if (runLines.some((line) => nearestOnPolyline(x, z, line).distanceSq < 22 * 22)) continue
      if (buildings.some((b) => nearRing(x, z, b.ring, 9))) continue
      ok[i] = 1
    }
  }
  // Drop single-cell spurs (an opening), then flood-fill.
  const open = new Uint8Array(ok)
  for (let i = 0; i < ok.length; i++) {
    if (!ok[i]) continue
    const n = ok[i - 1] + ok[i + 1] + ok[i - columns] + ok[i + columns]
    if (n < 2) open[i] = 0
  }
  const seen = new Uint8Array(ok.length)
  const lots: Lot[] = []
  for (let start = 0; start < open.length; start++) {
    if (!open[start] || seen[start]) continue
    const cells: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()!
      cells.push(i)
      for (const j of [i - 1, i + 1, i - columns, i + columns]) {
        if (j >= 0 && j < open.length && open[j] && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    if (cells.length * step * step < 600) continue
    // Principal axis of the cells.
    let sx = 0, sz = 0
    for (const i of cells) {
      sx += (i % columns) * step
      sz += Math.floor(i / columns) * step
    }
    const cx = sx / cells.length, cz = sz / cells.length
    let xx = 0, zz = 0, xz = 0
    for (const i of cells) {
      const x = (i % columns) * step - cx, z = Math.floor(i / columns) * step - cz
      xx += x * x
      zz += z * z
      xz += x * z
    }
    const angle = 0.5 * Math.atan2(2 * xz, xx - zz)
    lots.push({ cells, centre: [cx, cz], axis: [Math.cos(angle), Math.sin(angle)] })
  }
  return lots
}

/** Rows of 2.6 m stalls, 5.4 m deep, back to back with 7 m aisles, about 60% full. */
function fillLot(lot: Lot, grid: TerrainGrid, random: () => number): ParkedCar[] {
  const inLot = new Set(lot.cells)
  const insideAt = (x: number, z: number) => {
    const col = Math.round(x / grid.step), row = Math.round(z / grid.step)
    return inLot.has(row * grid.columns + col)
  }
  const [ax, az] = lot.axis
  const nx = -az, nz = ax
  const cars: ParkedCar[] = []
  const span = Math.sqrt(lot.cells.length) * grid.step * 1.5
  const module = 5.4 * 2 + 7
  for (let across = -span; across <= span; across += module) {
    for (const side of [-1, 1]) {
      const offset = across + side * 2.7
      for (let along = -span; along <= span; along += 2.6) {
        const x = lot.centre[0] + ax * along + nx * offset
        const z = lot.centre[1] + az * along + nz * offset
        // Whole stall must be in the lot.
        if (!insideAt(x + nx * 2.4, z + nz * 2.4) || !insideAt(x - nx * 2.4, z - nz * 2.4) || !insideAt(x, z)) continue
        if (random() > 0.6) continue
        // Nose into the aisle half the time.
        const facing = Math.atan2(-nx * side, nz * side) + (random() < 0.5 ? Math.PI : 0)
        const roll = random()
        cars.push({ x, z, heading: facing + (random() - 0.5) * 0.08, body: roll < 0.45 ? 0 : roll < 0.85 ? 1 : 2, colour: CAR_COLOURS[Math.floor(random() * CAR_COLOURS.length)] })
      }
    }
  }
  return cars
}

/** A 3 m deck along the wall that faces most downhill, for footprints over 60 m². */
export function deckFor(building: Building, grid: TerrainGrid): Deck | null {
  const ring = building.ring
  if (Math.abs(area(ring)) < 60) return null
  const [cx, cz] = centroid(ring)
  const ground = grid.sampleTerrain(cx, cz)
  if (!ground) return null
  const downhill: Point2 = [ground.normal.x, ground.normal.z]
  const slope = Math.hypot(downhill[0], downhill[1])
  if (slope < 0.03) return null
  let best = -Infinity, bestEdge = -1
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 6) continue
    // Outward normal of a ring with positive signed area in (x, z).
    const ox = -(z1 - z0) / len, oz = (x1 - x0) / len
    const score = (ox * downhill[0] + oz * downhill[1]) / slope + len * 0.01
    if (score > best) ((best = score), (bestEdge = i))
  }
  if (bestEdge < 0 || best < 0.4) return null
  const [x0, z0] = ring[bestEdge], [x1, z1] = ring[(bestEdge + 1) % ring.length]
  const len = Math.hypot(x1 - x0, z1 - z0)
  const ux = (x1 - x0) / len, uz = (z1 - z0) / len
  const ox = -uz, oz = ux
  const keep = Math.min(len - 1, Math.max(5, len * 0.7))
  const start = (len - keep) / 2
  const a: Point2 = [x0 + ux * start, z0 + uz * start]
  const b: Point2 = [a[0] + ux * keep, a[1] + uz * keep]
  const depth = 3
  // Floor level with the ground floor: the building base plus a step.
  return {
    corners: [a, b, [b[0] + ox * depth, b[1] + oz * depth], [a[0] + ox * depth, a[1] + oz * depth]],
    floor: building.base + 0.6,
    patio: PATIO.test(building.name ?? ''),
  }
}

/** The Billy Goat Hut: beside the top of Quickdraw, off the lift line and the runs. */
export function placeHut(lifts: Lift[], runs: Run[], grid: TerrainGrid): Hut | null {
  const lift = lifts.find((l) => /quickdraw/i.test(l.name))
  if (!lift) return null
  const [tx, tz] = lift.top
  const [bx, bz] = lift.bottom
  const len = Math.hypot(tx - bx, tz - bz)
  const ux = (tx - bx) / len, uz = (tz - bz) / len
  const runLines = runs.filter((r) => r.kind === 'line').flatMap((r) => r.parts)
  let best: Hut | null = null
  let bestScore = -Infinity
  for (const side of [1, -1]) {
    for (const back of [10, 20, 30]) {
      for (const out of [22, 32, 42]) {
        const x = tx + ux * back - uz * out * side
        const z = tz + uz * back + ux * out * side
        const g = grid.sampleTerrain(x, z)
        if (!g) continue
        const clear = Math.min(...runLines.map((line) => Math.sqrt(nearestOnPolyline(x, z, line).distanceSq)))
        const score = Math.min(clear, 25) * 2 - (1 - g.normal.y) * 200 - out * 0.3
        if (score > bestScore) {
          bestScore = score
          // Door faces the lift top.
          best = { x, z, heading: Math.atan2(-(tx - x), tz - z) }
        }
      }
    }
  }
  return best
}

function centroid(ring: Point2[]): Point2 {
  let x = 0, z = 0
  for (const [px, pz] of ring) ((x += px), (z += pz))
  return [x / ring.length, z / ring.length]
}

function area(ring: Point2[]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return s / 2
}

function nearRing(x: number, z: number, ring: Point2[], distance: number): boolean {
  if (pointInRing(x, z, ring)) return true
  return nearestOnPolyline(x, z, [...ring, ring[0]]).distanceSq < distance * distance
}
