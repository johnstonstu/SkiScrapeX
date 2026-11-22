import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSkiState, type SkiInput } from '../src/sim'
import { Spring, createSkierView } from '../src/render/rider/skierView'

const idle: SkiInput = { steer: 0, brake: 0, tuck: false }
const ground = { height: 0, normal: { x: 0, y: 1, z: 0 } } as never

/** Every joint's world position, to check for NaN and to compare poses. */
function joints(object: THREE.Object3D): number[] {
  object.updateMatrixWorld(true)
  const out: number[] = []
  const p = new THREE.Vector3()
  object.traverse((o) => out.push(...o.getWorldPosition(p).toArray()))
  return out
}

describe('rider animation', () => {
  it('a spring settles on its target even with long frames', () => {
    const s = new Spring()
    for (let i = 0; i < 40; i++) s.step(1, 0.1, 4, 0.6)
    expect(s.x).toBeCloseTo(1, 3)
  })

  it('an under-damped spring overshoots, which reads as weight on a landing', () => {
    const s = new Spring()
    let peak = 0
    for (let i = 0; i < 120; i++) peak = Math.max(peak, s.step(1, 1 / 60, 3, 0.6))
    expect(peak).toBeGreaterThan(1.02)
  })

  it('poses every mode without NaN, and a crash fades in rather than snapping', () => {
    const view = createSkierView()
    const state = createSkiState({ x: 0, z: 0, heading: 0 })
    const run = (frames: number, setup: () => SkiInput, pose: 'ski' | 'sit' | 'stand' = 'ski') => {
      for (let i = 0; i < frames; i++) {
        state.time += 1 / 60
        view.update(state, setup(), state.grounded ? ground : null, pose, 1 / 60)
      }
    }
    state.speed = 12
    run(60, () => {
      state.edgeAngle = Math.sin(state.time * 3) * 0.7
      state.carveLoad = 1.8
      state.carveRadius = 12
      return { ...idle, steer: Math.sign(state.edgeAngle) }
    })
    run(60, () => ({ ...idle, tuck: true }))
    state.speed = 3
    run(60, () => ({ ...idle, brake: 1 }))
    run(60, () => ({ ...idle, tuck: true }))
    const before = joints(view.object)
    state.crashed = 1.5
    run(1, () => idle)
    const firstCrashFrame = joints(view.object)
    run(30, () => idle)
    const crashed = joints(view.object)
    // One frame in, the body has moved only part of the way to the crash pose.
    const moved = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0)
    expect(moved(before, firstCrashFrame)).toBeLessThan(moved(before, crashed) * 0.5)
    state.crashed = 0
    run(60, () => idle)
    state.grounded = false
    state.air = { time: 0.3, spin: 1, spinRate: 3, flip: 0.5, flipRate: 1, grab: 'mute', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0.2, corkTime: 0 }
    run(30, () => idle)
    state.air = null
    state.grounded = true
    run(30, () => idle)
    run(30, () => idle, 'sit')
    run(30, () => idle, 'stand')
    expect(joints(view.object).every(Number.isFinite)).toBe(true)
  })
})
