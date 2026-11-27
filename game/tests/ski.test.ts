import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FIXED_HZ,
  PHYSICS,
  advance,
  carve,
  createClock,
  createFlatSlope,
  createRollingSlope,
  createSkiState,
  createSkier,
  createSteadySlope,
  normalFromGradient,
  resetSkier,
  steerYawRate,
  type SampleTerrain,
  type SkiInput,
  type SkiState,
  type Slope,
} from '../src/sim'

const IDLE: SkiInput = { steer: 0, brake: 0, tuck: false }
const simDir = join(dirname(fileURLToPath(import.meta.url)), '../src/sim')

function run(
  state: SkiState,
  sample: SampleTerrain,
  input: SkiInput,
  seconds: number,
  fps = 60,
): SkiState {
  const clock = createClock()
  const frames = Math.round(seconds * fps)
  const frameDt = 1 / fps
  for (let i = 0; i < frames; i++) advance(clock, state, input, sample, frameDt)
  return state
}

function pitchRun(pitchDeg: number, seconds: number, input: SkiInput, fps = 60): SkiState {
  const slope = testSlope(pitchDeg)
  return run(createSkier(slope), slope.sampleTerrain, input, seconds, fps)
}

function testSlope(pitchDeg: number): Slope {
  return createSteadySlope(pitchDeg, {
    width: 900,
    depth: 4000,
    crest: 2000,
    spawnX: 450,
    spawnZ: 40,
  })
}

