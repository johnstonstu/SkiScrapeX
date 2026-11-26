/**
 * Physics tuning from the 2026-11-25 playtest (batch B1): a recreational tuck
 * that reaches the Chute benchmark, slower edging with a speed cap for
 * keyboard steering, hockey stops in the real 0.5 to 0.9 g range that take
 * longer on steeps, frame-rate independent key steering, and short airs that
 * a judged comp scores and that land without a speed penalty.
 */
import { describe, expect, it } from 'vitest'
import { FIXED_DT, PHYSICS, createSkiState, createSteadySlope, stepSkier, type SkiEnv, type SkiInput } from '../src/sim'
import { keyboardEdgeCap } from '../src/sim/skier'
import { rampKeySteer } from '../src/player/keySteer'

/** A skier on a steady slope, facing down it at `speed` m/s. */
function start(pitch: number, speed: number) {
  const slope = createSteadySlope(pitch, { width: 4000, depth: 8000, spawnX: 2000, spawnZ: 200 })
  const g = slope.sampleTerrain(2000, 200)!
  const s = createSkiState({ x: 2000, y: g.height, z: 200, heading: 0 })
  const fy = -g.normal.z / g.normal.y
  const l = Math.hypot(fy, 1)
  s.vy = (fy / l) * speed
  s.vz = (1 / l) * speed
  return { s, sample: slope.sampleTerrain }
}

const kmh = (s: { vx: number; vy: number; vz: number }) => Math.hypot(s.vx, s.vy, s.vz) * 3.6

describe('tuck', () => {
  it('a straight tuck on 25° tops out near 160 km/h, above the 151 km/h Chute benchmark', () => {
    const { s, sample } = start(25, 0)
    for (let t = 0; t < 90; t += FIXED_DT) stepSkier(s, { steer: 0, brake: 0, tuck: true }, sample, FIXED_DT)
    expect(kmh(s)).toBeGreaterThan(151)
    expect(kmh(s)).toBeLessThan(175)
  })
})

describe('edging', () => {
  it('caps the keyboard edge by speed: full at 60 km/h, 32° at 110 km/h and up', () => {
    expect(keyboardEdgeCap(50 / 3.6)).toBe(PHYSICS.maxEdgeDeg)
    expect(keyboardEdgeCap(85 / 3.6)).toBeCloseTo((PHYSICS.maxEdgeDeg + PHYSICS.keyEdgeHighDeg) / 2, 5)
    expect(keyboardEdgeCap(130 / 3.6)).toBe(PHYSICS.keyEdgeHighDeg)
  })

  it('a held key at 100 km/h holds a moderate edge; a stick can still ask for the full edge', () => {
    const peak = (directionalSteering: boolean) => {
      const { s, sample } = start(20, 100 / 3.6)
      let most = 0
      for (let t = 0; t < 0.6; t += FIXED_DT) {
        stepSkier(s, { steer: 1, brake: 0, tuck: false, directionalSteering }, sample, FIXED_DT)
        most = Math.max(most, (Math.abs(s.edgeAngle) * 180) / Math.PI)
      }
      return most
    }
    expect(peak(true)).toBeLessThan(40)
    expect(peak(false)).toBeGreaterThan(PHYSICS.maxEdgeDeg - 1)
  })

  it('rolls the edge on over about a quarter second, not in one frame', () => {
    const { s, sample } = start(20, 40 / 3.6)
    const input: SkiInput = { steer: 1, brake: 0, tuck: false }
    for (let t = 0; t < 0.1; t += FIXED_DT) stepSkier(s, input, sample, FIXED_DT)
    const after100 = (Math.abs(s.edgeAngle) * 180) / Math.PI
    expect(after100).toBeLessThan(25)
    expect(after100).toBeGreaterThan(10)
  })
})

