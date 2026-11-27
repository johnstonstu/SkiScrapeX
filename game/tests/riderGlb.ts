import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { RiderAsset } from '../src/render/rider/riderSkin'

await MeshoptDecoder.ready

/**
 * Reads public/models/rider.glb in Node, without GLTFLoader (which needs image
 * decoding; meshopt buffers are decoded with three's MeshoptDecoder). Gives the glTF JSON for asset checks and a RiderAsset with the
 * real skinned geometry (no textures) for posing tests.
 */
export const RIDER_GLB = new URL('../public/models/rider.glb', import.meta.url)

export interface GltfNode { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[]; mesh?: number; skin?: number }
export interface GltfAccessor { bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }
export interface Gltf {
  nodes: GltfNode[]
  meshes: { name: string; primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[]
  skins: { joints: number[] }[]
  accessors: GltfAccessor[]
  bufferViews: {
    buffer: number
    byteOffset?: number
    byteLength: number
    byteStride?: number
    extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } }
  }[]
  materials: { name: string; extras?: { mask?: string; normal?: string; normalScale?: number } }[]
  extensionsRequired?: string[]
  images?: { mimeType: string; bufferView: number }[]
  textures?: { source: number }[]
}

export function readGlb(url: URL = RIDER_GLB): { gltf: Gltf; bin: Buffer; views: Buffer[] } {
  const bytes = readFileSync(url)
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error(`${url} is not a GLB file`)
  const jsonLength = bytes.readUInt32LE(12)
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${url}: first GLB chunk is not JSON`)
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf
  const binStart = 20 + jsonLength
  const binLength = bytes.readUInt32LE(binStart)
  if (bytes.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error(`${url}: second GLB chunk is not BIN`)
  const bin = bytes.subarray(binStart + 8, binStart + 8 + binLength)
  // Each view's bytes; meshopt-compressed views are decoded from the BIN chunk.
  const views = gltf.bufferViews.map((view) => {
    const m = view.extensions?.EXT_meshopt_compression
    if (!m) return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    if (m.buffer !== 0) throw new Error(`${url}: meshopt data outside the GLB BIN chunk`)
    const target = new Uint8Array(m.count * m.byteStride)
    const source = bin.subarray(m.byteOffset ?? 0, (m.byteOffset ?? 0) + m.byteLength)
    MeshoptDecoder.decodeGltfBuffer(target, m.count, m.byteStride, source, m.mode, m.filter ?? 'NONE')
    return Buffer.from(target.buffer, target.byteOffset, target.byteLength)
  })
  return { gltf, bin, views }
}

const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
const COMPONENT: Record<number, { bytes: number; read: (b: Buffer, at: number) => number; max: number }> = {
  5120: { bytes: 1, read: (b, at) => b.readInt8(at), max: 127 },
  5122: { bytes: 2, read: (b, at) => b.readInt16LE(at), max: 32767 },
  5121: { bytes: 1, read: (b, at) => b.readUInt8(at), max: 255 },
  5123: { bytes: 2, read: (b, at) => b.readUInt16LE(at), max: 65535 },
  5125: { bytes: 4, read: (b, at) => b.readUInt32LE(at), max: 4294967295 },
  5126: { bytes: 4, read: (b, at) => b.readFloatLE(at), max: 1 },
}

/** One accessor as plain numbers (normalized integers become 0..1). */
function readAccessor(gltf: Gltf, views: Buffer[], index: number): { data: number[]; size: number } {
  const accessor = gltf.accessors[index]
  const view = gltf.bufferViews[accessor.bufferView]
  const component = COMPONENT[accessor.componentType]
  if (!component) throw new Error(`rider.glb accessor ${index}: unsupported component type ${accessor.componentType}`)
  const size = SIZE[accessor.type]
  const stride = view.byteStride ?? size * component.bytes
  const bin = views[accessor.bufferView]
  const start = accessor.byteOffset ?? 0
  const data: number[] = new Array(accessor.count * size)
  for (let i = 0; i < accessor.count; i++) {
    for (let k = 0; k < size; k++) {
      const v = component.read(bin, start + i * stride + k * component.bytes)
      data[i * size + k] = accessor.normalized ? Math.max(-1, v / component.max) : v
    }
  }
  return { data, size }
}

/** The rider's garments as riderSkin.ts loads them, minus textures. */
export function readRiderAsset(url: URL = RIDER_GLB): RiderAsset {
  const { gltf, views } = readGlb(url)
  const garments: RiderAsset['garments'] = new Map()
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue
    if (node.skin === undefined) throw new Error(`rider.glb node ${node.name} has a mesh but no skin`)
    const moved = (node.translation ?? [0, 0, 0]).some((v) => Math.abs(v) > 1e-6) ||
      (node.rotation ?? [0, 0, 0, 1]).some((v, i) => Math.abs(v - (i === 3 ? 1 : 0)) > 1e-6) || node.matrix
    if (moved) throw new Error(`rider.glb node ${node.name} is not at the origin; garment vertices must be in rig space`)
    const boneNames = gltf.skins[node.skin].joints.map((j) => gltf.nodes[j].name!)
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      const [garment, slot] = gltf.materials[primitive.material].name.split('|')
      const geometry = new THREE.BufferGeometry()
      const position = readAccessor(gltf, views, primitive.attributes.POSITION)
      const joints = readAccessor(gltf, views, primitive.attributes.JOINTS_0)
      const weights = readAccessor(gltf, views, primitive.attributes.WEIGHTS_0)
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(position.data, 3))
      geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints.data, 4))
      geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights.data, 4))
      geometry.setIndex(readAccessor(gltf, views, primitive.indices).data)
      const list = garments.get(garment) ?? []
      list.push({ name: garment, geometry, boneNames, mask: null, normal: null, normalScale: new THREE.Vector2(1, 1), lens: slot === 'lens' })
      garments.set(garment, list)
    }
  }
  if (!garments.size) throw new Error(`${url} has no skinned garments`)
  return { garments }
}
