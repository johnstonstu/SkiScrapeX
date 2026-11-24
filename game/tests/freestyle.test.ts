import { describe, expect, it } from 'vitest'
import { FIXED_DT, SURFACES, createSkiState, createSteadySlope, gradeLanding, stepSkier, trickName, type SkiInput, landingSpot, GRAB_STYLE } from '../src/sim'
import { buildParkOverlay, FEATURES, footprintOf, placeFeatures, type PlacedFeature } from '../src/world/park'

const IDLE: SkiInput = { steer: 0, brake: 0, tuck: false }

function run(slope: ReturnType<typeof createSteadySlope>, seconds: number, input: (t: number) => SkiInput, env = {}, x = 250, z = 40) {
  const s = createSkiState({ x, z, heading: 0 })
  s.y = slope.sampleTerrain(x, z)!.height
  for (let t = 0; t < seconds; t += FIXED_DT) stepSkier(s, input(t), slope.sampleTerrain, FIXED_DT, env)
  return s
}

describe('powder', () => {
  const flat = createSteadySlope(0.001, { width: 400, depth: 600, crest: 0 })
  const powder = { sampleSurface: () => SURFACES.powder }

  it('sinks about 0.30 m standing still', () => {
    const s = run(flat, 3, () => IDLE, powder)
    expect(s.sink).toBeGreaterThan(0.27)
    expect(s.sink).toBeLessThan(0.33)
  })

  it('planes up to about 0.10 m at 10 m/s and is slower than a groomer', () => {
    const slope = createSteadySlope(20, { width: 400, depth: 3000 })
    const fresh = run(slope, 6, () => IDLE, powder)
    const packed = run(slope, 6, () => IDLE)
    expect(packed.speed).toBeGreaterThan(fresh.speed)
    const atTen = run(flat, 0.01, () => IDLE, powder)
    atTen.vz = 10
    for (let t = 0; t < 1.5; t += FIXED_DT) {
      atTen.vz = 10
      stepSkier(atTen, IDLE, flat.sampleTerrain, FIXED_DT, powder)
    }
    expect(atTen.sink).toBeGreaterThan(0.06)
    expect(atTen.sink).toBeLessThan(0.14)
  })
})

