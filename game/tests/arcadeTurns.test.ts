import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, fallLineHeading, stepSkier, type SkiEnv } from '../src/sim'
import { SKI_MODELS } from '../src/ui/riderPanel'

/**
 * 0.9.40 arcade turning: holding left then right links turns on any pitch,
 * the same on keys (directional) and sticks, for skis and the board.
 * `tuning/inputs.test.ts` prints the full table.
 */
const deg = (r: number) => (r * 180) / Math.PI

function linked(pitch: number, directionalSteering: boolean, env: SkiEnv, hold = 1.2) {
  const slope = createSteadySlope(pitch, { width: 6000, depth: 6000 })
  const s = createSkiState({ x: 3000, z: 200, heading: 0 })
  s.y = slope.sampleTerrain(s.x, s.z)!.height
  s.vy = -Math.sin((pitch * Math.PI) / 180) * 20 / 3.6
  s.vz = Math.cos((pitch * Math.PI) / 180) * 20 / 3.6
  let maxOff = 0, skid = 0, speed = 0, t = 0
  for (; t < 12; t += FIXED_DT) {
    const steer = t < 1 ? 0 : Math.floor((t - 1) / hold) % 2 === 0 ? 1 : -1
    stepSkier(s, { steer, brake: 0, tuck: false, directionalSteering }, slope.sampleTerrain, FIXED_DT, env)
    const fall = fallLineHeading(slope.sampleTerrain(s.x, s.z)!.normal) ?? 0
    maxOff = Math.max(maxOff, Math.abs(deg(Math.atan2(Math.sin(s.heading - fall), Math.cos(s.heading - fall)))))
    if (s.skid >= 0.3) skid += FIXED_DT
    speed += s.speed * FIXED_DT
  }
  return { maxOff, skid: skid / t, kmh: (speed / t) * 3.6, switched: s.ridingSwitch }
}

describe('arcade linked turns', () => {
  for (const model of ['allMountain', 'snowboard'] as const) {
    const env = { ski: SKI_MODELS[model] }
    it(`${model}: held turns never wind uphill or backwards, on keys or sticks`, () => {
      for (const pitch of [6, 12, 20, 30]) for (const keys of [true, false]) {
        const r = linked(pitch, keys, env)
        expect(r.maxOff).toBeLessThan(90)
        expect(r.switched).toBe(false)
      }
    })
    it(`${model}: keys and sticks ride the same linked turns`, () => {
      for (const pitch of [12, 20, 30]) {
        const keys = linked(pitch, true, env), stick = linked(pitch, false, env)
        expect(Math.abs(keys.kmh - stick.kmh)).toBeLessThan(stick.kmh * 0.08)
      }
    })
    it(`${model}: linked turns carve instead of sliding out (skidding under 10% of the time)`, () => {
      for (const pitch of [12, 20, 30]) for (const keys of [true, false]) expect(linked(pitch, keys, env).skid).toBeLessThan(0.1)
    })
  }
  it('faster facing down the hill than across it', () => {
    const env = { ski: SKI_MODELS.allMountain }
    expect(linked(20, false, env, 0.8).kmh).toBeGreaterThan(linked(20, false, env, 3).kmh + 4)
  })
})
