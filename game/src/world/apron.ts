import type { TerrainGrid } from './terrainGrid'

/**
 * Coarse procedural land around the LidarBC crop so the world does not end at
 * a cliff. Grid lines include the crop edges, where heights match the crop
 * exactly; outside, heights blend from the crop edge into rolling ridges.
 * Inside the crop the apron sits well below the real terrain and is hidden.
 */
export interface Apron {
  xs: number[]
  zs: number[]
  heights: Float32Array
  /** Bilinear height on the apron grid (NaN outside it). */
  heightAt: (x: number, z: number) => number
  /** 0..1 forest cover from elevation and noise. */
  coverAt: (x: number, z: number, height: number) => number
  /** Metres outside the crop (0 inside). */
  outside: (x: number, z: number) => number
}

const BLEND = 1600
/** Real MRDEM heights only need a short blend to meet the LidarBC edge. */
const REAL_BLEND = 250
const TREELINE = 560

/** NRCan MRDEM 30 m ground and canopy around the crop, resampled to the crop frame. */
export interface Horizon {
  columns: number
  rows: number
  step: number
  /** Local x, z of sample [0, 0] (cell centre). */
  originX: number
  originZ: number
  heights: Float32Array
  /** Surface minus ground, metres. */
  canopy: Float32Array | null
}

export function sampleHorizon(h: Horizon, values: Float32Array, x: number, z: number): number {
  const gx = (x - h.originX) / h.step
  const gz = (z - h.originZ) / h.step
  if (gx < 0 || gz < 0 || gx > h.columns - 1 || gz > h.rows - 1) return Number.NaN
  const c = Math.min(Math.floor(gx), h.columns - 2)
  const r = Math.min(Math.floor(gz), h.rows - 2)
  const u = gx - c
  const v = gz - r
  const i = r * h.columns + c
  return (values[i] * (1 - u) + values[i + 1] * u) * (1 - v) + (values[i + h.columns] * (1 - u) + values[i + h.columns + 1] * u) * v
}

/** Grid spacing grows with distance from the crop: 90 m near, 300 m at the far edge. */
function spacing(distance: number): number {
  return distance < 2000 ? 90 : distance < 6000 ? 180 : 300
}

export function buildApron(grid: TerrainGrid, horizon: Horizon | null = null, pad = horizon ? 11500 : 5000): Apron {
  const axis = (size: number) => {
    const values = new Set<number>([0, size])
    for (let v = 0; v <= size; v += 90) values.add(Math.round(v))
    for (let d = 0; d <= pad; d += spacing(d)) {
      values.add(Math.round(-d))
      values.add(Math.round(size + d))
    }
    // Denser lines just outside the edge so the blend starts smoothly.
    for (const d of [15, 40]) {
      values.add(-d)
      values.add(size + d)
    }
    return [...values].sort((a, b) => a - b)
  }
  const xs = axis(grid.width)
  const zs = axis(grid.depth)
  const outside = (x: number, z: number) => {
    const dx = Math.max(0, -x, x - grid.width)
    const dz = Math.max(0, -z, z - grid.depth)
    return Math.hypot(dx, dz)
  }
  const edgeHeight = (x: number, z: number) =>
    grid.heightAt(Math.min(grid.width, Math.max(0, x)), Math.min(grid.depth, Math.max(0, z)))

  const heights = new Float32Array(xs.length * zs.length)
  zs.forEach((z, row) => {
    xs.forEach((x, column) => {
      const d = outside(x, z)
      const edge = edgeHeight(x, z)
      const inside = x > 0 && x < grid.width && z > 0 && z < grid.depth
      let h: number
      const real = horizon ? sampleHorizon(horizon, horizon.heights, x, z) : Number.NaN
      if (inside) h = edge - 60
      else if (Number.isFinite(real)) {
        const t = smoothstep(0, REAL_BLEND, d)
        h = edge * (1 - t) + real * t
      } else {
        const t = smoothstep(0, BLEND, d)
        h = edge * (1 - t) + ridges(x, z) * t + t * (1 - t) * 60 * (fbm(x / 700, z / 700) - 0.5)
      }
      heights[row * xs.length + column] = Number.isFinite(h) ? h : 0
    })
  })

  const find = (values: number[], v: number) => {
    let lo = 0
    let hi = values.length - 1
    if (v < values[0] || v > values[hi]) return -1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (values[mid] <= v) lo = mid
      else hi = mid
    }
    return lo
  }
  const heightAt = (x: number, z: number) => {
    const c = find(xs, x)
    const r = find(zs, z)
    if (c < 0 || r < 0) return Number.NaN
    const u = (x - xs[c]) / (xs[c + 1] - xs[c])
    const v = (z - zs[r]) / (zs[r + 1] - zs[r])
    const i = r * xs.length + c
    const a = heights[i]
    const b = heights[i + 1]
    const cc = heights[i + xs.length]
    const d = heights[i + xs.length + 1]
    return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v
  }
  const coverAt = (x: number, z: number, height: number) => {
    if (horizon?.canopy) {
      const canopy = sampleHorizon(horizon, horizon.canopy, x, z)
      // 30 m cells average canopy and gaps, so a modest height already means forest.
      if (Number.isFinite(canopy)) return Math.max(0, Math.min(1, (canopy - 1.5) / 7))
    }
    const n = fbm(x / 320 + 11.3, z / 320 - 4.1)
    const line = smoothstep(TREELINE + 60, TREELINE - 80, height)
    return Math.max(0, Math.min(1, (n - 0.32) * 2.2)) * line
  }
  return { xs, zs, heights, heightAt, coverAt, outside }
}

/** Rolling Okanagan-highland ridges, roughly 1700 to 2300 m (local y 100 to 700). */
function ridges(x: number, z: number): number {
  const broad = fbm(x / 2600, z / 2600)
  const ridge = 1 - Math.abs(fbm(x / 1300 + 7.7, z / 1300 + 2.3) * 2 - 1)
  return 80 + broad * 420 + ridge * ridge * 260
}

function smoothstep(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash(ix, iz)
  const b = hash(ix + 1, iz)
  const c = hash(ix, iz + 1)
  const d = hash(ix + 1, iz + 1)
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz
}

export function fbm(x: number, z: number): number {
  let sum = 0
  let amplitude = 0.5
  let frequency = 1
  for (let i = 0; i < 4; i++) {
    sum += noise(x * frequency, z * frequency) * amplitude
    frequency *= 2.03
    amplitude *= 0.5
  }
  return sum / 0.9375
}
