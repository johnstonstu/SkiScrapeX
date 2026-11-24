import { describe, expect, it } from 'vitest'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { chooseCourse, liftAtBottom, resortFromFeatures, runHalfWidth, type FeaturesDocument, type Run } from '../src/world/resort'
import { buildSurface, isClear, surfaceAt, SurfaceId } from '../src/world/surface'
import { indexTrunks, plantForest } from '../src/world/forest'
import { createSkier, fallLineHeading, skiFrame } from '../src/sim'

/** 11 × 11 grid at 5 m, falling 0.3 m per metre toward +Z (south). */
function plane(columns = 11, rows = 11, grade = 0.3) {
  const heights = new Float32Array(columns * rows)
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) heights[row * columns + column] = 100 - row * 5 * grade
  return createTerrainGrid({ columns, rows, stepMetres: 5 }, heights)
}

describe('terrain grid', () => {
  it('matches the triangle height and gives a smooth upward normal', () => {
    const grid = plane()
    const sample = grid.sampleTerrain(12.3, 17.8)!
    expect(sample.height).toBeCloseTo(100 - 17.8 * 0.3, 5)
    expect(sample.normal.y).toBeGreaterThan(0.9)
    expect(sample.normal.z).toBeGreaterThan(0)
    expect(Math.hypot(sample.normal.x, sample.normal.y, sample.normal.z)).toBeCloseTo(1, 6)
    expect(grid.sampleTerrain(-1, 4)).toBeNull()
    expect(grid.sampleTerrain(4, 51)).toBeNull()
  })

  it('uses the NE–SW diagonal and treats NaN cells as holes', () => {
    const heights = new Float32Array([0, 1, 2, 10])
    const grid = createTerrainGrid({ columns: 2, rows: 2, stepMetres: 1 }, heights)
    // Upper triangle (NW, NE, SW) at u = v = 0.25.
    expect(grid.sampleFacet(0.25, 0.25)!.height).toBeCloseTo(0.25 * 1 + 0.25 * 2, 6)
    // Lower triangle (NE, SW, SE) at u = v = 0.75.
    expect(grid.sampleFacet(0.75, 0.75)!.height).toBeCloseTo(10 - 0.25 * (10 - 2) - 0.25 * (10 - 1), 6)
    heights[3] = Number.NaN
    const holed = createTerrainGrid({ columns: 2, rows: 2, stepMetres: 1 }, heights)
    expect(holed.sampleTerrain(0.5, 0.5)).toBeNull()
  })

  it('preserves the horizontal compass bearing across a steep sidehill', () => {
    const normal = { x: 0.48, y: 0.8, z: 0.36 }
    const heading = 1.1
    const { forward } = skiFrame(heading, normal)
    expect(Math.atan2(-forward.x, forward.z)).toBeCloseTo(heading, 8)
    expect(forward.x * normal.x + forward.y * normal.y + forward.z * normal.z).toBeCloseTo(0, 8)
  })

  it('finds the fall line from the normal', () => {
    const grid = plane()
    expect(fallLineHeading(grid.sampleTerrain(20, 20)!.normal)).toBeCloseTo(0, 5)
    expect(fallLineHeading({ x: 0, y: 1, z: 0 })).toBeNull()
  })
})

const doc: FeaturesDocument = {
  version: 1,
  runs: [
    {
      name: 'Down',
      // Advanced half-width (~15 m) leaves room for off-piste on this 50 m toy grid.
      difficulty: 'advanced',
      geometry: 'line',
      points: [
        { x: 25, z: 2 },
        { x: 25, z: 48 },
      ],
    },
  ],
  lifts: [
    {
      name: 'Quickdraw',
      aerialway: 'chair_lift',
      // Mapped top to bottom; the loader must flip it.
      line: [
        { x: 40, z: 1 },
        { x: 40, z: 49 },
      ],
    },
  ],
}