describe('pop and landing', () => {
  const slope = createSteadySlope(12, { width: 400, depth: 3000 })

  it('a charged pop leaves the snow and lands cleanly', () => {
    let landedClean = false
    const s = createSkiState({ x: 200, z: 100, heading: 0 })
    s.y = slope.sampleTerrain(200, 100)!.height
    s.vz = 8
    let wasAir = false
    for (let t = 0; t < 3; t += FIXED_DT) {
      stepSkier(s, { ...IDLE, jump: t < 0.45 }, slope.sampleTerrain, FIXED_DT)
      if (!s.grounded) wasAir = true
      if (wasAir && s.grounded) {
        landedClean = s.crashed === 0
        break
      }
    }
    expect(wasAir).toBe(true)
    expect(landedClean).toBe(true)
  })

  it('keeps the boots facing backwards through a switch landing and rollout', () => {
    const s = createSkiState({ x: 200, z: 100, heading: Math.PI })
    s.y = slope.sampleTerrain(s.x, s.z)!.height + 0.02
    s.vz = 9
    s.vy = -3
    s.grounded = false
    s.air = { time: 0.6, spin: Math.PI, spinRate: 0, flip: 0, flipRate: 0, grab: null, grabTime: 0, timeToLand: 0.02, predictedFrom: 0.6, cork: 0, corkTime: 0 }
    for (let i = 0; i < 120; i++) stepSkier(s, IDLE, slope.sampleTerrain, FIXED_DT)
    expect(s.grounded).toBe(true)
    expect(s.ridingSwitch).toBe(true)
    expect(Math.cos(s.heading)).toBeLessThan(-0.99)
    expect(s.vz).toBeGreaterThan(5)
  })

  it('grades by equivalent fall height and rotation', () => {
    const air = { time: 1, spin: Math.PI * 2, spinRate: 0, flip: 0, flipRate: 0, grab: null, grabTime: 0, timeToLand: 0, predictedFrom: 0, cork: 0, corkTime: 0 }
    const n = { x: 0, y: 1, z: 0 }
    expect(gradeLanding({ x: 0, y: -2, z: 10 }, n, 0, air, false).grade).toBe('perfect')
    expect(gradeLanding({ x: 0, y: -5, z: 10 }, n, 0, air, false).grade).toBe('clean')
    // Upright on a big drop stomps sketchy instead of bailing.
    expect(gradeLanding({ x: 0, y: -9, z: 10 }, n, 0, air, false).grade).toBe('sketchy')
    expect(gradeLanding({ x: 0, y: -12, z: 10 }, n, 0, air, false).grade).toBe('sketchy')
    // Only a truly huge upright drop still wipes out.
    expect(gradeLanding({ x: 0, y: -18, z: 10 }, n, 0, air, false).grade).toBe('crash')
    // Skis 90 degrees across the direction of travel.
    expect(gradeLanding({ x: 0, y: -2, z: 10 }, n, Math.PI / 2, air, false).grade).toBe('crash')
    // Backwards is a switch landing, not a crash.
    const back = gradeLanding({ x: 0, y: -2, z: 10 }, n, Math.PI, air, false)
    expect(back.switchLanding).toBe(true)
    expect(back.grade).toBe('perfect')
    // Half a flip short.
    expect(gradeLanding({ x: 0, y: -2, z: 10 }, n, 0, { ...air, flip: Math.PI }, false).grade).toBe('crash')
  })

  it('names tricks', () => {
    expect(trickName(Math.PI * 3, 0, 'mute', false)).toBe('540 Mute')
    expect(trickName(0, -Math.PI * 2, 'japan', true)).toBe('Switch Backflip Japan')
    expect(trickName(0, 0, null, false)).toBe('Air')
  })
})

describe('park features', () => {
  const slope = createSteadySlope(10, { width: 400, depth: 3000 })
  const heightAt = (x: number, z: number) => slope.sampleTerrain(x, z)?.height ?? Number.NaN
  const place = (id: string): PlacedFeature => {
    const spec = FEATURES[id]
    return { spec, x: 200, z: 200, dirX: 0, dirZ: 1, footprint: footprintOf(spec), halfWidth: 5 }
  }

  it('a medium tabletop launches a skier at speed and lands within the safe EFH', () => {
    const park = buildParkOverlay([place('kickerM')], slope.sampleTerrain, heightAt)
    const s = createSkiState({ x: 200, z: 192, heading: 0 })
    s.y = park.sampleTerrain(200, 192)!.height
    s.vz = 7
    let flew = false
    for (let t = 0; t < 6; t += FIXED_DT) {
      stepSkier(s, IDLE, park.sampleTerrain, FIXED_DT)
      if (!s.grounded) flew = true
      if (flew && s.grounded) break
    }
    expect(flew).toBe(true)
    expect(s.crashed).toBe(0)
    expect(s.trick?.efh ?? 0).toBeLessThan(1.5)
  })

  it('the ramp in front of a box puts the skier on the box', () => {
    const park = buildParkOverlay([place('box')], slope.sampleTerrain, heightAt)
    expect(park.rails.length).toBe(1)
    const s = createSkiState({ x: 200, z: 185, heading: 0 })
    s.y = park.sampleTerrain(200, 185)!.height
    s.vz = 6
    let railed = false
    for (let t = 0; t < 5; t += FIXED_DT) {
      stepSkier(s, IDLE, park.sampleTerrain, FIXED_DT, { rails: park.rails })
      if (s.rail) railed = true
    }
    expect(railed).toBe(true)
    expect(s.trick?.kind).toBe('rail')
  })

  it('lays out a lineup along a park line', () => {
    const site = { id: 'p', name: 'Test', layout: 'mixed', line: [[0, 0], [0, 600]] as [number, number][] }
    const placed = placeFeatures(site, 'mixed')
    expect(placed.length).toBeGreaterThanOrEqual(5)
    for (let i = 1; i < placed.length; i++) expect(placed[i].z).toBeGreaterThan(placed[i - 1].z + placed[i - 1].footprint)
  })
})

