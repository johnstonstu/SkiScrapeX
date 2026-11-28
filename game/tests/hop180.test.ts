import { describe, expect, it } from 'vitest'
import { FIXED_DT, FREESTYLE, SURFACES, createSkiState, createSteadySlope, stepSkier, type SampleTerrain, type SkiEnv, type SkiInput } from '../src/sim'
import { newAir, stepRotation } from '../src/sim/freestyle'

/**
 * Hop 180: jump plus a direction on plain snow turns the rider half way round, so getting out
 * of switch (or into it) does not take a jump. `npm run tune` prints the wider table
 * (tuning/switch180.test.ts).
 */
const PITCH = 12
const slope = createSteadySlope(PITCH, { width: 6000, depth: 6000 })
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function rider(startSwitch: boolean, kmh = 35) {
  const s = createSkiState({ x: 3000, z: 200, heading: startSwitch ? Math.PI : 0 })
  s.y = slope.sampleTerrain(s.x, s.z)!.height
  s.vy = -Math.sin((PITCH * Math.PI) / 180) * (kmh / 3.6)
  s.vz = Math.cos((PITCH * Math.PI) / 180) * (kmh / 3.6)
  s.speed = kmh / 3.6
  s.ridingSwitch = startSwitch
  return s
}

interface Play {
  /** Seconds jump is held. */
  hold: number
  /** Direction held from `from` to `to` seconds, with jump going down at 0.5. */
  dir?: number
  from?: number
  to?: number
}

function play(s: ReturnType<typeof rider>, { hold, dir = 1, from = 0.5, to = 0.5 + hold }: Play, terrain: SampleTerrain = slope.sampleTerrain, env: SkiEnv = {}) {
  let air = 0, crashed = false, maxSpinRate = 0
  for (let t = 0; t < 2.5; t += FIXED_DT) {
    const input: SkiInput = { steer: t >= from && t < to ? dir : 0, brake: 0, tuck: false, jump: t >= 0.5 && t < 0.5 + hold }
    stepSkier(s, input, terrain, FIXED_DT, env)
    if (!s.grounded) air += FIXED_DT
    if (s.air) maxSpinRate = Math.max(maxSpinRate, Math.abs(s.air.spinRate))
    if (s.crashed > 0) crashed = true
  }
  return { air, crashed, maxSpinRate }
}