describe('milestone 3 ski feel', () => {
  it('holds a traverse instead of winding uphill, on keys and sticks alike', () => {
    // 0.9.40: keys used to keep turning past the traverse and spin the skier uphill
    // and backwards; every input now aims at a heading off the fall line.
    const slope = testSlope(15)
    const limit = (PHYSICS.maxTraverseDeg * Math.PI) / 180
    for (const directionalSteering of [true, false]) for (const steer of [-1, 1]) {
      const state = createSkier(slope)
      const heading = steer * (115 * Math.PI) / 180
      state.heading = heading
      run(state, slope.sampleTerrain, { ...IDLE, steer, directionalSteering }, 0.5)
      expect((state.heading - heading) * steer).toBeLessThanOrEqual(1e-9)
      // Pressing the other way turns back down through the fall line.
      run(state, slope.sampleTerrain, { ...IDLE, steer: -steer, directionalSteering }, 0.5)
      expect(Math.abs(state.heading)).toBeLessThan(limit)
    }
  })

  it('stays still on flat ground from rest', () => {
    const slope = createFlatSlope({
      width: 400,
      depth: 400,
      height: 12,
      spawnX: 200,
      spawnZ: 200,
    })
    const spawned = slope.sampleTerrain(slope.spawn.x, slope.spawn.z)
    const state = run(createSkier(slope), slope.sampleTerrain, IDLE, 5, 60)
    expect(state.speed).toBe(0)
    expect(state.x).toBe(slope.spawn.x)
    expect(state.y).toBe(spawned?.height)
    expect(state.z).toBe(slope.spawn.z)
    expect(state.offMap).toBe(false)
    expect(state.mode).toBe('still')
  })

  it('gains speed faster on a steeper slope', () => {
    const gentle = pitchRun(10, 3, IDLE)
    const steep = pitchRun(25, 3, IDLE)
    expect(gentle.speed).toBeGreaterThan(2)
    expect(steep.speed).toBeGreaterThan(gentle.speed * 1.7)
    expect(gentle.vz).toBeGreaterThan(0)
    expect(steep.vz).toBeGreaterThan(gentle.vz)
    expect(Math.abs(steep.vx)).toBeLessThan(0.05)
    expect(steep.offMap).toBe(false)
  })

  it('turning across the slope reduces acceleration', () => {
    const straight = pitchRun(18, 4, IDLE)
    const across = pitchRun(18, 4, { steer: 0.55, brake: 0, tuck: false })
    const straightAccel = straight.speed / 4
    const acrossAccel = across.speed / 4
    expect(acrossAccel).toBeLessThan(straightAccel * 0.85)
    expect(Math.abs(across.heading)).toBeGreaterThan(0.45)
    expect(Math.abs(across.heading)).toBeLessThan(Math.PI / 2)
    expect(across.speed).toBeGreaterThan(3)
    expect(across.speed).toBeGreaterThan(straight.speed * 0.35)
    expect(Math.abs(across.x - 450)).toBeGreaterThan(3)
    expect(across.offMap).toBe(false)
    expect(straight.offMap).toBe(false)
  })

  it('matches g(sin θ − μ cos θ) after one second', () => {
    for (const pitchDeg of [10, 15, 25]) {
      const pitch = (pitchDeg * Math.PI) / 180
      const expected =
        PHYSICS.gravity * (Math.sin(pitch) - PHYSICS.snowFriction * Math.cos(pitch))
      const state = pitchRun(pitchDeg, 1, IDLE)
      expect(state.speed).toBeGreaterThan(expected * 0.985)
      expect(state.speed).toBeLessThan(expected * 1.005)
    }
  })

  it('braking can stop the skier on the test pitch', () => {
    const slope = testSlope(PHYSICS.testPitchDeg)
    const braking = createSkier(slope)
    const coasting = createSkier(slope)
    const clockA = createClock()
    const clockB = createClock()
    const frameDt = 1 / 60
    for (let i = 0; i < 4 * 60; i++) {
      advance(clockA, braking, IDLE, slope.sampleTerrain, frameDt)
      advance(clockB, coasting, IDLE, slope.sampleTerrain, frameDt)
    }
    expect(braking.speed).toBeGreaterThan(6)
    for (let i = 0; i < 8 * 60; i++) {
      advance(clockA, braking, { steer: 0, brake: 1, tuck: false }, slope.sampleTerrain, frameDt)
      advance(clockB, coasting, IDLE, slope.sampleTerrain, frameDt)
    }
    expect(braking.speed).toBeLessThan(0.25)
    expect(braking.offMap).toBe(false)
    expect(coasting.speed).toBeGreaterThan(8)
    expect(coasting.z).toBeGreaterThan(braking.z)
  })

  it('agrees across 30, 60 and 144 fps frame deltas', () => {
    const straight = frameRates(IDLE, 4)
    expect(straight[0].state.speed).toBeGreaterThan(6)
    expect(straight[0].state.z - 40).toBeGreaterThan(10)
    expectClose(straight)

    const turning = frameRates({ steer: 0.35, brake: 0, tuck: false }, 5)
    expect(turning[0].state.speed).toBeGreaterThan(4)
    expect(Math.hypot(turning[0].state.x - 450, turning[0].state.z - 40)).toBeGreaterThan(8)
    expectClose(turning)
  })

  it('clamps a 10 s frame spike to one max frame', () => {
    const slope = testSlope(15)
    const spiked = createSkier(slope)
    const clamped = createSkier(slope)
    advance(createClock(), spiked, IDLE, slope.sampleTerrain, 10)
    advance(createClock(), clamped, IDLE, slope.sampleTerrain, PHYSICS.maxFrameDt)
    expect(Number.isFinite(spiked.speed)).toBe(true)
    expect(spiked.speed).toBe(clamped.speed)
    expect(spiked.x).toBe(clamped.x)
    expect(spiked.y).toBe(clamped.y)
    expect(spiked.z).toBe(clamped.z)
    const full = pitchRun(15, 10, IDLE)
    expect(full.speed).toBeGreaterThan(spiked.speed + 5)
    expect(PHYSICS.maxSubsteps).toBeGreaterThanOrEqual(PHYSICS.maxFrameDt * FIXED_HZ)
  })

  it('reports edge and a carve or skid while steering, and braking while slowing', () => {
    // Get going first: from rest, full stick turns across the hill and stops.
    const turning = pitchRun(15, 2, IDLE)
    run(turning, testSlope(15).sampleTerrain, { steer: 1, brake: 0, tuck: false }, 0.6, 60)
    expect(turning.speed).toBeGreaterThan(1)
    expect(Math.abs(turning.edgeAngle)).toBeGreaterThan((40 * Math.PI) / 180)
    expect(['carving', 'skidding']).toContain(turning.mode)
    expect(Math.abs(turning.heading)).toBeGreaterThan(0.4)

    const slope = testSlope(PHYSICS.testPitchDeg)
    const state = createSkier(slope)
    run(state, slope.sampleTerrain, IDLE, 2, 60)
    expect(state.speed).toBeGreaterThan(3)
    run(state, slope.sampleTerrain, { steer: 0, brake: 1, tuck: true }, 0.4, 60)
    expect(state.mode).toBe('braking')
    expect(state.tuck).toBe(true)
    expect(state.speed).toBeGreaterThan(0.35)

    const released = pitchRun(15, 2, IDLE)
    run(released, testSlope(15).sampleTerrain, { steer: 1, brake: 0, tuck: false }, 0.6, 60)
    run(released, testSlope(15).sampleTerrain, IDLE, 0.25, 60)
    // Released across the hill, only the light uphill traverse edge stays on.
    expect(Math.abs(released.edgeAngle)).toBeLessThanOrEqual((PHYSICS.traverseEdgeDeg * Math.PI) / 180 + 1e-9)
    expect(released.mode).not.toBe('carving')
  })

  it('opens a neutral brake toward the side the skis already face', () => {
    const slope = testSlope(15)
    const state = createSkier(slope)
    state.vz = 8
    state.heading = -0.5
    run(state, slope.sampleTerrain, { steer: 0, brake: 1, tuck: false }, 0.3, 60)
    expect(state.heading).toBeLessThan(-0.5)
  })

  it('treats a near-zero normal as a bad sample', () => {
    const sample: SampleTerrain = (x, z) => {
      if (x < 0 || z < 0 || x > 100 || z > 100) return null
      if (z > 20) return { height: 5, normal: { x: 0, y: 0, z: 0 } }
      return { height: 5, normal: { x: 0, y: 1, z: 0 } }
    }
    const state = createSkiState({ x: 50, y: 5, z: 10, heading: 0 })
    state.vz = 12
    run(state, sample, IDLE, 2, 60)
    expect(state.offMap).toBe(true)
    expect(state.speed).toBe(0)
    expect(Number.isFinite(state.x)).toBe(true)
    expect(Number.isFinite(state.z)).toBe(true)
    expect(state.z).toBeLessThanOrEqual(20)
  })

  it('turns the skis faster at low speed than at high speed', () => {
    expect(steerYawRate(2, 1)).toBeGreaterThan(steerYawRate(20, 1) * 1.5)
    const slow = headedRun(3)
    const fast = headedRun(22)
    expect(Math.abs(slow.heading)).toBeGreaterThan(Math.abs(fast.heading) * 1.3)
  })

  it('tuck reaches a higher speed than an upright run', () => {
    const upright = pitchRun(22, 16, IDLE)
    const tucked = pitchRun(22, 16, { steer: 0, brake: 0, tuck: true })
    expect(tucked.speed).toBeGreaterThan(upright.speed + 2)
    expect(tucked.offMap).toBe(false)
  })

  it('stops at the edge of the sampler without leaving finite state', () => {
    const slope = createFlatSlope({ width: 30, depth: 30, height: 4, spawnX: 28, spawnZ: 15 })
    const state = createSkier(slope)
    state.vx = 40
    run(state, slope.sampleTerrain, IDLE, 1, 60)
    expect(state.offMap).toBe(true)
    expect(state.mode).toBe('off-map')
    expect(state.speed).toBe(0)
    expect(Number.isFinite(state.x)).toBe(true)
    expect(Number.isFinite(state.y)).toBe(true)
    expect(Number.isFinite(state.z)).toBe(true)
    expect(state.x).toBeLessThanOrEqual(30)
    const heldX = state.x
    run(state, slope.sampleTerrain, { steer: 1, brake: 1, tuck: true }, 1, 60)
    expect(state.x).toBe(heldX)
    resetSkier(state, slope)
    expect(state.offMap).toBe(false)
    expect(state.x).toBe(slope.spawn.x)
    expect(state.speed).toBe(0)
  })

  it('leaves the ground over a cliff and lands again', () => {
    const sample: SampleTerrain = (x, z) => {
      if (x < 0 || z < 0 || x > 80 || z > 160) return null
      return { height: z < 50 ? 12 : 0, normal: { x: 0, y: 1, z: 0 } }
    }
    const state = createSkiState({ x: 40, y: 12, z: 49.2, heading: 0 })
    state.vz = 18
    let sawAir = false
    const clock = createClock()
    for (let i = 0; i < 180; i++) {
      advance(clock, state, IDLE, sample, 1 / 60)
      if (!state.grounded && state.y < 12 && state.y > 0) sawAir = true
      expect(Number.isFinite(state.y)).toBe(true)
    }
    expect(sawAir).toBe(true)
    expect(state.grounded).toBe(true)
    expect(state.y).toBe(0)
    expect(state.offMap).toBe(false)
  })

  it('rolls downhill on the rolling slope', () => {
    const slope = createRollingSlope({
      width: 400,
      depth: 1200,
      crest: 400,
      spawnX: 200,
      spawnZ: 30,
      basePitchDeg: 16,
      amplitude: 3.5,
      wavelength: 110,
    })
    const state = run(createSkier(slope), slope.sampleTerrain, IDLE, 6, 60)
    expect(state.speed).toBeGreaterThan(4)
    expect(state.z).toBeGreaterThan(slope.spawn.z + 10)
    expect(state.offMap).toBe(false)
    expect(Number.isFinite(state.y)).toBe(true)
  })
})

