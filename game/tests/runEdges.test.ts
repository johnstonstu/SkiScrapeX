import { describe, expect, it } from 'vitest'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { resortFromFeatures, runHalfWidth, type FeaturesDocument } from '../src/world/resort'
import { buildSurface, groomHeading, isClear } from '../src/world/surface'
import { plantForest } from '../src/world/forest'

const SIZE = 81
const STEP = 5
const CENTRE = 200

/** Gentle slope falling toward +Z, so groom headings have a fall line. */
const grid = createTerrainGrid(
  { columns: SIZE, rows: SIZE, stepMetres: STEP },
  Float32Array.from({ length: SIZE * SIZE }, (_, i) => 400 - Math.floor(i / SIZE) * STEP * 0.3),
)

const doc = (x = CENTRE): FeaturesDocument => ({
  version: 1,
  runs: [{ name: 'Down', difficulty: 'intermediate', grooming: 'classic', geometry: 'line', points: [{ x, z: 20 }, { x, z: 380 }] }],
})
const resort = resortFromFeatures(doc(), grid.heightAt)
const half = runHalfWidth(resort.runs[0])

/** Forest everywhere except a cleared band `clearing` metres either side of x = CENTRE. */
function canopy(clearing: number): Float32Array {
  return Float32Array.from({ length: SIZE * SIZE }, (_, i) => (Math.abs((i % SIZE) * STEP - CENTRE) <= clearing ? 0 : 1))
}

describe('runs fitted to the LiDAR clearing', () => {
  it('widens a run into the open part of its real clearing, but not into the forest', () => {
    const cover = canopy(half + 10)
    const guessed = buildSurface(grid, resort, 2.5)
    const fitted = buildSurface(grid, resort, 2.5, [], { canopyCover: cover })
    const x = CENTRE + half + 6
    expect(guessed.runNameAt(x, 200)).toBe('Off-piste')
    expect(fitted.runNameAt(x, 200)).toBe('Down')
    expect(isClear(fitted, x, 200)).toBe(true)
    expect(fitted.runNameAt(CENTRE + half + 20, 200)).toBe('Off-piste')
  })

  it('gives standing forest at a run edge back to the trees, keeping the core', () => {
    const cover = canopy(6)
    const fitted = buildSurface(grid, resort, 2.5, [], { canopyCover: cover })
    expect(fitted.runNameAt(CENTRE + half * 0.85, 200)).toBe('Off-piste')
    expect(isClear(fitted, CENTRE + half * 0.85, 200)).toBe(false)
    // The core of the run stays, even where the canopy grid says forest.
    expect(fitted.runNameAt(CENTRE + half * 0.45, 200)).toBe('Down')
  })

  it('does not grow runs across open alpine ground with no forest nearby', () => {
    const open = new Float32Array(SIZE * SIZE)
    const fitted = buildSurface(grid, resort, 2.5, [], { canopyCover: open })
    expect(fitted.runNameAt(CENTRE + half + 6, 200)).toBe('Off-piste')
  })
})

describe('edge saplings', () => {
  it('plants none in the middle where two runs overlap', () => {
    const twin = resortFromFeatures(
      { version: 1, runs: [...doc(CENTRE).runs!, ...doc(CENTRE + half * 1.4).runs!.map((r) => ({ ...r, name: 'Beside' }))] },
      grid.heightAt,
    )
    const surface = buildSurface(grid, twin, 2.5)
    const forest = plantForest(grid, twin, surface, null, { density: 1 })
    // Saplings are the short trees planted inside corridors; none may stand where both runs are clear.
    const saplings = forest.chunks.flatMap((c) => c.trees).filter((t) => t.height < 3.4 && isClear(surface, t.x, t.z))
    expect(saplings.filter((t) => t.x > CENTRE + half * 0.5 && t.x < CENTRE + half * 0.9)).toHaveLength(0)
    // ...but the outer edges still get some.
    expect(saplings.length).toBeGreaterThan(0)
  })
})

describe('groom heading', () => {
  // Normal of a slope falling toward +Z leans toward +Z.
  const nx = 0
  const nz = 0.3

  it('leans a run that heads roughly downhill toward the fall line', () => {
    const run = Math.PI / 2 - 0.6
    const turned = groomHeading(run, nx, nz)
    expect(Math.abs(turned - Math.PI / 2)).toBeLessThan(Math.abs(run - Math.PI / 2))
  })

  it('keeps a traverse heading, whichever way the run was drawn', () => {
    expect(groomHeading(0.15, nx, nz)).toBe(0.15)
    const up = -Math.PI / 2 + 0.3
    const turned = groomHeading(up, nx, nz)
    expect(Math.abs(turned + Math.PI / 2)).toBeLessThan(0.3)
  })

  it('leaves flat ground alone', () => {
    expect(groomHeading(1, 0.01, 0.02)).toBe(1)
  })
})
