import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput, type SurfaceSample } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'
import { crashSpin } from '../src/render/rider/skierCrashPose'
import { DEFAULT_OUTFIT, SKI_MODELS } from '../src/ui/riderPanel'

/**
 * 0.9.53 rider pass: the snowboarder stands on the board through skidded turns,
 * a stopped rider holds the uphill edges, the skis ease flat at takeoff and a
 * fast crash spins on the snow and squares up again.
 */
const up = (o: THREE.Object3D) => new THREE.Vector3(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()))

describe('snowboarder through half-steer turns', () => {
  const slope = createSteadySlope(18, { width: 4000, depth: 8000 })
  const view = createSkierView()
  view.setColours({ ...DEFAULT_OUTFIT, model: 'snowboard', skiGraphic: 'solid' })
  const board = view.object.getObjectByName('snowboard')!
  const state = createSkiState({ x: 2000, z: 100, heading: 0 })
  state.y = slope.sampleTerrain(2000, 100)!.height
  const off: number[] = []
  let maxRoll = 0
  let acc = 0
  let maxEdge = 0
  const heelKnee: number[] = []
  for (let f = 0; f < 60 * 10; f++) {
    const time = (f + 1) / 60
    const steer = time < 3 ? 0 : (Math.sin(((time - 3) * Math.PI * 2) / 2.4) > 0 ? 1 : -1) * 0.5
    const input: SkiInput = { steer, brake: state.speed * 3.6 > 45 ? 0.5 : 0, tuck: false }
    // Real time: the sim's fixed steps fill each 60 Hz frame, as in the game loop.
    for (acc += 1 / 60; acc >= FIXED_DT; acc -= FIXED_DT) stepSkier(state, input, slope.sampleTerrain, FIXED_DT, { ski: SKI_MODELS.snowboard })
    view.update(state, input, slope.sampleTerrain(state.x, state.z)!, 'ski', 1 / 60)
    if (time < 5) continue
    view.object.updateMatrixWorld(true)
    // The line from the board to the hips, against the board's own normal.
    const hips = view.bones.thigh_L.getWorldPosition(new THREE.Vector3()).add(view.bones.thigh_R.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)
    const legs = hips.sub(board.getWorldPosition(new THREE.Vector3())).normalize()
    maxRoll = Math.max(maxRoll, Math.abs(board.rotation.z))
    maxEdge = Math.max(maxEdge, Math.abs(state.edgeAngle))
    off.push(Math.acos(Math.min(1, legs.dot(up(board)))))
    if (board.rotation.z < -0.4) heelKnee.push(THREE.MathUtils.radToDeg(view.bones.shin_L.rotation.x), THREE.MathUtils.radToDeg(view.bones.shin_R.rotation.x))
  }

  it('rolls the board with the body when a skidded turn leans past the sim edge', () => {
    // At half steer the sim edge stays near 25° while the path leans the rider past 40°:
    // the body used to hang that difference off the side of the board.
    expect(maxRoll).toBeGreaterThan(maxEdge + 0.12)
    expect(Math.max(...off)).toBeLessThan(THREE.MathUtils.degToRad(24))
  })

  it('rides the heel edge on extended legs, not a deep sit', () => {
    expect(heelKnee.length).toBeGreaterThan(40)
    expect(heelKnee.reduce((a, b) => a + b, 0) / heelKnee.length).toBeLessThan(45)
  })
})

describe('stopped across a hill', () => {
  for (const edgeAngle of [0.74, -0.74]) {
    it(`stands on the uphill edges whatever edge the sim left (${edgeAngle})`, () => {
      const view = createSkierView()
      view.setColours({ ...DEFAULT_OUTFIT, model: 'allMountain', skiGraphic: 'solid' })
      const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
      // The hill falls away toward +X; the skis point across it.
      const ground = { height: 0, normal: { x: Math.sin(0.2), y: Math.cos(0.2), z: 0 } } as SurfaceSample
      state.speed = 0
      state.edgeAngle = edgeAngle
      const input: SkiInput = { steer: 0, brake: 1, tuck: false }
      for (let f = 0; f < 150; f++) view.update(state, input, ground, 'ski', 1 / 60)
      view.object.updateMatrixWorld(true)
      for (const ski of view.skis) {
        const n = up(ski)
        // Level or tipped into the hill, never rolled down it.
        expect(n.x).toBeLessThan(0.03)
        expect(n.x).toBeGreaterThan(-0.2)
      }
    })
  }
})

