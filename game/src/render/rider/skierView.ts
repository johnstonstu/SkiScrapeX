import * as THREE from 'three'
import { PHYSICS, fallLineHeading, skiFrame, type SkiInput, type SkiState, type SurfaceSample } from '../../sim'
import { ANKLE_IN_SKI, BOARD_BINDINGS, BOARD_BOOT_HEIGHT, FORE_ARM, HIP_SOCKET_DROP, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM, buildRider, type RiderLook } from './skierModel'
import { Spring } from './spring'
import { RiderSnow } from './riderSnow'
import { DOUBLE_POLE_CYCLE, doublePolePose } from './doublePole'
import { applyCrashPose } from './skierCrashPose'
import { applySitPose } from './skierLiftPose'

export { SKI_GRAPHICS, type RiderLook, type SkiGraphic } from './skierModel'
export { Spring } from './spring'
export { doublePolePose } from './doublePole'

/** `ski` follows the sim; `sit` is on a chair; `stand` is upright on a surface lift. */
export type SkierPose = 'ski' | 'sit' | 'stand'

/** Grip to tip, metres. */
const POLE_REACH = 1.1
const smooth = (t: number) => t * t * (3 - 2 * t)
/** Turn pole plant: where the tip strikes (metres ahead of the boots) and how long the reach takes. */
const PLANT_AHEAD = 0.75
const PLANT_REACH = 0.12
/** Boot cuff direction in the ski's frame: up with 15° of forward lean (ski boots are built leaning). */
export const BOOT_CUFF = new THREE.Vector3(0, Math.cos(0.26), Math.sin(0.26))
/** How far the wrist bends toward the pole shaft (0 rigid, 1 fully in line). */
const WRIST_FOLLOW = 0.35
/** In a turn the legs lean this much less than the edged skis (knee angulation), radians. */
const KNEE_ANGULATION = 0.12
/** Skating: how far the hips move from the middle of the stance over the gliding ski (0 to 1). */
const SKATE_WEIGHT_SHIFT = 0.7
/** How far below the chest's rest height the carried hands sit, metres. */
const HAND_DROP = 0.1
/** Skis ride this far above the root; the ankle sits ANKLE_IN_SKI above that. */
const SKI_LIFT = 0.03
/** Ski stance fore/aft offset of the boots (the ankle sits ANKLE_IN_SKI.z further on). */
const SKI_FORE = 0.04

/**
 * Hips height for a skier from how bent the knees should be: the hip-to-ankle
 * chord at that knee angle, less how far the hips sit back of the boots. About
 * 53° of knee bend standing, 60° cruising, 70° in a carve and 110° in a full
 * tuck, so a crouch reads as a crouch and the legs have room to angulate into
 * a turn without the thighs swinging out flat. (The old fit put the knees
 * near 85° all the time, a permanent squat.)
 */
