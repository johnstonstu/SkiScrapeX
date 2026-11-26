import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../src/sim'
import { DEFAULT_OUTFIT } from '../src/ui/riderPanel'
import { BOOT_CUFF, Spring, createSkierView } from '../src/render/rider/skierView'

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
    run(30, () => ({ ...idle, grab: true }))
    state.air = null
    state.grounded = true
    run(30, () => idle)
    run(30, () => idle, 'sit')
    run(30, () => idle, 'stand')
    expect(joints(view.object).every(Number.isFinite)).toBe(true)
  })
})

it('rolls the snowboard across both edges and lifts its nose at takeoff', () => {
  const view = createSkierView()
  const outfit = { ...DEFAULT_OUTFIT, skiGraphic: 'solid' } as const
  const visibleBoots = () => {
    const names: string[] = []
    view.object.traverseVisible((object) => {
      if (object.name.endsWith('-boot')) names.push(object.name)
    })
    return names
  }
  view.setColours({ ...outfit, model: 'allMountain' })
  expect(visibleBoots()).toEqual(['ski-boot', 'ski-boot'])
  view.setColours({ ...outfit, model: 'snowboard' })
  expect(visibleBoots()).toEqual(['snowboard-boot', 'snowboard-boot'])
  const board = view.object.getObjectByName('snowboard')!
  expect(board.children.filter((object) => object.name === 'snowboard-boot')).toHaveLength(2)
  const state = createSkiState({ x: 0, z: 0, heading: 0 })
  state.speed = 12

  expect(board.visible).toBe(true)
  for (const edge of [-0.64, 0, 0.64]) {
    state.edgeAngle = edge
    for (let frame = 0; frame < 12; frame++) view.update(state, idle, ground)
    expect(board.rotation.z).toBeCloseTo(edge)
    expect(joints(view.object).every(Number.isFinite)).toBe(true)
  }

  state.grounded = false
  state.air = {
    time: 0.05, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: null,
    grabTime: 0, timeToLand: 0.5, predictedFrom: 0, cork: 0, corkTime: 0,
  }
  view.update(state, idle, null)
  expect(board.rotation.x).toBeLessThan(-0.15)
  state.air.time = 0.3
  state.air.grab = 'nose'
  for (let frame = 0; frame < 30; frame++) view.update(state, { ...idle, grab: true }, null)
  expect(board.rotation.x).toBeLessThan(-0.3)
  for (let frame = 0; frame < 40; frame++) view.update(state, idle, null)
  expect(board.rotation.x).toBeCloseTo(0, 2)
  expect(joints(view.object).every(Number.isFinite)).toBe(true)
  view.setColours({ ...outfit, model: 'allMountain' })
  expect(visibleBoots()).toEqual(['ski-boot', 'ski-boot'])
})

it('pulls the jacket hem back at speed and lets it settle when stopped', () => {
  const view = createSkierView()
  const state = createSkiState({ x: 0, z: 0, heading: 0 })
  const hem = view.object.getObjectByName('jacket-hem') as THREE.SkinnedMesh
  expect(hem.isSkinnedMesh).toBe(true)
  const weights = hem.geometry.getAttribute('skinWeight')
  expect(Array.from({ length: weights.count }, (_, i) => weights.getY(i)).some((weight) => weight > 0.1 && weight < 0.9)).toBe(true)
  const update = (speed: number) => {
    state.speed = speed
    for (let frame = 0; frame < 60; frame++) {
      state.time += 1 / 60
      view.update(state, idle, ground)
    }
  }
  update(24)
  expect(hem.morphTargetInfluences?.[1]).toBeLessThan(-0.2)
  update(0)
  expect(hem.morphTargetInfluences?.[1]).toBeCloseTo(0, 3)
})

