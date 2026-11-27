import { describe, expect, it } from 'vitest'
import { FIXED_DT, SURFACES, createSkiState, stepSkier } from '../src/sim'
import { Species, indexTrunks, plantForest, type Tree } from '../src/world/forest'
import { buildMoguls, pointOnMogul } from '../src/world/moguls'
import { resortFromFeatures, type Run } from '../src/world/resort'
import { createSurfaceSampler, looseSnowDepth } from '../src/world/snow'
import { buildSurface } from '../src/world/surface'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { resolveTreeContact } from '../src/world/treeSkiing'

const size = 61
const heights = Float32Array.from({ length: size * size }, (_, i) => 100 - Math.floor(i / size) * 1.2)
const grid = createTerrainGrid({ columns: size, rows: size, stepMetres: 5 }, heights)
const idle = { steer: 0, brake: 0, tuck: false }
const resort = resortFromFeatures({ version: 1, runs: [] }, grid.heightAt)
const surface = buildSurface(grid, resort)

describe('variable powder', () => {
  it('uses the same depth for visible snowpack and fresh powder physics at texture samples', () => {
    const cover = Float32Array.from(heights, (_, i) => (i % size) / (size - 1))
    const sample = createSurfaceSampler(grid, surface, { cover, height: new Float32Array(heights.length) })
    for (const col of [0, 9, 31, 55, 60]) {
      const row = 20
      const x = col * grid.step, z = row * grid.step
      expect(sample(x, z).depth).toBeCloseTo(looseSnowDepth(x, z, cover[row * size + col]), 6)
    }
  })

  it('has shallow pockets and deep drifts, without depth cliffs off-piste', () => {
    const sample = createSurfaceSampler(grid, surface, null)
    const depths = []
    for (let z = 0; z <= 300; z += 2) {
      for (let x = 0; x <= 298; x += 2) {
        const depth = sample(x, z).depth
        expect(Math.abs(depth - sample(x + 2, z).depth)).toBeLessThan(0.045)
        depths.push(depth)
      }
    }
    expect(Math.min(...depths)).toBeLessThan(0.16)
    expect(Math.max(...depths)).toBeGreaterThan(0.53)
  })

  it('drops deeper and loses more speed in deep snow than in a shallow patch', () => {
    const run = (depth: number) => {
      const state = createSkiState({ x: 80, z: 80, heading: 0 })
      state.y = grid.heightAt(state.x, state.z)
      state.vz = 8
      for (let frame = 0; frame < 120; frame++) {
        stepSkier(state, idle, grid.sampleTerrain, FIXED_DT, { sampleSurface: () => ({ ...SURFACES.powder, depth }) })
      }
      return state
    }
    const shallow = run(0.07), deep = run(0.6)
    expect(deep.sink).toBeGreaterThan(shallow.sink + 0.05)
    expect(deep.speed).toBeLessThan(shallow.speed - 0.3)
  })
})

