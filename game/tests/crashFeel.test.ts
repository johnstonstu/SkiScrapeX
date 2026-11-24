import { describe, expect, it } from 'vitest'
import { FIXED_DT, beginCrash, createSkiState, createSteadySlope, stepSkier } from '../src/sim'

const slope = createSteadySlope(15, { width: 800, depth: 1200 })

describe('crash feel', () => {
  it('keeps a fast crash down longer than a slow one', () => {
    const slow = createSkiState({ x: 400, z: 200 })
    const fast = createSkiState({ x: 400, z: 200 })
    beginCrash(slow, 3)
    beginCrash(fast, 22)
    expect(fast.crashed).toBeGreaterThan(slow.crashed)
    expect(fast.crashSpeed).toBe(22)
  })

  it('slides farther when entry speed is high', () => {
    const slow = createSkiState({ x: 400, z: 200, heading: 0 })
    const fast = createSkiState({ x: 400, z: 200, heading: 0 })
    for (const s of [slow, fast]) {
      s.y = slope.sampleTerrain(s.x, s.z)!.height
      s.vx = 0
      s.vz = 12
    }
    beginCrash(slow, 6)
    beginCrash(fast, 20)
    slow.vz = 6
    fast.vz = 20
    const z0Slow = slow.z
    const z0Fast = fast.z
    for (let t = 0; t < 1.2; t += FIXED_DT) {
      stepSkier(slow, { steer: 0, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
      stepSkier(fast, { steer: 0, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
    }
    expect(fast.z - z0Fast).toBeGreaterThan(slow.z - z0Slow)
  })
})
