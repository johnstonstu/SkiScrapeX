import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSkiState } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'
import { createClipCheck, type ClipHit } from '../src/render/rider/riderClipping'
import { LAB_POSES, idle, stepLabPose, type LabPose } from '../src/tools/riderPoses'
import { readRiderAsset } from './riderGlb'

/**
 * Poses the real skinned rider (public/models/rider.glb) in every rider lab
 * pose and measures how deep any body part's cloth cuts into another part
 * (see riderClipping.ts). Today's clipping is recorded in riderClipping.json;
 * a change that makes a pair clip deeper, or adds a new pair, fails.
 *
 * Print the table: RIDER_CLIP_REPORT=1 npx vitest run tests/riderClipping.test.ts
 * Record new budgets after a deliberate change: UPDATE_RIDER_CLIP=1 npx vitest run tests/riderClipping.test.ts
 */
const BUDGETS = new URL('./riderClipping.json', import.meta.url)
/** How much deeper than its budget a pair may clip before the test fails, metres. */
const SLACK = 0.005
/** A pair with no budget fails past this depth, metres. */
const NEW_PAIR = 0.01
const SETTLE_FRAMES = 90
/** Animated poses: sample every 5 frames over 2 s and keep the worst. */
const CYCLE_FRAMES = 120
const SAMPLE_EVERY = 5

const asset = readRiderAsset()

/** Worst clipping per pair over a pose's held frame or cycle. */
function measurePose(pose: LabPose): ClipHit[] {
  const view = createSkierView({ asset })
  const check = createClipCheck(view)
  const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
  let time = 0
  for (let i = 0; i < SETTLE_FRAMES; i++) stepLabPose(pose, state, view, (time += 1 / 60), 1 / 60)
  const worst = new Map<string, ClipHit>()
  const keep = (hits: ClipHit[]) => {
    for (const hit of hits) {
      const key = `${hit.from}>${hit.into}`
      const had = worst.get(key)
      if (!had || hit.depth > had.depth) worst.set(key, { ...hit })
    }
  }
  // Rail poses stand on the rail top, air poses are off the snow: no ground check.
  const groundY = state.grounded && !state.rail ? 0 : null
  keep(check.measure({ groundY }).hits)
  if (pose.animated) {
    for (let i = 1; i <= CYCLE_FRAMES; i++) {
      stepLabPose(pose, state, view, (time += 1 / 60), 1 / 60)
      if (i % SAMPLE_EVERY === 0) keep(check.measure({ groundY }).hits)
    }
  }
  return [...worst.values()].sort((a, b) => b.depth - a.depth)
}

type Budgets = Record<string, Record<string, number>>
const cm = (m: number) => Math.round(m * 1000) / 10

describe('rider clipping', () => {
  const results = new Map(LAB_POSES.map((pose) => [pose.label, measurePose(pose)]))

  it('clips no deeper than its recorded budget in every lab pose', () => {
    if (process.env.RIDER_CLIP_REPORT) {
      const rows: string[] = []
      for (const [label, hits] of results) {
        if (!hits.length) rows.push(`${label.padEnd(14)} clean`)
        for (const h of hits.slice(0, 6)) rows.push(`${label.padEnd(14)} ${`${h.from} -> ${h.into}`.padEnd(26)} ${String(cm(h.depth)).padStart(5)} cm  ${String(h.count).padStart(5)} verts  ${h.garment}`)
      }
      console.log(`Rider clipping (worst 6 pairs per pose)\n${rows.join('\n')}`)
    }
    const measured: Budgets = {}
    for (const [label, hits] of results) measured[label] = Object.fromEntries(hits.map((h) => [`${h.from}>${h.into}`, cm(h.depth)]))
    if (process.env.UPDATE_RIDER_CLIP) writeFileSync(BUDGETS, JSON.stringify(measured, null, 2) + '\n')
    const budgets = JSON.parse(readFileSync(BUDGETS, 'utf8')) as Budgets
    const over: string[] = []
    for (const [label, pairs] of Object.entries(measured)) {
      for (const [pair, depth] of Object.entries(pairs)) {
        const budget = budgets[label]?.[pair]
        const limit = budget === undefined ? cm(NEW_PAIR) : budget + cm(SLACK)
        if (depth > limit) over.push(`${label}: ${pair} ${depth} cm (budget ${budget ?? 'none'})`)
      }
    }
    expect(over).toEqual([])
  })

  it('catches a knee forced through the other thigh', () => {
    const view = createSkierView({ asset })
    const check = createClipCheck(view)
    const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
    const standing = LAB_POSES.find((p) => p.label === 'Standing')!
    for (let i = 0; i < SETTLE_FRAMES; i++) stepLabPose(standing, state, view, i / 60, 1 / 60)
    const before = check.measure({ groundY: null }).hits.find((h) => h.from === 'shin_L' && h.into === 'thigh_R')
    expect(before).toBeUndefined()
    // Aim the left thigh at the right knee, so the left knee lands inside the right leg.
    const thigh = view.bones.thigh_L
    view.object.updateMatrixWorld(true)
    const target = view.bones.shin_R.getWorldPosition(new THREE.Vector3())
    const from = thigh.getWorldPosition(new THREE.Vector3())
    const parentRotation = thigh.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
    const direction = target.sub(from).applyQuaternion(parentRotation).normalize()
    thigh.quaternion.setFromUnitVectors(view.bones.shin_L.position.clone().normalize(), direction)
    const hits = check.measure({ groundY: null }).hits
    const crossed = hits.filter((h) => h.into === 'thigh_R' || h.into === 'shin_R')
    expect(crossed.length).toBeGreaterThan(0)
    expect(crossed[0].depth).toBeGreaterThan(0.03)
  })

  it('poses with the skinned body attached and finite capsule sizes', () => {
    const view = createSkierView({ asset })
    expect(view.skinned).toBe(true)
    const check = createClipCheck(view)
    for (const s of check.segments) {
      expect(s.radius, s.name).toBeGreaterThan(0.02)
      expect(s.radius, s.name).toBeLessThan(0.25)
    }
    expect(idle.steer).toBe(0)
  })
})
