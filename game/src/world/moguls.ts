import { pointAlong, type Run } from './resort'
import { surfaceAt, SurfaceId, type SurfaceField } from './surface'
import type { TerrainGrid } from './terrainGrid'
import type { SampleTerrain } from '../sim'

export interface Mogul {
  x: number
  z: number
  height: number
  dirX: number
  dirZ: number
  width: number
  uphill: number
  downhill: number
}

/** A point in the same asymmetric footprint the physics uses. */
export function pointOnMogul(bump: Mogul, across: number, along: number): [number, number] {
  const u = across * bump.width
  const v = along * (along > 0 ? bump.downhill : bump.uphill)
  return [bump.x + u * bump.dirZ + v * bump.dirX, bump.z - u * bump.dirX + v * bump.dirZ]
}

/** Staggered, irregular rows along mapped mogul runs, with smoother shoulders. */
export function buildMoguls(grid: TerrainGrid, runs: Run[], surface: SurfaceField, avoid?: (x: number, z: number) => boolean) {
  const bumps: Mogul[] = []
  // Overlap check while placing: one bump where mapped runs share a centreline.
  const placed = new Map<string, Mogul[]>()
  const cell = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`
  // Look in the neighbouring cells too, so a bump just across a cell edge still counts.
  const near = (x: number, z: number) =>
    [-1.5, 0, 1.5].some((ox) => [-1.5, 0, 1.5].some((oz) => placed.get(cell(x + ox, z + oz))?.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 1.5 ** 2)))
  for (const run of runs) {
    if (!run.moguls || run.kind !== 'line') continue
    for (const line of run.parts) {
      for (let row = 0; ; row++) {
        const distance = 20 + row * 5.2 + Math.sin(row * 1.64) * 0.62
        const [x, z] = pointAlong(line, distance)
        const [nx, nz] = pointAlong(line, distance + 1)
        const length = Math.hypot(nx - x, nz - z)
        if (length < 0.01) break
        const dirX = (nx - x) / length, dirZ = (nz - z) / length
        for (const lane of [-1, 0, 1]) {
          const shape = row * 1.73 + lane * 2.4 + x * 0.015
          const side = lane * 4.5 + (row % 2 - 0.5) * 3.3 + 0.5 * Math.sin(shape)
          const stagger = 0.4 * Math.cos(shape * 1.2)
          const bx = x + side * dirZ + dirX * stagger
          const bz = z - side * dirX + dirZ * stagger
          if (surfaceAt(surface, bx, bz) !== SurfaceId.powder || !Number.isFinite(grid.heightAt(bx, bz)) || avoid?.(bx, bz)) continue
          // Mapped runs can share a centreline. Plant one bump where they overlap.
          if (near(bx, bz)) continue
          const bump = {
            x: bx, z: bz, dirX, dirZ,
            // Deeper crests (~0.5–0.94 m) so Gunbarrel-style fields cast readable shade.
            height: 0.72 + 0.22 * Math.sin(shape * 0.86),
            width: 2.05 + 0.24 * Math.cos(shape),
            uphill: 2.75 + 0.25 * Math.sin(shape),
            downhill: 1.95 + 0.22 * Math.cos(shape * 0.61),
          }
          bumps.push(bump)
          const key = cell(bx, bz)
          if (!placed.has(key)) placed.set(key, [])
          placed.get(key)!.push(bump)
        }
      }
    }
  }
  const field = bumpField(bumps)
  const sampleTerrain: SampleTerrain = (x, z) => {
    const base = grid.sampleTerrain(x, z)
    return base ? field.apply(base, x, z) : base
  }
  return { bumps, sampleTerrain, onMogul: (x: number, z: number) => (field.profile(x, z)?.rise ?? 0) > 0.07 }
}

/**
 * A bump list as terrain: the rise and slope of the highest bump at a point
 * (looked up in an 8 m cell index), and `apply`, which raises a terrain sample
 * by it and tilts its normal. Used for the mapped mogul runs and for event
 * courses (the mogul comp) laid on top of the terrain while they run.
 */
export function bumpField(bumps: readonly Mogul[]) {
  const cells = new Map<number, Mogul[]>()
  // Numeric cell keys: the profile runs for every terrain sample the physics takes.
  const key = (cx: number, cz: number) => cx + cz * 65536
  for (const bump of bumps) {
    const radius = Math.max(bump.width, bump.uphill, bump.downhill)
    for (let cz = Math.floor((bump.z - radius) / 8); cz <= Math.floor((bump.z + radius) / 8); cz++) {
      for (let cx = Math.floor((bump.x - radius) / 8); cx <= Math.floor((bump.x + radius) / 8); cx++) {
        const k = key(cx, cz)
        if (!cells.has(k)) cells.set(k, [])
        cells.get(k)!.push(bump)
      }
    }
  }
  const profile = (x: number, z: number) => {
    const nearby = cells.get(key(Math.floor(x / 8), Math.floor(z / 8)))
    if (!nearby) return null
    let rise = 0, dx = 0, dz = 0
    for (const bump of nearby) {
      const ex = x - bump.x, ez = z - bump.z
      const along = ex * bump.dirX + ez * bump.dirZ
      const length = along > 0 ? bump.downhill : bump.uphill
      const u = (ex * bump.dirZ - ez * bump.dirX) / bump.width, v = along / length
      const t = 1 - u * u - v * v
      if (t <= 0 || bump.height * t * t <= rise) continue
      rise = bump.height * t * t
      const du = -4 * bump.height * t * u / bump.width
      const dv = -4 * bump.height * t * v / length
      dx = du * bump.dirZ + dv * bump.dirX
      dz = -du * bump.dirX + dv * bump.dirZ
    }
    return rise > 0 ? { rise, dx, dz } : null
  }
  type Sample = NonNullable<ReturnType<SampleTerrain>>
  const apply = (base: Sample, x: number, z: number): Sample => {
    const bump = profile(x, z)
    if (!bump) return base
    const gx = -base.normal.x / base.normal.y + bump.dx
    const gz = -base.normal.z / base.normal.y + bump.dz
    const length = Math.hypot(gx, 1, gz)
    return { ...base, height: base.height + bump.rise, mogulHeight: (base.mogulHeight ?? 0) + bump.rise, normal: { x: -gx / length, y: 1 / length, z: -gz / length } }
  }
  return { bumps, profile, apply }
}
