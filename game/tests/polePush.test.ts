import { describe, expect, it } from 'vitest'
import { createSkiState, FIXED_DT, stepSkier, type SampleTerrain } from '../src/sim'

const flat: SampleTerrain = () => ({ height: 0, normal: { x: 0, y: 1, z: 0 } })

function cruising(speed: number) {
  const s = createSkiState({ x: 0, z: 0, heading: 0 })
  s.vz = speed
  s.speed = speed
  return s
}

function run(s: ReturnType<typeof createSkiState>, seconds: number, tuck: boolean) {
  for (let t = 0; t < seconds; t += FIXED_DT) stepSkier(s, { steer: 0, brake: 0, tuck }, flat, FIXED_DT)
}

describe('forward at different speeds', () => {
  it('pushes with the poles on a tap at cruising speed, instead of tucking', () => {
    const tapped = cruising(7)
    const coasting = cruising(7)
    run(tapped, 0.3, true)
    run(coasting, 0.3, false)
    expect(tapped.tuck).toBe(false)
    expect(tapped.poling).toBe(true)
    expect(tapped.speed).toBeGreaterThan(coasting.speed + 0.15)
  })

  it('settles into a tuck when forward is held', () => {
    const s = cruising(7)
    run(s, 0.6, true)
    expect(s.poling).toBe(false)
    expect(s.tuck).toBe(true)
  })

  it('tucks at once when already fast', () => {
    const s = cruising(13)
    run(s, 0.05, true)
    expect(s.tuck).toBe(true)
    expect(s.poling).toBe(false)
  })
})
