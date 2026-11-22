import { pointAlong, type Run } from './resort'
import { surfaceAt, SurfaceId, type SurfaceField } from './surface'
import type { TerrainGrid } from './terrainGrid'
import type { SampleTerrain } from '../sim'

/** Staggered bumps along mapped mogul runs, with an open shoulder on either side. */
export function buildMoguls(grid: TerrainGrid, runs: Run[], surface: SurfaceField) {
  const bumps: { x: number; z: number; height: number }[] = []
  const cells = new Map<number, number[]>()
  const radius = 2.35
  const stride = Math.ceil(grid.width / 8) + 4
  const cell = (x: number, z: number) => Math.floor(x / 8) + stride * Math.floor(z / 8)
  for (const run of runs) {
    if (!run.moguls || run.kind !== 'line') continue
    for (const line of run.parts) {
      for (let row = 0; ; row++) {
        const distance = 20 + row * 4.8
        const [x, z] = pointAlong(line, distance)
        const [nx, nz] = pointAlong(line, distance + 1)
        const length = Math.hypot(nx - x, nz - z)
        if (length < 0.01) break
        for (const lane of [-1, 0, 1]) {
          const side = lane * 4.8 + (row % 2 - 0.5) * 2.8 + 0.35 * Math.sin(row + lane)
          const bx = x + side * (nz - z) / length
          const bz = z - side * (nx - x) / length
          if (surfaceAt(surface, bx, bz) !== SurfaceId.powder || !Number.isFinite(grid.heightAt(bx, bz))) continue
          const index = bumps.length
          bumps.push({ x: bx, z: bz, height: 0.45 + 0.14 * Math.sin(row * 0.81 + lane) })
          for (let cz = Math.floor((bz - radius) / 8); cz <= Math.floor((bz + radius) / 8); cz++) {
            for (let cx = Math.floor((bx - radius) / 8); cx <= Math.floor((bx + radius) / 8); cx++) {
              const key = cz * stride + cx
              if (!cells.has(key)) cells.set(key, [])
              cells.get(key)!.push(index)
            }
          }
        }
      }
    }
  }
  const sampleTerrain: SampleTerrain = (x, z) => {
    const base = grid.sampleTerrain(x, z)
    const nearby = cells.get(cell(x, z))
    if (!base || !nearby) return base
    let rise = 0, dx = 0, dz = 0
    for (const i of nearby) {
      const bump = bumps[i]
      const u = (x - bump.x) / radius, v = (z - bump.z) / radius
      const t = 1 - u * u - v * v
      if (t <= 0 || bump.height * t * t <= rise) continue
      rise = bump.height * t * t
      dx = -4 * bump.height * t * u / radius
      dz = -4 * bump.height * t * v / radius
    }
    if (!rise) return base
    const gx = -base.normal.x / base.normal.y + dx
    const gz = -base.normal.z / base.normal.y + dz
    const length = Math.hypot(gx, 1, gz)
    return { ...base, height: base.height + rise, normal: { x: -gx / length, y: 1 / length, z: -gz / length } }
  }
  return { bumps, radius, sampleTerrain }
}
