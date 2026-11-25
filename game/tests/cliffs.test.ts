import { describe, expect, it } from 'vitest'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { resortFromFeatures } from '../src/world/resort'
import { buildCliffs, faceHeight, makeOutcrop, nearOutcrop, outcropTop, placeRunDrops, placeTowerDrop } from '../src/world/cliffs'
import { createSkiState, FIXED_DT, stepSkier } from '../src/sim'

const SIZE = 61
const STEP = 5
/** A planar 30° slope falling toward +Z. */
const fall = Math.tan((30 * Math.PI) / 180)
const grid = createTerrainGrid(
  { columns: SIZE, rows: SIZE, stepMetres: STEP },
  Float32Array.from({ length: SIZE * SIZE }, (_, i) => 300 - Math.floor(i / SIZE) * STEP * fall),
)
const outcrop = makeOutcrop(grid, 150, 150, 12, 8, 5, 1)!

describe('rock drops', () => {
  it('lies along the fall line, flush with the snow at the back and proud at the lip', () => {
    expect(outcrop.dirZ).toBeCloseTo(1, 3)
    // Centre of the back edge meets the slope; the lip stands a face height above it.
    expect(outcropTop(outcrop, 150, 150 - 7.9)! - grid.heightAt(150, 150 - 7.9)).toBeLessThan(0.15)
    const lip = outcropTop(outcrop, 150, 150 - 1.5)!
    expect(lip - grid.heightAt(150, 150 - 1.5)).toBeGreaterThan(faceHeight(outcrop, 0) * 0.7)
    // Off the footprint: below the lip and beside the rock.
    expect(outcropTop(outcrop, 150, 150 + 3)).toBeNull()
    expect(outcropTop(outcrop, 150 + 8, 147)).toBeNull()
  })

  it('tapers the face toward the ends', () => {
    expect(faceHeight(outcrop, 5.5)).toBeLessThan(faceHeight(outcrop, 0))
  })

  it('carries the skis over the lip into the air', () => {
    const cliffs = buildCliffs([outcrop], grid.sampleTerrain)
    const state = createSkiState({ x: 150, z: 150 - 20, heading: 0 })
    state.y = cliffs.sampleTerrain(150, 130)!.height
    state.vz = 12
    let maxGap = 0
    for (let t = 0; t < 2.5; t += FIXED_DT) {
      stepSkier(state, { steer: 0, brake: 0, tuck: true }, cliffs.sampleTerrain, FIXED_DT)
      const ground = cliffs.sampleTerrain(state.x, state.z)
      if (ground && !state.grounded) maxGap = Math.max(maxGap, state.y - ground.height)
    }
    expect(maxGap).toBeGreaterThan(2.5)
    expect(state.z).toBeGreaterThan(160)
  })

  it('keeps trees off the rock and its landing, not the whole slope', () => {
    expect(nearOutcrop([outcrop], 150, 145)).toBe(true)
    expect(nearOutcrop([outcrop], 150, 162)).toBe(true)
    expect(nearOutcrop([outcrop], 150, 200)).toBe(false)
    expect(nearOutcrop([outcrop], 180, 150)).toBe(false)
  })

  it('places named run drops along the run and the tower drop beside the tower, toward the run', () => {
    const resort = resortFromFeatures(
      { version: 1, runs: [{ name: 'West Bank', difficulty: 'advanced', geometry: 'line', points: [{ x: 100, z: 20 }, { x: 100, z: 280 }] }, { name: 'The Pit', difficulty: 'advanced', geometry: 'line', points: [{ x: 200, z: 20 }, { x: 200, z: 280 }] }] },
      grid.heightAt,
    )
    const drops = placeRunDrops(grid, resort.runs)
    expect(drops.length).toBe(4)
    for (const d of drops) expect(Math.abs(d.x - 200)).toBeLessThan(12)
    const tower = placeTowerDrop(grid, resort.runs, [[85, 150], [300, 40]])!
    expect(tower.x).toBeGreaterThan(85)
    expect(tower.x).toBeLessThanOrEqual(100)
    expect(Math.abs(tower.z - 150)).toBeLessThan(5)
  })
})
