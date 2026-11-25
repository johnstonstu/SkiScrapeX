import * as THREE from 'three'
import { SnowMaterial } from '../../fx'
import { createTerrainGrid, type TerrainGrid } from '../../world/terrainGrid'
import { buildDetailChunk, chunksNear, detailLayout } from '../../world/detailChunks'
import type { Canopy, SurfaceField } from '../../world/surface'
import { looseSnowDepth, MAX_LOOSE_SNOW_DEPTH } from '../../world/snow'
import type { Lighting } from '../lighting'

export interface DetailOptions {
  /** Detail is exact inside `near` and has morphed to the coarse surface by `far` (metres). */
  near: number
  far: number
  /** At most this many tiles built per update, and only while under `budgetMs`. */
  buildsPerFrame: number
  budgetMs: number
  /** Tiles kept in memory. */
  cache: number
  /** Draw the coarse mesh at every `coarseStride`-th sample (2 halves it to 10 m, for phones). */
  coarseStride: 1 | 2
}

const DEFAULT_DETAIL: DetailOptions = { near: 140, far: 220, buildsPerFrame: 3, budgetMs: 2.5, cache: 48, coarseStride: 1 }

/**
 * One coarse mesh for the whole crop, same triangle split as the sampler,
 * plus 2 m tiles near the camera when the grid has detail.
 */
