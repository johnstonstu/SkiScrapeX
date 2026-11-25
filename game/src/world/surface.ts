import type { TerrainGrid } from './terrainGrid'
import type { ExposureField } from './exposure'
import { nearestOnPolyline, pointInRing, runHalfWidth, type Resort } from './resort'

/** Same ids as `fx/snow/mask.ts`. Kept here so the world module has no Three.js import. */
export const SurfaceId = { groomed: 0, powder: 1, ice: 2, rock: 3, underTree: 4, park: 5 } as const

export interface Canopy {
  /** Share of each grid cell under canopy taller than the threshold, 0..1, per height sample. */
  cover: Float32Array
  /** Tallest canopy in each cell, metres, per height sample. */
  height: Float32Array
}

export interface SurfaceField {
  /** Texels across (east) and down (south). Texel centres sit at (i + 0.5) * texel. */
  width: number
  height: number
  texel: number
  /** RGBA mask for SnowMaterial: R surface id × 32, G groom heading / 2π. Forest shade is a separate canopy texture. */
  mask: Uint8Array
  /** 1 on a mapped run, road or building lot. Trees stay off these texels. */
  runNameAt(x: number, z: number): string
  clear: Uint8Array
  /** Wind exposure over the grid (summit crust and rock on off-piste snow), if built. */
  exposure: ExposureField | null
}

const TAU = Math.PI * 2
const ROAD_CLEAR = 7
const LOT_CLEAR = 5

/**
 * Rasterise runs into a surface mask over the terrain grid.
 * Texels cover the grid from x = 0 to width and z = 0 to depth.
 */
export function buildSurface(
  grid: TerrainGrid,
  resort: Resort,
  texel = 2.5,
  parks: { name?: string; line: [number, number][]; halfWidth: number }[] = [],
  options: { exposure?: ExposureField } = {},
): SurfaceField {
  const width = Math.ceil(grid.width / texel)
  const height = Math.ceil(grid.depth / texel)
  const count = width * height
  const mask = new Uint8Array(count * 4)
  const names = ['Off-piste']
  const locations = new Uint16Array(count)
  const clear = new Uint8Array(count)
  const runDistance = new Float32Array(count).fill(Infinity)
  const surface = new Uint8Array(count).fill(SurfaceId.powder)
  const heading = new Float32Array(count)

  for (const run of resort.runs) {
    const location = names.push(run.name) - 1
    const clearCorridor = !run.wooded
    const id = run.groomed ? SurfaceId.groomed : SurfaceId.powder
    if (run.kind === 'area') {
      for (const ring of run.parts) {
        const [minX, minZ, maxX, maxZ] = bounds(ring, 0)
        const direction = principalDirection(ring)
        eachTexel(minX, minZ, maxX, maxZ, texel, width, height, (index, x, z) => {
          if (!pointInRing(x, z, ring)) return
          if (clearCorridor) clear[index] = 1
          locations[index] = location
          surface[index] = id
          heading[index] = Math.atan2(direction[1], direction[0])
          runDistance[index] = 0
        })
      }
      continue
    }
    const half = runHalfWidth(run)
    for (const line of run.parts) {
      // One segment at a time keeps the work proportional to the run's area.
      for (let s = 1; s < line.length; s++) {
        const segment: [number, number][] = [line[s - 1], line[s]]
        const [minX, minZ, maxX, maxZ] = bounds(segment, half * 1.15)
        eachTexel(minX, minZ, maxX, maxZ, texel, width, height, (index, x, z) => {
          const near = nearestOnPolyline(x, z, segment)
          // Ragged edge so mapped centrelines do not look ruled.
          const wobble = half * (0.72 + 0.45 * edgeNoise(x, z))
          if (near.distanceSq > wobble * wobble || near.distanceSq >= runDistance[index]) return
          runDistance[index] = near.distanceSq
          if (clearCorridor) clear[index] = 1
          locations[index] = location
          surface[index] = id
          heading[index] = Math.atan2(near.dirZ, near.dirX)
        })
      }
    }
  }

  // Terrain parks: groomed look, park physics, no trees.
  for (const park of parks) {
    const location = names.push(park.name ?? 'Terrain park') - 1
    for (let k = 1; k < park.line.length; k++) {
      const segment: [number, number][] = [park.line[k - 1], park.line[k]]
      const [minX, minZ, maxX, maxZ] = bounds(segment, park.halfWidth)
      eachTexel(minX, minZ, maxX, maxZ, texel, width, height, (index, x, z) => {
        const near = nearestOnPolyline(x, z, segment)
        if (near.distanceSq > park.halfWidth * park.halfWidth) return
        clear[index] = 1
        locations[index] = location
        surface[index] = SurfaceId.park
        heading[index] = Math.atan2(near.dirZ, near.dirX)
      })
    }
  }

  // Roads (drawn by render/roadView.ts) need a clear corridor.
  for (const road of resort.roads) {
    for (let s = 1; s < road.length; s++) {
      const segment: [number, number][] = [road[s - 1], road[s]]
      const [minX, minZ, maxX, maxZ] = bounds(segment, ROAD_CLEAR)
      eachTexel(minX, minZ, maxX, maxZ, texel, width, height, (index, x, z) => {
        const near = nearestOnPolyline(x, z, segment)
        if (near.distanceSq > ROAD_CLEAR * ROAD_CLEAR) return
        clear[index] = 1
      })
    }
  }
  // Building lots: keep trees a few metres off the walls.
  for (const building of resort.buildings) {
    const ring = building.points.map((p): [number, number] => [p.x, p.z])
    if (ring.length < 3) continue
    const [minX, minZ, maxX, maxZ] = bounds(ring, LOT_CLEAR)
    eachTexel(minX, minZ, maxX, maxZ, texel, width, height, (index, x, z) => {
      if (pointInRing(x, z, ring) || nearestOnPolyline(x, z, [...ring, ring[0]]).distanceSq < LOT_CLEAR * LOT_CLEAR) {
        clear[index] = 1
      }
    })
  }

  for (let i = 0; i < count; i++) {
    const turns = (((heading[i] / TAU) % 1) + 1) % 1
    mask[i * 4] = surface[i] * 32
    mask[i * 4 + 1] = Math.round(turns * 255)
    mask[i * 4 + 3] = 255
  }
  function runNameAt(x: number, z: number) {
    const col = Math.floor(x / texel), row = Math.floor(z / texel)
    if (col < 0 || row < 0 || col >= width || row >= height) return names[0]
    return names[locations[row * width + col]]
  }
  return { width, height, texel, mask, clear, runNameAt, exposure: options.exposure ?? null }
}