it('swings drawstrings when the skier stops hard, then lets them hang straight down', () => {
  const view = createSkierView()
  const state = createSkiState({ x: 0, z: 0, heading: 0 })
  const cord = view.object.getObjectByName('cord_L')!
  const pom = view.object.getObjectByName('pom')!
  const q = new THREE.Quaternion()
  /** Angle of a bone's axis from world vertical (down for a cord, up for the pom). */
  const tilt = (bone: THREE.Object3D, axis: THREE.Vector3, vertical: THREE.Vector3) =>
    axis.clone().applyQuaternion(bone.getWorldQuaternion(q)).angleTo(vertical)
  const cordTilt = () => tilt(cord, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0))
  const run = (frames: number, vz: number, input = idle) => {
    let peak = 0
    for (let frame = 0; frame < frames; frame++) {
      state.time += 1 / 60
      state.vz = vz
      state.speed = Math.abs(vz)
      view.update(state, input, ground, 'ski', 1 / 60)
      peak = Math.max(peak, cordTilt())
    }
    return peak
  }
  run(120, 12)
  // Hockey stop: 12 m/s to rest in a quarter of a second.
  for (const vz of [9, 6, 3, 0]) run(4, vz)
  expect(run(40, 0)).toBeGreaterThan(0.15)
  run(400, 0)
  expect(cordTilt()).toBeLessThan(0.12)
  // In a deep tuck at speed the chest pitches forward, but the cords follow gravity and the
  // airflow (streaming back), not the chest, and the pom stays up.
  run(420, 12, { ...idle, tuck: true })
  const airflow = new THREE.Vector3(0, -9.81, -12 * 0.9).normalize()
  expect(tilt(cord, new THREE.Vector3(0, -1, 0), airflow)).toBeLessThan(0.35)
  expect(tilt(pom, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0))).toBeLessThan(1.0)
})