describe('takeoff', () => {
  it('eases the skis flat instead of snapping them level', () => {
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'allMountain', skiGraphic: 'solid' })
    const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
    const ground = { height: 0, normal: { x: 0, y: 1, z: 0 } } as SurfaceSample
    state.speed = 12
    state.vz = 12
    state.edgeAngle = 0.6
    const input: SkiInput = { steer: 1, brake: 0, tuck: false }
    for (let f = 0; f < 60; f++) view.update(state, input, ground, 'ski', 1 / 60)
    const before = view.skis[0].rotation.z
    expect(Math.abs(before)).toBeGreaterThan(0.25)
    state.grounded = false
    state.air = { time: 0, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: null, grabTime: 0, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
    view.update(state, input, null, 'ski', 1 / 60)
    expect(Math.abs(view.skis[0].rotation.z)).toBeGreaterThan(Math.abs(before) * 0.7)
    for (let f = 0; f < 40; f++) view.update(state, input, null, 'ski', 1 / 60)
    expect(Math.abs(view.skis[0].rotation.z)).toBeLessThan(0.02)
  })
})

describe('crash spin', () => {
  const crash = (crashSpeed: number, crashAge: number, crashed: number) =>
    crashSpin({ ...createSkiState(), crashSpeed, crashAge, crashed, crashHeading: 0, heading: 0 })

  it('leaves a slow fall alone', () => {
    expect(crash(3, 1, 1)).toBe(0)
  })

  it('turns a fast slide and squares up by the end of the get-up', () => {
    expect(Math.abs(crash(16, 0, 2.5))).toBeLessThan(1e-6)
    expect(Math.abs(crash(16, 1.5, 1.5))).toBeGreaterThan(0.8)
    expect(Math.abs(crash(16, 1.5, 1.5))).toBeLessThan(1.7)
    expect(Math.abs(crash(16, 3, 0))).toBeLessThan(1e-6)
  })
})

describe('snowboarder pushing on the flat', () => {
  it('takes the back foot out to push and straps back in when the push ends', () => {
    const slope = createSteadySlope(2, { width: 4000, depth: 8000 })
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'snowboard', skiGraphic: 'solid' })
    const board = view.object.getObjectByName('snowboard')!
    const boot = board.children.filter((c) => c.name === 'snowboard-boot')[1]
    const state = createSkiState({ x: 2000, z: 100, heading: 0 })
    state.y = slope.sampleTerrain(2000, 100)!.height
    let acc = 0
    const run = (seconds: number, tuck: boolean, each?: () => void) => {
      for (let f = 0; f < 60 * seconds; f++) {
        const input: SkiInput = { steer: 0, brake: 0, tuck }
        for (acc += 1 / 60; acc >= FIXED_DT; acc -= FIXED_DT) stepSkier(state, input, slope.sampleTerrain, FIXED_DT, { ski: SKI_MODELS.snowboard })
        view.update(state, input, slope.sampleTerrain(state.x, state.z)!, 'ski', 1 / 60)
        each?.()
      }
    }
    run(0.5, false)
    const home = boot.position.clone()
    let reach = 0
    let side = 0
    run(4, true, () => {
      reach = Math.max(reach, boot.position.distanceTo(home))
      side = Math.max(side, Math.abs(boot.position.x - home.x))
    })
    // The foot leaves the binding, steps off the side of the board and strokes along it.
    expect(side).toBeGreaterThan(0.15)
    expect(reach).toBeGreaterThan(0.3)
    expect(state.speed).toBeGreaterThan(2)
    run(2.5, false)
    expect(boot.position.distanceTo(home)).toBeLessThan(0.03)
    expect(boot.children.every((c) => c.visible)).toBe(true)
  })
})