export function skiHipHeight(flex: number, tuck: number, hipBack: number): number {
  const kneeBend = 0.7 + flex * 1.05 + tuck * 0.2
  const chord = Math.sqrt(THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 + 2 * THIGH_LENGTH * SHIN_LENGTH * Math.cos(kneeBend))
  const back = hipBack + SKI_FORE + ANKLE_IN_SKI.z
  return SKI_LIFT + ANKLE_IN_SKI.y + HIP_SOCKET_DROP + Math.sqrt(Math.max(0.01, chord * chord - back * back))
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
  /** Snow stuck to the clothes (read-only; for tests and tuning). */
  snow: RiderSnow
} {
  const rig = buildRider()
  // The skinned body loads in the browser; tests and `?noskin` keep the code-built one.
  if (typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('noskin')) {
    rig.loadSkin().catch((error: unknown) => console.error('Rider model failed to load; keeping the code-built rider.', error))
  }
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
  const poling = new Spring()
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
  /** Shoulder give when a planted tip bites; decays via spring. */
  const plantBite = new Spring()
  /** Arms flare on landing; decays via spring. */
  const armFlare = new Spring()
  /** Loose gear (drawstrings, pom, pack, hood) lagging the body's acceleration. */
  const packBounce = new Spring()
  const snow = new RiderSnow()
  const rawAccel = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const lastVelocity = new THREE.Vector3()
  const accel = new THREE.Vector3()
  const bodyUp = new THREE.Vector3()
  let grabBlend = 0
  let lastGrab: string | null = null
  let wasAir = false
  let lastVy = 0
  /** Turn pole plant: seconds since the tip reached for the snow, and when it let go. */
  let plantAge = 10
  let plantRelease = 0
  let plantSide = 1
  let plantBit = false
  let dpPhase = 0
  let lastEdgeSign = 0
  let lastSteerSign = 0
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
  /** 1 while the hips follow the skis' lean (on snow), easing to 0 in the air and on rails. */
  let legFollow = 0
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

  const hingeX = new THREE.Vector3()
  const hingeY = new THREE.Vector3()
  const hingeZ = new THREE.Vector3()
  const hingeBasis = new THREE.Matrix4()
  /**
   * Two-bone IK for a knee: a hinge, not a ball joint. The thigh twists so its
   * front (local +Z, the kneecap in the bind pose) faces the bend, and the shin
   * only rotates about the thigh's local X. `solve` leaves the twist to
   * setFromUnitVectors, so the shin bent sideways off the thigh (up to ~45° in
   * a carve) and the skinned trousers folded across the knee.
   */
  const solveKnee = (upper: THREE.Object3D, lower: THREE.Object3D, target: THREE.Vector3, l1: number, l2: number, bendHint: THREE.Vector3) => {
    const to = v1.copy(target).sub(upper.position)
    const d = THREE.MathUtils.clamp(to.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    const dir = to.normalize()
    const bend = hint.copy(bendHint).addScaledVector(dir, -bendHint.dot(dir))
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1)
    bend.normalize()
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
    const mid = v2.copy(dir).multiplyScalar(a).addScaledVector(bend, h)
    // Bone hangs down -Y, so +Y runs knee to hip; +Z is the kneecap, square to the thigh.
    hingeY.copy(mid).normalize().negate()
    hingeZ.copy(bend).addScaledVector(hingeY, -bend.dot(hingeY)).normalize()
    hingeX.crossVectors(hingeY, hingeZ)
    upper.quaternion.setFromRotationMatrix(hingeBasis.makeBasis(hingeX, hingeY, hingeZ))
    // Shin in thigh space lies in its YZ plane; flexion swings it back (-Z) about +X.
    const shin = v3.copy(dir).multiplyScalar(d).sub(mid).applyQuaternion(qInv.copy(upper.quaternion).invert())
    lower.quaternion.setFromAxisAngle(xAxis, Math.max(0, Math.atan2(-shin.z, -shin.y)))
  }

  /** Root-space point to the local space of `object` (root's matrices must be current). */
  const rootToLocal = (object: THREE.Object3D, point: THREE.Vector3, out: THREE.Vector3) =>
    object.worldToLocal(root.localToWorld(out.copy(point)))

  const ankle = new THREE.Vector3()
  const kneeHint = new THREE.Vector3()
  const hipsInverse = new THREE.Matrix4()
  const cuffKnee = new THREE.Vector3()
  const midLeg = new THREE.Vector3()
  const fitLegs = () => {
    root.updateMatrixWorld(true)
    hipsInverse.copy(hips.matrixWorld).invert()
    for (const leg of legs) {
      ankle.copy(ANKLE_IN_SKI).applyQuaternion(leg.ski.quaternion).add(leg.ski.position)
      // A ski boot's cuff is stiff: the shin runs up it, leaning forward over the tip and
      // rolling with the ski onto its edge. Aim the knee one shin length up the cuff, so the
      // leg angulates into the boot instead of folding sideways at the ankle.
      cuffKnee.copy(BOOT_CUFF).applyQuaternion(leg.ski.quaternion).multiplyScalar(SHIN_LENGTH).add(ankle)
      rootToLocal(hips, ankle, ankle)
      rootToLocal(hips, cuffKnee, cuffKnee)
      kneeHint.copy(cuffKnee).sub(midLeg.copy(leg.thigh.position).add(ankle).multiplyScalar(0.5))
      solveKnee(leg.thigh, leg.knee, ankle, THIGH_LENGTH, SHIN_LENGTH, kneeHint)
    }
  }

  const ankleMid = new THREE.Vector3()
  const glideAnkle = new THREE.Vector3()
  const hipRoot = new THREE.Vector3()
  const bodyInverse = new THREE.Matrix4()
  /**
   * Put the hips where the legs can incline with the skis. The body's lean spring
   * lags and leans less than the edged skis, so with the hips left over the boots
   * the shins ran up the edged cuffs while the thighs leaned back out of the turn,
   * a sideways Z at every knee. Here the ankle-to-hip line swings round the boots
   * to lean with the skis (less a little knee angulation), keeping its length so
   * the knee bend the stance asked for stays the same; skating, the hips ride over
   * the gliding ski. `weight` blends it in and out (rails and air keep the old fit).
   */
  const placeHipsOverSkis = (skiLean: number, stride: number, weight: number) => {
    ankleMid.set(0, 0, 0)
    for (const ski of skis) ankleMid.add(v1.copy(ANKLE_IN_SKI).applyQuaternion(ski.quaternion).add(ski.position))
    ankleMid.multiplyScalar(0.5)
    const reach = Math.max(0.3, hips.position.y - ankleMid.y)
    body.updateMatrix()
    hipRoot.copy(hips.position).applyMatrix4(body.matrix)
    const lean = skiLean - Math.sign(skiLean) * Math.min(Math.abs(skiLean), KNEE_ANGULATION)
    let x = ankleMid.x - Math.sin(lean) * reach
    const y = ankleMid.y + Math.cos(lean) * reach
    if (stride !== 0) {
      // stride > 0: the left leg (index 0) pushes, so the weight rides the right ski.
      const glide = skis[stride > 0 ? 1 : 0]
      glideAnkle.copy(ANKLE_IN_SKI).applyQuaternion(glide.quaternion).add(glide.position)
      x += (glideAnkle.x - x) * SKATE_WEIGHT_SHIFT * Math.min(1, Math.abs(stride))
    }
    hipRoot.x += (x - hipRoot.x) * weight
    hipRoot.y += (y - hipRoot.y) * weight
    hips.position.copy(hipRoot.applyMatrix4(bodyInverse.copy(body.matrix).invert()))
  }

  const handTarget = new THREE.Vector3()
  const elbowHint = new THREE.Vector3()
  const tip = new THREE.Vector3()
  const handWorld = new THREE.Vector3()
  const qWrist = new THREE.Quaternion()
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
    tip.applyQuaternion(qInv).normalize()
    // The wrist bends part of the way toward the pole, so the grip follows the shaft.
    qWrist.setFromUnitVectors(down, tip)
    arm.hand.quaternion.identity().slerp(qWrist, WRIST_FOLLOW)
    arm.pole.quaternion.setFromUnitVectors(down, tip.applyQuaternion(qInv.copy(arm.hand.quaternion).invert()))
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
    snow,
    eye: rig.eye,
    setFirstPerson: rig.setFirstPerson,
    setColours: rig.setColours,
    update(state, input, ground, pose = 'ski', dt = 1 / 60) {
      const boarding = rig.boarding
      // World pickups hide attached gear until the piece is collected.
      const showSkis = !state.missingSkis
      const showPoles = !boarding && !state.missingPoles
      for (const ski of skis) ski.visible = showSkis && !boarding
      boardGroup.visible = boarding && showSkis
      for (const arm of arms) arm.pole.visible = showPoles
      const up = ground && pose === 'ski' ? ground.normal : { x: 0, y: 1, z: 0 }
      const frame = skiFrame(state.heading, up)
      basis.makeBasis(
        ax.set(-frame.side.x, -frame.side.y, -frame.side.z),
        ay.set(frame.up.x, frame.up.y, frame.up.z),
        az.set(frame.forward.x, frame.forward.y, frame.forward.z),
      )
      qBase.setFromRotationMatrix(basis)
      root.quaternion.copy(qBase)
      const powderBob =
        pose === 'ski' && state.grounded && state.unweight > 0
          ? Math.sin((1 - state.unweight / Math.max(PHYSICS.powderUnweightTime, 0.01)) * Math.PI) * 0.09
          : 0
      root.position.set(
        state.x,
        state.y - (pose === 'ski' ? state.sink * 0.9 : 0) + powderBob,
        state.z,
      )
      const air = pose === 'ski' ? state.air : null
      const crashed = pose === 'ski' && state.crashed > 0
      const rail = pose === 'ski' && !crashed ? state.rail : null
      const wind = pose === 'ski' && !crashed ? THREE.MathUtils.clamp((state.speed - 0.5) / 24, 0, 1) : 0
      const edgePull = THREE.MathUtils.clamp(state.edgeAngle, -0.8, 0.8)
      if (wasAir && !air && pose === 'ski' && !crashed) clothBack.v -= THREE.MathUtils.clamp(-lastVy, 0, 9) * 0.04
      const side = clothSide.step(wind * (-edgePull * 0.038 + Math.sin(state.time * 17) * 0.013), dt, 3.4, 0.66)
      const back = clothBack.step(-wind * (0.033 + Math.sin(state.time * 22) * 0.012), dt, 4.1, 0.58)
      rig.poseCloth(side, back)
      // Body acceleration (world), lightly smoothed against the fixed-step sim's frame jitter
      // and clamped so a respawn does not fling the cloth.
      rawAccel.set(state.vx, state.vy, state.vz).sub(lastVelocity).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 25)
      lastVelocity.set(state.vx, state.vy, state.vz)
      accel.lerp(rawAccel, ease(25, dt))
      velocity.set(state.vx, state.vy, state.vz)
      rig.stepCloth(accel, velocity, dt)
      snow.step(state, dt)
      rig.setWeather(state.time, Math.min(1, state.speed / 20), snow)
      packBounce.step(-accel.dot(bodyUp.set(0, 1, 0).applyQuaternion(root.quaternion)) * 0.0012, dt, 2.4, 0.3)
      rig.bouncePack(packBounce.x)

      const nextMode: Mode = pose === 'sit' ? 'sit' : pose === 'stand' ? 'stand' : crashed ? 'crash' : rail ? 'rail' : 'ski'
      if (nextMode !== mode) startFade(nextMode)

      // Rail entry: crouch → hop-extend while the skis swing onto the feature.
      if (rail && !wasRail) {
        railEntry = 1
        entryTurn = Math.atan2(Math.sin(lastHeading - state.heading), Math.cos(lastHeading - state.heading))
        crouch.v -= 1.6
        crouch.x = Math.min(crouch.x, 0.35)
      }
      wasRail = Boolean(rail)
      lastHeading = state.heading
      railEntry = Math.max(0, railEntry - dt / 0.28)
      if (railEntry > 0) {
        const hop = Math.sin(railEntry * Math.PI)
        qFlip.setFromAxisAngle(ay.set(0, 1, 0), entryTurn * railEntry * railEntry)
        root.quaternion.multiply(qFlip)
        root.position.y += hop * 0.34
        crouch.x += hop * 0.22
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
        applySitPose({
          ridePhase,
          boarding,
          hips,
          spine,
          chest,
          head,
          skis,
          placeBoard,
          placeArm,
          fitLegs,
          scratch: v1,
        })
        applyFade(dt)
        rig.applyCloth()
        return
      }
      if (crashed) {
        applyCrashPose({
          state,
          boarding,
          hips,
          spine,
          chest,
          head,
          skis,
          crouch,
          placeBoard,
          placeArm,
          fitLegs,
        })
        applyFade(dt)
        rig.applyCloth()
        return
      }

      // ---- Read the sim ----
      const skiing = pose === 'ski' && state.grounded && !rail && !air
      const stance = state.ridingSwitch ? -1 : 1
      const speed = state.speed
      const still = skiing && speed < 0.5
      const tucked = skiing && state.tuck && speed >= PHYSICS.skateMaxSpeed
      // A half tuck when cruising, folding all the way down as the speed builds.
      const tuckDepth = tucked ? 0.68 + 0.32 * Math.min(1, Math.max(0, (speed - 8) / 9)) : 0
      // A forward tap at cruising speed: one double-pole stroke.
      const poleStroke = skiing && state.poling && !boarding
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
      // The lean above is against gravity, but the body hangs off the root, which lies on
      // the slope. On a side-hill or a banked berm the slope already tips the root, so take
      // that roll back out (most of it) or the skier over-leans into banks and tips downhill
      // on traverses.
      const rightX = -Math.cos(state.heading)
      const rightZ = -Math.sin(state.heading)
      const slopeRoll = skiing && ground ? Math.asin(Math.max(-0.6, Math.min(0.6, ground.normal.x * rightX + ground.normal.z * rightZ))) : 0
      const wantIncline = skiing
        ? stance * Math.sign(lateralG || edge) * Math.min(0.85, Math.max(Math.atan(Math.abs(lateralG)) * 0.78, Math.abs(edge) * 0.15)) - slopeRoll * 0.8
        : 0
      incline.step(wantIncline, dt, 2.6, 0.92)

      // Steer flip plants first (hand leads the turn); edge flip still unweights the legs.
      const edgeSign = Math.abs(edge) > 0.12 ? Math.sign(edge) : 0
      const steerSign = Math.abs(input.steer) > 0.22 ? Math.sign(input.steer) : 0
      if (skiing && !tucked && !skating && !braking && speed > 3) {
        if (!boarding && steerSign !== 0 && lastSteerSign !== 0 && steerSign !== lastSteerSign) {
          plantAge = 0
          plantBit = false
          plantRelease = 10
          // Positive steer = right turn → plant with the right hand (side -1).
          plantSide = steerSign > 0 ? -1 : 1
        }
        if (edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign) {
          crouch.v -= (boarding ? 0.8 : 1.1) * Math.min(1, speed / 10)
        }
      }
      if (steerSign !== 0) lastSteerSign = steerSign
      if (edgeSign !== 0) lastEdgeSign = edgeSign
      plantAge = Math.min(10, plantAge + dt)
      // The tip stays where it struck the snow while the skier passes it; let go once it is behind the boots.
      const plantTipZ = PLANT_AHEAD - speed * Math.max(0, plantAge - PLANT_REACH)
      if (plantRelease === 10 && plantAge < 5 && (plantTipZ < -0.45 || plantAge > 0.6)) plantRelease = plantAge
      const plantWeight =
        plantAge < PLANT_REACH ? smooth(plantAge / PLANT_REACH) : plantAge < plantRelease ? 1 : 1 - smooth(Math.min(1, (plantAge - plantRelease) / 0.22))
      // Tip bite: kick the shoulder and a little crouch when the plant lands.
      if (!plantBit && plantAge >= PLANT_REACH && plantAge < PLANT_REACH + 0.08 && plantWeight > 0.5) {
        plantBit = true
        plantBite.v -= 2.4
        crouch.v -= 0.35
        counter.v += plantSide * 0.8
      }
      plantBite.step(0, dt, 5.5, 0.72)

      // Takeoff extends; landing kicks the crouch spring down and it rebounds.
      if (air && !wasAir) crouch.v -= boarding ? 1.6 : 2.2
      if (!air && wasAir) {
        const impact = 1.4 + Math.min(10, Math.max(0, -lastVy)) * 0.4
        crouch.v += impact
        armFlare.v += 1.2 + Math.min(4, Math.max(0, -lastVy)) * 0.35
      }
      armFlare.step(0, dt, 3.2, 0.78)
      wasAir = Boolean(air)
      lastVy = state.vy

      // The sim keeps the grab name for scoring after the button is released.
      const grabbing = Boolean(air?.grab && input.grab)
      if (grabbing && air?.grab) lastGrab = air.grab
      grabBlend += ((grabbing ? 1 : 0) - grabBlend) * ease(14, dt)
      tuck.step(tuckDepth, dt, 1.9, 0.9)
      poling.step(poleStroke ? 1 : 0, dt, 3.2, 0.9)
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
      const doublePole = Math.max(skate.x * Math.max(0, Math.min(1, (2.4 - speed) / 1.2)), poling.x)
      const skateAmount = Math.max(0, skate.x - doublePole)
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
        tucked ? (boarding ? 0.8 : 1) * tuckDepth : 0,
        braking ? (plowing ? 0.38 : 0.6) : 0,
        // Double-poling is done from the waist on fairly straight legs (a dip on each push, below).
        skating ? 0.4 * (1 - doublePole) : 0,
        charging ? 0.45 + state.popCharge * 0.45 : 0,
        air ? 0.42 + grabBlend * 0.45 : 0,
        rail ? 0.42 : 0,
      )
      wantCrouch += doublePole * dp.crunch * 0.3
      crouch.step(Math.min(1.05, wantCrouch), dt, 3, 0.6)
      const flex = Math.max(0, Math.min(1.1, crouch.x))
      // Hips back in a tuck and a hockey stop, forward over the skis in a press.
      fore.step(tuck.x * 0.16 + brake.x * 0.05 - press.x * 0.05 + skate.x * 0.03, dt, 2.5, 0.9)

      // ---- Skis ----
      const halfStance = 0.13 + brake.x * 0.03 + plow.x * 0.14 + skate.x * 0.03 - railBlend.x * 0.04 - tuck.x * 0.015
      const lead = incline.x * 0.12
      // Skis drift under the outside of the turn so the body can incline.
      const shift = -Math.sin(incline.x) * 0.32
      skis[0].position.set(halfStance + shift, SKI_LIFT, SKI_FORE - lead)
      skis[1].position.set(-halfStance + shift, SKI_LIFT, SKI_FORE + lead)
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
          skis[i].position.x += s * 0.2 * push
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
      if (boarding) {
        const kneeFold = 0.15 + flex * 1.25
        const hipHeight = 0.97 - (THIGH_LENGTH + SHIN_LENGTH) * (1 - Math.cos(kneeFold * 0.55)) * 1.05 - flex * 0.06 - tuck.x * 0.05
        const toeSide = THREE.MathUtils.clamp(edge * 0.9, -0.55, 0.55)
        hips.position.set(-toeSide * 0.14, Math.max(0.4, hipHeight), (1 - 2 * switchLook) * (0.04 + tuck.x * 0.09))
      } else {
        const hipBack = 0.05 + flex * 0.1 + fore.x
        hips.position.set(0, skiHipHeight(flex, tuck.x, hipBack), -hipBack)
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

      if (!boarding) {
        legFollow += ((skiing ? 1 : 0) - legFollow) * ease(10, dt)
        if (legFollow > 0.001) placeHipsOverSkis(edgeVisual, skateAmount > 0.01 ? stride : 0, legFollow)
      }
      fitLegs()

      // ---- Arms ----
      // Targets are in chest space: the shoulders sit at (±0.215, 0.21, 0).
      const cruise = skiing && !still && !tucked && !braking && !skating && speed > 1 && speed < 14 ? 1 : 0
      const breathe = idle * Math.sin(state.time * 1.6) * 0.01 + cruise * Math.sin(state.time * 1.1) * 0.006
      const idleHand =
        idle * 0.04 * Math.sin(state.time * 0.55) +
        cruise * 0.025 * Math.sin(state.time * 0.9 + 0.4)
      const handsBack = Math.max(0, Math.min(1, airBlend.x)) * (1 - grabBlend)
      for (let i = 0; i < 2; i++) {
        const side = arms[i].side
        const inside = Math.sign(incline.x) === -side ? 1 : 0 // left hand (side 1) is inside on a left turn (incline < 0)
        const planting = plantSide === side && skiing ? plantWeight : 0
        // Hands forward and a little wide, about belt height, as if holding a tray
        // (HAND_DROP below the chest keeps them there over the athletic stance).
        // In a turn the inside hand reaches forward and down toward the next plant; the outside one stays wide.
        const hand = v1.set(
          side * (0.31 + (1 - inside) * Math.abs(incline.x) * 0.08) + side * idleHand * 0.35,
          -HAND_DROP + breathe - inside * Math.abs(incline.x) * 0.12 + idle * Math.sin(state.time * 1.3 + side) * 0.012,
          0.42 + inside * Math.abs(incline.x) * 0.14 + cruise * Math.sin(state.time * 0.7 + side) * 0.02,
        )
        // Plant: a forward reach and wrist flick, then the hand rides past the planted pole.
        const reachIn = plantSide === side && skiing && plantAge < PLANT_REACH ? smooth(plantAge / PLANT_REACH) : 0
        hand.z += planting * (0.06 + reachIn * 0.06)
        hand.y -= planting * 0.04
        hand.x -= side * planting * 0.03
        // Bite loads the planting shoulder back and down for a moment.
        if (plantSide === side) {
          hand.y += plantBite.x * 0.05
          hand.z += plantBite.x * 0.04
          hand.x -= side * plantBite.x * 0.03
        }
        // Landing flare: both arms out and a little forward.
        hand.x += side * Math.max(0, armFlare.x) * 0.14
        hand.y += Math.max(0, armFlare.x) * 0.05
        hand.z -= Math.max(0, armFlare.x) * 0.04
        // Deep carve: inside hand drops toward the snow.
        if (skiing && Math.abs(edge) > 0.45) {
          const insideDrop = Math.min(1, (Math.abs(edge) - 0.45) / 0.35)
          if (Math.sign(edge) === side) hand.y -= insideDrop * 0.14
        }
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
        if (rail) {
          const pressAmt = press.x
          // Nose press: arms counterbalance aft; tail press: arms reach forward over the tip.
          const pressX = side * (0.62 + Math.max(0, side * rail.balance) * 0.12 + Math.abs(pressAmt) * 0.08)
          const pressY = 0.18 - side * rail.balance * 0.1 + Math.abs(pressAmt) * 0.06
          const pressZ = 0.12 - pressAmt * 0.22
          hand.lerp(v2.set(pressX, pressY, pressZ), Math.min(1, railBlend.x))
        }
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
      rig.applyCloth()
    },
  }
}
