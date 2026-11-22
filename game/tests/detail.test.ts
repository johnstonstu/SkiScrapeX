import { describe, expect, it } from 'vitest'
import { createTerrainGrid, decodeDetailHeights, withDetail } from '../src/world/terrainGrid'
import { buildDetailChunk, chunksNear, detailLayout, SKIRT_DEPTH } from '../src/world/detailChunks'

const slope = (x: number, z: number) => -0.3 * z + 4 * Math.sin(x / 37)
// A 3 m wide, 0.6 m deep cat track the 5 m grid cannot hold.
const track = (x: number, z: number) => slope(x, z) - (Math.abs(x - 101) < 1.5 ? 0.6 : 0)

function grids(holeAt?: [number, number]) {
  const coarseShape = { columns: 81, rows: 61, stepMetres: 5 } // 400 x 300 m
  const coarse = new Float32Array(81 * 61)
  for (let r = 0; r < 61; r++) for (let c = 0; c < 81; c++) coarse[r * 81 + c] = slope(c * 5, r * 5)
  const fineShape = { columns: 200, rows: 151, stepMetres: 2 } // 398 x 300 m
  const fine = new Float32Array(200 * 151)
  for (let r = 0; r < 151; r++) for (let c = 0; c < 200; c++) fine[r * 200 + c] = track(c * 2, r * 2)
  if (holeAt) fine[holeAt[1] * 200 + holeAt[0]] = Number.NaN
  const base = createTerrainGrid(coarseShape, coarse)
  return withDetail(base, createTerrainGrid(fineShape, fine))
}

describe('detail terrain', () => {
  it('decodes centimetre heights relative to the manifest origin', () => {
    const buffer = new ArrayBuffer(6)
    const view = new DataView(buffer)
    view.setUint16(0, 0, true)
    view.setUint16(2, 12345, true)
    view.setUint16(4, 65535, true)
    const out = decodeDetailHeights(buffer, { columns: 3, rows: 1, baseElevation: 1599.5, scale: 100, hole: 65535 }, 1600)
    expect(out[0]).toBeCloseTo(-0.5, 5)
    expect(out[1]).toBeCloseTo(122.95, 4)
    expect(out[2]).toBeNaN()
  })

  it('samples the fine grid where it has data and the coarse grid elsewhere', () => {
    const grid = grids()
    expect(grid.heightAt(101, 50)).toBeCloseTo(track(101, 50), 2)
    expect(grid.coarse!.heightAt(101, 50)).toBeGreaterThan(track(101, 50) + 0.3)
    // East of the last fine sample (398 m) the coarse grid still answers.
    expect(grid.heightAt(399, 50)).toBeCloseTo(grid.coarse!.heightAt(399, 50), 5)
    expect(grid.sampleTerrain(399, 50)).not.toBeNull()
    expect(grid.heightAt(401, 50)).toBeNaN()
  })

  it('selects every tile that touches the detail disc', () => {
    const grid = grids()
    const layout = detailLayout(grid, 64)
    expect(layout.size).toBe(64)
    const x = 170, z = 120, radius = 90
    const chosen = new Set(chunksNear(layout, x, z, radius))
    for (let a = 0; a < 360; a += 7) {
      for (const r of [0, radius * 0.5, radius * 0.99]) {
        const px = x + r * Math.cos((a * Math.PI) / 180)
        const pz = z + r * Math.sin((a * Math.PI) / 180)
        const index = Math.floor(pz / 64) * layout.across + Math.floor(px / 64)
        expect(chosen.has(index)).toBe(true)
      }
    }
    expect(chosen.size).toBeLessThan(layout.across * layout.down)
  })

  it('builds tiles whose shared edges match and whose morph target is the coarse surface', () => {
    const grid = grids([32, 10])
    const layout = detailLayout(grid, 64)
    const left = buildDetailChunk(grid, layout, 0)
    const right = buildDetailChunk(grid, layout, 1)
    const side = layout.cells + 1
    for (let r = 0; r < side; r++) {
      const a = r * side + layout.cells // east edge of the left tile
      const b = r * side // west edge of the right tile
      expect([...left.positions.subarray(a * 3, a * 3 + 3)]).toEqual([...right.positions.subarray(b * 3, b * 3 + 3)])
    }
    for (let v = 0; v < side * side; v += 17) {
      const x = left.positions[v * 3], z = left.positions[v * 3 + 2]
      expect(left.base[v * 4]).toBeCloseTo(grid.coarse!.heightAt(x, z), 4)
    }
    // The hole at detail sample (32, 10) takes the coarse height.
    const hole = 10 * side + 32 - layout.cells
    expect(right.positions[hole * 3 + 1]).toBeCloseTo(grid.coarse!.heightAt(64, 20), 4)
    // Skirt vertices hang below the edge they follow.
    const surface = side * side
    expect(left.positions[surface * 3 + 1]).toBeCloseTo(left.positions[1] - SKIRT_DEPTH, 5)
    expect(left.positions.every(Number.isFinite)).toBe(true)
  })

  it('clips the last tile to the fine grid', () => {
    const grid = grids()
    const layout = detailLayout(grid, 64)
    const last = buildDetailChunk(grid, layout, layout.across * layout.down - 1)
    let maxX = 0, maxZ = 0
    for (let i = 0; i < last.positions.length; i += 3) {
      maxX = Math.max(maxX, last.positions[i])
      maxZ = Math.max(maxZ, last.positions[i + 2])
    }
    expect(maxX).toBe(398)
    expect(maxZ).toBe(300)
  })
})
