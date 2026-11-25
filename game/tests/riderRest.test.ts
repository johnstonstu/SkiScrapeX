import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildRider } from '../src/render/rider/skierModel'

/**
 * tools/blender/rig_rest.json is what the Blender build script reads to place
 * its armature. It must match the bind pose in skierModel.ts, or the skinned
 * body would be bound to joints in the wrong places.
 * Regenerate with: UPDATE_RIG_REST=1 npx vitest run tests/riderRest.test.ts
 */
const FILE = new URL('../../tools/blender/rig_rest.json', import.meta.url)

export interface RestJoint {
  name: string
  parent: string | null
  /** Root space (+X rider's left, +Y up, +Z forward), metres. */
  head: [number, number, number]
}

function restJoints(): RestJoint[] {
  const rig = buildRider()
  const out: RestJoint[] = []
  rig.withRestPose(() => {
    const p = new THREE.Vector3()
    for (const [name, bone] of Object.entries(rig.bones)) {
      bone.getWorldPosition(p)
      const parent = bone.parent instanceof THREE.Bone ? bone.parent.name : null
      out.push({ name, parent, head: [p.x, p.y, p.z].map((v) => Math.round(v * 1e4) / 1e4) as [number, number, number] })
    }
  })
  return out
}

describe('rider bind pose', () => {
  it('matches the joints the Blender build script reads', () => {
    const joints = restJoints()
    if (process.env.UPDATE_RIG_REST) writeFileSync(FILE, JSON.stringify(joints, null, 2) + '\n')
    const stored = JSON.parse(readFileSync(FILE, 'utf8')) as RestJoint[]
    expect(stored.map((j) => j.name).sort()).toEqual(joints.map((j) => j.name).sort())
    for (const joint of joints) {
      const match = stored.find((j) => j.name === joint.name)!
      expect(match.parent).toBe(joint.parent)
      for (let k = 0; k < 3; k++) expect(Math.abs(match.head[k] - joint.head[k])).toBeLessThan(1e-3)
    }
  })

  it('has every joint the animation drives, with arms clear of the torso', () => {
    const joints = restJoints()
    const at = (name: string) => joints.find((j) => j.name === name)!.head
    for (const side of ['L', 'R']) for (const part of ['thigh', 'shin', 'upperarm', 'forearm', 'hand']) expect(at(`${part}_${side}`)).toBeDefined()
    // A-pose: the wrists sit well outside the shoulders.
    expect(at('hand_L')[0]).toBeGreaterThan(at('upperarm_L')[0] + 0.2)
    expect(at('hand_R')[0]).toBeLessThan(at('upperarm_R')[0] - 0.2)
  })
})