export function surfaceAt(field: SurfaceField, x: number, z: number): number {
  const column = Math.floor(x / field.texel)
  const row = Math.floor(z / field.texel)
  if (column < 0 || row < 0 || column >= field.width || row >= field.height) return SurfaceId.powder
  return Math.round(field.mask[(row * field.width + column) * 4] / 32)
}

export function isClear(field: SurfaceField, x: number, z: number): boolean {
  const column = Math.floor(x / field.texel)
  const row = Math.floor(z / field.texel)
  if (column < 0 || row < 0 || column >= field.width || row >= field.height) return false
  return field.clear[row * field.width + column] === 1
}

export function nearestSample(grid: TerrainGrid, x: number, z: number): number {
  const column = Math.max(0, Math.min(grid.columns - 1, Math.round(x / grid.step)))
  const row = Math.max(0, Math.min(grid.rows - 1, Math.round(z / grid.step)))
  return row * grid.columns + column
}

function eachTexel(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  texel: number,
  width: number,
  height: number,
  visit: (index: number, x: number, z: number) => void,
): void {
  const c0 = Math.max(0, Math.floor(minX / texel))
  const c1 = Math.min(width - 1, Math.ceil(maxX / texel))
  const r0 = Math.max(0, Math.floor(minZ / texel))
  const r1 = Math.min(height - 1, Math.ceil(maxZ / texel))
  for (let row = r0; row <= r1; row++) {
    for (let column = c0; column <= c1; column++) {
      visit(row * width + column, (column + 0.5) * texel, (row + 0.5) * texel)
    }
  }
}

function bounds(points: [number, number][], pad: number): [number, number, number, number] {
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return [minX - pad, minZ - pad, maxX + pad, maxZ + pad]
}

/** Long axis of a ring, used as the grooming direction of an area run. */
function principalDirection(ring: [number, number][]): [number, number] {
  let best: [number, number] = [0, 1]
  let bestLength = 0
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const dx = ring[j][0] - ring[i][0]
      const dz = ring[j][1] - ring[i][1]
      const length = Math.hypot(dx, dz)
      if (length > bestLength) {
        bestLength = length
        best = [dx / length, dz / length]
      }
    }
  }
  return best
}

/** Smooth -1..1 noise along run edges (extra octave for sapling-scale jags). */
function edgeNoise(x: number, z: number): number {
  const a = Math.sin(x * 0.071 + Math.sin(z * 0.043) * 2.1)
  const b = Math.sin(z * 0.093 - x * 0.021)
  const c = Math.sin(x * 0.19 + z * 0.17 + 0.7)
  return a * 0.45 + b * 0.3 + c * 0.25
}
