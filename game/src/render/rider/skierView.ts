import * as THREE from 'three'
import { PHYSICS, fallLineHeading, skiFrame, type SkiInput, type SkiState, type SurfaceSample } from '../../sim'
import { ANKLE_IN_SKI, BOARD_BINDINGS, BOARD_BOOT_HEIGHT, FORE_ARM, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM, buildRider, type RiderLook } from './skierModel'

export { SKI_GRAPHICS, type RiderLook, type SkiGraphic } from './skierModel'

/** `ski` follows the sim; `sit` is on a chair; `stand` is upright on a surface lift. */
export type SkierPose = 'ski' | 'sit' | 'stand'

/**
 * A damped spring toward a moving target. Under-damped channels overshoot a
 * little, which reads as weight: the body sinks past the landing and comes
 * back, the hips swing through an edge change. Sub-stepped so a long frame
 * cannot blow it up.
 */
export class Spring {
  v = 0
  constructor(public x = 0) {}
  step(target: number, dt: number, hz: number, zeta: number): number {
    const w = 2 * Math.PI * hz
    for (let left = dt; left > 1e-6; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120)
      this.v += (w * w * (target - this.x) - 2 * zeta * w * this.v) * h
      this.x += this.v * h
    }
    return this.x
  }
}

/** Grip to tip, metres. */
const POLE_REACH = 1.1
const smooth = (t: number) => t * t * (3 - 2 * t)
/** Turn pole plant: where the tip strikes (metres ahead of the boots) and how long the reach takes. */
const PLANT_AHEAD = 0.75
const PLANT_REACH = 0.12
/** Seconds per double-pole push. */
const DOUBLE_POLE_CYCLE = 1.05

/**
 * Double-pole push at phase 0..1: reach forward and plant (0 to 0.35), drive
 * the hands down past the hips while the back crunches (to 0.75), then swing
 * the arms forward again. Hands in chest space, pole tips in root space.
 */
export function doublePolePose(phase: number, speed: number) {
  const reachEnd = 0.35
  const pushEnd = 0.75
  const forward = { handX: 0.27, handY: 0.12, handZ: 0.5 }
  const back = { handX: 0.33, handY: -0.32, handZ: -0.2 }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  if (phase < reachEnd) {
    const t = smooth(phase / reachEnd)
    return {
      handX: lerp(back.handX, forward.handX, t), handY: lerp(back.handY, forward.handY, t), handZ: lerp(back.handZ, forward.handZ, t),
      tipY: lerp(0.35, 0.0, t), tipZ: lerp(-0.7, 0.4, t), crunch: 0,
    }
  }
  if (phase < pushEnd) {
    const t = (phase - reachEnd) / (pushEnd - reachEnd)
    const k = smooth(t)
    return {
      handX: lerp(forward.handX, back.handX, k), handY: lerp(forward.handY, back.handY, k), handZ: lerp(forward.handZ, back.handZ, k),
      // The tip stays put on the snow while the skier slides past it.
      tipY: -0.02, tipZ: 0.4 - speed * t * (pushEnd - reachEnd) * DOUBLE_POLE_CYCLE - k * 0.5,
      crunch: 0.75 * Math.sin(t * Math.PI),
    }
  }
  const t = smooth((phase - pushEnd) / (1 - pushEnd))
  return { handX: back.handX, handY: lerp(back.handY, back.handY + 0.1, t), handZ: back.handZ, tipY: lerp(0, 0.35, t), tipZ: -0.7, crunch: 0 }
}

/** Discrete poses that crossfade into each other instead of snapping. */
type Mode = 'ski' | 'rail' | 'crash' | 'sit' | 'stand'
/** Seconds to blend into each mode. Falling is quick, getting up is slow. */
const FADE_IN: Record<Mode, number> = { ski: 0.3, rail: 0.12, crash: 0.16, sit: 0.4, stand: 0.4 }

/**
 * Stylised freeskier (or snowboarder) driven by the sim. The mesh and rig are
 * built in skierModel.ts; this file poses them every frame.
 *
 * Continuous moves (edging, crouch, tuck, skating, braking) run through
 * springs so they ease in with follow-through. Discrete switches (a crash,
 * getting up, getting on a lift or a rail) crossfade from a snapshot of the
 * last pose.
 */
