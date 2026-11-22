import type { SampleTerrain, SurfaceSample } from '../sim'

/** The subset of `terrain.json` the sampler needs. */
export interface GridShape {
  columns: number
  rows: number
  stepMetres: number
}

export interface TerrainGrid {
  columns: number
  rows: number
  step: number
  /** Metres east from sample [0, 0] to the last column. */
  width: number
  /** Metres south from sample [0, 0] to the last row. */
  depth: number
  heights: Float32Array
  /** Per-vertex unit normals, xyz interleaved, from central differences. */
  normals: Float32Array
  /**
   * Height on the rendered triangle (same diagonal as the mesh) and a normal
   * blended bilinearly from the vertex normals, so the skier sits exactly on
   * the visible surface but does not feel every 5 m facet as a kink.
   */
  sampleTerrain: SampleTerrain
  /** Same height, flat triangle normal. Useful for tests and debug. */
  sampleFacet: SampleTerrain
  /** Height only, or NaN outside / in a hole. */
  heightAt: (x: number, z: number) => number
  /**
   * Finer grid on the same origin (2 m from the 1 m LiDAR). When present,
   * `sampleTerrain`, `sampleFacet` and `heightAt` read it first and fall back
   * to this grid; `heights`, `normals` and the shape stay the coarse grid so
   * per-cell data (canopy, surface mask) keeps its indexing.
   */
  detail?: TerrainGrid
  /** The coarse grid alone, when `detail` is set. */
  coarse?: TerrainGrid
}

/** Coarse grid whose samplers prefer `detail` where it has data. */
export function withDetail(base: TerrainGrid, detail: TerrainGrid): TerrainGrid {
  const prefer = (fine: SampleTerrain, coarse: SampleTerrain): SampleTerrain => (x, z) => fine(x, z) ?? coarse(x, z)
  return {
    ...base,
    detail,
    coarse: base,
    sampleTerrain: prefer(detail.sampleTerrain, base.sampleTerrain),
    sampleFacet: prefer(detail.sampleFacet, base.sampleFacet),
    heightAt: (x, z) => {
      const h = detail.heightAt(x, z)
      return Number.isFinite(h) ? h : base.heightAt(x, z)
    },
  }
}

/** Decode the uint16 centimetre detail heights to metres relative to `originElevation`; holes become NaN. */
export function decodeDetailHeights(
  buffer: ArrayBuffer,
  info: { columns: number; rows: number; baseElevation: number; scale: number; hole: number },
  originElevation: number,
): Float32Array {
  const count = info.columns * info.rows
  if (buffer.byteLength !== count * 2) throw new Error('Detail grid size mismatch')
  const view = new DataView(buffer)
  const offset = info.baseElevation - originElevation
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    const value = view.getUint16(i * 2, true)
    out[i] = value === info.hole ? Number.NaN : offset + value / info.scale
  }
  return out
}

/**
 * Cell (column, row) spans four samples. The split runs NE to SW (`u + v <= 1`
 * is the upper triangle NW/NE/SW, the rest is NE/SW/SE). Matches the mesh
 * index order in `render/terrainView.ts` and the OSM tool's `heights.py`.
 */
export function createTerrainGrid(shape: GridShape, heights: Float32Array): TerrainGrid {
  const { columns, rows, stepMetres: step } = shape
  if (
    !Number.isInteger(columns) || columns < 2 ||
    !Number.isInteger(rows) || rows < 2 ||
    !Number.isFinite(step) || step <= 0 ||
    heights.length !== columns * rows
  ) {
    throw new Error('Invalid terrain grid dimensions')
  }
  const width = (columns - 1) * step
  const depth = (rows - 1) * step
  const normals = vertexNormals(columns, rows, step, heights)

  function locate(x: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < 0 || z < 0 || x > width || z > depth) return null
    const gx = x / step
    const gz = z / step
    const column = Math.min(Math.floor(gx), columns - 2)
    const row = Math.min(Math.floor(gz), rows - 2)
    const u = gx - column
    const v = gz - row
    const i = row * columns + column
    const a = heights[i]
    const b = heights[i + 1]
    const c = heights[i + columns]
    const d = heights[i + columns + 1]
    // A NaN corner is a hole: the whole cell is off the surface.
    if (!Number.isFinite(a + b + c + d)) return null
    const upper = u + v <= 1
    const riseEast = upper ? b - a : d - c
    const riseSouth = upper ? c - a : d - b
    const height = upper ? a + u * riseEast + v * riseSouth : d - (1 - u) * riseEast - (1 - v) * riseSouth
    return { i, u, v, height, riseEast, riseSouth }
  }

  const sampleFacet: SampleTerrain = (x, z) => {
    const cell = locate(x, z)
    if (!cell) return null
    const length = Math.hypot(cell.riseEast, step, cell.riseSouth)
    return {
      height: cell.height,
      normal: { x: -cell.riseEast / length, y: step / length, z: -cell.riseSouth / length },
    }
  }

  const sampleTerrain: SampleTerrain = (x, z): SurfaceSample | null => {
    const cell = locate(x, z)
    if (!cell) return null
    const { i, u, v } = cell
    const w00 = (1 - u) * (1 - v)
    const w10 = u * (1 - v)
    const w01 = (1 - u) * v
    const w11 = u * v
    let nx = 0
    let ny = 0
    let nz = 0
    for (const [index, weight] of [
      [i, w00],
      [i + 1, w10],
      [i + columns, w01],
      [i + columns + 1, w11],
    ] as const) {
      nx += normals[index * 3] * weight
      ny += normals[index * 3 + 1] * weight
      nz += normals[index * 3 + 2] * weight
    }
    const length = Math.hypot(nx, ny, nz)
    return { height: cell.height, normal: { x: nx / length, y: ny / length, z: nz / length } }
  }

  const heightAt = (x: number, z: number) => locate(x, z)?.height ?? Number.NaN

  return { columns, rows, step, width, depth, heights, normals, sampleTerrain, sampleFacet, heightAt }
}

/** Central-difference normals at every sample (one-sided on the edges). */
export function vertexNormals(columns: number, rows: number, step: number, heights: Float32Array): Float32Array {
  const normals = new Float32Array(columns * rows * 3)
  const at = (column: number, row: number, fallback: number) => {
    const value = heights[row * columns + column]
    return Number.isFinite(value) ? value : fallback
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const centre = at(column, row, 0)
      const west = column > 0 ? column - 1 : column
      const east = column < columns - 1 ? column + 1 : column
      const north = row > 0 ? row - 1 : row
      const south = row < rows - 1 ? row + 1 : row
      const dhdx = (at(east, row, centre) - at(west, row, centre)) / ((east - west) * step)
      const dhdz = (at(column, south, centre) - at(column, north, centre)) / ((south - north) * step)
      const length = Math.hypot(dhdx, 1, dhdz)
      const index = (row * columns + column) * 3
      normals[index] = -dhdx / length
      normals[index + 1] = 1 / length
      normals[index + 2] = -dhdz / length
    }
  }
  return normals
}
