import type { TerrainGrid } from './terrainGrid'

/**
 * Wind exposure: how hard the wind strips snow off each 5 m sample, 0..1.
 * Summit ridges and windward faces get scoured to crust and then rock; flat
 * plateaus, hollows and lee slopes keep their snow. The value is smooth, so
 * the snow shader and the sim threshold it per pixel and per position rather
 * than per mask texel (no square patches).
 */
export interface ExposureField {
  columns: number
  rows: number
  step: number
  values: Float32Array
}

/** Prevailing wind, blowing toward +X east and a little south (+Z). Matches the shader's powder ripples. */
export const WIND = { x: 0.87, z: 0.49 } as const

/** Exposure where the snow turns to wind crust, and where rock pokes through. */
export const SCOUR = { crust: 0.35, rock: 0.62, band: 0.05 } as const

export interface ExposureOptions {
  /** Height of the grid's zero, metres above sea level. */
  originElevation?: number
  /** Elevation (m ASL) where scouring starts, and where it is at full strength. */
  fromElevation?: number
  fullElevation?: number
  /** Canopy cover per sample, 0..1. Trees hold the snow. */
  cover?: Float32Array
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** Ring offsets (in cells) for the topographic position index. */
const DIRECTIONS: [number, number][] = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]]

export function buildExposure(grid: TerrainGrid, options: ExposureOptions = {}): ExposureField {
  const base = grid.coarse ?? grid
  const { columns, rows, step, heights, normals } = base
  const origin = options.originElevation ?? 1600
  const from = options.fromElevation ?? 2040
  const full = options.fullElevation ?? 2150
  const values = new Float32Array(columns * rows)

  // Height relative to the mean of a ring around the sample: positive on ridges and knolls.
  const ringMean = (col: number, row: number, radius: number, centre: number) => {
    let sum = 0
    let n = 0
    for (const [dx, dz] of DIRECTIONS) {
      const c = Math.round(col + dx * radius)
      const r = Math.round(row + dz * radius)
      if (c < 0 || r < 0 || c >= columns || r >= rows) continue
      const h = heights[r * columns + c]
      if (!Number.isFinite(h)) continue
      sum += h
      n++
    }
    return n ? sum / n : centre
  }

  const near = Math.max(1, Math.round(20 / step))
  const far = Math.max(near + 1, Math.round(45 / step))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const i = row * columns + col
      const h = heights[i]
      if (!Number.isFinite(h)) continue
      const elevation = smoothstep(from, full, h + origin)
      if (elevation <= 0) continue

      const tpiNear = h - ringMean(col, row, near, h)
      const tpiFar = h - ringMean(col, row, far, h)
      const convex = 0.6 * smoothstep(0.2, 2.2, tpiNear) + 0.4 * smoothstep(0.4, 4.5, tpiFar)
      const hollow = smoothstep(0.3, 2.5, -tpiNear)

      const nx = normals[i * 3]
      const ny = normals[i * 3 + 1]
      const nz = normals[i * 3 + 2]
      const slopeDeg = (Math.acos(Math.max(-1, Math.min(1, ny))) * 180) / Math.PI
      const horizontal = Math.hypot(nx, nz)
      // +1 where the slope faces into the wind, -1 on the lee side.
      const facing = horizontal > 1e-4 ? -(nx * WIND.x + nz * WIND.z) / horizontal : 0
      const aspect = smoothstep(6, 22, slopeDeg)
      const windward = smoothstep(-0.1, 0.8, facing) * aspect
      const lee = smoothstep(0.15, 0.85, -facing) * aspect
      const steep = smoothstep(24, 42, slopeDeg)

      let e = 0.08 + 0.62 * convex + 0.3 * windward + 0.22 * steep - 0.4 * lee - 0.3 * hollow
      const cover = options.cover?.[i] ?? 0
      e *= 1 - smoothstep(0.12, 0.5, cover)
      values[i] = clamp01(e) * elevation
    }
  }
  return { columns, rows, step, values }
}

/** Bilinear exposure at a world position (0 outside the grid). */
export function exposureAt(field: ExposureField, x: number, z: number): number {
  const { columns, rows, step, values } = field
  const gx = x / step
  const gz = z / step
  if (gx < 0 || gz < 0 || gx > columns - 1 || gz > rows - 1) return 0
  const col = Math.min(columns - 2, Math.floor(gx))
  const row = Math.min(rows - 2, Math.floor(gz))
  const fx = gx - col
  const fz = gz - row
  const i = row * columns + col
  const top = values[i] + (values[i + 1] - values[i]) * fx
  const bottom = values[i + columns] + (values[i + columns + 1] - values[i + columns]) * fx
  return top + (bottom - top) * fz
}

/** Share of wind crust and of bare rock at an exposure value, with a short soft band at each threshold. */
export function scourShares(exposure: number): { crust: number; rock: number } {
  return {
    crust: smoothstep(SCOUR.crust - SCOUR.band, SCOUR.crust + SCOUR.band, exposure),
    rock: smoothstep(SCOUR.rock - SCOUR.band, SCOUR.rock + SCOUR.band, exposure),
  }
}