describe('skiing through trees', () => {
  const tree = (x: number, z: number): Tree => ({ x, y: grid.heightAt(x, z), z, height: 20, rotation: 0, tone: 1, species: Species.Fir })
  const trunks = indexTrunks({ chunkSize: 32, count: 2, source: 'canopy', chunks: [{ cx: 16, cz: 16, trees: [tree(20, 20), tree(21.45, 22.3)] }] })
  const contact = (x: number, speed: number) => {
    const state = createSkiState({ x, z: 21, heading: 0 })
    state.y = grid.heightAt(x, 21)
    state.vz = state.speed = speed
    const impact = resolveTreeContact(state, x, 18, trunks, grid.sampleTerrain)
    return { state, impact }
  }

  it('catches a swept head-on hit and gets up with a clear downhill route', () => {
    const { state, impact } = contact(20, 9)
    expect(impact?.kind).toBe('crash')
    expect(impact?.into).toBeCloseTo(9)
    expect(state.crashed).toBeGreaterThan(0)
    expect(state.x).toBeLessThan(20) // The first recovery side is blocked.
    for (let frame = 0; frame < 500; frame++) {
      const x = state.x, z = state.z
      stepSkier(state, { ...idle, tuck: true }, grid.sampleTerrain, FIXED_DT)
      expect(resolveTreeContact(state, x, z, trunks, grid.sampleTerrain)?.kind).not.toBe('crash')
    }
    expect(state.crashed).toBe(0)
    expect(state.z).toBeGreaterThan(23)
  })

  it('slides past glancing hits and nudges slow square contacts sideways', () => {
    const glance = contact(20.62, 9)
    expect(glance.impact?.kind).not.toBe('crash')
    expect(glance.state.vz).toBeGreaterThan(7)
    expect(glance.state.vx).toBeGreaterThan(0)
    const slow = contact(20, 2)
    expect(slow.impact?.kind).not.toBe('crash')
    expect(Math.abs(slow.state.vx)).toBeGreaterThan(0.6)
    expect(slow.state.crashed).toBe(0)
  })

  it('knocks a rider aside below a hard hit instead of crashing them (0.9.40)', () => {
    const knock = contact(20, 7)
    expect(knock.impact?.kind).toBe('brush')
    expect(knock.state.crashed).toBe(0)
    expect(knock.state.speed).toBeGreaterThan(0.5)
  })

  it('never crashes into a tree again just after getting up', () => {
    const { state } = contact(20, 9)
    while (state.crashed > 0) stepSkier(state, idle, grid.sampleTerrain, FIXED_DT)
    expect(state.crashGrace).toBeGreaterThan(2)
    state.x = 20; state.z = 21; state.vx = 0; state.vz = state.speed = 12
    const again = resolveTreeContact(state, 20, 18, trunks, grid.sampleTerrain)
    expect(again?.kind).toBe('brush')
    expect(state.crashed).toBe(0)
  })

  it('spaces canopy trunks while leaving forest cover', () => {
    const canopy = { cover: new Float32Array(heights.length).fill(0.85), height: new Float32Array(heights.length).fill(12) }
    const forest = plantForest(grid, resort, surface, canopy, { density: 1.5 })
    expect(forest.count).toBeGreaterThan(1000)
    const trees = forest.chunks.flatMap((chunk) => chunk.trees)
    for (const tree of trees) {
      expect(trees.some((other) => other !== tree && (other.x - tree.x) ** 2 + (other.z - tree.z) ** 2 < 2.7 ** 2)).toBe(false)
    }
  })
})

const runs: Run[] = [{ id: 'bumps', name: 'Bumps', difficulty: 'expert', groomed: false, moguls: true, kind: 'line', parts: [[[150, 25], [150, 200]]] }]
const field = buildMoguls(grid, runs, surface)

it('builds irregular moguls with asymmetric faces and shallower snow on their crests', () => {
  const bump = field.bumps[1]
  const uphill = pointOnMogul(bump, 0, -0.5)
  const downhill = pointOnMogul(bump, 0, 0.5)
  expect(field.bumps.length).toBeGreaterThan(12)
  expect(new Set(field.bumps.map((bump) => bump.height)).size).toBeGreaterThan(10)
  expect(Math.min(...field.bumps.map((b) => b.height))).toBeGreaterThan(0.45)
  expect(Math.max(...field.bumps.map((b) => b.height))).toBeGreaterThan(0.85)
  expect(bump.z - uphill[1]).toBeGreaterThan(downhill[1] - bump.z)
  expect(field.sampleTerrain(bump.x, bump.z)?.mogulHeight).toBeCloseTo(bump.height)
  const loose = createSurfaceSampler(grid, surface, null)
  const packed = createSurfaceSampler(grid, surface, null, { onMogul: field.onMogul })
  expect(packed(bump.x, bump.z).depth).toBeLessThan(loose(bump.x, bump.z).depth * 0.6)
})

it('can absorb a quick mogul crest by holding crouch', () => {
  const bump = field.bumps[1]
  const ride = (jump: boolean) => {
    const state = createSkiState({ x: bump.x, z: bump.z - 0.45, heading: 0 })
    state.y = field.sampleTerrain(state.x, state.z)!.height
    state.vz = 10
    let airborneSteps = 0
    for (let step = 0; step < 30; step++) {
      stepSkier(state, { ...idle, jump }, field.sampleTerrain, FIXED_DT)
      if (!state.grounded) airborneSteps++
    }
    return airborneSteps
  }
  expect(ride(false)).toBeGreaterThan(0)
  expect(ride(true)).toBeLessThan(ride(false))
})
