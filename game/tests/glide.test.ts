import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { GLIDE, buildGlide } from '../src/world/glide'
import { buildMoguls } from '../src/world/moguls'
import { createSurfaceSampler } from '../src/world/snow'
import type { Point2, Run } from '../src/world/resort'
import { FIXED_DT, PHYSICS, createSkiState, stepSkier, type SkiEnv } from '../src/sim'

const flatRun = (line: Point2[], extra: Partial<Run> = {}): Run => ({ id: 'r', name: 'Track', difficulty: 'easy', groomed: true, kind: 'line', parts: [line], ...extra })

describe('glide tracks (pure)', () => {
  // A 600 m track falling 2 degrees to the east, then a 25 degree pitch.
  const height = (x: number) => (x < 600 ? -x * Math.tan((2 * Math.PI) / 180) : -600 * Math.tan((2 * Math.PI) / 180) - (x - 600) * Math.tan((25 * Math.PI) / 180))
  const field = buildGlide([flatRun([[0, 0], [600, 0], [900, 0]])], (x) => height(x))

  it('covers the flat stretch and not the pitch below it', () => {
    expect(field.at(200, 0)).toMatchObject({ cruise: GLIDE.cruise })
    expect(field.at(200, 0)!.dirX).toBeCloseTo(1)
    expect(field.at(200, GLIDE.reach - 1)).not.toBeNull()
    expect(field.at(200, GLIDE.reach + 3)).toBeNull()
    expect(field.at(800, 0)).toBeNull()
  })

  it('lays boosters along a long stretch, pointing down the track', () => {
    expect(field.boosters.length).toBeGreaterThanOrEqual(2)
    for (const b of field.boosters) expect(b.dirX).toBeCloseTo(1)
    const b = field.boosters[0]
    expect(field.at(b.x + 5, 0)!.boost).toBe(true)
    expect(field.at(b.x - 5, 0)!.boost).toBe(false)
    expect(field.at(b.x + 5, b.halfWidth + 2)!.boost).toBe(false)
  })

  it('leaves glades, short rolls and steep runs alone', () => {
    expect(buildGlide([flatRun([[0, 0], [600, 0]], { glade: true })], (x) => height(x)).stretches).toEqual([])
    expect(buildGlide([flatRun([[0, 0], [30, 0]])], () => 0).stretches).toEqual([])
    expect(buildGlide([flatRun([[0, 0], [600, 0]])], (x) => -x * 0.4).stretches).toEqual([])
  })

  it('turns a level line round if it was mapped uphill', () => {
    const uphill = buildGlide([flatRun([[600, 0], [0, 0]])], (x) => height(x))
    expect(uphill.at(200, 0)!.dirX).toBeCloseTo(1)
  })
})

describe('glide in the skier', () => {
  const flat = () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } })
  const track = { dirX: 0, dirZ: 1, cruise: GLIDE.cruise, boost: false }
  const run = (env: SkiEnv, input: { tuck?: boolean; brake?: number; steer?: number }, start: { speed?: number; heading?: number }, seconds: number) => {
    const s = createSkiState({ x: 0, z: 0, heading: start.heading ?? 0 })
    s.vz = Math.cos(start.heading ?? 0) * (start.speed ?? 0)
    s.vx = -Math.sin(start.heading ?? 0) * (start.speed ?? 0)
    s.speed = start.speed ?? 0
    for (let t = 0; t < seconds; t += FIXED_DT) stepSkier(s, { steer: input.steer ?? 0, brake: input.brake ?? 0, tuck: input.tuck ?? false }, flat as never, FIXED_DT, env)
    return s
  }

  it('carries a moving skier to cruising speed on the level with no input', () => {
    const s = run({ glide: () => track }, {}, { speed: 3 }, 12)
    expect(s.speed).toBeGreaterThan(GLIDE.cruise - 2.5)
    expect(s.speed).toBeLessThan(GLIDE.cruise + 0.5)
    expect(run({}, {}, { speed: 3 }, 12).speed).toBeLessThan(3)
  })

  it('leaves a stopped skier stopped until they press forward', () => {
    expect(run({ glide: () => track }, {}, {}, 5).speed).toBeLessThan(0.2)
    expect(run({ glide: () => track }, { tuck: true }, {}, 8).speed).toBeGreaterThan(GLIDE.cruise - 3)
  })

  it('drops out when braking or when travelling across the track', () => {
    expect(run({ glide: () => track }, { brake: 1 }, { speed: 10 }, 6).speed).toBeLessThan(2)
    const across = run({ glide: () => track }, {}, { speed: 3, heading: Math.PI / 2 }, 6)
    expect(across.gliding).toBe(0)
    expect(across.speed).toBeLessThan(3)
  })

  it('a booster pushes past cruising speed and flags it', () => {
    const s = run({ glide: () => ({ ...track, boost: true }) }, {}, { speed: 10 }, 3)
    expect(s.speed).toBeGreaterThan(GLIDE.cruise + 3)
    expect(s.speed).toBeLessThan(PHYSICS.boostSpeed + 0.5)
    expect(s.boosting).toBe(true)
  })
})

const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

