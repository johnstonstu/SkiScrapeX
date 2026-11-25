import { describe, expect, it } from 'vitest'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { resortFromFeatures } from '../src/world/resort'
import { buildSurface, surfaceAt, SurfaceId } from '../src/world/surface'
import { buildExposure, exposureAt, SCOUR } from '../src/world/exposure'
import { createSurfaceSampler } from '../src/world/snow'

const SIZE = 41
const STEP = 5
const CREST_X = 100

/** A north-south ridge (about 19° flanks) with its crest `crest` metres above a 1600 m origin. */
function ridge(crest: number) {
  const heights = new Float32Array(SIZE * SIZE)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) heights[r * SIZE + c] = crest - 0.35 * Math.abs(c * STEP - CREST_X)
  }
  return createTerrainGrid({ columns: SIZE, rows: SIZE, stepMetres: STEP }, heights)
}

function plateau(height: number) {
  return createTerrainGrid({ columns: SIZE, rows: SIZE, stepMetres: STEP }, new Float32Array(SIZE * SIZE).fill(height))
}

describe('summit wind exposure', () => {
  const summitRidge = ridge(560)
  const exposure = buildExposure(summitRidge, { originElevation: 1600 })

  it('strips a summit ridge crest down to rock', () => {
    expect(exposureAt(exposure, CREST_X, 100)).toBeGreaterThan(SCOUR.rock)
  })

  it('scours the windward flank harder than the lee flank', () => {
    // The wind blows toward +X, so the west flank faces into it.
    const windward = exposureAt(exposure, CREST_X - 30, 100)
    const lee = exposureAt(exposure, CREST_X + 30, 100)
    expect(windward).toBeGreaterThan(lee + 0.2)
    expect(lee).toBeLessThan(SCOUR.crust)
  })

  it('leaves a flat summit plateau and low terrain snowy', () => {
    const flat = buildExposure(plateau(560), { originElevation: 1600 })
    expect(exposureAt(flat, 100, 100)).toBeLessThan(SCOUR.crust)
    const low = buildExposure(ridge(300), { originElevation: 1600 })
    expect(Math.max(...low.values)).toBe(0)
  })

  it('keeps snow under trees', () => {
    const forested = buildExposure(summitRidge, { originElevation: 1600, cover: new Float32Array(SIZE * SIZE).fill(0.8) })
    expect(exposureAt(forested, CREST_X, 100)).toBeLessThan(SCOUR.crust)
  })

  it('varies smoothly, so patches have no texel steps', () => {
    let largest = 0
    let previous = exposureAt(exposure, 40, 77)
    for (let x = 40.5; x <= 160; x += 0.5) {
      const value = exposureAt(exposure, x, 77)
      largest = Math.max(largest, Math.abs(value - previous))
      previous = value
    }
    expect(largest).toBeLessThan(0.05)
  })

  it('feeds the ski surface: rock on the crest, soft snow on the lee flank', () => {
    const empty = resortFromFeatures({ version: 1, runs: [] }, summitRidge.heightAt)
    const surface = buildSurface(summitRidge, empty, 2.5, [], { exposure })
    // The mask itself stays powder: scour is not baked into hard texels any more.
    expect(surfaceAt(surface, CREST_X, 100)).toBe(SurfaceId.powder)
    const sample = createSurfaceSampler(summitRidge, surface, null)
    expect(sample(CREST_X, 100).kind).toBe('rock')
    expect(sample(CREST_X, 100).depth).toBe(0)
    expect(sample(CREST_X + 30, 100).kind).toBe('powder')
    expect(sample(CREST_X + 30, 100).depth).toBeGreaterThan(0.05)
  })
})