describe('synthetic slopes', () => {
  it('matches the terrain sampler contract and the analytic gradient', () => {
    const steady = createSteadySlope(15, { width: 100, depth: 200, crest: 80 })
    const rolling = createRollingSlope({ width: 100, depth: 200, crest: 80, amplitude: 3.5, wavelength: 80 })
    const flat = createFlatSlope({ width: 100, depth: 100, height: 5 })
    expect(flat.sampleTerrain(-1, 10)).toBeNull()
    expect(steady.sampleTerrain(10, 250)).toBeNull()
    for (const slope of [flat, steady, rolling]) {
      for (const [x, z] of [
        [slope.originX + 10, slope.originZ + 10],
        [slope.originX + slope.width * 0.5, slope.originZ + slope.depth * 0.4],
      ] as const) {
        const sample = slope.sampleTerrain(x, z)
        expect(sample).not.toBeNull()
        const step = 0.05
        const east = (slope.sampleTerrain(x + step, z)!.height - slope.sampleTerrain(x - step, z)!.height) / (2 * step)
        const south = (slope.sampleTerrain(x, z + step)!.height - slope.sampleTerrain(x, z - step)!.height) / (2 * step)
        const expected = normalFromGradient(east, south)
        expect(sample!.normal.x).toBeCloseTo(expected.x, 4)
        expect(sample!.normal.y).toBeCloseTo(expected.y, 4)
        expect(sample!.normal.z).toBeCloseTo(expected.z, 4)
        const length = Math.hypot(sample!.normal.x, sample!.normal.y, sample!.normal.z)
        expect(length).toBeCloseTo(1, 6)
      }
    }
    const top = steady.sampleTerrain(10, 10)!.height
    const bottom = steady.sampleTerrain(10, 150)!.height
    expect(bottom).toBeLessThan(top)
  })
})