describe('hockey stop', () => {
  const stop = (pitch: number, fromKmh: number) => {
    const { s, sample } = start(pitch, fromKmh / 3.6)
    let t = 0
    while (kmh(s) > 1 && t < 15) {
      stepSkier(s, { steer: 0, brake: 1, tuck: false }, sample, FIXED_DT)
      t += FIXED_DT
    }
    return { t, g: fromKmh / 3.6 / t / 9.81 }
  }

  it('stops from 50 km/h at a real 0.5 to 0.9 g, not the old 1.5 to 1.8 g', () => {
    for (const pitch of [10, 20, 30]) {
      const { g } = stop(pitch, 50)
      expect(g, `${pitch}°`).toBeGreaterThan(0.5)
      expect(g, `${pitch}°`).toBeLessThan(0.9)
    }
  })

  it('takes longer on a steep pitch', () => {
    expect(stop(30, 50).t).toBeGreaterThan(stop(10, 50).t * 1.15)
    expect(stop(30, 80).t).toBeGreaterThan(stop(10, 80).t * 1.15)
  })
})

describe('keyboard steering is the same at any frame rate', () => {
  const RISE = 11, RELEASE = 10
  /** Steer integral (edge-seconds) for a key held from 0 to `holdMs`, read every `frameMs` for 400 ms. */
  const steerIntegral = (holdMs: number, frameMs: number) => {
    const changes = [{ t: 0, want: 1 }, { t: holdMs, want: 0 }]
    let value = 0, want = 0, area = 0
    for (let from = -frameMs / 2; from < 400; from += frameMs) {
      const to = from + frameMs
      const inside = changes.filter((c) => c.t > from && c.t <= to)
      const ramp = rampKeySteer(value, want, inside, from, to, RISE, RELEASE)
      value = ramp.value
      if (inside.length) want = inside[inside.length - 1].want
      // The sim holds the frame's mean steer for the whole frame.
      area += ramp.mean * (frameMs / 1000)
    }
    return area
  }

  it('a 17 ms tap steers the same at 5 fps as at 60 fps', () => {
    const at60 = steerIntegral(17, 1000 / 60)
    const at5 = steerIntegral(17, 200)
    expect(at60).toBeGreaterThan(0)
    expect(Math.abs(at5 - at60) / at60).toBeLessThan(0.05)
  })

  it('a held key ramps to full steer and releases back to zero', () => {
    const held = rampKeySteer(0, 1, [], 0, 300, RISE, RELEASE)
    expect(held.value).toBe(1)
    expect(held.mean).toBeGreaterThan(0.7)
    const released = rampKeySteer(1, 0, [], 0, 150, RISE, RELEASE)
    expect(released.value).toBe(0)
    // A reversal starts on the new side at once.
    expect(rampKeySteer(0.8, -1, [], 0, 10, RISE, RELEASE).value).toBeLessThan(0)
  })
})

describe('short airs', () => {
  /** Pop the skier off a 15° slope at 10 m/s with `vy` up; return the landed state. */
  const hop = (vy: number, env: SkiEnv) => {
    const { s, sample } = start(15, 10)
    s.y += 0.05
    s.vy += vy
    s.grounded = false
    const before = kmh(s)
    for (let t = 0; t < 2 && (!s.grounded || t < 0.05); t += FIXED_DT) stepSkier(s, { steer: 0, brake: 0, tuck: false }, sample, FIXED_DT, env)
    return { s, before }
  }

  it('a judged comp scores a 0.3 to 0.5 s straight air; free skiing does not pop it', () => {
    const judged = hop(2, { judgedAirs: true })
    expect(judged.s.trick?.kind).toBe('air')
    expect(judged.s.trick!.airTime).toBeGreaterThan(0.25)
    expect(judged.s.trick!.airTime).toBeLessThan(0.55)
    expect(hop(2, {}).s.trick).toBeNull()
  })

  it('a clean short hop lands with its speed', () => {
    const { s, before } = hop(2, {})
    expect(s.grounded).toBe(true)
    expect(kmh(s)).toBeGreaterThan(before * 0.9)
  })
})
