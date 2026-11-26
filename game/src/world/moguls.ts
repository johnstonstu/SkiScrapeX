import { pointAlong, runHalfWidth, type Run } from './resort'
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

/**
 * Bump shapes. Moguls are the deep, regular rows skiers cut on steep ungroomed
 * runs (crests about 0.5 to 0.94 m). Chop is what an ungroomed run that is not
 * a mogul field gets after a few days: lower, looser, uneven bumps (about 0.2
 * to 0.4 m) in more, closer lanes.
 */
export const BUMPS = {
  mogul: { start: 20, row: 5.2, laneGap: 4.5, rowShift: 3.3, height: 0.72, heightVary: 0.22, width: 2.05, uphill: 2.75, downhill: 1.95 },
  chop: { start: 15, row: 4.4, laneGap: 3.6, rowShift: 2.6, height: 0.3, heightVary: 0.1, width: 1.75, uphill: 2.2, downhill: 1.6 },
} as const

/** Lanes across a run: three on a normal mogul run, more on wide ones so the field fills most of the run. */
export function mogulLanes(run: Run): number {
  const half = runHalfWidth(run)
  if (run.chop) return Math.max(3, 2 * Math.floor((half * 0.6) / BUMPS.chop.laneGap) + 1)
  return Math.max(3, 2 * Math.floor((half * 0.55) / BUMPS.mogul.laneGap) + 1)
}

/** Staggered, irregular rows along mapped mogul (and chop) runs, with smoother shoulders. */
export function buildMoguls(grid: TerrainGrid, runs: Run[], surface: SurfaceField, avoid?: (x: number, z: number) => boolean) {
  const bumps: Mogul[] = []
  // Overlap check while placing: one bump where mapped runs share a centreline.
  const placed = new Map<string, Mogul[]>()
  const cell = (x: number, z: number) => `${Math.floor(x / 8)},${Math.floor(z / 8)}`
  // Look in the neighbouring cells too, so a bump just across a cell edge still counts.
  const near = (x: number, z: number) =>
    [-1.5, 0, 1.5].some((ox) => [-1.5, 0, 1.5].some((oz) => placed.get(cell(x + ox, z + oz))?.some((b) => (b.x - x) ** 2 + (b.z - z) ** 2 < 1.5 ** 2)))
  for (const run of runs) {
    if (!(run.moguls || run.chop) || run.kind !== 'line') continue
    const spec = run.moguls ? BUMPS.mogul : BUMPS.chop
    const lanes = mogulLanes(run)
    const offsets = Array.from({ length: lanes }, (_, i) => i - (lanes - 1) / 2)
    for (const line of run.parts) {
      for (let row = 0; ; row++) {
        const distance = spec.start + row * spec.row + Math.sin(row * 1.64) * 0.62
        const [x, z] = pointAlong(line, distance)
        const [nx, nz] = pointAlong(line, distance + 1)
        const length = Math.hypot(nx - x, nz - z)
        if (length < 0.01) break
        const dirX = (nx - x) / length, dirZ = (nz - z) / length
        for (const lane of offsets) {
          const shape = row * 1.73 + lane * 2.4 + x * 0.015
          // Chop is looser: more sideways scatter and some gaps in each row.
          if (run.chop && Math.sin(shape * 2.9 + z * 0.031) > 0.55) continue
          const scatter = run.chop ? 1.2 * Math.sin(shape * 1.9) : 0.5 * Math.sin(shape)
          const side = lane * spec.laneGap + (row % 2 - 0.5) * spec.rowShift + scatter
          const stagger = (run.chop ? 1.1 : 0.4) * Math.cos(shape * 1.2)
          const bx = x + side * dirZ + dirX * stagger
          const bz = z - side * dirX + dirZ * stagger
          if (surfaceAt(surface, bx, bz) !== SurfaceId.powder || !Number.isFinite(grid.heightAt(bx, bz)) || avoid?.(bx, bz)) continue
          // Mapped runs can share a centreline. Plant one bump where they overlap.
          if (near(bx, bz)) continue
          const bump = {
            x: bx, z: bz, dirX, dirZ,
            // Deeper crests (~0.5–0.94 m) so Gunbarrel-style fields cast readable shade.
            height: spec.height + spec.heightVary * Math.sin(shape * 0.86),
            width: spec.width + 0.24 * Math.cos(shape),
            uphill: spec.uphill + 0.25 * Math.sin(shape),
            downhill: spec.downhill + 0.22 * Math.cos(shape * 0.61),
          }
          bumps.push(bump)
          const key = cell(bx, bz)
          if (!placed.has(key)) placed.set(key, [])
          placed.get(key)!.push(bump)
        }
      }
    }
  }
  let field = bumpField(bumps)
  const sampleTerrain: SampleTerrain = (x, z) => {
    const base = grid.sampleTerrain(x, z)
    return base ? field.apply(base, x, z) : base
  }
  return {
    bumps,
    sampleTerrain,
    onMogul: (x: number, z: number) => (field.profile(x, z)?.rise ?? 0) > 0.07,
    /**
     * Flatten the bumps whose centre `cleared` covers (a race track while its
     * event runs), or put every bump back with null. Returns the bumps that
     * stay, for the view.
     */
    clear(cleared: ((x: number, z: number) => boolean) | null): readonly Mogul[] {
      const kept = cleared ? bumps.filter((bump) => !cleared(bump.x, bump.z)) : bumps
      field = bumpField(kept)
      return kept
    },
  }
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
