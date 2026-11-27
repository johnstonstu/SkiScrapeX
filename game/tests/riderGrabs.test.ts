import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSkiState } from '../src/sim'
import { createSkierView, grabSpecsFor } from '../src/render/rider/skierView'
import { LAB_POSES, stepLabPose } from '../src/tools/riderPoses'
import { DEFAULT_OUTFIT } from '../src/ui/riderPanel'

const GRABS = ['mute', 'japan', 'truck', 'nose', 'tail', 'safety', 'critical'] as const

/** Distance (metres) from each grabbing wrist to its grab point, held in the air. */
export function grabGaps(model: 'allMountain' | 'snowboard', grab: string): number[] {
  const view = createSkierView()
  view.setColours({ ...DEFAULT_OUTFIT, model, skiGraphic: 'solid' })
  const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
  const base = LAB_POSES.find((p) => p.label === 'Mute grab')!
  const pose = {
    ...base,
    setup: (s: typeof state, t: number) => {
      const input = base.setup(s, t)
      s.air!.grab = grab as never
      return input
    },
  }
  for (let i = 0; i < 120; i++) stepLabPose(pose, state, view, i / 60, 1 / 60)
  view.object.updateMatrixWorld(true)
  const board = view.object.getObjectByName('snowboard')!
  return grabSpecsFor(grab, model === 'snowboard').map((spec) => {
    const at = model === 'snowboard'
      ? new THREE.Vector3(spec.across, 0.035, spec.along).applyMatrix4(board.matrixWorld)
      : new THREE.Vector3(spec.across, 0.06, spec.along).applyMatrix4(view.skis[spec.ski].matrixWorld)
    const hand = view.object.getObjectByName(spec.hand === 0 ? 'hand_L' : 'hand_R')!
    return hand.getWorldPosition(new THREE.Vector3()).distanceTo(at)
  })
}

describe('grabs', () => {
  for (const model of ['allMountain', 'snowboard'] as const) {
    for (const grab of GRABS) {
      it(`${model} ${grab}: the hand takes hold of the gear`, () => {
        const gaps = grabGaps(model, grab)
        // The wrist sits about a mitt from what it holds (a board edge is a little further round the knees).
        for (const gap of gaps) expect(gap).toBeLessThan(model === 'snowboard' ? 0.13 : 0.08)
      })
    }
  }
})
