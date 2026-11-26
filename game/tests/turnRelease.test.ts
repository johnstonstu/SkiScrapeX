/**
 * Letting go of a turn should ease the rider out of it, not jolt them back.
 * The sim rolls the edge off at its full rate; the hips used to follow that
 * straight, sliding back under the body faster than it came upright (Stu,
 * 2026-11-26: "bumps you back when you release the turn button").
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'

/** Hips sideways position (rider frame, metres) per frame through a held turn released at 2.5 s. */
function turnAndRelease() {
  const slope = createSteadySlope(18)
  const view = createSkierView()
  const state = createSkiState({ x: slope.spawn.x, z: slope.spawn.z, heading: 0.3 })
  state.y = slope.sampleTerrain(state.x, state.z)!.height
  state.vx = -Math.sin(0.3) * 10
  state.vz = Math.cos(0.3) * 10
  state.speed = 10
  const inverse = new THREE.Matrix4()
  const p = new THREE.Vector3()
  const hips: number[] = []
  for (let t = 0; t < 3.5; t += FIXED_DT) {
    const input: SkiInput = { steer: t >= 2 && t < 2.5 ? 1 : 0, brake: 0, tuck: false }
    stepSkier(state, input, slope.sampleTerrain, FIXED_DT)
    view.update(state, input, slope.sampleTerrain(state.x, state.z), 'ski', FIXED_DT)
    view.object.updateMatrixWorld(true)
    inverse.copy(view.object.matrixWorld).invert()
    hips.push(view.bones.hips.getWorldPosition(p).applyMatrix4(inverse).x)
  }
  return hips
}

describe('turn release', () => {
  it('the hips ease back under the body when a turn is let go, with no jolt', () => {
    const hips = turnAndRelease()
    const release = Math.round(2.5 / FIXED_DT)
    const speeds = hips.slice(release - 1, release + 40).map((x, i, a) => (i ? (x - a[i - 1]) / FIXED_DT : 0)).slice(1)
    // No jolt: the hips never start or stop moving all at once. Without the ease they
    // went from rest to 2.5 m/s in one frame and stopped from 3.7 m/s just as fast.
    const jerk = speeds.map((v, i) => (i ? Math.abs(v - speeds[i - 1]) : Math.abs(v)))
    expect(Math.max(...jerk)).toBeLessThan(0.6)
    // But it does come back: most of the way within 0.6 s.
    const held = hips[release - 1]
    const settled = hips[hips.length - 1]
    expect(Math.abs(hips[release + Math.round(0.6 / FIXED_DT)] - settled)).toBeLessThan(Math.abs(held - settled) * 0.45)
  })
})
