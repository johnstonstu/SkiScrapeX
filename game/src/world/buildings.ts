import type { TerrainGrid } from './terrainGrid'
import type { Canopy } from './surface'
import { nearestOnPolyline, pointInRing, type Point2 } from './resort'

/**
 * Building shells from OSM footprints. Pure data: footprints, wall and roof
 * heights, roof style. `render/buildingView.ts` turns these into meshes.
 */
export interface Building {
  id: string
  name: string | null
  kind: string
  /** Counter-clockwise footprint seen from above (+X east, +Z south), not closed. */
  ring: Point2[]
  /** Lowest ground under the footprint; walls start a little below it. */
  base: number
  /** Top of the walls (eaves). */
  eaves: number
  roof: GableRoof | null
  /** Plain colour index into the wall palette. */
  palette: number
}

/** Ridge along the long axis of the footprint's oriented bounding box. */
export interface GableRoof {
  centre: Point2
  /** Unit vector along the ridge. */
  axis: Point2
  halfLength: number
  halfWidth: number
  rise: number
}

export interface FeatureBuilding {
  id?: string
  name?: string | null
  building?: string
  tags?: Record<string, string>
  points: { x: number; z: number }[]
}

const LEVEL_METRES = 3
const ROOF_PITCH = Math.tan((32 * Math.PI) / 180)

export function buildBuildings(
  features: FeatureBuilding[],
  heightAt: (x: number, z: number) => number,
  lidar?: { grid: TerrainGrid; canopy: Canopy },
): Building[] {
  const buildings: Building[] = []
  features.forEach((feature, index) => {
    let ring = feature.points.map((p): Point2 => [p.x, p.z])
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1)
    if (ring.length < 3) return
    if (signedArea(ring) < 0) ring.reverse()
    const area = Math.abs(signedArea(ring))
    if (area < 6) return
    const grounds = ring.map(([x, z]) => heightAt(x, z)).filter(Number.isFinite)
    if (grounds.length !== ring.length) return
    const low = Math.min(...grounds)
    const high = Math.max(...grounds)
    const kind = feature.building ?? feature.tags?.building ?? 'yes'
    const levels = levelsFor(kind, area, feature.tags)
    let eaves = high + levels * LEVEL_METRES
    const box = orientedBox(ring)
    const fill = area / (4 * box.halfLength * box.halfWidth)
    const roof: GableRoof | null =
      fill > 0.82 && box.halfWidth < 14
        ? { ...box, rise: box.halfWidth * ROOF_PITCH }
        : null
    // Inside a footprint the first-return surface measures the roof. Keep cells
    // clear of the eave so nearby trees do not supply the building height.
    if (lidar && !Number(feature.tags?.['building:levels'])) {
      const { grid, canopy } = lidar
      const samples: number[] = []
      const boundary = [...ring, ring[0]]
      const xs = ring.map(p => p[0]), zs = ring.map(p => p[1])
      for (let row = Math.max(0, Math.ceil(Math.min(...zs) / grid.step)); row <= Math.min(grid.rows - 1, Math.max(...zs) / grid.step); row++) {
        for (let col = Math.max(0, Math.ceil(Math.min(...xs) / grid.step)); col <= Math.min(grid.columns - 1, Math.max(...xs) / grid.step); col++) {
          const x = col * grid.step, z = row * grid.step
          if (!pointInRing(x, z, ring) || nearestOnPolyline(x, z, boundary).distanceSq < grid.step ** 2 / 2) continue
          const index = row * grid.columns + col
          if (canopy.cover[index] > 0.7) samples.push(grid.heights[index] + canopy.height[index])
        }
      }
      if (samples.length >= 3) {
        samples.sort((a, b) => a - b)
        const estimate = samples[Math.floor(samples.length / 2)] - (roof?.rise ?? 0) * 0.65
        if (estimate >= high + 2.2 && estimate <= high + 25) eaves = estimate
      }
    }
    buildings.push({
      id: feature.id ?? `building/${index}`,
      name: (feature.name ?? feature.tags?.name)?.replace(/Gunbarell/i, 'Gunbarrel').replace(/The edge bistro/i, 'The Edge Bistro') ?? null,
      kind,
      ring,
      base: low - 0.6,
      eaves,
      roof,
      palette: hash(feature.id ?? String(index)) % 6,
    })
  })
  return buildings
}

function levelsFor(kind: string, area: number, tags?: Record<string, string>): number {
  const tagged = Number(tags?.['building:levels'])
  if (Number.isFinite(tagged) && tagged > 0) return Math.min(8, tagged)
  const height = Number.parseFloat(tags?.height ?? '')
  if (Number.isFinite(height) && height > 0) return Math.max(1, height / LEVEL_METRES)
  switch (kind) {
    case 'service':
    case 'shed':
    case 'garage':
      return 1
    case 'house':
    case 'cabin':
      return 2
    case 'terrace':
      return 3
    case 'apartments':
    case 'hotel':
      return 4
    default:
      return area > 600 ? 3 : area > 120 ? 2 : 1
  }
}

/** Minimum-area rectangle aligned to one of the hull edges. */
export function orientedBox(ring: Point2[]): { centre: Point2; axis: Point2; halfLength: number; halfWidth: number } {
  let best = { centre: ring[0], axis: [1, 0] as Point2, halfLength: 0, halfWidth: 0, area: Infinity }
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]
    const [bx, bz] = ring[(i + 1) % ring.length]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-6) continue
    const ux = (bx - ax) / length
    const uz = (bz - az) / length
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const [x, z] of ring) {
      const u = x * ux + z * uz
      const v = -x * uz + z * ux
      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < best.area) {
      const cu = (minU + maxU) / 2
      const cv = (minV + maxV) / 2
      const centre: Point2 = [cu * ux - cv * uz, cu * uz + cv * ux]
      const alongU = maxU - minU >= maxV - minV
      best = {
        centre,
        axis: alongU ? [ux, uz] : [-uz, ux],
        halfLength: Math.max(maxU - minU, maxV - minV) / 2,
        halfWidth: Math.min(maxU - minU, maxV - minV) / 2,
        area,
      }
    }
  }
  return { centre: best.centre, axis: best.axis, halfLength: best.halfLength, halfWidth: best.halfWidth }
}

export function signedArea(ring: Point2[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]
    const [bx, bz] = ring[(i + 1) % ring.length]
    sum += ax * bz - bx * az
  }
  // +X east, +Z south: positive here is clockwise on a north-up map, so flip.
  return -sum / 2
}

/** Spatial lookup for collisions: is (x, z) inside any footprint grown by `pad`? */
export function indexBuildings(buildings: Building[], cell = 32) {
  const buckets = new Map<number, Building[]>()
  const key = (cx: number, cz: number) => cx * 100003 + cz
  for (const building of buildings) {
    const xs = building.ring.map((p) => p[0])
    const zs = building.ring.map((p) => p[1])
    for (let cx = Math.floor(Math.min(...xs) / cell); cx <= Math.floor(Math.max(...xs) / cell); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / cell); cz <= Math.floor(Math.max(...zs) / cell); cz++) {
        const k = key(cx, cz)
        const list = buckets.get(k)
        if (list) list.push(building)
        else buckets.set(k, [building])
      }
    }
  }
  return {
    hit(x: number, z: number): Building | null {
      for (const building of buckets.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []) {
        if (pointInRing(x, z, building.ring)) return building
      }
      return null
    },
  }
}

function samePoint(a: Point2, b: Point2): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