describe('hop 180', () => {
  it('a tap of jump with a direction brings a switch rider round to forward', () => {
    for (const dir of [1, -1]) {
      const s = rider(true)
      const r = play(s, { hold: 0.08, dir })
      expect(r.crashed).toBe(false)
      expect(s.ridingSwitch).toBe(false)
      // Facing the way they are going, still rolling down the hill.
      expect(Math.abs(wrap(s.heading - Math.atan2(-s.vx, s.vz)))).toBeLessThan(0.2)
      expect(s.vz).toBeGreaterThan(7)
      expect(r.air).toBeGreaterThan(0.33)
      expect(r.air).toBeLessThan(0.6)
      expect(r.maxSpinRate).toBeLessThanOrEqual(FREESTYLE.hop180RateMax + 1e-6)
      expect(s.trick).toMatchObject({ name: 'Switch 180', hop: true, points: FREESTYLE.hop180Points, switchLanding: false })
      expect(s.trick!.grade).not.toBe('crash')
    }
  })

  it('works at a crawl and at speed, on gentle and steep snow', () => {
    for (const [pitch, kmh] of [[5, 10], [20, 60], [30, 90]]) {
      const steep = createSteadySlope(pitch, { width: 6000, depth: 6000 })
      const s = createSkiState({ x: 3000, z: 200, heading: Math.PI })
      s.y = steep.sampleTerrain(s.x, s.z)!.height
      s.vy = -Math.sin((pitch * Math.PI) / 180) * (kmh / 3.6)
      s.vz = Math.cos((pitch * Math.PI) / 180) * (kmh / 3.6)
      s.speed = kmh / 3.6
      s.ridingSwitch = true
      const r = play(s, { hold: 0.08 }, steep.sampleTerrain)
      expect(r.crashed, `${pitch} deg`).toBe(false)
      expect(s.ridingSwitch, `${pitch} deg`).toBe(false)
    }
  })

  it('forgives a direction let go just before the pop, or pressed just after it', () => {
    const early = rider(true)
    play(early, { hold: 0.1, from: 0.35, to: 0.52 })
    expect(early.ridingSwitch).toBe(false)
    const late = rider(true)
    play(late, { hold: 0.08, from: 0.5 + 0.08 + 0.06, to: 0.9 })
    expect(late.ridingSwitch).toBe(false)
    // Much later than that is ordinary air steering, which a hop is too short for.
    const tooLate = rider(true)
    play(tooLate, { hold: 0.08, from: 0.5 + 0.08 + 0.2, to: 0.75 })
    expect(tooLate.ridingSwitch).toBe(true)
  })

  it('holding the direction on through the hop still lands exactly half a turn', () => {
    const s = rider(true)
    const r = play(s, { hold: 0.3, from: 0.3, to: 2.5 })
    expect(r.crashed).toBe(false)
    expect(s.ridingSwitch).toBe(false)
  })

  it('from forward a tapped ollie in a turn stays an ollie, and a held crouch hops to switch', () => {
    const tap = rider(false)
    const tapped = play(tap, { hold: 0.08 })
    expect(tap.ridingSwitch).toBe(false)
    expect(tapped.air).toBeLessThan(0.33)
    const held = rider(false)
    const r = play(held, { hold: 0.25 })
    expect(r.crashed).toBe(false)
    expect(held.ridingSwitch).toBe(true)
    expect(held.trick).toMatchObject({ name: '180', hop: true, switchLanding: true })
    // And straight back again.
    play(held, { hold: 0.08 })
    expect(held.ridingSwitch).toBe(false)
  })

  it('jump without a direction is the same pop as before', () => {
    const s = rider(true)
    const r = play(s, { hold: 0.08, dir: 0 })
    expect(s.ridingSwitch).toBe(true)
    // popMin on a 12 degree pitch.
    expect(r.air).toBeLessThan(0.33)
    expect(r.maxSpinRate).toBeLessThan(0.5)
  })

  it('leaves a mogul field alone: crouching through bumps while steering does not spin to switch', () => {
    const bumps: SampleTerrain = (x, z) => {
      const ground = slope.sampleTerrain(x, z)
      return ground ? { ...ground, mogulHeight: 0.3 } : null
    }
    const forward = rider(false)
    play(forward, { hold: 0.4 }, bumps)
    expect(forward.ridingSwitch).toBe(false)
    // A switch rider can still hop out.
    const back = rider(true)
    play(back, { hold: 0.08 }, bumps)
    expect(back.ridingSwitch).toBe(false)
  })

  it('in deep snow a forward tap still bounces, and a switch rider hops round', () => {
    const powder: SkiEnv = { sampleSurface: () => SURFACES.powder }
    const forward = rider(false, 25)
    forward.sink = 0.2
    const bounce = play(forward, { hold: 0.08 }, slope.sampleTerrain, powder)
    expect(bounce.air).toBe(0)
    expect(forward.ridingSwitch).toBe(false)
    const back = rider(true, 25)
    back.sink = 0.2
    back.surface = SURFACES.powder
    const r = play(back, { hold: 0.08 }, slope.sampleTerrain, powder)
    expect(r.crashed).toBe(false)
    expect(back.ridingSwitch).toBe(false)
  })

  it('a takeoff that turns out to be a real jump spins by hand as before', () => {
    const air = { ...newAir(1), quick: Math.PI, timeToLand: 1.6 }
    stepRotation(air, { steer: 0, pitch: 0, grab: false }, FIXED_DT, true)
    expect(air.quick).toBe(0)
    // The pre-wind is untouched.
    expect(air.spinRate).toBeGreaterThan(FREESTYLE.spinRateMax - FREESTYLE.spinAccel * FIXED_DT - 1e-6)
  })

  it('with the landing assist off the hop still turns, paced to the landing', () => {
    const s = rider(true)
    const r = play(s, { hold: 0.08 }, slope.sampleTerrain, { assist: false })
    expect(r.crashed).toBe(false)
    expect(s.ridingSwitch).toBe(false)
  })
})