export function createTerrainView(
  grid: TerrainGrid,
  surface: SurfaceField,
  canopy: Canopy | null,
  lighting: Lighting,
  detailOptions: Partial<DetailOptions> = {},
) {
  const options = { ...DEFAULT_DETAIL, ...detailOptions }
  // The mesh may be drawn from a subsampled grid; physics keeps the full one.
  const drawn = options.coarseStride === 2 ? subsample(grid, 2) : grid
  const { columns, rows, step, heights, normals } = drawn
  const positions = new Float32Array(columns * rows * 3)
  for (let i = 0; i < columns * rows; i++) {
    positions[i * 3] = (i % columns) * step
    positions[i * 3 + 1] = Number.isFinite(heights[i]) ? heights[i] : 0
    positions[i * 3 + 2] = Math.floor(i / columns) * step
  }
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6)
  let cursor = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      indices[cursor++] = a
      indices[cursor++] = c
      indices[cursor++] = b
      indices[cursor++] = b
      indices[cursor++] = c
      indices[cursor++] = d
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  // Coarse terrain: cut out where detail tiles draw (aFlags.y).
  const flags = new Uint8Array(columns * rows * 2)
  for (let i = 1; i < flags.length; i += 2) flags[i] = 255
  geometry.setAttribute('aFlags', new THREE.BufferAttribute(flags, 2, true))
  geometry.computeBoundingSphere()

  const mask = new THREE.DataTexture(surface.mask, surface.width, surface.height)
  mask.colorSpace = THREE.NoColorSpace
  mask.magFilter = THREE.NearestFilter
  mask.minFilter = THREE.NearestFilter
  mask.needsUpdate = true

  const material = new SnowMaterial({
    mask,
    maskOrigin: { x: 0, z: 0 },
    maskSize: { x: surface.width * surface.texel, z: surface.height * surface.texel },
    sunDirection: lighting.sunDirection,
    sunColor: lighting.sunColor,
    skyColor: lighting.skyColor,
    groundColor: lighting.groundColor,
    fogColor: lighting.fogColor,
    fogDensity: lighting.fogDensity,
    slopeStartDeg: 38,
    slopeFullDeg: 55,
  })
  const groomBytes = new Uint8Array(surface.width * surface.height)
  for (let i = 0; i < groomBytes.length; i++) groomBytes[i] = surface.mask[i * 4] === 0 || surface.mask[i * 4] === 160 ? 255 : 0
  const groomTexture = new THREE.DataTexture(groomBytes, surface.width, surface.height, THREE.RedFormat, THREE.UnsignedByteType)
  groomTexture.colorSpace = THREE.NoColorSpace
  groomTexture.magFilter = THREE.LinearFilter
  groomTexture.minFilter = THREE.LinearFilter
  groomTexture.needsUpdate = true
  material.setGroomTexture(groomTexture)

  // Shade, loose depth and wind exposure share one linear lookup (RGBA: cover, depth, exposure).
  const exposure = surface.exposure
  const sameShape = exposure && exposure.columns === grid.columns && exposure.rows === grid.rows
  const pack = new Uint8Array(grid.columns * grid.rows * 4)
  for (let i = 0; i < grid.columns * grid.rows; i++) {
    const cover = canopy?.cover[i] ?? 0
    const depth = looseSnowDepth((i % grid.columns) * grid.step, Math.floor(i / grid.columns) * grid.step, cover)
    pack[i * 4] = Math.round(Math.min(1, cover * 1.2) * 255)
    pack[i * 4 + 1] = Math.round(depth / MAX_LOOSE_SNOW_DEPTH * 255)
    pack[i * 4 + 2] = sameShape ? Math.round(exposure.values[i] * 255) : 0
    pack[i * 4 + 3] = 255
  }
  const canopyTexture = new THREE.DataTexture(pack, grid.columns, grid.rows, THREE.RGBAFormat, THREE.UnsignedByteType)
  canopyTexture.colorSpace = THREE.NoColorSpace
  canopyTexture.magFilter = THREE.LinearFilter
  canopyTexture.minFilter = THREE.LinearFilter
  canopyTexture.needsUpdate = true
  // Samples are cell centres, so the texture spans half a cell past each edge.
  material.setCanopy(canopyTexture, -grid.step / 2, -grid.step / 2, grid.columns * grid.step, grid.rows * grid.step)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'terrain'
  mesh.receiveShadow = true

  // Skirt: a wall hanging 60 m below the crop edge hides gaps where the
  // coarse apron meets the 5 m terrain.
  const ring: number[] = []
  for (let c = 0; c < columns; c++) ring.push(c)
  for (let r = 1; r < rows; r++) ring.push(r * columns + columns - 1)
  for (let c = columns - 2; c >= 0; c--) ring.push((rows - 1) * columns + c)
  for (let r = rows - 2; r > 0; r--) ring.push(r * columns)
  const skirtPositions = new Float32Array(ring.length * 6)
  ring.forEach((index, i) => {
    const x = positions[index * 3]
    const y = positions[index * 3 + 1]
    const z = positions[index * 3 + 2]
    skirtPositions.set([x, y, z, x, y - 60, z], i * 6)
  })
  const skirtIndices: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = i * 2
    const b = ((i + 1) % ring.length) * 2
    skirtIndices.push(a, a + 1, b, b, a + 1, b + 1)
  }
  const skirtGeometry = new THREE.BufferGeometry()
  skirtGeometry.setAttribute('position', new THREE.BufferAttribute(skirtPositions, 3))
  skirtGeometry.setIndex(skirtIndices)
  skirtGeometry.computeVertexNormals()
  const skirtMaterial = new THREE.MeshLambertMaterial({ color: 0xdfe7ee, side: THREE.DoubleSide })
  const skirt = new THREE.Mesh(skirtGeometry, skirtMaterial)
  mesh.add(skirt)

  // Detail tiles morph toward the surface actually drawn, so their far edge meets it.
  const detail = grid.detail ? createDetailTiles(drawn === grid ? grid : { ...grid, coarse: drawn }, material, options) : null
  if (detail) mesh.add(detail.group)

  return {
    mesh,
    material,
    /** Move the detail ring; call each frame with the camera position. */
    update(x: number, z: number) {
      detail?.update(x, z)
    },
    get detailTiles() {
      return detail?.visible ?? 0
    },
    dispose() {
      detail?.dispose()
      geometry.dispose()
      material.dispose()
      mask.dispose()
      canopyTexture.dispose()
      groomTexture.dispose()
      skirtGeometry.dispose()
      skirtMaterial.dispose()
    },
  }
}

