import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, createSkiState, createSteadySlope, fallLineHeading, stepSkier, type SkiInput, type SkiState } from '../src/sim'
import { angulationShare, boardKneeBend, createSkierView } from '../src/render/rider/skierView'
import { SHIN_LENGTH } from '../src/render/rider/skierModel'
import { DEFAULT_OUTFIT, SKI_MODELS } from '../src/ui/riderPanel'

/**
 * The rider in real linked turns: the real sim drives the real view and each
 * frame is measured in the world. Lean is measured across the direction of
 * travel against gravity, positive to the skier's right.
 */
type Frame = {
  time: number
  edge: number
  physLean: number
  skiRoll: number
  legLean: number
  chestLean: number
  /** Roll of the line between the shoulders off level (positive: right shoulder lower). */
  shoulderRoll: number
  headRoll: number
  skiOffFall: number
  chestOffFall: number
  /** Hip socket to ankle, inside and outside leg of the lean. */
  legIn: number
  legOut: number
  /** Board space: heights above the board, knee bend off the boot toe, knee bend. */
  hipUp: number
  kneeUp: number[]
  kneeOffToe: number[]
  kneeBend: number[]
  handAboveSnow: number
}

const deg = THREE.MathUtils.radToDeg
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function ride(model: 'allMountain' | 'snowboard'): Frame[] {
  const slope = createSteadySlope(18, { width: 4000, depth: 8000 })
  const view = createSkierView()
  view.setColours({ ...DEFAULT_OUTFIT, model, skiGraphic: 'solid' })
  const env = { ski: SKI_MODELS[model] }
  const state: SkiState = createSkiState({ x: 2000, z: 100, heading: 0 })
  state.y = slope.sampleTerrain(2000, 100)!.height
  const board = view.object.getObjectByName('snowboard')!
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3())
  const axis = (o: THREE.Object3D, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(o.getWorldQuaternion(q))
  const foot = (s: string) => new THREE.Vector3(0, -SHIN_LENGTH, 0).applyMatrix4(view.bones[`shin_${s}`].matrixWorld)
  const frames: Frame[] = []
  let lastTravel: number | null = null
  let lat = 0
  for (let f = 0; f < 60 * 12; f++) {
    const time = (f + 1) / 60
    // Straight for 3 s, then linked turns of 2 s each way.
    const steer = time < 3 ? 0 : Math.sin(((time - 3) * Math.PI * 2) / 4) > 0 ? 1 : -1
    const input: SkiInput = { steer, brake: state.speed * 3.6 > 45 ? 0.5 : 0, tuck: false }
    stepSkier(state, input, slope.sampleTerrain, FIXED_DT, env)
    const ground = slope.sampleTerrain(state.x, state.z)!
    view.update(state, input, ground, 'ski', 1 / 60)
    const travel = Math.atan2(-state.vx, state.vz)
    if (lastTravel !== null) lat += (wrap(travel - lastTravel) * 60 * Math.hypot(state.vx, state.vz) - lat) * 0.5
    lastTravel = travel
    if (time < 2) continue
    view.object.updateMatrixWorld(true)
    const right = new THREE.Vector3(state.vx, 0, state.vz).normalize().cross(up).normalize()
    const lean = (v: THREE.Vector3) => deg(Math.atan2(v.dot(right), v.dot(up)))
    const hipMid = wp(view.bones.thigh_L).add(wp(view.bones.thigh_R)).multiplyScalar(0.5)
    const legLean = lean(hipMid.clone().sub(foot('L').add(foot('R')).multiplyScalar(0.5)))
    const len = (s: string) => wp(view.bones[`thigh_${s}`]).distanceTo(foot(s))
    const ear = axis(view.bones.head, 1, 0, 0)
    const fall = fallLineHeading(ground.normal) ?? 0
    const chestFwd = axis(view.bones.chest, 0, 0, 1)
    const base = model === 'snowboard' ? board : view.skis[0]
    const baseUp = axis(base, 0, 1, 0)
    const above = (p: THREE.Vector3) => p.clone().sub(wp(base)).dot(baseUp)
    const legs = (['L', 'R'] as const).map((s, i) => {
      const hip = wp(view.bones[`thigh_${s}`])
      const knee = wp(view.bones[`shin_${s}`])
      const ankle = foot(s)
      const line = ankle.clone().sub(hip).normalize()
      const out = knee.clone().sub(hip)
      out.addScaledVector(line, -out.dot(line))
      const toe = axis(view.skis[i], 0, 0, 1)
      return {
        up: above(knee),
        offToe: deg(out.angleTo(toe)),
        bend: 180 - deg(hip.sub(knee).angleTo(ankle.sub(knee))),
      }
    })
    const hands = [view.object.getObjectByName('hand_L'), view.object.getObjectByName('hand_R')].filter(Boolean) as THREE.Object3D[]
    frames.push({
      time,
      edge: state.edgeAngle,
      physLean: deg(Math.atan(lat / 9.81)),
      skiRoll: deg(base.rotation.z),
      legLean,
      chestLean: lean(axis(view.bones.chest, 0, 1, 0)),
      shoulderRoll: deg(Math.asin(wp(view.bones.upperarm_L).sub(wp(view.bones.upperarm_R)).normalize().y)),
      headRoll: deg(Math.asin(ear.y)),
      skiOffFall: deg(wrap(state.heading - fall)),
      chestOffFall: deg(wrap(Math.atan2(-chestFwd.x, chestFwd.z) - fall)),
      legIn: legLean > 0 ? len('R') : len('L'),
      legOut: legLean > 0 ? len('L') : len('R'),
      hipUp: above(hipMid),
      kneeUp: legs.map((l) => l.up),
      kneeOffToe: legs.map((l) => l.offToe),
      kneeBend: legs.map((l) => l.bend),
      handAboveSnow: Math.min(...hands.map((h) => {
        const p = wp(h)
        return p.y - slope.sampleTerrain(p.x, p.z)!.height
      })),
    })
  }
  return frames
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

describe('skier in real turns', () => {
  const frames = ride('allMountain')
  // Settled in a carve: edged, and the path already curving that way (at an edge
  // change the edge flips a few frames before the lean the turn needs).
  const carving = frames.filter((f) => f.time > 5 && Math.abs(f.edge) > 0.6 && Math.sign(f.physLean) === Math.sign(f.edge) && Math.abs(f.physLean) > 20)

  it('angulates: the upper body tilts back toward the outside ski above about 25° of edge', () => {
    expect(angulationShare(0.1)).toBeLessThan(0.2)
    expect(angulationShare(0.45)).toBeGreaterThanOrEqual(0.35)
    expect(angulationShare(0.8)).toBeLessThanOrEqual(0.5)
    expect(carving.length).toBeGreaterThan(60)
    for (const f of carving) {
      // The shoulders tip the same way as the legs but clearly less.
      expect(Math.sign(f.legLean - f.shoulderRoll), `t ${f.time.toFixed(2)}`).toBe(Math.sign(f.legLean))
    }
    const back = mean(carving.map((f) => (f.legLean - f.shoulderRoll) / f.legLean))
    expect(back).toBeGreaterThan(0.3)
    // And the head stays near level.
    for (const f of carving) expect(Math.abs(f.headRoll)).toBeLessThan(8)
  })

  it('extends the outside leg and folds the inside one, more with more edge', () => {
    const deep = carving.filter((f) => Math.abs(f.edge) > 0.75)
    const flat = frames.filter((f) => f.time < 3)
    expect(mean(deep.map((f) => f.legOut - f.legIn))).toBeGreaterThan(0.08)
    expect(Math.abs(mean(flat.map((f) => f.legOut - f.legIn)))).toBeLessThan(0.02)
  })

  it('draws the full lean and the physics edge (it was 20% short and the skis 10% flat)', () => {
    // The skis are the physics edge; only at an edge change, while the lean catches
    // up, are they drawn flatter for a few frames.
    const off = carving.map((f) => Math.abs(f.skiRoll * Math.sign(f.edge) - Math.abs(deg(f.edge))))
    expect(mean(off)).toBeLessThan(1.5) // v0.9.29 drew them about 7° flat
    expect(off.filter((d) => d < 3).length / off.length).toBeGreaterThan(0.8)
    const peak = (k: 'legLean' | 'physLean') => Math.max(...frames.filter((f) => f.time > 5).map((f) => Math.abs(f[k])))
    expect(peak('legLean')).toBeGreaterThan(peak('physLean') * 0.95)
  })

  it('keeps the chest near the fall line while the skis come across it', () => {
    const across = frames.filter((f) => f.time > 5 && Math.abs(f.skiOffFall) > 25)
    expect(across.length).toBeGreaterThan(30)
    // Aimed at 30% of the way to the skis; the spring and the waist's limit add a little.
    expect(mean(across.map((f) => f.chestOffFall / f.skiOffFall))).toBeLessThan(0.45)
  })
})

describe('snowboarder in real turns', () => {
  const frames = ride('snowboard')
  const cruising = frames.filter((f) => f.time > 2 && f.time < 3)
  const toe = frames.filter((f) => f.time > 5 && f.edge > 0.6)
  const heel = frames.filter((f) => f.time > 5 && f.edge < -0.6)

  it('cruises in a tall athletic stance, not a frog squat', () => {
    expect(boardKneeBend(0.2)).toBeLessThan(THREE.MathUtils.degToRad(40))
    for (const f of cruising) {
      for (const bend of f.kneeBend) {
        expect(bend).toBeGreaterThan(20)
        expect(bend).toBeLessThan(45) // was 83-87°
      }
    }
  })

  it('keeps the hips above the knees and the knees over the toes on both edges', () => {
    expect(toe.length).toBeGreaterThan(40)
    expect(heel.length).toBeGreaterThan(40)
    for (const f of [...cruising, ...toe, ...heel]) {
      const label = `t ${f.time.toFixed(2)} edge ${deg(f.edge).toFixed(0)}`
      for (const knee of f.kneeUp) expect(f.hipUp - knee, label).toBeGreaterThan(0.25)
      // Knees bend toward the boot toes, never back toward the heels (was 109-130°).
      for (const off of f.kneeOffToe) expect(off, label).toBeLessThan(60)
      expect(f.handAboveSnow, label).toBeGreaterThan(0.05)
    }
  })

  it('leans across the board with the turn, the torso more upright than the legs', () => {
    for (const [side, sign] of [[toe, 1], [heel, -1]] as const) {
      expect(Math.sign(mean(side.map((f) => f.legLean)))).toBe(sign)
      expect(Math.abs(mean(side.map((f) => f.chestLean)))).toBeLessThan(Math.abs(mean(side.map((f) => f.legLean))))
    }
  })
})
