import type { TerrainGrid } from './terrainGrid'

/**
 * Square tiles of the 2 m detail grid, drawn near the camera on top of the
 * coarse mesh. Tile edges fall on detail samples, so neighbours share their
 * edge vertices exactly; a short skirt hides any sliver where a tile meets
 * the coarse mesh.
 */
export interface DetailLayout {
  /** Metres per tile side (a whole number of detail steps). */
  size: number
  /** Detail cells per tile side. */
  cells: number
  across: number
  down: number
}

export interface DetailChunkData {
  index: number
  positions: Float32Array
  normals: Float32Array
  /** Coarse height and normal under each vertex, for the distance morph. */
  base: Float32Array
  indices: Uint32Array
}

export const SKIRT_DEPTH = 1.5

export function detailLayout(grid: TerrainGrid, size = 160): DetailLayout {
  const detail = grid.detail
  if (!detail) throw new Error('Grid has no detail')
  const cells = Math.max(1, Math.round(size / detail.step))
  const side = cells * detail.step
  return {
    size: side,
    cells,
    across: Math.ceil((detail.columns - 1) / cells),
    down: Math.ceil((detail.rows - 1) / cells),
  }
}

/** Tiles any part of which lies within `radius` of (x, z), so the disc is fully covered. */
export function chunksNear(layout: DetailLayout, x: number, z: number, radius: number): number[] {
  const out: number[] = []
  const first = (v: number) => Math.max(0, Math.floor((v - radius) / layout.size))
  for (let row = first(z); row < layout.down && row * layout.size <= z + radius; row++) {
    for (let col = first(x); col < layout.across && col * layout.size <= x + radius; col++) {
      const dx = Math.max(col * layout.size - x, 0, x - (col + 1) * layout.size)
      const dz = Math.max(row * layout.size - z, 0, z - (row + 1) * layout.size)
      if (dx * dx + dz * dz <= radius * radius) out.push(row * layout.across + col)
    }
  }
  return out
}

/** Vertex data for one tile. Holes in the detail grid take the coarse surface. */
export function buildDetailChunk(grid: TerrainGrid, layout: DetailLayout, index: number): DetailChunkData {
  const detail = grid.detail!
  const coarse = grid.coarse ?? grid
  const col0 = (index % layout.across) * layout.cells
  const row0 = Math.floor(index / layout.across) * layout.cells
  const cols = Math.min(layout.cells, detail.columns - 1 - col0) + 1
  const rows = Math.min(layout.cells, detail.rows - 1 - row0) + 1
  // Edge ring for the skirt, clockwise from the north-west corner.
  const ring: number[] = []
  for (let c = 0; c < cols; c++) ring.push(c)
  for (let r = 1; r < rows; r++) ring.push(r * cols + cols - 1)
  for (let c = cols - 2; c >= 0; c--) ring.push((rows - 1) * cols + c)
  for (let r = rows - 2; r > 0; r--) ring.push(r * cols)
  const surfaceCount = cols * rows
  const count = surfaceCount + ring.length
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const base = new Float32Array(count * 4)
  const dh = detail.heights, dn = detail.normals
  const sample = coarseSampler(coarse)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = r * cols + c
      const source = (row0 + r) * detail.columns + col0 + c
      const x = (col0 + c) * detail.step
      const z = (row0 + r) * detail.step
      sample(x, z, base, v * 4)
      const h = dh[source]
      const p = v * 3
      positions[p] = x
      positions[p + 2] = z
      if (Number.isFinite(h)) {
        positions[p + 1] = h
        normals[p] = dn[source * 3]
        normals[p + 1] = dn[source * 3 + 1]
        normals[p + 2] = dn[source * 3 + 2]
      } else {
        positions[p + 1] = base[v * 4]
        normals[p] = base[v * 4 + 1]
        normals[p + 1] = base[v * 4 + 2]
        normals[p + 2] = base[v * 4 + 3]
      }
    }
  }
  for (let i = 0; i < ring.length; i++) {
    const v = ring[i]
    const s3 = (surfaceCount + i) * 3, v3 = v * 3
    positions[s3] = positions[v3]
    positions[s3 + 1] = positions[v3 + 1] - SKIRT_DEPTH
    positions[s3 + 2] = positions[v3 + 2]
    normals[s3] = normals[v3]
    normals[s3 + 1] = normals[v3 + 1]
    normals[s3 + 2] = normals[v3 + 2]
    const s4 = (surfaceCount + i) * 4, v4 = v * 4
    base[s4] = base[v4] - SKIRT_DEPTH
    base[s4 + 1] = base[v4 + 1]
    base[s4 + 2] = base[v4 + 2]
    base[s4 + 3] = base[v4 + 3]
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6 + ring.length * 6)
  let k = 0
  // Same NE to SW split as the sampler.
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, cc = a + cols, d = cc + 1
      indices[k++] = a; indices[k++] = cc; indices[k++] = b
      indices[k++] = b; indices[k++] = cc; indices[k++] = d
    }
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const sa = surfaceCount + i, sb = surfaceCount + ((i + 1) % ring.length)
    // Clockwise ring seen from above: outward faces wind a, b, sa.
    indices[k++] = a; indices[k++] = b; indices[k++] = sa
    indices[k++] = sa; indices[k++] = b; indices[k++] = sb
  }
  return { index, positions, normals, base, indices }
}

/**
 * Coarse height (on the rendered triangle) and bilinear vertex normal written
 * into `out` at `offset` as h, nx, ny, nz. Same maths as terrainGrid's
 * sampler, without allocating; points off the grid clamp to its edge.
 */
function coarseSampler(grid: TerrainGrid) {
  const { columns, rows, step, heights, normals } = grid
  return (x: number, z: number, out: Float32Array, offset: number) => {
    const gx = Math.min(Math.max(x / step, 0), columns - 1)
    const gz = Math.min(Math.max(z / step, 0), rows - 1)
    const column = Math.min(Math.floor(gx), columns - 2)
    const row = Math.min(Math.floor(gz), rows - 2)
    const u = gx - column, v = gz - row
    const i = row * columns + column
    const a = heights[i], b = heights[i + 1], c = heights[i + columns], d = heights[i + columns + 1]
    let height: number
    if (u + v <= 1) height = a + u * (b - a) + v * (c - a)
    else height = d - (1 - u) * (d - c) - (1 - v) * (d - b)
    if (!Number.isFinite(height)) height = 0
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v
    const i3 = i * 3, j3 = (i + columns) * 3
    let nx = normals[i3] * w00 + normals[i3 + 3] * w10 + normals[j3] * w01 + normals[j3 + 3] * w11
    let ny = normals[i3 + 1] * w00 + normals[i3 + 4] * w10 + normals[j3 + 1] * w01 + normals[j3 + 4] * w11
    let nz = normals[i3 + 2] * w00 + normals[i3 + 5] * w10 + normals[j3 + 2] * w01 + normals[j3 + 5] * w11
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    out[offset] = height
    out[offset + 1] = nx
    out[offset + 2] = ny
    out[offset + 3] = nz
  }
}
