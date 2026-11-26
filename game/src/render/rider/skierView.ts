import * as THREE from 'three'
import { PHYSICS, fallLineHeading, skiFrame, type SkiInput, type SkiState, type SurfaceSample } from '../../sim'
import { ANKLE_IN_SKI, BOARD_BINDINGS, BOARD_BOOT_HEIGHT, FORE_ARM, HIP_SOCKET_DROP, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM, buildRider, type RiderLook } from './skierModel'
import { Spring } from './spring'
import { RiderSnow } from './riderSnow'
import { DOUBLE_POLE_CYCLE, doublePolePose } from './doublePole'
import { applyCrashPose } from './skierCrashPose'
import { applySitPose } from './skierLiftPose'
import type { RiderAsset } from './riderSkin'

export { SKI_GRAPHICS, type RiderLook, type SkiGraphic } from './skierModel'
export { Spring } from './spring'
export { doublePolePose } from './doublePole'

/** `ski` follows the sim; `sit` is on a chair; `stand` is upright on a surface lift. */
export type SkierPose = 'ski' | 'sit' | 'stand'

/** Grip to tip, metres. */
const POLE_REACH = 1.1
const smooth = (t: number) => t * t * (3 - 2 * t)
/** How fast the shown edge eases off when the sim rolls the edge back (per second): softer than going onto it. */
export const EDGE_RELEASE_RATE = 7
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
/** Carving: how far the hips move from the middle of the stance toward the outside ski (0 to 1). */
const OUTSIDE_WEIGHT = -0.15
/** Lean spring, Hz: fast enough to follow the physics lean through a short turn. */
export const INCLINE_HZ = 5.5
/** Smoothing rate of the path's sideways acceleration, 1/s (a time constant of about 40 ms). */
const LEAN_SMOOTH = 25
/** Edge change: the old edge (radians) above which the body holds off crossing over, and below which it crosses fully. */
const CROSSOVER_HOLD = 0.6
const CROSSOVER_EDGE = 0.2
/** Only a guard against a spike in the measured lean, radians (66°). */
const MAX_INCLINE = 1.15
/** How far the chest turns with the skis, from the fall line (0 stays down the hill, 1 follows the skis). */
export const CHEST_FOLLOW = 0.3
/** Most the chest twists off the skis, radians: a waist turns about 65° at most. */
const MAX_COUNTER = 1.15
/** Angulation, as a share of the lean the upper body tilts back out of the turn (low and high edge). */
const ANGULATION_FLAT = 0.15
const ANGULATION_CARVE = 0.45
/** Edge (radians) where angulation starts to build and where it is full. */
const ANGULATION_FROM = 0.22
const ANGULATION_FULL = 0.47
/** How much of the head's roll off level it takes back on snow (it stays near level). */
const HEAD_LEVEL = 0.85
/** Board: the hip sockets' half spread along the board, and the stance's lean off the board normal. */
const BOARD_HIP_HALF = 0.107
const BOARD_TOE_LEAN = 0.05
const BOARD_HEEL_SIT = 0.14
/** Board torso: forward hinge, and the share of the lean the torso keeps on each edge. */
const BOARD_HINGE = 0.2
const BOARD_TORSO_TOE = 0.3
const BOARD_TORSO_HEEL = 0.45
/** Lowest a board rider's hand goes, metres above the snow (root space). */
const BOARD_HAND_FLOOR = 0.14
/**
 * Board: share of the physics lean drawn, and its spring (Hz). The full lean read
 * as too intense on the board (Stu, 2026-11-26): the legs peaked 7° past the
 * physics. At 0.8 they peak just under it; it also settles a little softer
 * than the skier.
 */
export const BOARD_LEAN = 0.8
const BOARD_INCLINE_HZ = 4

/**
 * Share of the lean the upper body tilts back toward the outside ski: a little
 * at a low edge, building to ANGULATION_CARVE once the edge passes about 25°.
 */
export function angulationShare(edge: number): number {
  const t = THREE.MathUtils.clamp((Math.abs(edge) - ANGULATION_FROM) / (ANGULATION_FULL - ANGULATION_FROM), 0, 1)
  return ANGULATION_FLAT + (ANGULATION_CARVE - ANGULATION_FLAT) * smooth(t)
}

