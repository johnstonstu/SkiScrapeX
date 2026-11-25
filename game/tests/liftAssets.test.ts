import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * public/models/scenery/lifts.glb comes from tools/blender/build_lifts.py. The
 * lift view places these parts on the same anchors as its code-built ones, so
 * the models must keep them: chairs hang from a grip at the origin with the
 * seat about 2.3 m below, towers carry the rope at 11 m (chairs) or 7 m
 * (T-bar) with the sheaves 2.6 m either side, terminals stand on the ground.
 */
const GLB = new URL('../public/models/scenery/lifts.glb', import.meta.url)

interface Gltf {
  nodes: { name?: string; children?: number[]; mesh?: number; translation?: number[] }[]
  scenes: { nodes: number[] }[]
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]
  accessors: { count: number; min?: number[]; max?: number[] }[]
}

function readGltf(): Gltf {
  const bytes = readFileSync(GLB)
  const length = bytes.readUInt32LE(12)
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as Gltf
}

const gltf = readGltf()
const roots = new Map(gltf.scenes[0].nodes.map((i) => [gltf.nodes[i].name!, i]))

/** Bounds and triangles of an asset (children sit at the asset origin). */
function measure(name: string) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let triangles = 0
  const names: string[] = []
  const visit = (index: number) => {
    const node = gltf.nodes[index]
    names.push(node.name ?? '')
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const position = gltf.accessors[primitive.attributes.POSITION]
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], position.min![k])
          max[k] = Math.max(max[k], position.max![k])
        }
        triangles += (primitive.indices !== undefined ? gltf.accessors[primitive.indices].count : position.count) / 3
      }
    }
    node.children?.forEach(visit)
  }
  const root = roots.get(name)
  expect(root, name).toBeDefined()
  visit(root!)
  return { min, max, triangles, names }
}

describe('lift models', () => {
  it('has every part the lift view asks for', () => {
    for (const kind of ['qd', 'st', 'tb']) {
      for (const part of ['tower', 'terminal_bottom', 'terminal_top']) expect(roots.has(`${kind}_${part}`), `${kind}_${part}`).toBe(true)
    }
    expect(roots.has('qd_chair')).toBe(true)
    expect(roots.has('st_chair')).toBe(true)
  })

  it('hangs chairs from the grip with the seat where riders sit', () => {
    for (const name of ['qd_chair', 'st_chair']) {
      const { min, max, triangles } = measure(name)
      expect(max[1], name).toBeGreaterThan(-0.05)
      expect(max[1], name).toBeLessThan(0.2)
      // Seat about 2.3 m down (SEAT_DROP); a footrest may hang a little lower.
      expect(min[1], name).toBeLessThan(-2.3)
      expect(min[1], name).toBeGreaterThan(-2.9)
      // Up to 138 chairs per lift are drawn every frame.
      expect(triangles, name).toBeLessThan(800)
    }
    expect(measure('qd_chair').max[0]).toBeGreaterThan(1.0) // a quad is wider than the triple
    expect(measure('st_chair').max[0]).toBeLessThan(0.95)
  })

  it('carries the rope at tower height with sheaves either side', () => {
    for (const [name, height] of [['qd_tower', 11], ['st_tower', 11], ['tb_tower', 7]] as const) {
      const { min, max } = measure(name)
      expect(min[1], name).toBeLessThan(0.05)
      expect(max[1], name).toBeGreaterThan(height)
      expect(max[1], name).toBeLessThan(height + 2)
      expect(max[0], name).toBeGreaterThan(2.6)
      expect(min[0], name).toBeLessThan(-2.6)
    }
  })

  it('marks the Quickdraw housings so they hide around the camera, and stays small', () => {
    for (const end of ['bottom', 'top']) {
      const { names, min } = measure(`qd_terminal_${end}`)
      expect(names.some((n) => n.startsWith('hood_'))).toBe(true)
      expect(min[1]).toBeGreaterThan(-0.9)
    }
    expect(statSync(GLB).size).toBeLessThan(1024 * 1024)
  })
})
