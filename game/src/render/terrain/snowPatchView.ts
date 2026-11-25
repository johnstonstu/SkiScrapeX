import * as THREE from 'three'
import { snowPatchVertexShader, type SnowMaterial } from '../../fx/snow/SnowMaterial'
import { DEFORM_RANGE, type SnowDeform } from '../../world/snowDeform'
import type { TerrainGrid } from '../../world/terrainGrid'

export interface SnowPatchOptions {
  /** Radius of the deformable circle, metres. */
  radius: number
  /** Vertex spacing, metres. */
  spacing: number
}

/**
 * Deformable snow drawn as real geometry: a fine grid that follows the player,
 * shaded by the terrain's own snow material (shared uniforms, so sun, fog,
 * masks and tracks stay in step), with ski trenches and berms from the deform
 * field. The terrain hides itself inside the same circle. Needs the 2 m grid.
 */
export function createSnowPatchView(grid: TerrainGrid, deform: SnowDeform, terrainMaterial: SnowMaterial, options: SnowPatchOptions) {
  const fine = grid.detail
  if (!fine) return null
  const { radius, spacing } = options

  // Terrain heights as a float texture, holes filled from the coarse grid.
  const heights = new Float32Array(fine.heights.length)
  for (let i = 0; i < heights.length; i++) {
    const h = fine.heights[i]
    heights[i] = Number.isFinite(h) ? h : grid.heightAt((i % fine.columns) * fine.step, Math.floor(i / fine.columns) * fine.step) || 0
  }
  const heightTexture = new THREE.DataTexture(heights, fine.columns, fine.rows, THREE.RedFormat, THREE.FloatType)
  heightTexture.magFilter = THREE.NearestFilter
  heightTexture.minFilter = THREE.NearestFilter
  heightTexture.needsUpdate = true

  // Deform offsets, 8-bit in red, uploaded a few rows at a time.
  const n = deform.n
  const bytes = new Uint8Array(n * n * 4)
  const deformTexture = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat, THREE.UnsignedByteType)
  deformTexture.magFilter = THREE.LinearFilter
  deformTexture.minFilter = THREE.LinearFilter
  deformTexture.generateMipmaps = false
  deformTexture.colorSpace = THREE.NoColorSpace
  deformTexture.needsUpdate = true
  let uploaded = false
  deformTexture.onUpdate = () => {
    uploaded = true
  }
  const scale = 255 / (DEFORM_RANGE.low + DEFORM_RANGE.high)
  const encodeRows = (min: number, max: number) => {
    for (let row = min; row <= max; row++) {
      for (let col = 0; col < n; col++) {
        const i = row * n + col
        bytes[i * 4] = Math.max(0, Math.min(255, Math.round((deform.values[i] + DEFORM_RANGE.low) * scale)))
      }
    }
  }
  encodeRows(0, n - 1)

  const cells = Math.ceil((radius * 2) / spacing)
  const geometry = new THREE.PlaneGeometry(cells * spacing, cells * spacing, cells, cells)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate((cells * spacing) / 2, 0, (cells * spacing) / 2)
  geometry.deleteAttribute('uv')
  geometry.deleteAttribute('normal')

  const patchUniforms = {
    uHeights: { value: heightTexture },
    uHeightsSize: { value: new THREE.Vector2(fine.columns, fine.rows) },
    uHeightsStep: { value: fine.step },
    uPatchOrigin: { value: new THREE.Vector2() },
    uDeform: { value: deformTexture },
    uDeformRect: { value: new THREE.Vector4(0, 0, deform.size, deform.size) },
    uDeformRange: { value: new THREE.Vector2(DEFORM_RANGE.low, DEFORM_RANGE.high) },
  }
  // Same uniform objects as the terrain material, so its setters drive the patch too.
  const material = new THREE.ShaderMaterial({
    name: 'snow-patch',
    lights: true,
    uniforms: { ...terrainMaterial.uniforms, ...patchUniforms },
    vertexShader: snowPatchVertexShader,
    fragmentShader: terrainMaterial.fragmentShader,
    defines: { ...terrainMaterial.defines, SNOW_PATCH: '' },
    toneMapped: true,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'snow-patch'
  mesh.frustumCulled = false
  mesh.receiveShadow = true

  return {
    mesh,
    /** Follow the skier: snap the grid (no swimming), move the circle, upload changed rows. */
    update(x: number, z: number) {
      const ox = Math.floor((x - radius) / spacing) * spacing
      const oz = Math.floor((z - radius) / spacing) * spacing
      patchUniforms.uPatchOrigin.value.set(ox, oz)
      const inside = x > radius && z > radius && x < fine.width - radius && z < fine.depth - radius
      mesh.visible = inside
      terrainMaterial.setPatch(x, z, radius - spacing, inside)
      patchUniforms.uDeformRect.value.set(deform.originX, deform.originZ, deform.size, deform.size)
      const dirty = deform.takeDirty()
      if (!dirty) return
      if (dirty.full || !uploaded) {
        encodeRows(0, n - 1)
        deformTexture.clearUpdateRanges()
      } else {
        encodeRows(dirty.min, dirty.max)
        deformTexture.addUpdateRange(dirty.min * n * 4, (dirty.max - dirty.min + 1) * n * 4)
      }
      deformTexture.needsUpdate = true
    },
    hide() {
      mesh.visible = false
      terrainMaterial.setPatch(0, 0, 0, false)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      heightTexture.dispose()
      deformTexture.dispose()
    },
  }
}