describe('resort', () => {
  const grid = plane()
  const resort = resortFromFeatures(doc, grid.heightAt)

  it('orders lifts bottom to top from the height grid', () => {
    expect(resort.lifts[0].bottom).toEqual([40, 49])
    expect(resort.lifts[0].top).toEqual([40, 1])
    expect(resort.lifts[0].towers.length).toBe(0)
  })

  it('spawns on the run beside the top terminal, facing down it', () => {
    const course = chooseCourse(resort, grid.heightAt)
    expect(course.startRun?.name).toBe('Down')
    expect(course.spawn.x).toBeCloseTo(25)
    expect(Math.abs(course.spawn.heading)).toBeLessThan(1e-6)
    const slope = { id: 't', label: 't', width: grid.width, depth: grid.depth, originX: 0, originZ: 0, visualStep: 5, spawn: course.spawn, sampleTerrain: grid.sampleTerrain }
    expect(createSkier(slope).y).toBeGreaterThan(0)
  })

  it('detects the bottom terminal only', () => {
    expect(liftAtBottom(resort, 41, 46, 10)?.name).toBe('Quickdraw')
    expect(liftAtBottom(resort, 40, 2, 10)).toBeNull()
  })

  it('labels the snow under the rider, including a park crossing a run', () => {
    const surface = buildSurface(grid, resort, 1, [{ name: 'Test park', line: [[2, 30], [48, 30]], halfWidth: 3 }])
    expect(surface.runNameAt(25, 10)).toBe('Down')
    expect(surface.runNameAt(25, 30)).toBe('Test park')
    expect(surface.runNameAt(2, 8)).toBe('Off-piste')
    expect(surface.runNameAt(-5, 5)).toBe('Off-piste')
  })

  it('paints the run as groomed and keeps trees off it and the lift line', () => {
    const surface = buildSurface(grid, resort, 1)
    expect(surfaceAt(surface, 25, 25)).toBe(SurfaceId.groomed)
    expect(isClear(surface, 25, 25)).toBe(true)
    expect(isClear(surface, 2, 25)).toBe(false)
    const forest = plantForest(grid, resort, surface, null, { density: 4 })
    for (const chunk of forest.chunks) {
      for (const tree of chunk.trees) {
        expect(isClear(surface, tree.x, tree.z)).toBe(false)
        expect(Math.abs(tree.x - 40)).toBeGreaterThan(10)
      }
    }
    const trunks = indexTrunks(forest)
    const tall = forest.chunks.flatMap((c) => c.trees).find((t) => t.height >= 4)
    if (tall) expect(trunks.hit(tall.x, tall.z, 0.3)).toBe(tall)
    expect(trunks.hit(25, 25, 0.3)).toBeNull()
  })
})

describe('run half-widths', () => {
  const stub = (difficulty: Run['difficulty'], groomed = true): Run =>
    ({ difficulty, groomed, kind: 'line', name: 'test', parts: [[[0, 0], [0, 10]]] }) as Run

  it('keeps groomers wider than ungroomed and expert trails', () => {
    expect(runHalfWidth(stub('easy'))).toBe(22)
    expect(runHalfWidth(stub('intermediate'))).toBe(20)
    expect(runHalfWidth(stub('advanced'))).toBe(15)
    expect(runHalfWidth(stub('easy', false))).toBe(14)
    expect(runHalfWidth(stub('expert'))).toBe(9.5)
  })
})

describe('tree species', () => {
  it('follows elevation: ghosts and krummholz up top, lodgepole low down', async () => {
    const { pickSpecies, Species } = await import('../src/world/forest')
    const tally = (elevation: number, height: number) => {
      const counts = new Array(6).fill(0)
      for (let i = 0; i < 1000; i++) counts[pickSpecies(elevation, height, (i + 0.5) / 1000)]++
      return counts
    }
    const summit = tally(2150, 5)
    const summitTall = tally(2150, 12)
    const valley = tally(1650, 24)
    expect(summit[Species.Krummholz] + summit[Species.Ghost]).toBeGreaterThan(750)
    expect(summit[Species.Ghost]).toBeGreaterThan(summit[Species.Krummholz])
    expect(summitTall[Species.Ghost]).toBeGreaterThan(500)
    expect(summit[Species.Pine]).toBe(0)
    expect(valley[Species.Pine]).toBeGreaterThan(valley[Species.Fir])
    expect(valley[Species.Ghost]).toBe(0)
    expect(valley[Species.Snag]).toBeGreaterThan(30)
  })
})
