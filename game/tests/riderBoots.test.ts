import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSkiState } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'
import { ANKLE_IN_SKI, SHIN_LENGTH } from '../src/render/rider/skierModel'
import { DEFAULT_OUTFIT } from '../src/ui/riderPanel'
import { LAB_POSES, stepLabPose } from '../src/tools/riderPoses'

/**
 * The boots ride on the skis (or board), and the legs reach down to them by
 * IK. If a pose puts a ski further from the hip than the leg is long, the IK
 * stops short and the shin hangs in the air off its boot. In every lab pose,
 * on skis and on a snowboard, each shin must end at its boot's ankle.
 */
const MAX_GAP = 0.02
const SETTLE_FRAMES = 90
const CYCLE_FRAMES = 120

function worstGaps(model: 'allMountain' | 'snowboard') {
  const out: { label: string; gap: number }[] = []
  const end = new THREE.Vector3()
  const ankle = new THREE.Vector3()
  for (const pose of LAB_POSES) {
    if (model === 'snowboard' && ['Snowplough', 'Pushing', 'Skating'].includes(pose.label)) continue
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model, skiGraphic: 'solid' })
    const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
    let time = 0
    let worst = 0
    const frames = SETTLE_FRAMES + (pose.animated ? CYCLE_FRAMES : 0)
    for (let i = 0; i < frames; i++) {
      stepLabPose(pose, state, view, (time += 1 / 60), 1 / 60)
      if (i < SETTLE_FRAMES - 1) continue
      view.object.updateMatrixWorld(true)
      view.skis.forEach((ski, side) => {
        view.bones[side === 0 ? 'shin_L' : 'shin_R'].localToWorld(end.set(0, -SHIN_LENGTH, 0))
        ski.localToWorld(ankle.copy(ANKLE_IN_SKI))
        worst = Math.max(worst, end.distanceTo(ankle))
      })
    }
    out.push({ label: pose.label, gap: worst })
  }
  return out
}

describe('rider legs reach the boots', () => {
  for (const model of ['allMountain', 'snowboard'] as const) {
    it(`in every lab pose on ${model === 'snowboard' ? 'a snowboard' : 'skis'}`, () => {
      const gaps = worstGaps(model)
      if (process.env.RIDER_CLIP_REPORT) console.log(gaps.map((g) => `${g.label.padEnd(14)} ${(g.gap * 100).toFixed(1)} cm`).join('\n'))
      const detached = gaps.filter((g) => g.gap > MAX_GAP).map((g) => `${g.label}: ${(g.gap * 100).toFixed(1)} cm`)
      expect(detached).toEqual([])
    })
  }
})