describe('landing marker and grabs', () => {
  const flat = () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } })
  it('finds the touchdown point of a ballistic arc', () => {
    const spot = landingSpot({ x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 10 }, { spin: 0, spinRate: 0, flip: 0, flipRate: 0 }, flat)!
    expect(spot.time).toBeCloseTo(Math.sqrt(10 / 9.81), 1)
    expect(spot.z).toBeCloseTo(10 * spot.time, 5)
    expect(spot.lined).toBe(true)
  })
  it('flags a rotation that will not line up', () => {
    // A quarter turn short of a 180 at touchdown.
    const t = Math.sqrt(10 / 9.81)
    const spot = landingSpot({ x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 10 }, { spin: 0, spinRate: (Math.PI / 2) / t, flip: 0, flipRate: 0 }, flat)!
    expect(spot.lined).toBe(false)
    const full = landingSpot({ x: 0, y: 5, z: 0, vx: 0, vy: 0, vz: 10 }, { spin: 0, spinRate: Math.PI / t, flip: 0, flipRate: 0 }, flat)!
    expect(full.lined).toBe(true)
  })
  it('names and rewards the truck driver', () => {
    expect(trickName(Math.PI * 2, 0, 'truck', false)).toContain('Truck Driver')
    expect(GRAB_STYLE.truck).toBeGreaterThan(GRAB_STYLE.mute)
  })
})

describe('corks', () => {
  const base = () => ({ time: 0, spin: 0, spinRate: 6, flip: 0, flipRate: 0, grab: null, grabTime: 0, timeToLand: Infinity, predictedFrom: 0, cork: 0, corkTime: 0 })
  it('turns pitch during a spin into a cork, not a flip, and names it', async () => {
    const { stepRotation, corkLevel } = await import('../src/sim/freestyle')
    const air = base()
    for (let t = 0; t < 0.9; t += 1 / 120) stepRotation(air, { steer: 1, pitch: 1, grab: false }, 1 / 120, false)
    expect(Math.abs(air.flip)).toBeLessThan(0.2)
    expect(air.cork).toBeGreaterThan(0.9)
    expect(corkLevel(720, air.corkTime)).toBe(1)
    expect(trickName(Math.PI * 4, 0, null, false, air.corkTime)).toBe('Cork 720')
    expect(trickName(Math.PI * 6, 0, 'mute', false, 0.8)).toBe('Double Cork 1080 Mute')
  })
  it('still flips when not spinning', async () => {
    const { stepRotation } = await import('../src/sim/freestyle')
    const air = { ...base(), spinRate: 0 }
    for (let t = 0; t < 0.5; t += 1 / 120) stepRotation(air, { steer: 0, pitch: 1, grab: false }, 1 / 120, false)
    expect(air.flip).toBeGreaterThan(1)
    expect(air.cork).toBe(0)
  })
  it('levels the cork for landing, and punishes landing corked', async () => {
    const { stepRotation } = await import('../src/sim/freestyle')
    const air = { ...base(), cork: 1, corkTime: 0.5, timeToLand: 0.3 }
    for (let t = 0; t < 0.28; t += 1 / 120) stepRotation(air, { steer: 0, pitch: 0, grab: false }, 1 / 120, true)
    expect(Math.abs(air.cork)).toBeLessThan(0.2)
    const corked = gradeLanding({ x: 0, y: -2, z: 8 }, { x: 0, y: 1, z: 0 }, 0, { ...base(), spin: 0, cork: 1 }, false)
    expect(['sketchy', 'crash']).toContain(corked.grade)
  })
})