describe.skipIf(!hasData)('glide on the Apex traverses', () => {
  const world = hasData ? loadApexWorld() : null

  /** Seconds for a steering bot to cover `metres` of the run from a standing start at its top. */
  function timeAlong(name: string, metres: number, glide: boolean, forward: boolean): number {
    const { grid, resort, surface, canopy } = world!
    const { sampleTerrain, onMogul } = buildMoguls(grid, resort.runs, surface)
    const env: SkiEnv = { sampleSurface: createSurfaceSampler(grid, surface, canopy, { onMogul }), glide: glide ? buildGlide(resort.runs, grid.heightAt).at : undefined }
    const part = resort.runs.find((r) => r.name === name)!.parts[0]
    const line = part.flatMap((p, i) => {
      if (i === 0) return [p]
      const [a, b] = [part[i - 1], p]
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5))
      return Array.from({ length: n }, (_, u) => [a[0] + ((b[0] - a[0]) * (u + 1)) / n, a[1] + ((b[1] - a[1]) * (u + 1)) / n] as Point2)
    })
    const s = createSkiState({ x: line[0][0], z: line[0][1], heading: Math.atan2(-(line[4][0] - line[0][0]), line[4][1] - line[0][1]) })
    s.y = sampleTerrain(line[0][0], line[0][1])!.height
    let k = 0
    let dist = 0
    for (let t = 0; t < 300; t += FIXED_DT) {
      let near = Infinity
      for (let i = k; i < Math.min(line.length, k + 30); i++) {
        const d = (line[i][0] - s.x) ** 2 + (line[i][1] - s.z) ** 2
        if (d < near) ((near = d), (k = i))
      }
      let j = k
      for (let ahead = 0; j < line.length - 1 && ahead < 25; j++) ahead += Math.hypot(line[j + 1][0] - line[j][0], line[j + 1][1] - line[j][1])
      const want = Math.atan2(-(line[j][0] - s.x), line[j][1] - s.z)
      const error = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading))
      const [px, pz] = [s.x, s.z]
      // Forward for the first two seconds only (one push to get going) unless `forward` holds it.
      stepSkier(s, { steer: s.grounded ? Math.max(-1, Math.min(1, error * 2.5)) : 0, brake: 0, tuck: forward || t < 2 }, sampleTerrain, FIXED_DT, env)
      dist += Math.hypot(s.x - px, s.z - pz)
      if (dist >= metres) return t
    }
    return Infinity
  }

  it("reaches the blacks off Grandfather's Trail in well under a minute, with one push", () => {
    const before = timeAlong("Grandfather's Trail", 550, false, true)
    const after = timeAlong("Grandfather's Trail", 550, true, false)
    expect(before).toBeGreaterThan(60)
    expect(after).toBeLessThan(40)
  })

  it("gets Grandmother's Trail and Stock's Traverse moving without holding forward", () => {
    expect(timeAlong("Grandmother's Trail", 300, true, false)).toBeLessThan(30)
    expect(timeAlong("Stock's Traverse", 900, true, false)).toBeLessThan(70)
  })

  it("carries a rider who never steers along Grandfather's Trail without running off it", () => {
    const { grid, resort, surface, canopy } = world!
    const { sampleTerrain, onMogul } = buildMoguls(grid, resort.runs, surface)
    const field = buildGlide(resort.runs, grid.heightAt)
    const env: SkiEnv = { sampleSurface: createSurfaceSampler(grid, surface, canopy, { onMogul }), glide: field.at }
    const line = resort.runs.find((r) => r.name === "Grandfather's Trail")!.parts[0]
    const s = createSkiState({ x: line[0][0], z: line[0][1], heading: Math.atan2(-(line[1][0] - line[0][0]), line[1][1] - line[0][1]) })
    s.y = sampleTerrain(line[0][0], line[0][1])!.height
    let worst = 0
    for (let t = 0; t < 35; t += FIXED_DT) {
      stepSkier(s, { steer: 0, brake: 0, tuck: t < 2 }, sampleTerrain, FIXED_DT, env)
      let near = Infinity
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = line[i - 1]
        const [bx, bz] = line[i]
        const u = Math.max(0, Math.min(1, ((s.x - ax) * (bx - ax) + (s.z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2 || 1)))
        near = Math.min(near, Math.hypot(s.x - ax - u * (bx - ax), s.z - az - u * (bz - az)))
      }
      worst = Math.max(worst, near)
    }
    expect(worst).toBeLessThan(12)
    expect(Math.hypot(s.x - line[0][0], s.z - line[0][1])).toBeGreaterThan(350)
    expect(s.crashed).toBe(0)
  })

  it('finds the summit traverses and puts boosters on them', () => {
    const { grid, resort } = world!
    const field = buildGlide(resort.runs, grid.heightAt)
    const length = (name: string) => field.stretches.filter((s) => s.run === name).reduce((sum, s) => sum + s.length, 0)
    expect(length("Grandfather's Trail")).toBeGreaterThan(1500)
    expect(length("Grandmother's Trail")).toBeGreaterThan(300)
    expect(length("Stock's Traverse")).toBeGreaterThan(500)
    // The steep runs have none.
    for (const name of ['West Bank', 'Gunbarrel', 'Chute', 'Toilet Bowl']) expect(length(name)).toBe(0)
    expect(field.boosters.filter((b) => b.run === "Grandfather's Trail").length).toBeGreaterThanOrEqual(4)
    expect(field.boosters.length).toBeLessThan(30)
  })
})
