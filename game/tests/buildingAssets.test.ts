import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * public/models/scenery/buildings.glb comes from tools/blender/build_buildings.py,
 * built on the footprints in tools/blender/footprints.json. The game places each
 * model at its footprint centroid on the lowest ground and keeps colliding with
 * the OSM footprint, so a model must stay on that footprint (plus eaves, a deck
 * and signs) and stand on the ground.
 */
const GLB = new URL('../public/models/scenery/buildings.glb', import.meta.url)
const FOOTPRINTS = JSON.parse(readFileSync(new URL('../../tools/blender/footprints.json', import.meta.url), 'utf8')) as {
  name: string
  ring: [number, number][]
}[]
const MODELS: Record<string, string> = { 'Gunbarrel Saloon': 'gunbarrel', 'Apex Mountain Inn': 'apex_inn' }

interface Gltf {
  nodes: { name?: string; children?: number[]; mesh?: number }[]
  scenes: { nodes: number[] }[]
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
}
const bytes = readFileSync(GLB)
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as Gltf

function measure(name: string) {
  const root = gltf.scenes[0].nodes.find((i) => gltf.nodes[i].name === name)
  expect(root, name).toBeDefined()
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  const visit = (index: number) => {
    const node = gltf.nodes[index]
    if (node.mesh !== undefined) {
      for (const p of gltf.meshes[node.mesh].primitives) {
        const position = gltf.accessors[p.attributes.POSITION]
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], position.min![k])
          max[k] = Math.max(max[k], position.max![k])
        }
        triangles += (p.indices !== undefined ? gltf.accessors[p.indices].count : position.count) / 3
      }
    }
    node.children?.forEach(visit)
  }
  visit(root!)
  return { min, max, triangles }
}

describe('hero building models', () => {
  for (const [building, asset] of Object.entries(MODELS)) {
    it(`${building} sits on its footprint and the ground`, () => {
      const ring = FOOTPRINTS.find((f) => f.name === building)!.ring
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1])
      const { min, max, triangles } = measure(asset)
      // Eaves, a deck and signs may reach a few metres past the walls, no further.
      const reach = 9
      expect(min[0]).toBeGreaterThan(Math.min(...xs) - reach)
      expect(max[0]).toBeLessThan(Math.max(...xs) + reach)
      expect(min[2]).toBeGreaterThan(Math.min(...zs) - reach)
      expect(max[2]).toBeLessThan(Math.max(...zs) + reach)
      // It covers its footprint rather than sitting in one corner of it.
      expect(max[0] - min[0]).toBeGreaterThan(Math.max(...xs) - Math.min(...xs))
      expect(max[2] - min[2]).toBeGreaterThan(Math.max(...zs) - Math.min(...zs))
      // Walls start just below the lowest ground, so no gap shows under them.
      expect(min[1]).toBeLessThan(0)
      expect(min[1]).toBeGreaterThan(-1.5)
      expect(triangles).toBeLessThan(15000)
    })
  }

  it('stays a reasonable download', () => {
    expect(statSync(GLB).size).toBeLessThan(1.5 * 1024 * 1024)
  })
})
