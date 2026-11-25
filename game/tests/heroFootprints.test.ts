import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadDiskGrid } from './diskGrid'
import { resortFromFeatures } from '../src/world/resort'
import { buildBuildings } from '../src/world/buildings'

/**
 * tools/blender/footprints.json is what build_buildings.py models the hero
 * buildings on: each one's OSM footprint (relative to its centroid) and the
 * ground under it, so the model sits where the game's collisions are.
 * Regenerate with: UPDATE_FOOTPRINTS=1 npx vitest run tests/heroFootprints.test.ts
 */
const DATA = 'public/data/'
const FILE = new URL('../../tools/blender/footprints.json', import.meta.url)
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`)
const HEROES = ['Gunbarrel Saloon', 'Apex Mountain Inn']

interface Footprint {
  name: string
  id: string
  /** World position of the model origin: footprint centroid, lowest ground under it. */
  origin: [number, number, number]
  /** Footprint relative to the origin, counter-clockwise from above, metres. */
  ring: [number, number][]
  /** Ground height relative to the origin at each ring point. */
  ground: number[]
  /** A 2 m grid of ground heights over the footprint's box (relative to the origin), row-major from minX/minZ. */
  terrain: { minX: number; minZ: number; step: number; columns: number; rows: number; heights: number[] }
}

function footprints(): Footprint[] {
  const grid = loadDiskGrid(DATA)
  const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
  const shells = buildBuildings(resort.buildings, grid.heightAt)
  const round = (v: number) => Math.round(v * 100) / 100
  return HEROES.map((name) => {
    const shell = shells.find((b) => b.name === name)
    if (!shell) throw new Error(`Hero building ${name} is not in features.json`)
    const cx = shell.ring.reduce((s, p) => s + p[0], 0) / shell.ring.length
    const cz = shell.ring.reduce((s, p) => s + p[1], 0) / shell.ring.length
    const ground = shell.ring.map(([x, z]) => grid.heightAt(x, z))
    const low = Math.min(...ground)
    const xs = shell.ring.map((p) => p[0] - cx), zs = shell.ring.map((p) => p[1] - cz)
    const step = 2
    const minX = Math.floor(Math.min(...xs) - 12), minZ = Math.floor(Math.min(...zs) - 12)
    const columns = Math.ceil((Math.max(...xs) + 12 - minX) / step) + 1
    const rows = Math.ceil((Math.max(...zs) + 12 - minZ) / step) + 1
    const heights: number[] = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) heights.push(round(grid.heightAt(cx + minX + c * step, cz + minZ + r * step) - low))
    return {
      name,
      id: shell.id,
      origin: [round(cx), round(low), round(cz)],
      ring: shell.ring.map(([x, z]) => [round(x - cx), round(z - cz)] as [number, number]),
      ground: ground.map((g) => round(g - low)),
      terrain: { minX, minZ, step, columns, rows, heights },
    }
  })
}

describe.skipIf(!hasData)('hero building footprints', () => {
  it('match the file the Blender building script reads', () => {
    const current = footprints()
    if (process.env.UPDATE_FOOTPRINTS) writeFileSync(FILE, JSON.stringify(current) + '\n')
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as Footprint[]
    for (const fresh of current) {
      const saved = stored.find((s) => s.name === fresh.name)!
      expect(saved.id).toBe(fresh.id)
      expect(saved.origin).toEqual(fresh.origin)
      expect(saved.ring).toEqual(fresh.ring)
    }
  })
})
