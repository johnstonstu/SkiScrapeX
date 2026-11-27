/**
 * Distance detail for the coarse terrain mesh (geomipmapping with skirts).
 *
 * The coarse grid is cut into square tiles. Each tile draws every `stride`-th
 * vertex of the shared vertex buffer: 1 near the camera, 2, 4 and 8 further
 * out. Where a tile meets a neighbour drawn at another stride their edges do
 * not match, so every tile hangs a short skirt below its edges that hides the
 * gap. All tiles share one vertex buffer and one index buffer, rebuilt only
 * when a tile changes stride, so the terrain stays one draw call.
 *
 * No Three.js here: the view uploads what this returns.
 */

export interface LodGrid {
  columns: number
  rows: number
  /** Metres between samples. */
  step: number
}

export interface LodOptions {
  /** Cells per tile side; a multiple of the largest stride. */
  tileCells: number
  /** Distance (m, camera to the tile's nearest point) where each stride doubling starts: [to 2, to 4, to 8]. */
  bands: readonly number[]
}

export const DEFAULT_LOD: LodOptions = { tileCells: 32, bands: [420, 950, 1800] }

export interface LodTile {
  c0: number
  r0: number
  /** Cells across and down (edge tiles can be smaller). */
  w: number
  h: number
}

export interface TerrainLod {
  tiles: LodTile[]
  /** Vertices the skirts add after the grid's own: one hanging copy per tile-edge vertex. */
  skirtVertexCount: number
  /** For each skirt vertex, the grid vertex it hangs from. */
  skirtSource: Uint32Array
  /** The largest index count `fill` can produce (every tile at stride 1). */
  maxIndices: number
  /** Stride each tile should draw at for a camera at (x, z). */
  strides(x: number, z: number, out: Uint8Array): Uint8Array
  /** Write the index list for the given strides; returns the count written. */
  fill(strides: Uint8Array, into: Uint32Array): number
}

export function createTerrainLod(grid: LodGrid, options: LodOptions = DEFAULT_LOD): TerrainLod {
  const { columns, rows, step } = grid
  const cellsX = columns - 1
  const cellsZ = rows - 1
  const size = options.tileCells
  const tiles: LodTile[] = []
  const tilesAcross = Math.ceil(cellsX / size)
  for (let r0 = 0; r0 < cellsZ; r0 += size) {
    for (let c0 = 0; c0 < cellsX; c0 += size) tiles.push({ c0, r0, w: Math.min(size, cellsX - c0), h: Math.min(size, cellsZ - r0) })
  }

  // Skirt vertices: one hanging copy of every grid vertex on a tile-edge line.
  const skirtOf = new Int32Array(columns * rows).fill(-1)
  const sources: number[] = []
  const onEdge = (c: number, r: number) => c % size === 0 || r % size === 0 || c === cellsX || r === cellsZ
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      if (!onEdge(c, r)) continue
      skirtOf[r * columns + c] = columns * rows + sources.length
      sources.push(r * columns + c)
    }
  }
  const skirtSource = Uint32Array.from(sources)

  /** Largest of stride, stride/2, ... 1 that divides both sides of the tile. */
  const fitStride = (tile: LodTile, stride: number) => {
    let s = stride
    while (s > 1 && (tile.w % s !== 0 || tile.h % s !== 0)) s >>= 1
    return s
  }

  const cache = new Map<number, Uint32Array>()
  /** `edges`: bit 1 north, 2 south, 4 west, 8 east: a neighbour drawn at another stride, so that edge needs a skirt. */
  const tileIndices = (t: number, stride: number, edges: number): Uint32Array => {
    const key = (t * 16 + stride) * 16 + edges
    const hit = cache.get(key)
    if (hit) return hit
    const tile = tiles[t]
    const s = fitStride(tile, stride)
    const across = tile.w / s
    const down = tile.h / s
    const list: number[] = []
    const at = (i: number, j: number) => (tile.r0 + j * s) * columns + tile.c0 + i * s
    for (let j = 0; j < down; j++) {
      for (let i = 0; i < across; i++) {
        // Same diagonal as the full-resolution mesh: a-c-b, b-c-d.
        const a = at(i, j)
        const b = at(i + 1, j)
        const c = at(i, j + 1)
        const d = at(i + 1, j + 1)
        list.push(a, c, b, b, c, d)
      }
    }
    // Skirts: a wall from each edge segment down to its hanging copy, both faces.
    const wall = (p: number, q: number) => {
      const ps = skirtOf[p]
      const qs = skirtOf[q]
      list.push(p, ps, q, q, ps, qs, p, q, ps, q, qs, ps)
    }
    for (let i = 0; i < across; i++) {
      if (edges & 1) wall(at(i, 0), at(i + 1, 0))
      if (edges & 2) wall(at(i, down), at(i + 1, down))
    }
    for (let j = 0; j < down; j++) {
      if (edges & 4) wall(at(0, j), at(0, j + 1))
      if (edges & 8) wall(at(across, j), at(across, j + 1))
    }
    const out = Uint32Array.from(list)
    cache.set(key, out)
    return out
  }

  let maxIndices = 0
  for (const tile of tiles) maxIndices += tile.w * tile.h * 6 + 2 * (tile.w + tile.h) * 12

  return {
    tiles,
    skirtVertexCount: skirtSource.length,
    skirtSource,
    maxIndices,
    strides(x, z, out) {
      for (let t = 0; t < tiles.length; t++) {
        const tile = tiles[t]
        // Distance to the tile's nearest point, so a tile under the camera is always full detail.
        const minX = tile.c0 * step
        const minZ = tile.r0 * step
        const dx = Math.max(minX - x, 0, x - (minX + tile.w * step))
        const dz = Math.max(minZ - z, 0, z - (minZ + tile.h * step))
        const d = Math.hypot(dx, dz)
        let stride = 1
        for (const band of options.bands) if (d > band) stride *= 2
        out[t] = stride
      }
      return out
    },
    fill(strides, into) {
      let n = 0
      const strideAt = (t: number) => fitStride(tiles[t], strides[t] || 1)
      for (let t = 0; t < tiles.length; t++) {
        const mine = strideAt(t)
        const col = t % tilesAcross
        const differs = (n: number, exists: boolean) => exists && strideAt(n) !== mine
        const edges =
          (differs(t - tilesAcross, t >= tilesAcross) ? 1 : 0) |
          (differs(t + tilesAcross, t + tilesAcross < tiles.length) ? 2 : 0) |
          (differs(t - 1, col > 0) ? 4 : 0) |
          (differs(t + 1, col < tilesAcross - 1) ? 8 : 0)
        const list = tileIndices(t, strides[t] || 1, edges)
        into.set(list, n)
        n += list.length
      }
      return n
    },
  }
}
