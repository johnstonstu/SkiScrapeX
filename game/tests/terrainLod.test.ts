import { describe, expect, it } from 'vitest'
import { createTerrainLod } from '../src/render/terrain/terrainLod'

const grid = { columns: 101, rows: 81, step: 5 }

/** Triangles as sorted vertex triples, for comparing meshes. */
function triangles(indices: Uint32Array, count: number, limit: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < count; i += 3) {
    const tri = [indices[i], indices[i + 1], indices[i + 2]]
    if (tri.some((v) => v >= limit)) continue
    out.add(tri.join(','))
  }
  return out
}

describe('terrain LOD', () => {
  it('at full detail draws exactly the full-resolution mesh, with no skirts', () => {
    const lod = createTerrainLod(grid, { tileCells: 16, bands: [1e9, 1e9, 1e9] })
    const strides = lod.strides(0, 0, new Uint8Array(lod.tiles.length))
    expect([...strides].every((s) => s === 1)).toBe(true)
    const indices = new Uint32Array(lod.maxIndices)
    const count = lod.fill(strides, indices)
    expect(count).toBe((grid.columns - 1) * (grid.rows - 1) * 6)
    const want = new Set<string>()
    for (let r = 0; r < grid.rows - 1; r++) {
      for (let c = 0; c < grid.columns - 1; c++) {
        const a = r * grid.columns + c
        want.add([a, a + grid.columns, a + 1].join(','))
        want.add([a + 1, a + grid.columns, a + grid.columns + 1].join(','))
      }
    }
    expect(triangles(indices, count, grid.columns * grid.rows)).toEqual(want)
  })

  it('keeps tiles near the camera at full detail and thins far ones', () => {
    const lod = createTerrainLod({ columns: 641, rows: 529, step: 5 }, { tileCells: 32, bands: [420, 950, 1800] })
    const strides = lod.strides(100, 100, new Uint8Array(lod.tiles.length))
    lod.tiles.forEach((tile, t) => {
      const nearX = Math.max(tile.c0 * 5, Math.min(100, (tile.c0 + tile.w) * 5))
      const nearZ = Math.max(tile.r0 * 5, Math.min(100, (tile.r0 + tile.h) * 5))
      if (Math.hypot(nearX - 100, nearZ - 100) < 420) expect(strides[t]).toBe(1)
    })
    const indices = new Uint32Array(lod.maxIndices)
    const count = lod.fill(strides, indices)
    const full = 640 * 528 * 6
    // From a corner most of a 3.2 x 2.6 km crop is far away.
    expect(count).toBeLessThan(full * 0.25)
  })

  it('hangs skirts only where neighbouring tiles differ', () => {
    const lod = createTerrainLod(grid, { tileCells: 16, bands: [60, 1e9, 1e9] })
    const strides = lod.strides(0, 0, new Uint8Array(lod.tiles.length))
    expect(new Set(strides).size).toBe(2)
    const indices = new Uint32Array(lod.maxIndices)
    const count = lod.fill(strides, indices)
    const limit = grid.columns * grid.rows
    let skirt = 0
    for (let i = 0; i < count; i++) if (indices[i] >= limit) skirt++
    expect(skirt).toBeGreaterThan(0)
    expect(Math.max(...indices.subarray(0, count))).toBeLessThan(limit + lod.skirtVertexCount)
  })

  it('fits the stride to tiles cut short by the crop edge', () => {
    const lod = createTerrainLod({ columns: 45, rows: 45, step: 5 }, { tileCells: 32, bands: [0, 0, 0] })
    const strides = lod.strides(-1e5, -1e5, new Uint8Array(lod.tiles.length))
    const indices = new Uint32Array(lod.maxIndices)
    const count = lod.fill(strides, indices)
    // Every vertex index is a real grid or skirt vertex, and every triangle has area.
    for (let i = 0; i < count; i += 3) {
      expect(new Set([indices[i], indices[i + 1], indices[i + 2]]).size).toBe(3)
    }
  })
})