/**
 * Board knee bend (radians) for a crouch: about 35° cruising, 50° in a carve and
 * 65° in a tuck. Real riders cruise at 25° to 40°; the old fit squatted at 85°.
 */
export function boardKneeBend(flex: number): number {
  return 0.42 + flex * 0.95
}

/** 0 to 1: how far a board is onto its toe edge (positive edge) or its heel edge. */
const toeSide = (edge: number) => smooth(THREE.MathUtils.clamp(edge / 0.5, 0, 1))
const heelSide = (edge: number) => toeSide(-edge)

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
export function createSkierView(options: { asset?: RiderAsset } = {}): {
  object: THREE.Group
  update: (state: SkiState, input: SkiInput, ground: SurfaceSample | null, pose?: SkierPose, dt?: number) => void
  /** Point between the eyes, for the first-person camera. */
  eye: THREE.Object3D
  /** Hide the head and torso so a first-person camera sees only hands, poles and skis. */
  setFirstPerson: (on: boolean) => void
  setColours: (look: RiderLook) => void
  /** Snow stuck to the clothes (read-only; for tests and tuning). */
  snow: RiderSnow
  /** The rig's named joints and its bind pose, for the clipping check (riderClipping.ts). */
  bones: Record<string, THREE.Bone>
  /** Ski groups, left then right; each carries its boot (the ankle sits at ANKLE_IN_SKI). */
  skis: readonly THREE.Object3D[]
  withRestPose: (fn: () => void) => void
  /** True once the skinned body has replaced the code-built one. */
  readonly skinned: boolean
} {
  const rig = buildRider()
  // A given asset (tests) attaches at once. Otherwise the skinned body loads in
  // the browser; tests and `?noskin` keep the code-built one.
  if (options.asset) rig.attachSkin(options.asset)
  else if (typeof window !== 'undefined' && !new URLSearchParams(window.location.search).has('noskin')) {
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
  /** The edge angle the body shows (radians), eased off the sim's edge. */
  let edgeShown = 0
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
  const boardNose = new THREE.Vector3()
  const boardUp = new THREE.Vector3()
  const boardToe = new THREE.Vector3()
  /**
   * Bend the knees to reach the boots. `boardKnees`: a snowboard boot is soft and
   * turned across the board, so the knee goes over the toes and a little in toward
   * the stance centre (the ski cuff hint bowed the legs out and, in a toe-side lean,
   * flipped the knees back toward the heels).
   */
  const fitLegs = (boardKnees = false) => {
    root.updateMatrixWorld(true)
    hipsInverse.copy(hips.matrixWorld).invert()
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i]
      ankle.copy(ANKLE_IN_SKI).applyQuaternion(leg.ski.quaternion).add(leg.ski.position)
      if (boardKnees) {
        // Root-space direction: the boot's toe, pulled in along the board, a little up.
        boardNose.set(0, 0, 1).applyQuaternion(boardGroup.quaternion)
        boardUp.set(0, 1, 0).applyQuaternion(boardGroup.quaternion)
        cuffKnee.set(0, 0, 1).applyQuaternion(leg.ski.quaternion)
          .addScaledVector(boardNose, -Math.sign(BOARD_BINDINGS[i].z) * 0.25)
          .addScaledVector(boardUp, 0.1)
          .add(ankle)
      } else {
        // A ski boot's cuff is stiff: the shin runs up it, leaning forward over the tip and
        // rolling with the ski onto its edge. Aim the knee one shin length up the cuff, so the
        // leg angulates into the boot instead of folding sideways at the ankle.
        cuffKnee.copy(BOOT_CUFF).applyQuaternion(leg.ski.quaternion).multiplyScalar(SHIN_LENGTH).add(ankle)
      }
      rootToLocal(hips, ankle, ankle)
      rootToLocal(hips, cuffKnee, cuffKnee)
      if (boardKnees) kneeHint.copy(cuffKnee).sub(ankle)
      else kneeHint.copy(cuffKnee).sub(midLeg.copy(leg.thigh.position).add(ankle).multiplyScalar(0.5))
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
    if (stride === 0 && lean !== 0) {
      // Carving, the weight rides the outside ski (the left one, index 0, in a right turn).
      const outside = skis[lean > 0 ? 0 : 1]
      glideAnkle.copy(ANKLE_IN_SKI).applyQuaternion(outside.quaternion).add(outside.position)
      x += (glideAnkle.x - ankleMid.x) * OUTSIDE_WEIGHT * Math.min(1, Math.abs(lean) / 0.6)
    }
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

  /**
   * The board's own stance, in board space: the hips above the middle of the two
   * bindings at the height the knee bend asks for (the legs splay along the board,
   * so that is less than a skier's), with the leg line leaning `lean` off the board
   * normal toward the toe edge (negative: back over the heels). The board's roll
   * already carries most of the lean, so the body pivots about the edge in use, not
   * about the board's centre. `fore` shifts the hips toward the nose; `lift` (air)
   * is how far the board has come up under the body, so the knees fold to meet it.
   */
  const placeBoardHips = (flex: number, lean: number, fore: number, lift: number) => {
    boardUp.set(0, 1, 0).applyQuaternion(boardGroup.quaternion)
    boardToe.set(-1, 0, 0).applyQuaternion(boardGroup.quaternion)
    boardNose.set(0, 0, 1).applyQuaternion(boardGroup.quaternion)
    ankleMid.set(0, 0, 0)
    for (const boot of skis) ankleMid.add(v1.copy(ANKLE_IN_SKI).applyQuaternion(boot.quaternion).add(boot.position))
    ankleMid.multiplyScalar(0.5)
    const halfSpan = Math.abs(v1.sub(ankleMid).dot(boardNose))
    const along = Math.max(0, halfSpan - BOARD_HIP_HALF)
    const knee = boardKneeBend(flex)
    const chord2 = THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 + 2 * THIGH_LENGTH * SHIN_LENGTH * Math.cos(knee)
    const reach = Math.sqrt(Math.max(0.04, chord2 - along * along)) + HIP_SOCKET_DROP
    hipRoot.copy(ankleMid)
      .addScaledVector(boardUp, Math.cos(lean) * reach)
      .addScaledVector(boardToe, Math.sin(lean) * reach)
      .addScaledVector(boardNose, fore)
    hipRoot.y -= lift
    body.updateMatrix()
    hips.position.copy(hipRoot.applyMatrix4(bodyInverse.copy(body.matrix).invert()))
  }

  const earAxis = new THREE.Vector3()
  const crownAxis = new THREE.Vector3()
  /**
   * How far to roll the head about its own forward axis to bring the line between
   * the ears level with the horizon. Call with head.rotation.z at 0; clamped so a
   * flip or a crash never spins the head round.
   */
  const levelHead = () => {
    head.updateWorldMatrix(true, false)
    head.getWorldQuaternion(qInv)
    earAxis.set(1, 0, 0).applyQuaternion(qInv)
    crownAxis.set(0, 1, 0).applyQuaternion(qInv)
    if (crownAxis.y < 0.3) return 0
    return THREE.MathUtils.clamp(Math.atan2(-earAxis.y, crownAxis.y), -0.7, 0.7)
  }

  const handTarget = new THREE.Vector3()
  const handRoot = new THREE.Vector3()
  const elbowHint = new THREE.Vector3()
  const tip = new THREE.Vector3()
  const handWorld = new THREE.Vector3()
  const qWrist = new THREE.Quaternion()
  const qChest = new THREE.Quaternion()
  /** Where a shoulder is in root space right now (the torso must be posed). */
  const shoulderInRoot = (index: number, out: THREE.Vector3) => {
    root.updateMatrixWorld(true)
    return root.worldToLocal(arms[index].shoulder.getWorldPosition(out))
  }
  const thighs = legs.map((leg) => leg.thigh)
  /** A point in `object`'s frame, in root space right now. */
  const pointInRoot = (object: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3) => {
    root.updateMatrixWorld(true)
    return root.worldToLocal(object.localToWorld(out.copy(local)))
  }
  /**
   * Hand target in chest space (or root space when `inRoot`), pole tip in root
   * space. With a `floor` (root-space height, the snow plus the glove's
   * thickness), a root-space hand stays at or above it and the elbow bends up,
   * away from the snow, so an arm lying on the ground does not sink into it.
   */
  const placeArm = (index: number, hand: THREE.Vector3, poleTip: THREE.Vector3, inRoot = false, floor?: number) => {
    const arm = arms[index]
    // Elbows point back and out.
    elbowHint.set(arm.side * 0.6, -0.2, -1)
    if (inRoot) {
      root.updateMatrixWorld(true)
      handTarget.copy(hand)
      if (floor !== undefined) {
        handTarget.y = Math.max(handTarget.y, floor)
        // Root-space up, in chest space: out and up beats back and out on the ground.
        chest.getWorldQuaternion(qChest).invert().multiply(root.quaternion)
        elbowHint.set(0, 1, -0.3).applyQuaternion(qChest)
      }
      rootToLocal(chest, handTarget, handTarget)
    } else handTarget.copy(hand)
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
    bones: rig.bones,
    skis: rig.skis,
    withRestPose: rig.withRestPose,
    get skinned() {
      return rig.skinned
    },
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
          shoulderInRoot,
          pointInRoot,
          thighs,
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
      // The edge the legs and hips show: quick onto the edge, softer off it. The
      // sim rolls the edge off at its full rate when the steer is let go; the hips
      // following that straight snapped back under an upright body (a bump back).
      // Only a let-go eases: while steering (linked turns, an edge change) the skis
      // show the physics edge as it is.
      const letGo = Math.abs(input.steer) < 0.05 && Math.abs(edge) < Math.abs(edgeShown)
      edgeShown = letGo ? edgeShown + (edge - edgeShown) * ease(EDGE_RELEASE_RATE, dt) : edge
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
      // A light smooth (about 40 ms) against the frame-to-frame jitter of the heading.
      pathAccel += ((skiing ? turnRate * horizontal : 0) - pathAccel) * ease(LEAN_SMOOTH, dt)
      const lateralG = pathAccel / PHYSICS.gravity
      // The full lean the physics needs, drawn as it is (it used to be scaled to 78% and
      // capped at 49°, so a 50° carve looked under-leaned). MAX_INCLINE only guards a spike.
      // The lean above is against gravity, but the body hangs off the root, which lies on
      // the slope. On a side-hill or a banked berm the slope already tips the root, so take
      // that roll back out (most of it) or the skier over-leans into banks and tips downhill
      // on traverses.
      const rightX = -Math.cos(state.heading)
      const rightZ = -Math.sin(state.heading)
      const slopeRoll = skiing && ground ? Math.asin(Math.max(-0.6, Math.min(0.6, ground.normal.x * rightX + ground.normal.z * rightZ))) : 0
      // At an edge change the path can start curving the new way while the old edge
      // is still engaged (the edge rolls over at its own rate). The body cannot cross
      // over an edge that is still biting, or the hips swing out past the boots and
      // the thighs lean against the shins: hold the new lean back until the old edge
      // releases (full by CROSSOVER_EDGE).
      const pathLean = stance * Math.sign(lateralG) * Math.min(MAX_INCLINE, Math.atan(Math.abs(lateralG)))
      const edgeLean = stance * edge * 0.15
      const crossing = pathLean * edgeLean < 0
        ? THREE.MathUtils.clamp((CROSSOVER_HOLD - Math.abs(edge)) / (CROSSOVER_HOLD - CROSSOVER_EDGE), 0, 1)
        : 1
      const lean = Math.abs(pathLean * crossing) > Math.abs(edgeLean) ? pathLean * crossing : edgeLean
      const wantIncline = skiing ? lean * (boarding ? BOARD_LEAN : 1) - slopeRoll * 0.8 : 0
      // Fast and near critically damped: the lean follows the physics with little lag.
      incline.step(wantIncline, dt, boarding ? BOARD_INCLINE_HZ : INCLINE_HZ, 0.9)

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
        // Only a turn the rider steers into unweights. Letting go of a small correction
        // also rolls the skis back to their uphill edges (the sim holds the traverse);
        // that is not a new turn, and kicking the crouch there read as a bump back.
        if (edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign && steerSign === edgeSign * stance) {
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

      // Counter-rotation: the upper body keeps facing down the fall line. Aimed from the
      // fall line, not the skis: the chest turns only CHEST_FOLLOW of the way with the
      // skis (less in a hockey stop), so it stays down the hill in short and long turns.
      // Riding switch the skier looks back over a shoulder instead (switchLook).
      let wantCounter = 0
      if (skiing && ground && speed > 1.5 && !boarding && !state.ridingSwitch) {
        const fall = fallLineHeading(ground.normal)
        if (fall !== null) {
          const off = Math.atan2(Math.sin(state.heading - fall), Math.cos(state.heading - fall))
          wantCounter = Math.max(-MAX_COUNTER, Math.min(MAX_COUNTER, off * (1 - (braking ? CHEST_FOLLOW * 0.5 : CHEST_FOLLOW))))
        }
      }
      counter.step(wantCounter, dt, 3.5, 0.85)

      // Pushing on the flat: double-pole when nearly stopped, skate as speed builds.
      const doublePole = Math.max(skate.x * Math.max(0, Math.min(1, (2.4 - speed) / 1.2)), poling.x)
      const skateAmount = Math.max(0, skate.x - doublePole)
      if (skateAmount > 0.01) skatePhase += dt * (4 + speed * 0.9)
      const stride = Math.sin(skatePhase) * skateAmount
      if (doublePole > 0.01) dpPhase = (dpPhase + dt / DOUBLE_POLE_CYCLE) % 1
      const dp = doublePolePose(dpPhase, speed)

      // Athletic base flex, plus terrain absorption, edging, tuck, braking and pop.
      // A board rider cruises taller (about 35° of knee bend) and sits lower on the heel edge.
      let wantCrouch = pose === 'stand' ? 0.12 : still ? (boarding ? 0.15 : 0.22) : boarding ? 0.2 : 0.32
      wantCrouch += Math.abs(incline.x) * 0.3 + (skiing ? Math.min(0.2, state.sink * 0.5) : 0)
      if (boarding && skiing) wantCrouch += heelSide(edge) * 0.12
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
      // The stance opens a little as the lean builds: with the hips leaning over the
      // middle of it, the outside leg extends and the inside leg folds, more the
      // higher the edge (about 12 cm of difference at 45°).
      const halfStance = 0.13 + brake.x * 0.03 + plow.x * 0.14 + skate.x * 0.03 - railBlend.x * 0.04 - tuck.x * 0.015 +
        Math.min(1, Math.abs(incline.x)) * 0.02
      const lead = incline.x * 0.12
      // Skis drift under the outside of the turn so the body can incline.
      const shift = -Math.sin(incline.x) * 0.32
      skis[0].position.set(halfStance + shift, SKI_LIFT, SKI_FORE - lead)
      skis[1].position.set(-halfStance + shift, SKI_LIFT, SKI_FORE + lead)
      // The skis show the physics edge, and the legs lean with them (less a little
      // knee angulation). Only an edge far past the lean is drawn flatter: up to 18°
      // past it when there is hardly any turn (an upright body on hard edges folds
      // the inside knee into the other thigh), 34° once the body leans into a carve.
      // Off the edge (a turn let go) they ease back with `edgeShown` instead of snapping.
      const edgeRoom = 0.32 + 0.28 * THREE.MathUtils.clamp((Math.abs(incline.x) - 0.15) / 0.3, 0, 1)
      const edgeVisual = pose === 'ski' && !air ? Math.sign(edgeShown) * Math.min(Math.abs(edgeShown), Math.abs(incline.x) + edgeRoom) : 0
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

      let boardLift = 0
      if (boarding) {
        const lift = (boardLift = air ? 0.18 + grabBlend * 0.2 : 0)
        const grabTilt = air && grabBlend > 0 ? (lastGrab === 'nose' ? -0.35 : lastGrab === 'tail' ? 0.3 : 0) * grabBlend : 0
        // Roll about the engaged edge (the physics edge) and let the nose lead the ollie.
        const roll = THREE.MathUtils.clamp(edge, -1, 1)
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
      // The whole body leans with the physics (about the snow under the skis or board).
      body.rotation.z = incline.x + (rail ? rail.balance * 0.32 : 0) + stride * 0.12 + sway
      const bend = 0.12 + flex * 0.72 + tuck.x * 0.6 + press.x * 0.18 + skateAmount * 0.18 + plow.x * 0.05 + doublePole * dp.crunch
      legFollow += ((skiing ? 1 : 0) - legFollow) * ease(10, dt)
      if (boarding) {
        // Facing the toes, open a little toward the nose. In the hips' frame +Z is
        // now the toe edge and +X the nose, so leaning across the board is about X.
        hips.rotation.y = -Math.PI / 2 + 0.25
        const foreAft = (1 - 2 * switchLook) * (0.04 + tuck.x * 0.09)
        // The legs' line leans off the board normal by the lean the board's roll does
        // not take, plus a little toward the toes (shins into the tongues) or back over
        // the heels (sitting into the highbacks).
        const roll = boardGroup.rotation.z
        const legLean = THREE.MathUtils.clamp(incline.x - roll, -0.45, 0.45) * legFollow +
          (toeSide(edge) * BOARD_TOE_LEAN - heelSide(edge) * BOARD_HEEL_SIT) * legFollow
        placeBoardHips(flex, legLean, foreAft, boardLift)
        // Torso: a forward hinge plus a share of the lean, so on the toe edge it stays
        // fairly upright over the toes and on the heel edge the chest comes over the knees.
        const keep = incline.x > 0 ? BOARD_TORSO_TOE : BOARD_TORSO_HEEL
        const torso = BOARD_HINGE + flex * 0.35 + tuck.x * 0.6 + press.x * 0.18 + keep * incline.x - incline.x
        spine.rotation.x = torso * 0.55
        chest.rotation.x = torso * 0.45 - tuck.x * 0.08
      } else {
        const hipBack = 0.05 + flex * 0.1 + fore.x
        hips.position.set(0, skiHipHeight(flex, tuck.x, hipBack), -hipBack)
        // Angulation: the hips, spine and chest tilt back against the lean, toward the
        // outside ski, so the shoulders stay nearer level and the knees drive into the hill.
        const counterTilt = -incline.x * angulationShare(edge)
        hips.rotation.y = counter.x * 0.3
        hips.rotation.z = counterTilt * 0.25
        // The back bends in two parts, so a deep crouch or a tuck rounds it.
        spine.rotation.x = bend * 0.55
        chest.rotation.x = bend * 0.45 - tuck.x * 0.08
        spine.rotation.z = counterTilt * 0.45
        chest.rotation.z = counterTilt * 0.3
      }
      const upperTwist = boarding
        ? 0.45 - switchLook * 0.78 + look.x * 0.28 + spinLead * 0.5
        : counter.x * 0.7 + spinLead * 0.5 + switchLook * 0.25 + railLook * 0.55 - stride * 0.12
      spine.rotation.y = upperTwist * 0.55
      chest.rotation.y = upperTwist * 0.45
      // Head looks where the skier is going; up the hill in a tuck.
      head.rotation.x = boarding
        ? -Math.max(0, spine.rotation.x + chest.rotation.x) * 0.8 - tuck.x * 0.22
        : -bend * 0.8 - tuck.x * 0.22 + idle * Math.sin(state.time * 0.5) * 0.06
      head.rotation.y = boarding
        ? 0.75 - switchLook * 1.55 + look.x * 0.5 + spinLead * 0.4
        : -counter.x * 0.3 + look.x + spinLead * 0.4 + switchLook * stance * 1.15 * (state.heading > 0 ? 1 : -1) + railLook * 0.4 +
          idle * Math.sin(state.time * 0.37) * 0.35
      // On snow the head stays near level with the horizon, whatever the body does.
      head.rotation.z = levelHead() * HEAD_LEVEL * legFollow

      if (!boarding && legFollow > 0.001) placeHipsOverSkis(edgeVisual, skateAmount > 0.01 ? stride : 0, legFollow)
      fitLegs(boarding)

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
          // Low over the edge in a carve, never into the snow.
          if (skiing) {
            pointInRoot(chest, hand, handRoot)
            if (handRoot.y < BOARD_HAND_FLOOR) {
              handRoot.y = BOARD_HAND_FLOOR
              rootToLocal(chest, handRoot, hand)
            }
          }
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
