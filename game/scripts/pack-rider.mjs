#!/usr/bin/env node
/**
 * Packs the rider model for the web: `npm run pack:rider` after
 * tools/blender/build_rider.py has written public/models/rider.glb.
 *
 * - Textures move out of the GLB into public/models/rider/<name>.jpg, byte for
 *   byte, and each garment material names its files in `extras`, so the game
 *   only downloads the outfits a rider actually wears (riderSkin.ts).
 * - Normals and tangents become 8-bit, UVs and skin weights 16-bit (all
 *   normalized). Positions stay float: garment vertices are in rig space and
 *   riderSkin.ts binds them to the game's own bones, so there is no node
 *   transform to undo a position quantization.
 * - Vertices are reordered for the GPU cache and the buffers are
 *   meshopt-compressed (EXT_meshopt_compression, decoded by three's
 *   MeshoptDecoder).
 *
 * Running it on an already packed file is a no-op apart from re-encoding.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const here = dirname(fileURLToPath(import.meta.url))
const models = join(here, '../public/models')
const file = process.argv[2] ?? join(models, 'rider.glb')
const textureDir = join(dirname(file), 'rider')

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

const before = statSync(file).size
const doc = await io.read(file)
const root = doc.getRoot()

// 1. Textures out to files, named per garment.
mkdirSync(textureDir, { recursive: true })
let textureBytes = 0
const written = new Set()
const saveTexture = (texture) => {
  if (!texture) return undefined
  const name = texture.getName() || texture.getURI()
  if (!name) throw new Error('rider texture has no name')
  if (texture.getMimeType() !== 'image/jpeg') throw new Error(`rider texture ${name} is ${texture.getMimeType()}, expected JPEG`)
  const out = `${name}.jpg`
  if (!written.has(out)) {
    writeFileSync(join(textureDir, out), texture.getImage())
    textureBytes += texture.getImage().byteLength
    written.add(out)
  }
  return `rider/${out}`
}
for (const material of root.listMaterials()) {
  const extras = { ...material.getExtras() }
  const mask = saveTexture(material.getBaseColorTexture())
  const normal = saveTexture(material.getNormalTexture())
  if (mask) extras.mask = mask
  if (normal) {
    extras.normal = normal
    extras.normalScale = material.getNormalScale()
  }
  material.setExtras(extras)
  material.setBaseColorTexture(null)
  material.setNormalTexture(null)
}
for (const texture of root.listTextures()) texture.dispose()

// 2. Quantize everything but positions.
const toNormalized = (accessor, Array, max) => {
  if (accessor.getComponentType() !== 5126) return // already quantized
  const src = accessor.getArray()
  const out = new Array(src.length)
  const signed = Array === Int8Array || Array === Int16Array
  for (let i = 0; i < src.length; i++) {
    const v = signed ? Math.max(-1, Math.min(1, src[i])) : Math.max(0, Math.min(1, src[i]))
    out[i] = Math.round(v * max)
  }
  accessor.setArray(out).setNormalized(true)
}
const quantizeWeights = (accessor) => {
  if (accessor.getComponentType() !== 5126) return
  const src = accessor.getArray()
  const out = new Uint16Array(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const sum = src[i] + src[i + 1] + src[i + 2] + src[i + 3] || 1
    let total = 0
    let largest = i
    for (let k = i; k < i + 4; k++) {
      out[k] = Math.round((src[k] / sum) * 65535)
      total += out[k]
      if (src[k] > src[largest]) largest = k
    }
    out[largest] += 65535 - total // weights sum to exactly one
  }
  accessor.setArray(out).setNormalized(true)
}
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const normal = primitive.getAttribute('NORMAL')
    const tangent = primitive.getAttribute('TANGENT')
    const uv = primitive.getAttribute('TEXCOORD_0')
    const weights = primitive.getAttribute('WEIGHTS_0')
    if (normal) toNormalized(normal, Int8Array, 127)
    if (tangent) toNormalized(tangent, Int8Array, 127)
    if (uv) {
      if (uv.getComponentType() === 5126) {
        const a = uv.getArray()
        for (const v of a) if (v < -1e-4 || v > 1 + 1e-4) throw new Error(`${mesh.getName()}: UV ${v} outside 0..1, cannot normalize`)
      }
      toNormalized(uv, Uint16Array, 65535)
    }
    if (weights) quantizeWeights(weights)
  }
}

// 3. GPU-cache order (meshoptimizer's reorderMesh), then meshopt compression.
const reordered = new Set()
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices()
    for (const accessor of [indices, ...primitive.listAttributes()]) {
      if (reordered.has(accessor)) throw new Error(`${mesh.getName()}: accessor shared between primitives; reorder would apply twice`)
      reordered.add(accessor)
    }
    const vertexCount = primitive.getAttribute('POSITION').getCount()
    const triangles = new Uint32Array(indices.getArray())
    const [remap, unique] = MeshoptEncoder.reorderMesh(triangles, true, true)
    indices.setArray(vertexCount <= 65535 ? new Uint16Array(triangles) : triangles)
    for (const attribute of primitive.listAttributes()) {
      const src = attribute.getArray()
      const size = attribute.getElementSize()
      const out = new src.constructor(unique * size)
      for (let v = 0; v < vertexCount; v++) {
        const to = remap[v]
        if (to === undefined || to === 0xffffffff) continue // unused vertex
        for (let k = 0; k < size; k++) out[to * size + k] = src[v * size + k]
      }
      attribute.setArray(out)
    }
  }
}
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
const glb = await io.writeBinary(doc)
writeFileSync(file, glb)
const kb = (n) => `${(n / 1024).toFixed(0)} kB`
console.log(`rider.glb ${kb(before)} -> ${kb(glb.byteLength)}; ${written.size} textures (${kb(textureBytes)}) in ${textureDir}`)
