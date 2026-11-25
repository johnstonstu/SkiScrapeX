import { describe, expect, it } from 'vitest'
import { createSnowDeform, createStamper, imprint } from '../src/world/snowDeform'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { resortFromFeatures } from '../src/world/resort'
import { buildSurface } from '../src/world/surface'
import { createSurfaceSampler } from '../src/world/snow'

describe('deformable snow', () => {
  it('cuts a trench along the ski and piles a berm beside it', () => {
    const field = createSnowDeform(20, 0.1)
    field.recentre(10, 10)
    field.carve(8, 10, 12, 10, 0.1, 0.25, 0.08, 0.3)
    expect(field.at(10, 10)).toBeLessThan(-0.2)
    expect(field.at(10, 10.25)).toBeGreaterThan(0.03)
    expect(field.at(10, 11)).toBe(0)
    expect(field.at(14, 10)).toBe(0)
  })

  it('keeps tracks where they are in the world when the window slides', () => {
    const field = createSnowDeform(20, 0.1)
    field.recentre(10, 10)
    field.carve(9, 10, 11, 10, 0.1, 0.2, 0, 0.1)
    const before = field.at(10, 10)
    field.recentre(17, 10)
    expect(field.originX).toBeGreaterThan(0)
    expect(field.at(10, 10)).toBeCloseTo(before, 3)
    expect(field.takeDirty()?.full).toBe(true)
  })

  it('reports only the rows a stamp touched', () => {
    const field = createSnowDeform(20, 0.1)
    field.recentre(10, 10)
    field.takeDirty()
    field.carve(9, 10, 11, 10, 0.1, 0.2, 0.05, 0.2)
    const dirty = field.takeDirty()!
    expect(dirty.full).toBe(false)
    expect(dirty.max - dirty.min).toBeLessThan(10)
    expect(field.takeDirty()).toBeNull()
  })

  it('skids plough a wider swath than a carve, and groomers take only a faint groove', () => {
    const carve = createSnowDeform(20, 0.1)
    const skid = createSnowDeform(20, 0.1)
    const groomer = createSnowDeform(20, 0.1)
    for (const f of [carve, skid, groomer]) f.recentre(10, 10)
    imprint(carve, { x0: 8, z0: 10, x1: 12, z1: 10, sink: 0.2, loose: 0.4, skid: 0 })
    imprint(skid, { x0: 8, z0: 10, x1: 12, z1: 10, sink: 0.2, loose: 0.4, skid: 1 })
    imprint(groomer, { x0: 8, z0: 10, x1: 12, z1: 10, sink: 0, loose: 0, skid: 0 })
    expect(carve.at(10, 10.25)).toBeGreaterThanOrEqual(-0.01)
    expect(skid.at(10, 10.25)).toBeLessThan(-0.1)
    expect(groomer.at(10, 10)).toBeGreaterThan(-0.02)
    expect(groomer.at(10, 10)).toBeLessThan(0)
  })

  it('lays imprints down behind the skis, not under them', () => {
    const stamper = createStamper(createSnowDeform(20, 0.1), 0.25)
    const base = { sideX: 0, sideZ: 1, stance: 0.16, boardWidth: 0, sink: 0.2, loose: 0.4, skid: 0, grounded: true, crashed: false }
    stamper.push({ ...base, x: 9, z: 10 })
    stamper.push({ ...base, x: 10, z: 10 })
    stamper.step(0.1)
    expect(stamper.field.at(9.5, 10.16)).toBe(0)
    stamper.step(0.2)
    expect(stamper.field.at(9.5, 10.16)).toBeLessThan(-0.1)
  })

  it('makes packed track snow shallower for the sim', () => {
    const grid = createTerrainGrid({ columns: 11, rows: 11, stepMetres: 5 }, Float32Array.from({ length: 121 }, (_, i) => 100 - Math.floor(i / 11)))
    const resort = resortFromFeatures({ version: 1, runs: [] }, grid.heightAt)
    const surface = buildSurface(grid, resort, 2.5)
    const field = createSnowDeform(20, 0.1)
    field.recentre(25, 25)
    const fresh = createSurfaceSampler(grid, surface, null, { deform: field })(25, 25)
    field.carve(23, 25, 27, 25, 0.2, 0.25, 0, 0.1)
    const tracked = createSurfaceSampler(grid, surface, null, { deform: field })(25, 25)
    expect(tracked.depth).toBeLessThan(fresh.depth - 0.15)
    expect(tracked.mu).toBeLessThan(fresh.mu)
  })
})
