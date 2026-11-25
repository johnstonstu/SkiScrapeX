import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadDiskGrid } from './diskGrid'
import { chooseCourse, courseForRun, liftAtBottom, pickableRuns, resortFromFeatures } from '../src/world/resort'
import { buildBuildings } from '../src/world/buildings'
import { advance, createClock, createSkier } from '../src/sim'

// Needs the generated data (see README: fetch the data branch into public/data).
const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`)

describe.skipIf(!hasData)('Apex crop', () => {
  it('a steering bot skis Grandfather’s from the top of Quickdraw to a lift', () => {
    const grid = loadDiskGrid(DATA)
    const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
    const course = chooseCourse(resort, grid.heightAt)
    expect(course.startLift?.name).toBe('Quickdraw')
    expect(course.startRun?.name).toMatch(/Grandfather/)
    const line = course.startRun!.parts[0]
    const slope = { id: 'apex', label: 'apex', width: grid.width, depth: grid.depth, originX: 0, originZ: 0, visualStep: 5, spawn: course.spawn, sampleTerrain: grid.sampleTerrain }
    const skier = createSkier(slope)
    const clock = createClock()
    let reached: string | null = null
    for (let t = 0; t < 600 && !reached; t += 1 / 60) {
      let nearest = 0
      let best = Infinity
      line.forEach(([x, z], i) => {
        const d = (x - skier.x) ** 2 + (z - skier.z) ** 2
        if (d < best) ((best = d), (nearest = i))
      })
      let k = nearest
      for (let ahead = 0; k < line.length - 1 && ahead < 25; k++) ahead += Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])
      const want = Math.atan2(-(line[k][0] - skier.x), line[k][1] - skier.z)
      const error = Math.atan2(Math.sin(want - skier.heading), Math.cos(want - skier.heading))
      advance(clock, skier, { steer: Math.max(-1, Math.min(1, error * 2.5)), brake: skier.speed > 14 ? 0.6 : 0, tuck: skier.speed < 9 }, grid.sampleTerrain, 1 / 60)
      expect(skier.offMap).toBe(false)
      if (t > 10) reached = liftAtBottom(resort, skier.x, skier.z, 24)?.name ?? null
    }
    expect(reached).not.toBeNull()
  }, 30000)
  it('every pickable run starts on the snow and every lift has a ride up', () => {
    const grid = loadDiskGrid(DATA)
    const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
    const runs = pickableRuns(resort)
    expect(runs.length).toBeGreaterThan(30)
    for (const run of runs) {
      const course = courseForRun(resort, run)
      expect(grid.sampleTerrain(course.spawn.x, course.spawn.z), run.name).not.toBeNull()
    }
    for (const lift of resort.lifts) expect(grid.heightAt(...lift.top)).toBeGreaterThan(grid.heightAt(...lift.bottom))
    const buildings = buildBuildings(resort.buildings, grid.heightAt)
    expect(buildings.length).toBeGreaterThan(100)
  })
})

describe.skipIf(!hasData)('LiDAR run overlay', () => {
  it('traces cleared ground that OSM does not already cover', async () => {
    const { OVERLAY_RUNS } = await import('../src/world/runOverlay')
    const { readFileSync: read } = await import('node:fs')
    const grid = loadDiskGrid(DATA)
    const manifest = JSON.parse(read(`${DATA}terrain.json`, 'utf8'))
    const cover = read(`${DATA}${manifest.canopy.coverFile}`)
    const resort = resortFromFeatures(JSON.parse(read(`${DATA}features.json`, 'utf8')), grid.heightAt)
    expect(OVERLAY_RUNS.length).toBeGreaterThan(15)
    // Research drafts (refs P-*) are fall-line lines from trail-map order, not traced clearings.
    for (const run of OVERLAY_RUNS.filter((r) => !r.ref.startsWith('P-'))) {
      // On the crop, mostly open canopy, and running downhill overall.
      let open = 0
      for (const [x, z] of run.points) {
        expect(Number.isFinite(grid.heightAt(x, z)), run.ref).toBe(true)
        const i = Math.round(z / 5) * manifest.columns + Math.round(x / 5)
        if (cover[i] < 0.35 * 255) open++
      }
      expect(open / run.points.length, run.ref).toBeGreaterThan(0.7)
      const [x0, z0] = run.points[0]
      const [x1, z1] = run.points[run.points.length - 1]
      expect(Math.abs(grid.heightAt(x0, z0) - grid.heightAt(x1, z1)), run.ref).toBeGreaterThan(40)
      // Not a copy of an OSM run: its midpoint is away from every mapped line.
      const [mx, mz] = run.points[Math.floor(run.points.length / 2)]
      const nearest = Math.min(...resort.runs.flatMap((r) => r.parts.flat()).map(([x, z]) => Math.hypot(x - mx, z - mz)))
      expect(nearest, run.ref).toBeGreaterThan(12)
    }
  })
})

describe.skipIf(!hasData)('village props', () => {
  it('finds lots with cars, decks outside their buildings and the hut by the Quickdraw top', async () => {
    const { buildVillage } = await import('../src/world/village')
    const { readFileSync: read } = await import('node:fs')
    const { pointInRing } = await import('../src/world/resort')
    const grid = loadDiskGrid(DATA)
    const manifest = JSON.parse(read(`${DATA}terrain.json`, 'utf8'))
    const cover = read(`${DATA}${manifest.canopy.coverFile}`)
    const heightBytes = read(`${DATA}${manifest.canopy.heightFile}`)
    const canopy = { cover: Float32Array.from(cover, (b) => b / 255), height: Float32Array.from(heightBytes, (b) => b / 4) }
    const resort = resortFromFeatures(JSON.parse(read(`${DATA}features.json`, 'utf8')), grid.heightAt)
    const buildings = buildBuildings(resort.buildings, grid.heightAt)
    const village = buildVillage(grid, canopy, resort.roads, resort.runs, buildings, resort.lifts)
    expect(village.lots.length).toBeGreaterThan(3)
    expect(village.cars.length).toBeGreaterThan(40)
    for (const car of village.cars) expect(buildings.some((b) => pointInRing(car.x, car.z, b.ring))).toBe(false)
    expect(village.decks.length).toBeGreaterThan(20)
    for (const deck of village.decks) {
      const cx = deck.corners.reduce((s, p) => s + p[0], 0) / 4
      const cz = deck.corners.reduce((s, p) => s + p[1], 0) / 4
      expect(buildings.some((b) => pointInRing(cx, cz, b.ring))).toBe(false)
    }
    expect(village.decks.some((d) => d.patio)).toBe(true)
    const quickdraw = resort.lifts.find((l) => /quickdraw/i.test(l.name))!
    expect(Math.hypot(village.hut!.x - quickdraw.top[0], village.hut!.z - quickdraw.top[1])).toBeLessThan(60)
  })
})
