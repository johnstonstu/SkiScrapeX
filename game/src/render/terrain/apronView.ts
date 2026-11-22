import * as THREE from 'three'
import { SnowMaterial } from '../../fx'
import type { Apron } from '../../world/apron'
import type { Lighting } from '../lighting'

/** Mesh for the procedural land around the crop, shaded with the same snow material. */
export function createApronView(apron: Apron, lighting: Lighting) {
  const { xs, zs, heights } = apron
  const positions = new Float32Array(xs.length * zs.length * 3)
  zs.forEach((z, row) =>
    xs.forEach((x, column) => {
      const i = row * xs.length + column
      positions.set([x, heights[i], z], i * 3)
    }),
  )
  const indices: number[] = []
  for (let row = 0; row < zs.length - 1; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      const a = row * xs.length + column
      const b = a + 1
      const c = a + xs.length
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // Forest shade baked from the same cover function that plants the apron trees.
  const size = 256
  const minX = xs[0]
  const minZ = zs[0]
  const spanX = xs[xs.length - 1] - minX
  const spanZ = zs[zs.length - 1] - minZ
  const cover = new Uint8Array(size * size)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = minX + ((c + 0.5) / size) * spanX
      const z = minZ + ((r + 0.5) / size) * spanZ
      const h = apron.heightAt(x, z)
      cover[r * size + c] = Math.round(Math.min(1, apron.coverAt(x, z, h) * 1.3) * 255)
    }
  }
  const coverTexture = new THREE.DataTexture(cover, size, size, THREE.RedFormat, THREE.UnsignedByteType)
  coverTexture.colorSpace = THREE.NoColorSpace
  coverTexture.magFilter = THREE.LinearFilter
  coverTexture.minFilter = THREE.LinearFilter
  coverTexture.needsUpdate = true

  const material = new SnowMaterial({
    sunDirection: lighting.sunDirection,
    sunColor: lighting.sunColor,
    skyColor: lighting.skyColor,
    groundColor: lighting.groundColor,
    fogColor: lighting.fogColor,
    fogDensity: lighting.fogDensity,
    slopeStartDeg: 34,
    slopeFullDeg: 50,
    sparkle: 0.2,
  })
  material.setCorduroy(0.22, 0)
  material.setCanopy(coverTexture, minX, minZ, spanX, spanZ)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'apron'
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      coverTexture.dispose()
    },
  }
}
