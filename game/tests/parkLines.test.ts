import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { loadApexWorld } from './apexWorld'
import { rideMainLine } from './parkBot'
import { DROP_IN_SPEED, FEATURES, dropInSpawn, jumpOutcome, jumpWindow, landingAt, jumpShape, parkOnRun, parkBeside, parkSitesFromLines, placeFeatures, placeLineup, buildParkOverlay, type PlacedFeature } from '../src/world/park'
import { snapLipSpeed } from '../src/app/parkPace'
import { createSkiState, createSteadySlope } from '../src/sim'
import { polylineLength } from '../src/world/resort'

/**
 * Stu (2026-11-27): drop in straight above every park with speed, one line
 * of features straight down that needs no turning, and a video-game feel to
 * landing: every jump on that line lands in the sweet spot.
 */
describe('jump windows from the jump shapes', () => {
  it('lands short below the window, in the sweet spot inside it and long above it', () => {
    for (const id of ['kickerS', 'kickerM', 'kickerL', 'kickerXL', 'kickerPro', 'stepOver']) {
      for (const base of [8, 14, 20]) {
        const spec = FEATURES[id]
        const [lo, hi] = jumpWindow(spec, base)
        const { knuckle, toe } = jumpShape(spec, base)
        expect(hi, id).toBeGreaterThan(lo + 1)
        // Window widths a player can hit: at least 7 km/h on a normal pitch.
        if (base >= 14) expect((hi - lo) * 3.6, `${id} ${base}°`).toBeGreaterThan(7)
        expect(landingAt(spec, base, (lo + hi) / 2)).toBeGreaterThan(knuckle - (spec.deck ?? 0) * 0.3)
        expect(landingAt(spec, base, (lo + hi) / 2)).toBeLessThan(toe)
        expect(landingAt(spec, base, lo * 0.8)).toBeLessThan(landingAt(spec, base, lo))
        expect(landingAt(spec, base, hi * 1.15)).toBeGreaterThan(toe)
      }
    }
  })

  it('bigger jumps want more speed', () => {
    const mid = (id: string) => jumpWindow(FEATURES[id], 14).reduce((a, b) => a + b) / 2
    expect(mid('kickerS')).toBeLessThan(mid('kickerM'))
    expect(mid('kickerM')).toBeLessThan(mid('kickerL'))
    expect(mid('kickerL')).toBeLessThan(mid('kickerXL'))
    expect(mid('kickerXL')).toBeLessThan(mid('kickerPro'))
  })

  it('reads the landing spot from where the rider touched down', () => {
    const slope = createSteadySlope(14, { width: 200, depth: 600 })
    const heightAt = (x: number, z: number) => slope.sampleTerrain(x, z)!.height
    const [f] = buildParkOverlay(placeLineup([[100, 0], [100, 400]], ['kickerM'], 20), slope.sampleTerrain, heightAt).features
    expect(jumpOutcome(f, 100, f.z + 1)).toBe('cased')
    expect(jumpOutcome(f, 100, f.z + (f.knuckle! + f.toe!) / 2)).toBe('sweet')
    expect(jumpOutcome(f, 100, f.z + f.toe! + 3)).toBe('overshot')
  })

  it('trims a lip speed into the window, keeping the launch angle', () => {
    const s = createSkiState({ x: 0, z: 0, heading: 0 })
    s.vz = 15
    s.vy = 4
    s.speed = Math.hypot(15, 4)
    snapLipSpeed(s, [8, 11])
    expect(s.speed).toBeLessThan(11)
    expect(s.speed).toBeGreaterThan(8)
    expect(s.vy / s.vz).toBeCloseTo(4 / 15, 6)
  })
})

const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

