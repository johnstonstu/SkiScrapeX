import * as THREE from 'three'
import type { SkiState } from '../../sim'
import type { Spring } from './spring'
import { ANKLE_IN_SKI, SHIN_LENGTH, THIGH_LENGTH } from './skierModel'

/** Wrist height for a hand resting on the snow: about half a mitt's thickness, metres. */
const HAND_ON_SNOW = 0.07

/** Furthest a boot may sit from its hip socket: a whisker short of a straight leg, metres. */
const LEG_REACH = (THIGH_LENGTH + SHIN_LENGTH) * 0.98
const ORIGIN = new THREE.Vector3()

/**
 * The yard-sale throws the skis about while the tumble moves the hips, and a
 * ski further from its hip than the leg is long left the shin hanging in the
 * air off its boot (up to 25 cm in a hard tumble). Pull any such ski straight
 * back toward the hip until the leg just reaches it; skis in reach stay put.
 * Skis are in root space.
 */
function keepSkisInReach(
  skis: readonly THREE.Object3D[],
  thighs: readonly THREE.Object3D[],
  pointInRoot: (object: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3,
) {
  const socket = new THREE.Vector3()
  const toAnkle = new THREE.Vector3()
  skis.forEach((ski, i) => {
    pointInRoot(thighs[i], ORIGIN, socket)
    toAnkle.copy(ANKLE_IN_SKI).applyQuaternion(ski.quaternion).add(ski.position).sub(socket)
    const distance = toAnkle.length()
    if (distance > LEG_REACH) ski.position.addScaledVector(toAnkle, (LEG_REACH - distance) / distance)
  })
}

/**
 * Torso parts that must stay on top of the snow (y = 0 in root space), as a
 * point in the part's bone frame and the clothed radius around it, metres.
 */
const TORSO_CLEARANCE: { part: 'hips' | 'spine' | 'chest' | 'head'; at: THREE.Vector3; radius: number }[] = [
  // Sized for the bulkiest outfit (parkrat jacket, cap brim).
  { part: 'hips', at: new THREE.Vector3(0, 0, 0), radius: 0.18 },
  { part: 'hips', at: new THREE.Vector3(0, -0.12, -0.04), radius: 0.2 },
  { part: 'spine', at: new THREE.Vector3(0, 0.1, 0), radius: 0.18 },
  { part: 'chest', at: new THREE.Vector3(0, 0.12, 0), radius: 0.19 },
  { part: 'head', at: new THREE.Vector3(0, 0.12, 0), radius: 0.18 },
]

/** How far the hips must rise so no torso part (or shoulder) dips into the snow. */
function torsoLift(args: {
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  pointInRoot: (object: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3
  shoulderInRoot: (hand: number, out: THREE.Vector3) => THREE.Vector3
}): number {
  const p = new THREE.Vector3()
  let lift = 0
  for (const { part, at, radius } of TORSO_CLEARANCE) lift = Math.max(lift, radius - args.pointInRoot(args[part], at, p).y)
  for (let hand = 0; hand < 2; hand++) lift = Math.max(lift, SHOULDER_RADIUS - args.shoulderInRoot(hand, p).y)
  return lift
}
const SHOULDER_RADIUS = 0.13
/** Middle of the head in its bone frame, and how far (across the snow) a hand keeps from it, metres. */
const HEAD_CENTRE = new THREE.Vector3(0, 0.12, 0)
const HAND_HEAD_GAP = 0.32

/** Seconds before the crash ends that the rider starts getting up. */
export const GET_UP = 0.85
/** 0 lying down, 1 crouched on the gear ready to stand. */
export function getUpShare(crashedLeft: number): number {
  return THREE.MathUtils.clamp(1 - crashedLeft / GET_UP, 0, 1)
}
/** Hips (root space) at the end of the get-up: a low crouch over the gear. */
const GET_UP_HIPS = new THREE.Vector3(0.02, 0.58, -0.12)
const v = new THREE.Vector3()
const q = new THREE.Quaternion()

/** Yard-sale tumble then gather; same numbers as the former inline crash branch. */
export function applyCrashPose(args: {
  state: SkiState
  boarding: boolean
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  skis: THREE.Object3D[]
  crouch: Spring
  placeBoard: (x: number, y: number, z: number, edge: number, yaw?: number, pitch?: number) => void
  placeArm: (hand: number, handPos: THREE.Vector3, tip: THREE.Vector3, inRoot?: boolean, floor?: number) => void
  shoulderInRoot: (hand: number, out: THREE.Vector3) => THREE.Vector3
  pointInRoot: (object: THREE.Object3D, local: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3
  /** Left then right thigh bones (their origins are the hip sockets). */
  thighs: readonly THREE.Object3D[]
  fitLegs: () => void
}) {
  const { state, boarding, hips, spine, chest, head, skis, crouch, placeBoard, placeArm, shoulderInRoot, fitLegs } = args
  const hard = THREE.MathUtils.clamp(state.crashSpeed / 18, 0, 1)
  const sliding = Math.min(1, Math.hypot(state.vx, state.vz) / 8)
  const tumble = hard * Math.max(sliding, 0.35) * Math.max(0, 1 - state.crashAge / 1.15)
  const impactOff = Math.atan2(
    Math.sin(state.crashHeading - state.heading),
    Math.cos(state.crashHeading - state.heading),
  )
  const roll = Math.sin(state.crashAge * 9.5) * tumble + Math.sin(impactOff) * tumble * 0.55
  const pitch = Math.cos(state.crashAge * 7.2) * tumble + Math.cos(impactOff) * tumble * 0.4
  hips.position.set(roll * 0.08, 0.16 + (1 - hard) * 0.14 + Math.abs(pitch) * 0.04, hard * 0.08)
  hips.rotation.set(hard * 0.55 + pitch * 1.1, roll * 0.35, 0.95 + hard * 0.55 + roll * 1.4)
  spine.rotation.x = 0.2 + hard * 0.2 + pitch * 0.25
  chest.rotation.x = 0.12 + hard * 0.12
  chest.rotation.z = -0.15 - hard * 0.12 + roll * 0.3
  head.rotation.set(-0.25 - hard * 0.2 + pitch * 0.2, 0.25 + hard * 0.15, 0.15 + hard * 0.15 + roll * 0.25)
  // The tumble pitches and rolls the body around hips that sit near the snow,
  // which swung the head and chest up to 66 cm into it. Roll over the snow
  // instead: lift the hips until the lowest part of the torso rests on it.
  const lift = torsoLift(args)
  hips.position.y += lift
  // Yard-sale then re-attach: scatter peaks mid-crash and gathers in the last half-second.
  const gather = state.crashed < 0.55 ? state.crashed / 0.55 : 1
  const scatter = hard * (0.55 + (1 - tumble) * 0.45) * gather
  const sideThrow = Math.sin(impactOff)
  const alongThrow = Math.cos(impactOff)
  skis[0].position.set(
    0.45 + scatter * (0.55 + sideThrow * 0.35),
    0.04,
    0.12 + scatter * (0.35 + alongThrow * 0.25) + roll * 0.1,
  )
  skis[1].position.set(
    0.35 + scatter * (0.4 - sideThrow * 0.3),
    0.04,
    -0.12 - scatter * (0.45 - alongThrow * 0.2) - roll * 0.08,
  )
  skis[0].rotation.set(hard * 0.15 + pitch * 0.3, 0.3 + scatter * 0.5, 0.55 + scatter * 0.7)
  skis[1].rotation.set(-hard * 0.1 - pitch * 0.2, -0.25 - scatter * 0.4, 0.4 + scatter * 0.55)
  if (boarding) placeBoard(0.45 + scatter * 0.2, 0.1 + hard * 0.04, roll * 0.2, 0.75 + hard * 0.25, 0.15 + hard * 0.1)
  // Getting up: over the last GET_UP seconds the rider rolls onto the gear,
  // gets the skis or board under the hips and rises to a low crouch, a hand
  // pushing off the snow. The ski pose takes it the rest of the way up.
  const rise = getUpShare(state.crashed)
  if (rise > 0) {
    const r = rise * rise * (3 - 2 * rise)
    hips.position.lerp(GET_UP_HIPS, r)
    hips.rotation.set(
      THREE.MathUtils.lerp(hips.rotation.x, 0.35, r),
      THREE.MathUtils.lerp(hips.rotation.y, 0.25, r),
      THREE.MathUtils.lerp(hips.rotation.z, 0.12, r),
    )
    spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, 0.45, r)
    chest.rotation.x = THREE.MathUtils.lerp(chest.rotation.x, 0.25, r)
    chest.rotation.z = THREE.MathUtils.lerp(chest.rotation.z, 0.1, r)
    head.rotation.set(
      THREE.MathUtils.lerp(head.rotation.x, -0.55, r),
      THREE.MathUtils.lerp(head.rotation.y, 0.1, r),
      THREE.MathUtils.lerp(head.rotation.z, 0, r),
    )
    if (boarding) placeBoard(THREE.MathUtils.lerp(0.45 + scatter * 0.2, 0, r), 0.1 * (1 - r) + 0.02, 0, THREE.MathUtils.lerp(0.75 + hard * 0.25, -0.25, r), 0)
    else {
      skis.forEach((ski, i) => {
        ski.position.lerp(v.set(i === 0 ? 0.16 : -0.14, 0.03, i === 0 ? 0.08 : -0.06), r)
        ski.quaternion.slerp(q.identity(), r)
      })
    }
  }
  if (!boarding) keepSkisInReach(skis, args.thighs, args.pointInRoot)
  fitLegs()
  // Hands on the snow, placed from each shoulder in root space (the snow is
  // y = 0): the top hand props in front of the chest, the one underneath
  // reaches forward along the snow. They were chest-space targets, which put
  // the lower arm half a metre into the snow once the body rolled onto its side.
  // Poles follow the yard-sale then come back with gather.
  // In the tumble the head rolls over the arms, so a hand that lands under the
  // head is pushed out round it.
  const shoulder = new THREE.Vector3()
  const headAt = args.pointInRoot(head, HEAD_CENTRE, new THREE.Vector3())
  const clearOfHead = (hand: THREE.Vector3) => {
    const dx = hand.x - headAt.x
    const dz = hand.z - headAt.z
    const d = Math.hypot(dx, dz)
    if (d >= HAND_HEAD_GAP) return hand
    if (d < 1e-4) return hand.set(headAt.x, hand.y, headAt.z + HAND_HEAD_GAP)
    return hand.set(headAt.x + (dx / d) * HAND_HEAD_GAP, hand.y, headAt.z + (dz / d) * HAND_HEAD_GAP)
  }
  shoulderInRoot(0, shoulder)
  placeArm(
    0,
    clearOfHead(new THREE.Vector3(shoulder.x + 0.2 + hard * 0.1 * gather + roll * 0.1, HAND_ON_SNOW, shoulder.z + 0.4 + hard * 0.1 * gather)),
    new THREE.Vector3(0.75 + hard * 0.35 * gather, 0, 0.5 + hard * 0.25 * gather),
    true,
    HAND_ON_SNOW,
  )
  shoulderInRoot(1, shoulder)
  placeArm(
    1,
    clearOfHead(new THREE.Vector3(shoulder.x - 0.3 - hard * 0.15 * gather - roll * 0.1, HAND_ON_SNOW, shoulder.z + 0.3 + hard * 0.1 * gather)),
    new THREE.Vector3(-0.15 - hard * 0.25 * gather, 0, 1.0 + hard * 0.35 * gather),
    true,
    HAND_ON_SNOW,
  )
  crouch.x = 0.85 + hard * 0.1 * gather
  crouch.v = 0
}