function createDetailTiles(grid: TerrainGrid, material: SnowMaterial, options: DetailOptions) {
  const layout = detailLayout(grid)
  const fine = grid.detail!
  const group = new THREE.Group()
  group.name = 'terrain-detail'
  const maskBytes = new Uint8Array(layout.across * layout.down)
  const mask = new THREE.DataTexture(maskBytes, layout.across, layout.down, THREE.RedFormat, THREE.UnsignedByteType)
  mask.colorSpace = THREE.NoColorSpace
  mask.magFilter = THREE.NearestFilter
  mask.minFilter = THREE.NearestFilter
  mask.needsUpdate = true
  material.setDetail(mask, {
    x: 0, z: 0,
    width: layout.across * layout.size, depth: layout.down * layout.size,
    limitX: (fine.columns - 1) * fine.step, limitZ: (fine.rows - 1) * fine.step,
  })
  const tiles = new Map<number, THREE.Mesh>()
  let visible = 0
  const centreOf = (index: number) => [
    ((index % layout.across) + 0.5) * layout.size,
    (Math.floor(index / layout.across) + 0.5) * layout.size,
  ]
  const build = (index: number) => {
    const data = buildDetailChunk(grid, layout, index)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    geometry.setAttribute('aBase', new THREE.BufferAttribute(data.base, 4))
    const flags = new Uint8Array((data.positions.length / 3) * 2)
    for (let i = 0; i < flags.length; i += 2) flags[i] = 255
    geometry.setAttribute('aFlags', new THREE.BufferAttribute(flags, 2, true))
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1))
    geometry.computeBoundingSphere()
    const tile = new THREE.Mesh(geometry, material)
    tile.name = `terrain-detail-${index}`
    tile.receiveShadow = true
    tile.visible = false
    group.add(tile)
    tiles.set(index, tile)
    return tile
  }
  return {
    group,
    get visible() {
      return visible
    },
    update(x: number, z: number) {
      material.setDetailMorph(x, z, options.near, options.far)
      const wanted = chunksNear(layout, x, z, options.far)
      const missing = wanted.filter((i) => !tiles.has(i))
      missing.sort((a, b) => {
        const [ax, az] = centreOf(a), [bx, bz] = centreOf(b)
        return (ax - x) ** 2 + (az - z) ** 2 - ((bx - x) ** 2 + (bz - z) ** 2)
      })
      // Unbuilt tiles show the coarse mesh, so spreading the work is invisible.
      const started = performance.now()
      for (const index of missing.slice(0, options.buildsPerFrame)) {
        build(index)
        if (performance.now() - started > options.budgetMs) break
      }
      const show = new Set(wanted.filter((i) => tiles.has(i)))
      let changed = false
      visible = 0
      for (const [index, tile] of tiles) {
        const on = show.has(index)
        tile.visible = on
        if (on) visible++
        const value = on ? 255 : 0
        if (maskBytes[index] !== value) {
          maskBytes[index] = value
          changed = true
        }
      }
      if (changed) mask.needsUpdate = true
      if (tiles.size > options.cache) {
        const spare = [...tiles.keys()].filter((i) => !show.has(i))
        spare.sort((a, b) => {
          const [ax, az] = centreOf(a), [bx, bz] = centreOf(b)
          return (bx - x) ** 2 + (bz - z) ** 2 - ((ax - x) ** 2 + (az - z) ** 2)
        })
        for (const index of spare.slice(0, tiles.size - options.cache)) {
          const tile = tiles.get(index)!
          group.remove(tile)
          tile.geometry.dispose()
          tiles.delete(index)
        }
      }
    },
    dispose() {
      for (const tile of tiles.values()) tile.geometry.dispose()
      tiles.clear()
      mask.dispose()
      material.setDetail(null)
    },
  }
}

/** Every `stride`-th sample of the grid, as a grid of its own on the same origin. */
function subsample(grid: TerrainGrid, stride: number): TerrainGrid {
  const columns = Math.floor((grid.columns - 1) / stride) + 1
  const rows = Math.floor((grid.rows - 1) / stride) + 1
  const heights = new Float32Array(columns * rows)
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) heights[r * columns + c] = grid.heights[r * stride * grid.columns + c * stride]
  return createTerrainGrid({ columns, rows, stepMetres: grid.step * stride }, heights)
}