describe.skipIf(!hasData)('Apex park lines', () => {
  const world = hasData ? loadApexWorld() : null!
  const sites = hasData ? parkSitesFromLines(world.resort.parks, world.grid.heightAt) : []
  if (hasData) {
    const run = world.resort.runs.find((r) => r.name === 'Prospector' && r.kind === 'line')
    if (run) sites.push(parkBeside('Prospector', run.parts[0], sites.find((s) => s.name === 'Claim Jumper')!, world.grid.heightAt))
  }

  it('drops every park in at the top of a straight axis, facing straight down it and rolling', () => {
    expect(sites.map((s) => s.name).sort()).toEqual(['Aerial Site', 'Boarder Cross', 'Claim Jumper', 'Little Nuggets', 'Okanagan Park', 'Prospector'])
    for (const site of sites) {
      const axis = site.featureLine!
      expect(axis, site.name).toHaveLength(2)
      expect(polylineLength(axis), site.name).toBeGreaterThan(80)
      const spawn = dropInSpawn(site)
      expect(spawn.speed).toBe(DROP_IN_SPEED)
      const [dx, dz] = [axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]]
      expect(Math.cos(spawn.heading - Math.atan2(-dx, dz)), site.name).toBeCloseTo(1, 6)
      // Downhill all the way.
      expect(world.grid.heightAt(...axis[0]) - world.grid.heightAt(...axis[1]), site.name).toBeGreaterThan(10)
    }
  })

  it('rides the main line of every park hands-off: no turning, every jump in the sweet spot, no crash', () => {
    for (const site of sites) {
      const ride = rideMainLine(world, site)
      const jumps = ride.main.filter((f) => f.lip)
      expect(ride.main.length, site.name).toBeGreaterThanOrEqual(['Little Nuggets', 'Aerial Site'].includes(site.name) ? 2 : 3)
      expect(ride.crashes, site.name).toBe(0)
      expect(ride.maxDrift, site.name).toBeLessThan(3)
      // Rolling from the drop-in to the bottom, never stalled.
      expect(ride.minKmh, site.name).toBeGreaterThan(8)
      expect(ride.hits.length, site.name).toBe(jumps.length)
      for (const hit of ride.hits) expect(hit.outcome, `${site.name} ${hit.feature.spec.label} at ${hit.lip.toFixed(0)} km/h`).toBe('sweet')
      // The main line's first feature comes up soon after the drop-in.
      const first = ride.features.find((f) => f.lane === 0)!
      expect(Math.hypot(first.x - site.featureLine![0][0], first.z - site.featureLine![0][1]), site.name).toBeLessThan(45)
    }
  }, 120000)

  it('slides the main-line rails and boxes in the jib parks', () => {
    for (const name of ['Little Nuggets', 'Prospector', 'Okanagan Park']) {
      const ride = rideMainLine(world, sites.find((s) => s.name === name)!)
      expect(ride.rails, name).toBeGreaterThan(60)
    }
  }, 60000)

  it('keeps the features of every park clear of the other parks (Prospector beside Claim Jumper)', () => {
    const all = sites.flatMap((site) => placeFeatures(site, site.layout, world.grid.heightAt).map((f) => ({ f, site: site.name })))
    const corners = (f: PlacedFeature) =>
      [[0, -f.halfWidth], [0, f.halfWidth], [f.footprint, -f.halfWidth], [f.footprint, f.halfWidth], [f.footprint / 2, 0]].map(
        ([u, v]) => [f.x + f.dirX * u - f.dirZ * v, f.z + f.dirZ * u + f.dirX * v] as const,
      )
    const inside = (f: PlacedFeature, x: number, z: number) => {
      const u = (x - f.x) * f.dirX + (z - f.z) * f.dirZ
      const v = -(x - f.x) * f.dirZ + (z - f.z) * f.dirX
      return u >= 0 && u <= f.footprint && Math.abs(v) <= f.halfWidth
    }
    for (const a of all) for (const b of all) {
      if (a.site === b.site) continue
      expect(corners(a.f).some(([x, z]) => inside(b.f, x, z)), `${a.site} ${a.f.spec.label} in ${b.site} ${b.f.spec.label}`).toBe(false)
    }
  })

  it('lines every park up the same way: three lanes, main line in the middle', () => {
    for (const site of sites) {
      const ride = rideMainLine(world, site, site.layout, { seconds: 0.01 })
      const lanes = new Set(ride.features.map((f) => f.lane))
      if (site.name !== 'Boarder Cross') expect([...lanes].sort(), site.name).toEqual([0, 1, 2])
    }
  })
})
