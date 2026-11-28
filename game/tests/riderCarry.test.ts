import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'
import { FORE_ARM, UPPER_ARM } from '../src/render/rider/skierModel'
import { DEFAULT_OUTFIT, SKI_MODELS } from '../src/ui/riderPanel'

/**
 * How the skier carries the body and the poles through real linked turns
 * (0.9.51, from follow-cam reference): bent elbows with the hands in front,
 * poles hanging back from the hands, and the legs staying flexed through the
 * crossover instead of standing up at every edge change.
 */
type Sample = { edge: number; reach: number[]; handAhead: number[]; tipY: number[]; kneeBend: number[] }

function ride(): Sample[] {
  const slope = createSteadySlope(18, { width: 4000, depth: 8000 })
  const view = createSkierView()
  view.setColours({ ...DEFAULT_OUTFIT, model: 'allMountain', skiGraphic: 'solid' })
  const state = createSkiState({ x: 2000, z: 100, heading: 0 })
  state.y = slope.sampleTerrain(2000, 100)!.height
  const root = view.object
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  const local = (o: THREE.Object3D) => root.worldToLocal(wp(o))
  const samples: Sample[] = []
  for (let f = 0; f < 60 * 10; f++) {
    const time = (f + 1) / 60
    const steer = time < 3 ? 0 : Math.sin(((time - 3) * Math.PI * 2) / 2.4) > 0 ? 1 : -1
    const input: SkiInput = { steer, brake: state.speed * 3.6 > 45 ? 0.5 : 0, tuck: false }
    stepSkier(state, input, slope.sampleTerrain, FIXED_DT, { ski: SKI_MODELS.allMountain })
    view.update(state, input, slope.sampleTerrain(state.x, state.z)!, 'ski', 1 / 60)
    if (time < 4.5) continue
    root.updateMatrixWorld(true)
    const hip = local(view.bones.thigh_L).add(local(view.bones.thigh_R)).multiplyScalar(0.5)
    const sides = ['L', 'R'] as const
    samples.push({
      edge: state.edgeAngle,
      reach: sides.map((s) => wp(view.bones[`hand_${s}`]).distanceTo(wp(view.bones[`upperarm_${s}`])) / (UPPER_ARM + FORE_ARM)),
      handAhead: sides.map((s) => local(view.bones[`hand_${s}`]).z - hip.z),
      tipY: sides.map((s) => {
        const pole = view.bones[`hand_${s}`].children.find((c) => c.type === 'Group' && c.position.y === -0.04)!
        return root.worldToLocal(pole.localToWorld(new THREE.Vector3(0, -1.1, 0))).y
      }),
      kneeBend: sides.map((s) => THREE.MathUtils.radToDeg(view.bones[`shin_${s}`].rotation.x)),
    })
  }
  return samples
}

describe('skier carry through linked turns', () => {
  const samples = ride()

  it('keeps the elbows bent (arms were locked at 95% of their length)', () => {
    for (const s of samples) for (const r of s.reach) expect(r).toBeLessThan(0.9)
  })

  it('keeps the hands ahead of the hips, not trailing behind', () => {
    const ahead = samples.flatMap((s) => s.handAhead.map((z) => (z > -0.1 ? 1 : 0)))
    expect(ahead.reduce((a: number, b) => a + b, 0) / ahead.length).toBeGreaterThan(0.95)
  })

  it('never drives a pole tip down through the snow', () => {
    for (const s of samples) for (const y of s.tipY) expect(y).toBeGreaterThan(-0.08) // a planted basket sinks a few cm
  })

  it('stays flexed through the crossover instead of standing up', () => {
    const crossover = samples.filter((s) => Math.abs(s.edge) < 0.1)
    expect(crossover.length).toBeGreaterThan(10)
    const mean = crossover.flatMap((s) => s.kneeBend).reduce((a, b) => a + b, 0) / (crossover.length * 2)
    expect(mean).toBeGreaterThan(70) // 0.9.48 stood up to about 63°
  })
})