export function createSkierView(): {
  object: THREE.Group
  update: (state: SkiState, input: SkiInput, ground: SurfaceSample | null, pose?: SkierPose, dt?: number) => void
  /** Point between the eyes, for the first-person camera. */
  eye: THREE.Object3D
  /** Hide the head and torso so a first-person camera sees only hands, poles and skis. */
  setFirstPerson: (on: boolean) => void
  setColours: (look: RiderLook) => void
} {
  const rig = buildRider()
  const { root, skis, boardGroup, body, hips, spine, chest, head, legs, arms } = rig

  // ---- Working state --------------------------------------------------------
  const down = new THREE.Vector3(0, -1, 0)
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const v3 = new THREE.Vector3()
  const hint = new THREE.Vector3()
  const qInv = new THREE.Quaternion()
  const basis = new THREE.Matrix4()
  const ax = new THREE.Vector3()
  const ay = new THREE.Vector3()
  const az = new THREE.Vector3()
  const qBase = new THREE.Quaternion()
  const qFlip = new THREE.Quaternion()
  const xAxis = new THREE.Vector3(1, 0, 0)
  const centre = new THREE.Vector3(0, 0.9, 0)
  const offsetA = new THREE.Vector3()
  const offsetB = new THREE.Vector3()

  const incline = new Spring()
  const crouch = new Spring(0.3)
  const counter = new Spring()
  const tuck = new Spring()
  const brake = new Spring()
  const plow = new Spring()
  const skate = new Spring()
  const airBlend = new Spring()
  const railBlend = new Spring()
  const press = new Spring()
  const look = new Spring()
  const fore = new Spring()
  const clothSide = new Spring()
  const clothBack = new Spring()
  let grabBlend = 0
  let lastGrab: string | null = null
  let wasAir = false
  let lastVy = 0
  /** Turn pole plant: seconds since the tip reached for the snow, and when it let go. */
  let plantAge = 10
  let plantRelease = 0
  let plantSide = 1
  let dpPhase = 0
  let lastEdgeSign = 0
  let ridePhase = 0
  let skatePhase = 0
  let switchLook = 0
  let spinLead = 0
  let wasRail = false
  let railEntry = 0
  let entryTurn = 0
  let lastHeading = 0
  /** Travel direction last frame and the smoothed sideways acceleration of the path, m/s². */
  let lastTravel: number | null = null
  let pathAccel = 0
  let railLook = 0
  const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

  // ---- Crossfade between modes ---------------------------------------------
  const animated: THREE.Object3D[] = [
    body, hips, spine, chest, head, boardGroup, ...skis,
    ...legs.flatMap((leg) => [leg.thigh, leg.knee]),
    ...arms.flatMap((arm) => [arm.shoulder, arm.elbow, arm.hand, arm.pole]),
  ]
  const snapPosition = animated.map(() => new THREE.Vector3())
  const snapQuaternion = animated.map(() => new THREE.Quaternion())
  let mode: Mode | null = null
  let fade = 0
  let fadeTime = 0.3
  const startFade = (next: Mode) => {
    if (mode !== null) {
      animated.forEach((o, i) => {
        snapPosition[i].copy(o.position)
        snapQuaternion[i].copy(o.quaternion)
      })
      // Getting up from a crash takes longer than going down.
      fadeTime = mode === 'crash' ? 0.55 : FADE_IN[next]
      fade = 1
    }
    mode = next
  }
  const applyFade = (dt: number) => {
    if (fade <= 0) return
    fade = Math.max(0, fade - dt / fadeTime)
    const w = fade * fade * (3 - 2 * fade)
    animated.forEach((o, i) => {
      o.position.lerp(snapPosition[i], w)
      o.quaternion.slerp(snapQuaternion[i], w)
    })
  }

  /**
   * Two-bone IK. `target` is in the parent space of `upper`. Bones hang
   * down -Y at rest; `bendHint` (same space) is where the middle joint points.
   */
  const solve = (upper: THREE.Object3D, lower: THREE.Object3D, target: THREE.Vector3, l1: number, l2: number, bendHint: THREE.Vector3) => {
    const to = v1.copy(target).sub(upper.position)
    const d = THREE.MathUtils.clamp(to.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    const dir = to.normalize()
    const bend = hint.copy(bendHint).addScaledVector(dir, -bendHint.dot(dir))
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1)
    bend.normalize()
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
    const mid = v2.copy(dir).multiplyScalar(a).addScaledVector(bend, h)
    upper.quaternion.setFromUnitVectors(down, v3.copy(mid).normalize())
    const rest = v3.copy(dir).multiplyScalar(d).sub(mid)
    qInv.copy(upper.quaternion).invert()
    lower.quaternion.setFromUnitVectors(down, rest.applyQuaternion(qInv).normalize())
  }

  /** Root-space point to the local space of `object` (root's matrices must be current). */
  const rootToLocal = (object: THREE.Object3D, point: THREE.Vector3, out: THREE.Vector3) =>
    object.worldToLocal(root.localToWorld(out.copy(point)))

  const ankle = new THREE.Vector3()
  const kneeHint = new THREE.Vector3()
  const hipsInverse = new THREE.Matrix4()
  const fitLegs = () => {
    root.updateMatrixWorld(true)
    hipsInverse.copy(hips.matrixWorld).invert()
    for (const leg of legs) {
      ankle.copy(ANKLE_IN_SKI).applyQuaternion(leg.ski.quaternion).add(leg.ski.position)
      rootToLocal(hips, ankle, ankle)
      // Knees point over the ski tips.
      kneeHint.set(0, 0, 1).applyQuaternion(leg.ski.quaternion).transformDirection(root.matrixWorld).transformDirection(hipsInverse)
      solve(leg.thigh, leg.knee, ankle, THIGH_LENGTH, SHIN_LENGTH, kneeHint)
    }
  }

  const handTarget = new THREE.Vector3()
  const elbowHint = new THREE.Vector3()
  const tip = new THREE.Vector3()
  const handWorld = new THREE.Vector3()
  /** Hand target in chest space (or root space when `inRoot`), pole tip in root space. */
  const placeArm = (index: number, hand: THREE.Vector3, poleTip: THREE.Vector3, inRoot = false) => {
    const arm = arms[index]
    if (inRoot) {
      root.updateMatrixWorld(true)
      rootToLocal(chest, hand, handTarget)
    } else handTarget.copy(hand)
    // Elbows point back and out.
    elbowHint.set(arm.side * 0.6, -0.2, -1)
    solve(arm.shoulder, arm.elbow, handTarget, UPPER_ARM, FORE_ARM, elbowHint)
    arm.hand.quaternion.identity()
    root.updateMatrixWorld(true)
    arm.hand.getWorldPosition(handWorld)
    root.localToWorld(tip.copy(poleTip))
    tip.sub(handWorld)
    if (tip.lengthSq() < 1e-6) tip.set(0, -1, 0)
    // A planted tip nearer than the pole is long would push through the snow:
    // shorten the pole to reach it instead (it reads as the pole angling in).
    arm.pole.scale.y = THREE.MathUtils.clamp(tip.length() / POLE_REACH, 0.72, 1)
    arm.hand.getWorldQuaternion(qInv).invert()
    arm.pole.quaternion.setFromUnitVectors(down, tip.applyQuaternion(qInv).normalize())
  }

  /** Keep both boots attached to the board through the pose. */
  const placeBoard = (x: number, y: number, z: number, edge: number, yaw = 0, pitch = 0) => {
    boardGroup.position.set(x, y, z)
    boardGroup.rotation.order = 'YXZ'
    boardGroup.rotation.set(pitch, yaw, edge)
    boardGroup.updateMatrix()
    for (let i = 0; i < 2; i++) {
      const { z, yaw } = BOARD_BINDINGS[i]
      skis[i].position.set(0, BOARD_BOOT_HEIGHT, z).applyMatrix4(boardGroup.matrix)
      skis[i].quaternion.copy(boardGroup.quaternion)
      skis[i].rotateY(yaw)
    }
  }

  const resetJoints = () => {
    for (const ski of skis) ski.rotation.set(0, 0, 0)
    body.rotation.set(0, 0, 0)
    for (const part of [hips, spine, chest, head]) {
      part.rotation.order = 'YXZ'
      part.rotation.set(0, 0, 0)
    }
  }

  return {
    object: root,
    eye: rig.eye,
    setFirstPerson: rig.setFirstPerson,
    setColours: rig.setColours,
    update(state, input, ground, pose = 'ski', dt = 1 / 60) {
      const boarding = rig.boarding
      const up = ground && pose === 'ski' ? ground.normal : { x: 0, y: 1, z: 0 }
      const frame = skiFrame(state.heading, up)
      basis.makeBasis(
        ax.set(-frame.side.x, -frame.side.y, -frame.side.z),
        ay.set(frame.up.x, frame.up.y, frame.up.z),
        az.set(frame.forward.x, frame.forward.y, frame.forward.z),
      )
      qBase.setFromRotationMatrix(basis)
      root.quaternion.copy(qBase)
      root.position.set(state.x, state.y - (pose === 'ski' ? state.sink * 0.85 : 0), state.z)
      const air = pose === 'ski' ? state.air : null
      const crashed = pose === 'ski' && state.crashed > 0
      const rail = pose === 'ski' && !crashed ? state.rail : null
      const wind = pose === 'ski' && !crashed ? THREE.MathUtils.clamp((state.speed - 0.5) / 24, 0, 1) : 0
      const edgePull = THREE.MathUtils.clamp(state.edgeAngle, -0.8, 0.8)
      if (wasAir && !air && pose === 'ski' && !crashed) clothBack.v -= THREE.MathUtils.clamp(-lastVy, 0, 9) * 0.04
      const side = clothSide.step(wind * (-edgePull * 0.038 + Math.sin(state.time * 17) * 0.013), dt, 3.4, 0.66)
      const back = clothBack.step(-wind * (0.033 + Math.sin(state.time * 22) * 0.012), dt, 4.1, 0.58)
      rig.poseCloth(side, back)

      const nextMode: Mode = pose === 'sit' ? 'sit' : pose === 'stand' ? 'stand' : crashed ? 'crash' : rail ? 'rail' : 'ski'
      if (nextMode !== mode) startFade(nextMode)

      // Rail entry: a short hop while the skis swing from the approach line to the rail.
      if (rail && !wasRail) {
        railEntry = 1
        entryTurn = Math.atan2(Math.sin(lastHeading - state.heading), Math.cos(lastHeading - state.heading))
      }
      wasRail = Boolean(rail)
      lastHeading = state.heading
      railEntry = Math.max(0, railEntry - dt / 0.2)
      if (railEntry > 0) {
        qFlip.setFromAxisAngle(ay.set(0, 1, 0), entryTurn * railEntry * railEntry)
        root.quaternion.multiply(qFlip)
        root.position.y += Math.sin(railEntry * Math.PI) * 0.28
      }
      // A cork tilts the spin axis: pitch the body as it spins and it corkscrews.
      const tilt = air ? air.flip + air.cork * 1.05 : 0
      if (air && Math.abs(tilt) > 1e-3) {
        qFlip.setFromAxisAngle(xAxis, tilt)
        root.quaternion.multiply(qFlip)
        offsetA.copy(centre).applyQuaternion(qBase)
        offsetB.copy(centre).applyQuaternion(root.quaternion)
        root.position.add(offsetA).sub(offsetB)
      }
      resetJoints()

      if (pose === 'sit') {
        ridePhase += dt * 1.55
        const swing = Math.sin(ridePhase) * 0.045
        hips.position.set(0, 0.5, 0)
        spine.rotation.x = -0.1
        chest.rotation.x = -0.04
        head.rotation.y = Math.sin(ridePhase * 0.23) * 0.5
        head.rotation.x = 0.1
        skis[0].position.set(0.14, -0.16, 0.44 + swing)
        skis[1].position.set(-0.14, -0.16, 0.44 - swing)
        skis[0].rotation.x = -0.07 - swing
        skis[1].rotation.x = -0.07 + swing
        if (boarding) placeBoard(0, -0.2, 0.46, 0, Math.PI / 2, swing)
        fitLegs()
        // Hands rest on the bar, poles across the lap.
        placeArm(0, v1.set(0.2, -0.2, 0.34).clone(), new THREE.Vector3(0.3, 0.2, 1.2))
        placeArm(1, v1.set(-0.2, -0.2, 0.34).clone(), new THREE.Vector3(-0.3, 0.2, 1.2))
        applyFade(dt)
        return
      }
      if (crashed) {
        // Sprawled on the snow; hard crashes sprawl flatter, soft ones sit on a hip.
        // The crossfade makes the fall and the getting up.
        const hard = THREE.MathUtils.clamp(state.crashSpeed / 18, 0, 1)
        hips.position.set(0, 0.14 + (1 - hard) * 0.12, hard * 0.08)
        hips.rotation.set(hard * 0.55, 0, 0.95 + hard * 0.55)
        spine.rotation.x = 0.2 + hard * 0.2
        chest.rotation.x = 0.12 + hard * 0.12
        chest.rotation.z = -0.15 - hard * 0.12
        head.rotation.set(-0.25 - hard * 0.2, 0.25 + hard * 0.15, 0.15 + hard * 0.15)
        skis[0].position.set(0.45 + hard * 0.2, 0.04, 0.12 + hard * 0.12)
        skis[1].position.set(0.4 + hard * 0.18, 0.04, -0.1 - hard * 0.08)
        skis[0].rotation.set(hard * 0.15, 0.3 + hard * 0.2, 0.55 + hard * 0.4)
        skis[1].rotation.set(-hard * 0.1, -0.25 - hard * 0.15, 0.4 + hard * 0.25)
        if (boarding) placeBoard(0.45 + hard * 0.1, 0.1 + hard * 0.04, 0, 0.75 + hard * 0.25, 0.15 + hard * 0.1)
        fitLegs()
        placeArm(0, new THREE.Vector3(0.4 + hard * 0.12, -0.02, 0.08 + hard * 0.08), new THREE.Vector3(0.75 + hard * 0.25, 0, 0.5 + hard * 0.2))
        placeArm(1, new THREE.Vector3(-0.3 - hard * 0.1, 0.06 + hard * 0.04, 0.25 + hard * 0.1), new THREE.Vector3(-0.15 - hard * 0.15, 0, 1.0 + hard * 0.3))
        // Settle the springs into a low crouch so getting up rises out of it.
        crouch.x = 0.85 + hard * 0.1
        crouch.v = 0
        applyFade(dt)
        return
      }

      // ---- Read the sim ----
      const skiing = pose === 'ski' && state.grounded && !rail && !air
      const stance = state.ridingSwitch ? -1 : 1
      const speed = state.speed
      const still = skiing && speed < 0.5
      const tucked = skiing && input.tuck && speed >= PHYSICS.skateMaxSpeed
      const braking = skiing && input.brake > 0.2 && speed > 1
      // Slow braking is a snowplough; faster it is a hockey stop (the sim turns the skis across).
      const plowing = braking && speed < 6 && !boarding
      const skating = skiing && input.tuck && !braking && speed < PHYSICS.skateMaxSpeed && !boarding
      const charging = skiing && state.popCharge > 0
      const edge = skiing ? state.edgeAngle * stance : 0
      // Lean for the turn the skier is really making: the path's curvature
      // times speed is the sideways acceleration to balance, tan(lean) = a / g.
      // (The carve model's load misses pivoted and skidded turns.)
      const horizontal = Math.hypot(state.vx, state.vz)
      const travel = Math.atan2(-state.vx, state.vz)
      let turnRate = 0
      if (lastTravel !== null && horizontal > 1 && dt > 0) {
        const delta = Math.atan2(Math.sin(travel - lastTravel), Math.cos(travel - lastTravel))
        if (Math.abs(delta) < 0.5) turnRate = delta / dt
      }
      lastTravel = travel
      pathAccel += ((skiing ? turnRate * horizontal : 0) - pathAccel) * ease(11, dt)
      const lateralG = pathAccel / PHYSICS.gravity
      // Scaled and capped: full race inclination reads as falling at game camera distances.
      const wantIncline = skiing
        ? stance * Math.sign(lateralG || edge) * Math.min(0.85, Math.max(Math.atan(Math.abs(lateralG)) * 0.78, Math.abs(edge) * 0.15))
        : 0
      incline.step(wantIncline, dt, 2.6, 0.92)

      // Edge change: pole plant on the new inside hand, and the legs extend to
      // release the old edges before flexing into the new turn.
      const edgeSign = Math.abs(edge) > 0.12 ? Math.sign(edge) : 0
      if (skiing && edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign && speed > 3) {
        if (!boarding) {
          plantAge = 0
          plantRelease = 10
          plantSide = edgeSign > 0 ? -1 : 1 // right turn: right hand (index 1, side -1)
        }
        crouch.v -= (boarding ? 0.8 : 1.1) * Math.min(1, speed / 10)
      }
      if (edgeSign !== 0) lastEdgeSign = edgeSign
      plantAge = Math.min(10, plantAge + dt)
      // The tip stays where it struck the snow while the skier passes it; let go once it is behind the boots.
      const plantTipZ = PLANT_AHEAD - speed * Math.max(0, plantAge - PLANT_REACH)
      if (plantRelease === 10 && plantAge < 5 && (plantTipZ < -0.45 || plantAge > 0.6)) plantRelease = plantAge
      const plantWeight =
        plantAge < PLANT_REACH ? smooth(plantAge / PLANT_REACH) : plantAge < plantRelease ? 1 : 1 - smooth(Math.min(1, (plantAge - plantRelease) / 0.22))

      // Takeoff extends; landing kicks the crouch spring down and it rebounds.
      if (air && !wasAir) crouch.v -= boarding ? 1.6 : 2.2
      if (!air && wasAir) crouch.v += 1.4 + Math.min(10, Math.max(0, -lastVy)) * 0.4
      wasAir = Boolean(air)
      lastVy = state.vy

      // The sim keeps the grab name for scoring after the button is released.
      const grabbing = Boolean(air?.grab && input.grab)
      if (grabbing && air?.grab) lastGrab = air.grab
      grabBlend += ((grabbing ? 1 : 0) - grabBlend) * ease(14, dt)
      tuck.step(tucked ? 1 : 0, dt, 1.9, 0.9)
      brake.step(braking && !plowing ? 1 : 0, dt, 2.6, 0.85)
      plow.step(plowing ? 1 : 0, dt, 2.4, 0.95)
      skate.step(skating ? 1 : 0, dt, 2, 1)
      airBlend.step(air ? 1 : 0, dt, 2.6, 0.8)
      railBlend.step(rail ? 1 : 0, dt, 3, 0.85)
      spinLead += ((air ? Math.max(-1, Math.min(1, air.spinRate / 8)) : 0) - spinLead) * ease(6, dt)
      switchLook += ((state.ridingSwitch && skiing ? 1 : 0) - switchLook) * ease(4, dt)
      // On a slide the skis are across the rail: look down it, the way you are going.
      const wantLook = rail && rail.style === 'slide' ? -Math.sign(rail.vs || 1) * Math.sign(Math.sin(rail.headingOffset) || 1) * 1.1 : 0
      railLook += (wantLook - railLook) * ease(8, dt)
      press.step(rail && rail.press === 'nose' ? 1 : rail && rail.press === 'tail' ? -1 : 0, dt, 2.6, 0.75)
      // Eyes lead the turn: the head turns toward where the skier is steering.
      look.step(skiing && speed > 2 ? -input.steer * 0.32 : 0, dt, 1.8, 0.9)

      // Counter-rotation: the upper body keeps facing down the fall line.
      let wantCounter = 0
      if (skiing && ground && speed > 1.5 && !boarding) {
        const fall = fallLineHeading(ground.normal)
        if (fall !== null) {
          const off = Math.atan2(Math.sin(state.heading - fall), Math.cos(state.heading - fall))
          wantCounter = Math.max(-1.1, Math.min(1.1, off * (braking ? 0.7 : 0.4)))
        }
      }
      counter.step(wantCounter, dt, 1.7, 0.9)

      // Pushing on the flat: double-pole when nearly stopped, skate as speed builds.
      const doublePole = skate.x * Math.max(0, Math.min(1, (2.4 - speed) / 1.2))
      const skateAmount = skate.x - doublePole
      if (skateAmount > 0.01) skatePhase += dt * (4 + speed * 0.9)
      const stride = Math.sin(skatePhase) * skateAmount
      if (doublePole > 0.01) dpPhase = (dpPhase + dt / DOUBLE_POLE_CYCLE) % 1
      const dp = doublePolePose(dpPhase, speed)

      // Athletic base flex, plus terrain absorption, edging, tuck, braking and pop.
      let wantCrouch = pose === 'stand' ? 0.12 : still ? 0.22 : 0.32
      wantCrouch += Math.abs(incline.x) * 0.3 + (skiing ? Math.min(0.2, state.sink * 0.5) : 0)
      if (skiing && ground?.mogulHeight) {
        // Fold the legs up on the face and extend into the next trough.
        wantCrouch += Math.min(0.48, ground.mogulHeight * Math.max(0, speed / 12 + state.vy * 0.14))
      }
      wantCrouch = Math.max(
        wantCrouch,
        tucked ? (boarding ? 0.8 : 1) : 0,
        braking ? (plowing ? 0.38 : 0.6) : 0,
        skating ? 0.4 : 0,
        charging ? 0.45 + state.popCharge * 0.45 : 0,
        air ? 0.42 + grabBlend * 0.45 : 0,
        rail ? 0.42 : 0,
      )
      crouch.step(Math.min(1.05, wantCrouch), dt, 3, 0.6)
      const flex = Math.max(0, Math.min(1.1, crouch.x))
      // Hips back in a tuck and a hockey stop, forward over the skis in a press.
      fore.step(tuck.x * 0.16 + brake.x * 0.05 - press.x * 0.05 + skate.x * 0.03, dt, 2.5, 0.9)

      // ---- Skis ----
      const halfStance = 0.13 + brake.x * 0.03 + plow.x * 0.14 + skate.x * 0.03 - railBlend.x * 0.04 - tuck.x * 0.015
      const lead = incline.x * 0.12
      // Skis drift under the outside of the turn so the body can incline.
      const shift = -Math.sin(incline.x) * 0.32
      skis[0].position.set(halfStance + shift, 0.03, 0.04 - lead)
      skis[1].position.set(-halfStance + shift, 0.03, 0.04 + lead)
      // Skis tilt with the legs plus a little knee angulation, so the full-turn
      // pose holds together instead of skis on 45° under an upright body.
      const edgeVisual = pose === 'ski' && !air ? Math.sign(edge) * Math.min(Math.abs(edge) * 0.9, Math.abs(incline.x) + 0.32) : 0
      for (const ski of skis) ski.rotation.z = edgeVisual
      if (plow.x > 0.01) {
        // Snowplough: tips together, tails out, both skis on their inside edges.
        skis[0].rotation.y -= 0.26 * plow.x
        skis[1].rotation.y += 0.26 * plow.x
        skis[0].rotation.z += 0.22 * plow.x
        skis[1].rotation.z -= 0.22 * plow.x
      }
      if (skateAmount > 0.01) {
        // Skis in a V; the pushing ski angles out, slides out and back, then lifts to recover.
        for (let i = 0; i < 2; i++) {
          const s = legs[i].side
          const push = Math.max(0, s * stride)
          const recover = Math.max(0, -s * Math.cos(skatePhase)) * skateAmount
          skis[i].rotation.y += s * (0.16 + 0.14 * push) * skateAmount
          skis[i].rotation.z += s * 0.22 * push
          skis[i].position.x += s * 0.1 * push
          skis[i].position.z -= 0.14 * push
          skis[i].position.y += 0.06 * recover * (1 - push)
        }
      }
      if (Math.abs(press.x) > 0.01 && !air) {
        // Press: tip the skis onto the pressed end and slide them back under the body,
        // lifted so the pressed half stays on the rail.
        for (const ski of skis) {
          ski.rotation.x = press.x * 0.32
          ski.position.y += Math.abs(press.x) * 0.09
          ski.position.z -= press.x * 0.14
        }
      }
      if (airBlend.x > 0.01) {
        // Legs come up under the body; grabs pull them further.
        const lift = (0.18 + grabBlend * 0.22) * Math.max(0, Math.min(1, airBlend.x))
        for (const ski of skis) {
          ski.position.y += lift
          ski.position.z += 0.05 * airBlend.x
        }
      }
      if (air) {
        const g = grabBlend
        switch (lastGrab) {
          case 'mute':
            skis[0].rotation.y = 0.18 * g
            skis[1].rotation.y = 0.18 * g
            break
          case 'japan':
            for (const ski of skis) ski.rotation.set(0.4 * g, 0.3 * g, 0)
            skis[0].position.z -= 0.2 * g
            skis[1].position.z -= 0.2 * g
            break
          case 'nose':
            for (const ski of skis) ski.rotation.x = -0.45 * g
            break
          case 'tail':
            for (const ski of skis) ski.rotation.x = 0.4 * g
            break
          case 'safety':
          case 'critical':
            skis[1].rotation.z = -0.2 * g
            break
          case 'truck':
            for (const ski of skis) ski.rotation.x = -0.25 * g
            skis[0].position.x += 0.06 * g
            skis[1].position.x -= 0.06 * g
            break
        }
      }

      if (boarding) {
        const lift = air ? 0.18 + grabBlend * 0.2 : 0
        const grabTilt = air && grabBlend > 0 ? (lastGrab === 'nose' ? -0.35 : lastGrab === 'tail' ? 0.3 : 0) * grabBlend : 0
        // Roll about the engaged edge and let the nose lead the ollie.
        const roll = THREE.MathUtils.clamp(edge, -0.72, 0.72)
        const ollie = air ? -0.24 * Math.max(0, 1 - air.time / 0.27) * stance : 0
        placeBoard(
          shift * 0.6, 0.02 + 0.13 * Math.abs(Math.sin(roll)) + lift + Math.abs(press.x) * 0.07,
          -press.x * 0.1, roll, 0, ollie + grabTilt + (air ? 0 : press.x * 0.28),
        )
      }

      // ---- Body ----
      // Idle: a slow weight shift and a look around.
      const idle = still && !boarding ? 1 : 0
      const sway = idle * Math.sin(state.time * 0.8) * 0.025
      // Skating moves the weight over the gliding ski; on a rail the body sways with the balance.
      body.rotation.z = incline.x + (rail ? rail.balance * 0.32 : 0) + stride * 0.12 + sway
      const kneeFold = 0.15 + flex * 1.25
      const hipHeight = 0.97 - (THIGH_LENGTH + SHIN_LENGTH) * (1 - Math.cos(kneeFold * 0.55)) * 1.05 - flex * 0.06 - tuck.x * 0.05
      if (boarding) {
        const toeSide = THREE.MathUtils.clamp(edge * 0.9, -0.55, 0.55)
        hips.position.set(-toeSide * 0.14, Math.max(0.4, hipHeight), (1 - 2 * switchLook) * (0.04 + tuck.x * 0.09))
      } else {
        hips.position.set(0, Math.max(0.4, hipHeight), -0.05 - flex * 0.1 - fore.x)
      }
      // Angulation: the hips and spine tilt back against the inclination so the
      // shoulders stay near level and the knees drive into the hill.
      hips.rotation.y = boarding ? -Math.PI / 2 + 0.25 : counter.x * 0.3
      hips.rotation.z = -incline.x * 0.12
      // The back bends in two parts, so a deep crouch or a tuck rounds it.
      const bend = 0.12 + flex * 0.72 + tuck.x * 0.6 + press.x * 0.18 + skateAmount * 0.18 + plow.x * 0.05 + doublePole * dp.crunch
      spine.rotation.x = bend * 0.55
      chest.rotation.x = bend * 0.45 - tuck.x * 0.08
      spine.rotation.z = -incline.x * 0.2
      chest.rotation.z = -incline.x * 0.14
      const upperTwist = boarding
        ? 0.45 - switchLook * 0.78 + look.x * 0.28 + spinLead * 0.5
        : counter.x * 0.7 + spinLead * 0.5 + switchLook * 0.25 + railLook * 0.55 - stride * 0.12
      spine.rotation.y = upperTwist * 0.55
      chest.rotation.y = upperTwist * 0.45
      // Head stays level and looks where the skier is going; up the hill in a tuck.
      const tiltZ = incline.x + hips.rotation.z + spine.rotation.z + chest.rotation.z
      head.rotation.x = -bend * 0.8 - tuck.x * 0.22 + idle * Math.sin(state.time * 0.5) * 0.06
      head.rotation.z = -tiltZ * 0.65
      head.rotation.y = boarding
        ? 0.75 - switchLook * 1.55 + look.x * 0.5 + spinLead * 0.4
        : -counter.x * 0.3 + look.x + spinLead * 0.4 + switchLook * stance * 1.15 * (state.heading > 0 ? 1 : -1) + railLook * 0.4 +
          idle * Math.sin(state.time * 0.37) * 0.35

      fitLegs()

      // ---- Arms ----
      // Targets are in chest space: the shoulders sit at (±0.215, 0.21, 0).
      const breathe = idle * Math.sin(state.time * 1.6) * 0.01
      const handsBack = Math.max(0, Math.min(1, airBlend.x)) * (1 - grabBlend)
      for (let i = 0; i < 2; i++) {
        const side = arms[i].side
        const inside = Math.sign(incline.x) === -side ? 1 : 0 // left hand (side 1) is inside on a left turn (incline < 0)
        const planting = plantSide === side && skiing ? plantWeight : 0
        // Hands forward and a little wide, about belt height, as if holding a tray.
        // In a turn the inside hand reaches forward and down toward the next plant; the outside one stays wide.
        const hand = v1.set(side * (0.31 + (1 - inside) * Math.abs(incline.x) * 0.08), breathe - inside * Math.abs(incline.x) * 0.12, 0.42 + inside * Math.abs(incline.x) * 0.14)
        // Plant: a forward reach and wrist flick, then the hand rides past the planted pole.
        const reachIn = plantSide === side && skiing && plantAge < PLANT_REACH ? smooth(plantAge / PLANT_REACH) : 0
        hand.z += planting * (0.06 + reachIn * 0.06)
        hand.y += planting * 0.04
        hand.x -= side * planting * 0.03
        // Skating: the arm opposite the pushing leg swings forward.
        hand.z -= side * stride * 0.2
        hand.y += Math.abs(stride) * 0.04
        // Racing tuck: fists together in front of the chin, elbows inside the knees.
        hand.lerp(v2.set(side * 0.085, 0.2, 0.36), Math.max(0, Math.min(1, tuck.x)))
        hand.lerp(v2.set(side * 0.38, 0.0, 0.3), brake.x * 0.7)
        hand.lerp(v2.set(side * 0.34, -0.02, 0.44), plow.x * 0.6)
        // Double pole: both arms reach, drive down past the hips, swing back through.
        hand.lerp(v2.set(side * dp.handX, dp.handY, dp.handZ), doublePole)
        hand.lerp(v2.set(side * 0.55, 0.12, 0.15), handsBack)
        // Arms out for balance on a rail; the low side reaches further.
        if (rail) hand.lerp(v2.set(side * (0.62 + Math.max(0, side * rail.balance) * 0.12), 0.18 - side * rail.balance * 0.1, 0.12), Math.min(1, railBlend.x))
        if (rig.firstPerson) {
          // Raise the hands into the first-person view.
          hand.y += 0.36 * (1 - tuck.x)
          hand.z += 0.16
        }
        if (boarding) {
          // Front hand out over the nose, back hand low over the tail; no poles.
          const front = side === 1
          hand.set(front ? 0.42 : -0.32, front ? -0.02 : -0.16, 0.3 + Math.abs(incline.x) * 0.1)
          hand.lerp(v2.set(side * 0.25, -0.08, 0.21), THREE.MathUtils.clamp(tuck.x, 0, 1))
          hand.lerp(v2.set(side * 0.55, 0.16, 0.1), Math.max(handsBack, Math.min(1, railBlend.x)))
          if (rig.firstPerson) hand.y += 0.3
        }
        const handLocal = hand.clone()
        // Pole tip: carried just off the snow behind the boots, planted on a plant,
        // under the arms in a tuck.
        const tipTarget = v3.set(side * 0.44, 0.05, -0.42)
        if (still) tipTarget.set(side * 0.55, 0, 0.15)
        if (planting > 0) tipTarget.lerp(v2.set(side * 0.46, -0.02, Math.max(-0.6, PLANT_AHEAD - speed * Math.max(0, plantAge - PLANT_REACH))), planting)
        if (skateAmount > 0.01) {
          // Each pole plants beside the boots as its arm comes forward, then pushes back.
          const reach = Math.max(0, -side * stride)
          tipTarget.lerp(v2.set(side * 0.5, 0, 0.3 - (1 - reach) * 0.9), skateAmount)
        }
        tipTarget.lerp(v2.set(side * 0.42, dp.tipY, dp.tipZ), doublePole)
        tipTarget.lerp(v2.set(side * 0.22, 0.95, -1.15), Math.max(0, Math.min(1, tuck.x)))
        tipTarget.lerp(v2.set(side * 0.9, 0.3, -0.5), Math.max(0, Math.min(1, Math.max(airBlend.x, railBlend.x))))
        placeArm(i, handLocal, tipTarget.clone())
      }
      if (grabBlend > 0.02 && air) {
        // Reach a point on the equipment so the hand moves with it.
        const grab = lastGrab
        const reachFor = (handIndex: number, skiIndex: number, along: number, sideOffset: number) => {
          const target = boarding
            ? v1.set(sideOffset, 0.035, along).applyMatrix4(boardGroup.matrix)
            : v1.set(sideOffset, 0.06, along).applyQuaternion(skis[skiIndex].quaternion).add(skis[skiIndex].position)
          root.updateMatrixWorld(true)
          const current = root.worldToLocal(arms[handIndex].hand.getWorldPosition(v2))
          target.lerp(current, 1 - grabBlend)
          placeArm(handIndex, target.clone(), v3.set(arms[handIndex].side * 0.9, 0.5, -0.6).clone(), true)
        }
        if (boarding) {
          if (grab === 'truck') {
            reachFor(0, 0, 0.31, -0.12)
            reachFor(1, 1, -0.31, -0.12)
          } else {
            const frontHand = grab === 'nose' || grab === 'mute' || grab === 'japan'
            const along = grab === 'nose' ? 0.62 : grab === 'tail' ? -0.62 : grab === 'japan' ? -0.22 : 0.06
            reachFor(frontHand ? 0 : 1, 0, along, grab === 'safety' || grab === 'japan' ? 0.12 : -0.12)
          }
        } else if (grab === 'truck') {
          reachFor(0, 0, 0.42, 0)
          reachFor(1, 1, 0.42, 0)
        } else {
          const handIndex = grab === 'mute' || grab === 'japan' || grab === 'nose' ? 0 : 1
          const skiIndex = grab === 'mute' || grab === 'safety' ? 1 : grab === 'critical' ? 0 : grab === 'japan' ? 1 : handIndex
          const along = grab === 'nose' ? 0.72 : grab === 'tail' ? -0.62 : grab === 'japan' ? 0.32 : 0.22
          const sideOffset = grab === 'safety' ? -0.07 : grab === 'critical' ? 0.07 : 0
          reachFor(handIndex, skiIndex, along, sideOffset)
        }
      }
      applyFade(dt)
    },
  }
}