describe('carried along a glide track', () => {
  it('pushes with the foot out without tuck held while the sim reports a glide', () => {
    const slope = createSteadySlope(2, { width: 4000, depth: 8000 })
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'snowboard', skiGraphic: 'solid' })
    const boot = view.object.getObjectByName('snowboard')!.children.filter((c) => c.name === 'snowboard-boot')[1]
    const state = createSkiState({ x: 2000, z: 100, heading: 0 }) as ReturnType<typeof createSkiState> & { gliding?: number }
    state.y = slope.sampleTerrain(2000, 100)!.height
    const input: SkiInput = { steer: 0, brake: 0, tuck: false }
    const frame = () => {
      state.speed = 3
      view.update(state, input, slope.sampleTerrain(state.x, state.z)!, 'ski', 1 / 60)
    }
    for (let f = 0; f < 30; f++) frame()
    const home = boot.position.clone()
    let reach = 0
    for (let f = 0; f < 120; f++) {
      frame()
      reach = Math.max(reach, boot.position.distanceTo(home))
    }
    // No glide reported (as on main today): nothing changes.
    expect(reach).toBeLessThan(0.03)
    state.gliding = 1
    for (let f = 0; f < 180; f++) {
      frame()
      reach = Math.max(reach, boot.position.distanceTo(home))
    }
    expect(reach).toBeGreaterThan(0.3)
  })
})

describe('skier chest and the direction of travel', () => {
  /** Yaw of the chest away from the skis, radians, measured in the snow plane. */
  const run = (steerAt: (time: number, heading: number) => number, seconds: number) => {
    const slope = createSteadySlope(14, { width: 4000, depth: 8000 })
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, skiGraphic: 'solid' })
    const state = createSkiState({ x: 2000, z: 100, heading: 0 })
    state.y = slope.sampleTerrain(2000, 100)!.height
    let acc = 0
    const twist: number[] = []
    for (let f = 0; f < 60 * seconds; f++) {
      const time = (f + 1) / 60
      const input: SkiInput = { steer: steerAt(time, state.heading), brake: 0, tuck: false }
      for (acc += 1 / 60; acc >= FIXED_DT; acc -= FIXED_DT) stepSkier(state, input, slope.sampleTerrain, FIXED_DT, { ski: SKI_MODELS.allMountain })
      view.update(state, input, slope.sampleTerrain(state.x, state.z)!, 'ski', 1 / 60)
      if (time < seconds - 2) continue
      view.object.updateMatrixWorld(true)
      const fwd = (o: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize()
      const chest = fwd(view.bones.chest)
      const root = fwd(view.object)
      twist.push(Math.abs(Math.atan2(chest.x * root.z - chest.z * root.x, chest.dot(root))))
    }
    return twist.reduce((a, b) => a + b, 0) / twist.length
  }

  it('faces where it is going on a steady traverse, and down the hill through linked turns', () => {
    const hold = (want: number) => (_: number, heading: number) => Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - heading), Math.cos(want - heading)) * 3))
    const traverse = run(hold(0.87), 7)
    const turns = run((time) => (time < 2 ? 0 : Math.sin(((time - 2) * Math.PI * 2) / 2.4) > 0 ? 1 : -1), 8)
    // Across the hill the chest used to hold about 30° of twist toward the fall line.
    expect(traverse).toBeLessThan(THREE.MathUtils.degToRad(14))
    expect(turns).toBeGreaterThan(traverse + THREE.MathUtils.degToRad(8))
  })
})

describe('standing up off a chair', () => {
  it('rises out of a crouch over the first second and plays no idle on the ramp', () => {
    const slope = createSteadySlope(4, { width: 4000, depth: 8000 })
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, skiGraphic: 'solid' })
    const state = createSkiState({ x: 2000, z: 100, heading: 0 })
    const input: SkiInput = { steer: 0, brake: 0, tuck: false }
    const hipHeight = () => {
      view.object.updateMatrixWorld(true)
      return view.bones.thigh_L.getWorldPosition(new THREE.Vector3()).y - state.y
    }
    const frame = (pose: 'sit' | 'stand') => {
      state.z += 3 / 60
      Object.assign(state, { y: slope.sampleTerrain(state.x, state.z)!.height, vz: 3, speed: 3 })
      view.update(state, input, slope.sampleTerrain(state.x, state.z)!, pose, 1 / 60)
    }
    for (let f = 0; f < 60; f++) frame('sit')
    const heights: number[] = []
    for (let f = 0; f < 60 * 4; f++) {
      frame('stand')
      heights.push(hipHeight())
      expect(view.idles.current, `idle at frame ${f}`).toBeNull()
    }
    // Still low a third of a second in, standing tall by two seconds, with no dip back down.
    expect(heights[119] - heights[20]).toBeGreaterThan(0.08)
    for (let f = 40; f < 120; f++) expect(heights[f]).toBeGreaterThan(heights[f - 20] - 0.01)
  })
})
