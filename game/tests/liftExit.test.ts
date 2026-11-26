import { describe, expect, it } from 'vitest'
import { EXIT_REACH, FACE_DOWN_MAX_PITCH, LINE_CLEARANCE, chooseExit, type ExitOptions } from '../src/app/liftExit'
import type { SampleTerrain } from '../src/sim'

/** A plane falling toward +Z (south) at `pitchDeg`. */
function plane(pitchDeg: number): SampleTerrain {
  const t = Math.tan((pitchDeg * Math.PI) / 180)
  const len = Math.hypot(t, 1)
  return (_x, z) => ({ height: -z * t, normal: { x: 0, y: 1 / len, z: t / len } })
}

/** A lift that came straight up the fall line (heading north, yaw π) to the top at the origin. */
const lineDistanceSq = (x: number, z: number) => (z >= 0 ? x * x : x * x + z * z)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const options = (pitch: number, extra: Partial<ExitOptions> = {}): ExitOptions => ({
  aerial: false,
  sample: plane(pitch),
  blocked: () => false,
  lineDistanceSq,
  ...extra,
})

describe('lift exit', () => {
  it('a surface lift steps well clear of its line and stands across a steep hill', () => {
    const spot = chooseExit(0, 0, Math.PI, options(18))
    expect(lineDistanceSq(spot.x, spot.z)).toBeGreaterThanOrEqual(LINE_CLEARANCE ** 2)
    expect(Math.hypot(spot.x, spot.z)).toBeLessThanOrEqual(EXIT_REACH.surface[1] + 0.01)
    // Across the fall line (+Z), not down it: standing still, ready to turn down either way.
    expect(Math.abs(Math.abs(wrap(spot.face)) - Math.PI / 2)).toBeLessThan(0.05)
  })

  it('faces down a gentle hill', () => {
    const spot = chooseExit(0, 0, Math.PI, options(FACE_DOWN_MAX_PITCH - 2))
    expect(Math.abs(wrap(spot.face))).toBeLessThan(0.05)
  })

  it('a chair comes off ahead and keeps away from a building in the way', () => {
    // A hut 6 to 16 m straight ahead of the chair, 3 m wide.
    const hut = (x: number, z: number) => Math.abs(x) < 3 && z < -6 && z > -16
    const spot = chooseExit(0, 0, Math.PI, options(4, { aerial: true, blocked: hut, lineDistanceSq: () => 100 }))
    expect(hut(spot.x, spot.z)).toBe(false)
    const reach = Math.hypot(spot.x, spot.z)
    expect(reach).toBeGreaterThanOrEqual(EXIT_REACH.aerial[0] - 0.01)
    // Still broadly ahead (north), not doubled back toward the station.
    expect(spot.z).toBeLessThan(0)
  })

  it('picks the side with room to go both ways', () => {
    // Trees fill everything west of x = -3: the open side is east.
    const trees = (x: number) => x < -3
    const spot = chooseExit(0, 0, Math.PI, options(10, { blocked: trees }))
    expect(spot.x).toBeGreaterThan(0)
  })
})