describe('carved turn maths', () => {
  it('keeps the ski-coach radius and critical speed', () => {
    const sidecut = 14
    const edge = 30
    const result = carve({ kmh: 40, edge, sidecut })
    expect(result.radius).toBeCloseTo(sidecut * Math.cos((edge * Math.PI) / 180), 8)
    expect(result.vCrit).toBeCloseTo(Math.sqrt(PHYSICS.gravity * sidecut) * 3.6, 8)
    expect(result.load).toBeGreaterThan(1)
    const over = carve({ kmh: result.vCrit + 5, edge: 40, sidecut })
    expect(over.ideal).toBeNull()
    expect(over.status).toBe('over')
  })
})

describe('sim boundary', () => {
  it('does not import three.js', () => {
    const sources = readdirSync(simDir).filter((name) => name.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(3)
    for (const name of sources) {
      const source = readFileSync(join(simDir, name), 'utf8')
      expect(source).not.toMatch(/from ['"]three['"]/)
      expect(source).not.toMatch(/require\(['"]three['"]\)/)
    }
  })
})

function frameRates(input: SkiInput, seconds: number) {
  return [30, 60, 144].map((fps) => {
    const slope = testSlope(15)
    const state = createSkier(slope)
    const clock = createClock()
    const frames = fps * seconds
    for (let i = 0; i < frames; i++) advance(clock, state, input, slope.sampleTerrain, 1 / fps)
    return { fps, state, time: clock.time }
  })
}

function expectClose(results: ReturnType<typeof frameRates>) {
  for (const result of results) {
    expect(result.state.offMap).toBe(false)
    expect(Number.isFinite(result.state.speed)).toBe(true)
  }
  const [at30, at60, at144] = results
  for (const other of [at60, at144]) {
    expect(other.state.x).toBeCloseTo(at30.state.x, 4)
    expect(other.state.y).toBeCloseTo(at30.state.y, 4)
    expect(other.state.z).toBeCloseTo(at30.state.z, 4)
    expect(other.state.vx).toBeCloseTo(at30.state.vx, 4)
    expect(other.state.vy).toBeCloseTo(at30.state.vy, 4)
    expect(other.state.vz).toBeCloseTo(at30.state.vz, 4)
    expect(other.state.heading).toBeCloseTo(at30.state.heading, 5)
    expect(other.state.speed).toBeCloseTo(at30.state.speed, 4)
  }
}

function headedRun(speed: number): SkiState {
  const slope = createFlatSlope({ width: 500, depth: 500, height: 0, spawnX: 250, spawnZ: 250 })
  const state = createSkier(slope)
  state.vz = speed
  state.speed = speed
  return run(state, slope.sampleTerrain, { steer: 1, brake: 0, tuck: false }, 1.2, 60)
}