it('lets the jacket hem float up in the air and fall back on landing', () => {
  const view = createSkierView()
  const state = createSkiState({ x: 0, z: 0, heading: 0 })
  const hem = view.object.getObjectByName('hem_B')!
  const q = new THREE.Quaternion()
  /** How far the back hem points up out of hanging straight down (radians). */
  const lift = () => new THREE.Vector3(0, -1, 0).applyQuaternion(hem.getWorldQuaternion(q)).angleTo(new THREE.Vector3(0, -1, 0))
  for (let i = 0; i < 120; i++) {
    state.time += 1 / 60
    view.update(state, idle, ground, 'ski', 1 / 60)
  }
  const standing = lift()
  // Off a kicker: half a second of free fall.
  state.grounded = false
  state.air = { time: 0, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: null, grabTime: 0, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
  state.vy = 2
  let peak = 0
  for (let i = 0; i < 40; i++) {
    state.time += 1 / 60
    state.vy -= 9.81 / 60
    state.air.time += 1 / 60
    view.update(state, idle, null, 'ski', 1 / 60)
    peak = Math.max(peak, lift())
  }
  expect(peak).toBeGreaterThan(standing + 0.3)
  state.grounded = true
  state.air = null
  state.vy = 0
  for (let i = 0; i < 300; i++) {
    state.time += 1 / 60
    view.update(state, idle, ground, 'ski', 1 / 60)
  }
  expect(lift()).toBeLessThan(standing + 0.1)
})

it('binds every joint the skinned body uses to a named bone in the rig', () => {
  const view = createSkierView()
  for (const name of ['hips', 'spine', 'chest', 'head', 'thigh_L', 'shin_R', 'upperarm_L', 'forearm_R', 'hand_L', 'hem_F', 'hem_B', 'hood', 'pack', 'pom', 'cord_L', 'cord_R']) {
    const bone = view.object.getObjectByName(name) as THREE.Bone | undefined
    expect(bone?.isBone, name).toBe(true)
  }
})

it('keeps each shin running up its boot cuff in a deep carve, so the ankle does not fold sideways', () => {
  const view = createSkierView()
  const state = createSkiState({ x: 0, z: 0, heading: 0 })
  state.speed = 14
  for (let i = 0; i < 90; i++) {
    state.time += 1 / 60
    state.edgeAngle = 0.75
    state.carveLoad = 2
    state.carveRadius = 12
    view.update(state, { ...idle, steer: 1 }, ground, 'ski', 1 / 60)
  }
  view.object.updateMatrixWorld(true)
  const q = new THREE.Quaternion()
  const boots: THREE.Object3D[] = []
  view.object.traverse((o) => o.name === 'ski-boot' && boots.push(o))
  for (const name of ['shin_L', 'shin_R']) {
    const shin = view.object.getObjectByName(name)!
    // Up the shin, from the ankle toward the knee.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shin.getWorldQuaternion(q))
    const foot = shin.getWorldPosition(new THREE.Vector3()).addScaledVector(up, -0.42)
    const boot = boots.reduce((a, b) => (a.getWorldPosition(new THREE.Vector3()).distanceTo(foot) < b.getWorldPosition(new THREE.Vector3()).distanceTo(foot) ? a : b))
    const cuff = BOOT_CUFF.clone().applyQuaternion(boot.parent!.getWorldQuaternion(q))
    expect(up.angleTo(cuff), name).toBeLessThan(0.3)
  }
})

/** Knee bend (degrees) and how far the shin swings sideways off the thigh's hinge plane, per leg. */
function kneeAngles(view: ReturnType<typeof createSkierView>) {
  view.object.updateMatrixWorld(true)
  return ['L', 'R'].map((s) => {
    const thigh = view.object.getObjectByName(`thigh_${s}`)!
    const shin = view.object.getObjectByName(`shin_${s}`)!
    const hip = thigh.getWorldPosition(new THREE.Vector3())
    const knee = shin.getWorldPosition(new THREE.Vector3())
    const foot = new THREE.Vector3(0, -0.42, 0).applyMatrix4(shin.matrixWorld)
    const local = new THREE.Vector3(0, -1, 0).applyQuaternion(shin.quaternion)
    return {
      bend: THREE.MathUtils.radToDeg(Math.PI - hip.sub(knee).angleTo(foot.sub(knee))),
      sideways: THREE.MathUtils.radToDeg(Math.abs(Math.atan2(local.x, Math.hypot(local.y, local.z)))),
    }
  })
}

describe('rider legs', () => {
  const pose = (setup: (s: ReturnType<typeof createSkiState>) => SkiInput, frames = 180) => {
    const view = createSkierView()
    const state = createSkiState({ x: 0, z: 0, heading: 0 })
    let worstSideways = 0
    for (let i = 0; i < frames; i++) {
      state.time += 1 / 60
      view.update(state, setup(state), ground, 'ski', 1 / 60)
      for (const leg of kneeAngles(view)) worstSideways = Math.max(worstSideways, leg.sideways)
    }
    return { view, worstSideways, legs: kneeAngles(view) }
  }

  it('bends each knee as a hinge, never sideways, through carves, skating and a hockey stop', () => {
    const cases: ((s: ReturnType<typeof createSkiState>) => SkiInput)[] = [
      (s) => ((s.speed = 14), (s.edgeAngle = 0.75), (s.carveRadius = 10), (s.carveLoad = 2.2), { ...idle, steer: 1 }),
      (s) => ((s.speed = 2.5), { ...idle, tuck: true }),
      (s) => ((s.speed = 8), (s.edgeAngle = 0.7), { ...idle, brake: 1 }),
      (s) => ((s.speed = 3), { ...idle, brake: 1 }),
    ]
    // Before the hinge solve these reached 19° to 47°.
    for (const setup of cases) expect(pose(setup).worstSideways).toBeLessThan(0.5)
  })

  it('stands in an athletic stance rather than a squat, and folds deeper in a tuck', () => {
    const standing = pose((s) => ((s.speed = 0), idle)).legs
    const cruising = pose((s) => ((s.speed = 10), idle)).legs
    const tucked = pose((s) => ((s.speed = 20), (s.tuck = true), { ...idle, tuck: true })).legs
    for (const leg of standing) expect(leg.bend).toBeLessThan(65) // the old fit was ~80°
    for (const leg of cruising) expect(leg.bend).toBeLessThan(68)
    for (let i = 0; i < 2; i++) expect(tucked[i].bend).toBeGreaterThan(cruising[i].bend + 25)
  })

  it('double-poles on fairly straight legs, dipping the knees on each push', () => {
    let least = 180
    let most = 0
    const view = createSkierView()
    const state = createSkiState({ x: 0, z: 0, heading: 0 })
    state.speed = 0.8
    for (let i = 0; i < 240; i++) {
      state.time += 1 / 60
      view.update(state, { ...idle, tuck: true }, ground, 'ski', 1 / 60)
      if (i < 60) continue
      const bend = kneeAngles(view)[0].bend
      least = Math.min(least, bend)
      most = Math.max(most, bend)
    }
    expect(least).toBeLessThan(65)
    expect(most - least).toBeGreaterThan(8)
  })
})

describe('rider legs in real turns', () => {
  it('leans thigh and shin into the turn together, with the hips inside the boots (no sideways Z)', () => {
    const slope = createSteadySlope(18, { width: 4000, depth: 8000 })
    const view = createSkierView()
    const state = createSkiState({ x: 2000, z: 100, heading: 0 })
    state.y = slope.sampleTerrain(2000, 100)!.height
    let checked = 0
    let edgedFor = 0
    // Turns long enough for the edge to roll fully on and hold a carve (the sim steps at half the frame time here).
    for (let f = 0; f < 60 * 12; f++) {
      const time = (f + 1) / 60
      const steer = time < 3 ? 0 : Math.sin(((time - 3) * Math.PI * 2) / 4) > 0 ? 1 : -1
      const input: SkiInput = { steer, brake: state.speed * 3.6 > 45 ? 0.5 : 0, tuck: false }
      stepSkier(state, input, slope.sampleTerrain, FIXED_DT, {} as never)
      view.update(state, input, slope.sampleTerrain(state.x, state.z), 'ski', 1 / 60)
      // Mid-carve only: well into a turn, edged hard and held there a moment (not the edge change).
      edgedFor = Math.abs(state.edgeAngle) >= 0.75 ? edgedFor + 1 / 60 : 0
      if (time < 5 || edgedFor < 0.25) continue
      view.object.updateMatrixWorld(true)
      const forward = new THREE.Vector3(state.vx, 0, state.vz).normalize()
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
      const lean = (v: THREE.Vector3) => Math.atan2(v.dot(right), v.y)
      for (const s of ['L', 'R']) {
        const hip = view.object.getObjectByName(`thigh_${s}`)!.getWorldPosition(new THREE.Vector3())
        const shin = view.object.getObjectByName(`shin_${s}`)!
        const knee = shin.getWorldPosition(new THREE.Vector3())
        const foot = new THREE.Vector3(0, -0.42, 0).applyMatrix4(shin.matrixWorld)
        const shinLean = lean(knee.clone().sub(foot))
        const thighLean = lean(hip.clone().sub(knee))
        // Before: shins ~45° into the turn with thighs 10-40° the other way.
        expect(Math.sign(thighLean), `thigh ${s} leans with the shin`).toBe(Math.sign(shinLean))
        expect(Math.abs(shinLean - thighLean)).toBeLessThan(THREE.MathUtils.degToRad(45))
        // Hips inside the boots, on the turn side.
        expect(Math.sign(hip.clone().sub(foot).dot(right))).toBe(Math.sign(shinLean))
        expect(Math.abs(hip.clone().sub(foot).dot(right))).toBeGreaterThan(0.15)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('skating pushes the ski well out to the side on an extending leg, feet locked in the boots', () => {
    const view = createSkierView()
    const state = createSkiState({ x: 0, z: 0, heading: 0 })
    state.speed = 2.5
    const boots: THREE.Object3D[] = []
    view.object.traverse((o) => o.name === 'ski-boot' && boots.push(o))
    let straightest = 180
    let deepest = 0
    let spread = 0
    let miss = 0
    for (let i = 0; i < 300; i++) {
      state.time += 1 / 60
      view.update(state, { ...idle, tuck: true }, ground, 'ski', 1 / 60)
      if (i < 60) continue
      for (const leg of kneeAngles(view)) {
        straightest = Math.min(straightest, leg.bend)
        deepest = Math.max(deepest, leg.bend)
      }
      const ankles = boots.map((boot) => new THREE.Vector3(0, 0.2, -0.01).applyMatrix4(boot.parent!.matrixWorld))
      spread = Math.max(spread, Math.abs(ankles[0].x - ankles[1].x))
      boots.forEach((boot, k) => {
        const shin = view.object.getObjectByName(k === 0 ? 'shin_L' : 'shin_R')!
        const foot = new THREE.Vector3(0, -0.42, 0).applyMatrix4(shin.matrixWorld)
        miss = Math.max(miss, new THREE.Vector3(0, 0.2, -0.01).applyMatrix4(boot.parent!.matrixWorld).distanceTo(foot))
      })
    }
    expect(deepest - straightest).toBeGreaterThan(20)
    expect(spread).toBeGreaterThan(0.43) // was 0.37: the push barely left the stance
    expect(miss).toBeLessThan(0.005)
  })
})
