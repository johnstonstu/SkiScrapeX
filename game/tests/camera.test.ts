import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier } from '../src/sim'
import { followHeading, type CameraStyle } from '../src/player/camera'

const slope = createSteadySlope(15, { width: 2000, depth: 4000 })

/** Linked turns down a 15° slope; returns the peak-to-peak swing of the camera and of the travel direction. */
function linkedTurns(style: CameraStyle) {
  const s = createSkiState({ x: 1000, z: 200, heading: 0 })
  s.y = slope.sampleTerrain(1000, 200)!.height
  let camera = 0
  let lo = Infinity, hi = -Infinity, tlo = Infinity, thi = -Infinity
  for (let t = 0; t < 16; t += FIXED_DT) {
    // Straight to build speed, then turns to 45° each side of the fall line.
    const want = t < 3 ? 0 : Math.sin((t - 3) * 2) > 0 ? 0.8 : -0.8
    const steer = Math.max(-1, Math.min(1, (want - s.heading) * 3))
    stepSkier(s, { steer, brake: s.speed > 14 ? 0.6 : 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
    camera = followHeading(style, s, slope.sampleTerrain, camera, FIXED_DT)
    if (t > 6) {
      const travel = Math.atan2(-s.vx, s.vz)
      lo = Math.min(lo, camera); hi = Math.max(hi, camera)
      tlo = Math.min(tlo, travel); thi = Math.max(thi, travel)
    }
  }
  return { camera: hi - lo, travel: thi - tlo }
}

describe('follow camera', () => {
  it('the steady style holds the view down the hill through linked turns', () => {
    const steady = linkedTurns('steady')
    const tight = linkedTurns('tight')
    console.log(`swing (deg): travel ${(steady.travel * 57.3).toFixed(0)}, steady camera ${(steady.camera * 57.3).toFixed(0)}, tight camera ${(tight.camera * 57.3).toFixed(0)}`)
    expect(steady.travel).toBeGreaterThan(0.5)
    expect(steady.camera).toBeLessThan(tight.camera * 0.5)
  })
})
