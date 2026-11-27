import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLOVE_STYLES, HEADWEAR, JACKET_STYLES, PANTS_STYLES } from '../src/render/rider/riderSkin'
import { RIDER_GLB as GLB, readGlb, type Gltf, type GltfNode } from './riderGlb'

/**
 * public/models/rider.glb comes from tools/blender/build_rider.py. These checks
 * read its JSON chunk directly (no WebGL or image decoding needed) and make sure
 * it still fits the rig the animation drives.
 */
const REST = new URL('../../tools/blender/rig_rest.json', import.meta.url)

const readGltf = (): Gltf => readGlb().gltf

/** World position of every named node (game space; glTF is +Y up like the game). */
function worldPositions(gltf: Gltf): Map<string, THREE.Vector3> {
  const parents = new Map<number, number>()
  gltf.nodes.forEach((node, i) => node.children?.forEach((child) => parents.set(child, i)))
  const local = (node: GltfNode) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...(node.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(node.scale ?? [1, 1, 1])),
    )
  const out = new Map<string, THREE.Vector3>()
  gltf.nodes.forEach((node, i) => {
    const m = local(node)
    for (let p = parents.get(i); p !== undefined; p = parents.get(p)) m.premultiply(local(gltf.nodes[p]))
    if (node.name) out.set(node.name, new THREE.Vector3().setFromMatrixPosition(m))
  })
  return out
}

describe('rider model asset', () => {
  const gltf = readGltf()
  const rest = JSON.parse(readFileSync(REST, 'utf8')) as { name: string; head: [number, number, number] }[]

  it('places every joint where the rig binds it', () => {
    const world = worldPositions(gltf)
    for (const joint of rest) {
      const at = world.get(joint.name)
      expect(at, joint.name).toBeDefined()
      expect(at!.distanceTo(new THREE.Vector3(...joint.head)), joint.name).toBeLessThan(0.01)
    }
  })

  it('has a skinned mesh for every style the rider panel offers', () => {
    const names = new Set(gltf.meshes.map((mesh) => mesh.name))
    const expected = [
      ...JACKET_STYLES.map((s) => `jacket_${s}`), ...PANTS_STYLES.map((s) => `pants_${s}`),
      ...GLOVE_STYLES.map((s) => `gloves_${s}`), ...HEADWEAR.map((s) => `head_${s}`), 'head_face', 'head_goggles',
    ]
    for (const name of expected) expect(names.has(name), name).toBe(true)
    const restNames = new Set(rest.map((j) => j.name))
    for (const node of gltf.nodes) {
      if (node.mesh === undefined) continue
      expect(node.skin, node.name).toBeDefined()
      for (const joint of gltf.skins[node.skin!].joints) expect(restNames.has(gltf.nodes[joint].name!), gltf.nodes[joint].name).toBe(true)
    }
  })

  it('uses at most four joints per vertex, tangents for the normal maps and one cloth material per garment', () => {
    for (const mesh of gltf.meshes) {
      for (const primitive of mesh.primitives) {
        const a = primitive.attributes
        expect(a.JOINTS_0, mesh.name).toBeDefined()
        expect(a.WEIGHTS_0, mesh.name).toBeDefined()
        expect(a.JOINTS_1, mesh.name).toBeUndefined()
        expect(a.TANGENT, mesh.name).toBeDefined()
        expect(a.TEXCOORD_0, mesh.name).toBeDefined()
        const [garment] = gltf.materials[primitive.material].name.split('|')
        expect(garment).toBe(mesh.name)
      }
    }
  })

  it('stays inside the triangle and download budgets', () => {
    const tris = (name: string) =>
      gltf.meshes.find((m) => m.name === name)!.primitives.reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0)
    // The heaviest outfit a rider can wear, drawn for the player and every nearby NPC.
    const heaviest =
      Math.max(...JACKET_STYLES.map((s) => tris(`jacket_${s}`))) + Math.max(...PANTS_STYLES.map((s) => tris(`pants_${s}`))) +
      Math.max(...GLOVE_STYLES.map((s) => tris(`gloves_${s}`))) + Math.max(...HEADWEAR.map((s) => tris(`head_${s}`))) +
      tris('head_face') + tris('head_goggles')
    // The code-built body it replaced was about 15.5k triangles.
    expect(heaviest).toBeLessThan(10000)
    // Geometry only, meshopt-compressed (scripts/pack-rider.mjs); the maps are separate files.
    expect(statSync(GLB).size).toBeLessThan(1024 * 1024)
  })

  it('keeps its maps outside the GLB, one mask and normal map per garment, loaded per outfit', () => {
    expect(gltf.extensionsRequired).toContain('EXT_meshopt_compression')
    expect(gltf.images ?? []).toHaveLength(0)
    const outfit = { jacket: 0, pants: 0, gloves: 0, head: 0 }
    for (const material of gltf.materials) {
      if (material.name.endsWith('|lens')) continue
      const extras = material.extras ?? {}
      for (const file of [extras.mask, extras.normal]) {
        expect(file, material.name).toMatch(/^rider\/[a-z_]+\.jpg$/)
        expect(existsSync(new URL(`../public/models/${file}`, import.meta.url)), file).toBe(true)
      }
      const size = statSync(new URL(`../public/models/${extras.mask}`, import.meta.url)).size + statSync(new URL(`../public/models/${extras.normal}`, import.meta.url)).size
      const [kind] = material.name.split('_') as [keyof typeof outfit]
      if (kind in outfit) outfit[kind] = Math.max(outfit[kind], size)
    }
    // The heaviest outfit's maps (face and goggles count under head) stay well under the old all-in-one 1.5 MB.
    const heaviest = outfit.jacket + outfit.pants + outfit.gloves + outfit.head * 3
    expect(heaviest).toBeLessThan(700 * 1024)
  })
})
