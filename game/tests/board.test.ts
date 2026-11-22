import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier } from '../src/sim'
import { SKI_MODELS } from '../src/ui/riderPanel'

/** Ride straight, then hold a turn; return the heading change over the turn. */
function turn(model: keyof typeof SKI_MODELS) {
  const slope = createSteadySlope(15, { width: 400, depth: 800 })
  const s = createSkiState({ x: 200, z: 30, heading: 0 })
  s.y = slope.sampleTerrain(200, 30)!.height
  const env = { ski: SKI_MODELS[model] }
  for (let t = 0; t < 3; t += FIXED_DT) stepSkier(s, { steer: 0, brake: 0, tuck: true }, slope.sampleTerrain, FIXED_DT, env)
  const start = s.heading
  for (let t = 0; t < 0.8; t += FIXED_DT) stepSkier(s, { steer: 0.6, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT, env)
  expect(s.offMap).toBe(false)
  return Math.abs(Math.atan2(Math.sin(s.heading - start), Math.cos(s.heading - start)))
}

describe('snowboard', () => {
  it('is a ski model with a tight sidecut and extra float', () => {
    expect(SKI_MODELS.snowboard.sidecutRadius).toBeLessThan(SKI_MODELS.allMountain.sidecutRadius)
    expect(SKI_MODELS.snowboard.floatScale).toBeGreaterThan(SKI_MODELS.allMountain.floatScale)
  })

  it('turns at least as quickly as all-mountain skis for the same input', () => {
    expect(turn('snowboard')).toBeGreaterThanOrEqual(turn('allMountain') * 0.98)
  })
})
