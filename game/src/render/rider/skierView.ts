import * as THREE from 'three'
import { PHYSICS, fallLineHeading, skiFrame, type SkiInput, type SkiState, type SurfaceSample } from '../../sim'
import { ANKLE_IN_SKI, BOARD_BINDINGS, BOARD_BOOT_HEIGHT, FORE_ARM, HIP_SOCKET_DROP, SHIN_LENGTH, THIGH_LENGTH, UPPER_ARM, buildRider, type RiderLook } from './skierModel'
import { Spring } from './spring'
import { RiderSnow } from './riderSnow'
import { DOUBLE_POLE_CYCLE, doublePolePose } from './doublePole'
import { applyCrashPose, crashSpin } from './skierCrashPose'
import { applySitPose } from './skierLiftPose'
import type { RiderAsset } from './riderSkin'
import { createIdlePlayer, type IdlePose } from './idles'

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
/** Least knee bend a skier's longer leg keeps on snow (radians), and the hip-to-ankle length it allows. */
const SKI_MIN_KNEE = 0.45
const SKI_LEG_MAX = Math.sqrt(THIGH_LENGTH ** 2 + SHIN_LENGTH ** 2 + 2 * THIGH_LENGTH * SHIN_LENGTH * Math.cos(SKI_MIN_KNEE))
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
/** Most the chest twists off the skis, radians (about 50°; a long traverse held the old 65° limit, wrung round at the waist). */
const MAX_COUNTER = 0.85
/** Share of the counter-rotation a skier keeps on a steady traverse. */
const TRAVERSE_COUNTER = 0.28
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
const BOARD_TOE_LEAN = 0.1
const BOARD_HEEL_SIT = 0.07
/** Board: most the body's lean runs past the board's roll before the board rolls with it, radians. */
const BOARD_LEAN_PAST = 0.1
/**
 * Board torso: forward hinge (toward the toes), and the share of the lean the torso keeps
 * on each edge. Heelside the share is negative: the legs lean back into the hill and the
 * chest folds forward over the knees (a jackknife), so the shoulders stay over the board.
 * Toeside the hinge mostly goes (BOARD_TOE_UPRIGHT of it) and the torso keeps about a third
 * of the lean: knees and hips drive toward the snow under a fairly upright back (a bow).
 */
const BOARD_HINGE = 0.2
const BOARD_TORSO_TOE = 0.34
const BOARD_TORSO_HEEL = -0.18
const BOARD_TOE_UPRIGHT = 0.75
/** Share of the board torso's bend taken by the pelvis (the rest rounds the back). */
const BOARD_PELVIS_SHARE = 0.38
/** How fast the held turn crouch lets go after the lean is gone, radians per second. */
const TURN_HOLD_DECAY = 0.7
/** Ski torso hinge: base forward bend and per unit of crouch (radians). A skier's back leans about 30° to 40° forward when moving. */
const SKI_HINGE = 0.36
const SKI_HINGE_FLEX = 0.52
/** Longest a carried arm reaches, as a share of the arm: the elbows stay bent (about 110° to 130°). */
const CARRY_REACH = 0.84
/** Moving, the carried hands ride this much higher in chest space than HAND_DROP (the hinged torso already lowers them). */
const CARRY_LIFT = 0.08
/** Chest-space hand lift per radian of torso bend past the base hinge. */
const PITCH_HAND_LIFT = 0.45
/** Pole carried from the hand: angle back from straight down (radians), and how far it splays out. */
const POLE_CARRY_BACK = 0.62
const POLE_CARRY_OUT = 0.2
/** Hand follow-through spring (Hz, damping). */
const HAND_HZ = 5
const HAND_ZETA = 0.72
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
/** Heelside share of the lean (the hips cannot drop as far behind the heels as over the toes), and the most lean drawn, radians. */
const BOARD_LEAN_HEEL = 0.72
const BOARD_MAX_INCLINE = 0.95
/** Board: seconds for one hop along the flat. */
const BOARD_HOP_TIME = 0.75
/** Board: extra crouch on the heel edge (sitting into the turn) and on the toe edge (knees driven in). */
const BOARD_HEEL_CROUCH = 0.04
const BOARD_TOE_CROUCH = 0.2
/** Board: how far the shoulders turn toward the turn, per radian of lean. */
const BOARD_SHOULDER_LEAD = 0.55

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

/** How far a hand reaches from its shoulder in a grab (a little short of a straight arm), metres. */
const GRAB_REACH = (UPPER_ARM + FORE_ARM) * 0.94
const GRAB_MAX_ROLL = 0.3
/** Closest a grab draws a boot to its hip socket (the knee folds to about 150°), metres. */
const GRAB_MIN_LEG = 0.24
const ORIGIN = new THREE.Vector3()
/** Belly (spine frame) and chest (chest frame) points a grab keeps the legs clear of, and by how much (centre to centre), metres. */
const GRAB_TORSO = [new THREE.Vector3(0, 0.1, 0.06), new THREE.Vector3(0, 0.08, 0.08)] as const
const GRAB_KNEE_GAP = 0.25
const GRAB_THIGH_GAP = 0.2
export type GrabSpec = { hand: number; ski: number; along: number; across: number }

/**
 * Where each hand takes hold in a grab: which hand, which ski (skis only),
 * how far along it from the boot (+ toward the tip or nose) and how far
 * across it (metres).
 */
export function grabSpecsFor(grab: string | null, boarding: boolean): GrabSpec[] {
  if (!grab) return []
  if (boarding) {
    if (grab === 'truck') return [{ hand: 0, ski: 0, along: 0.31, across: -0.12 }, { hand: 1, ski: 1, along: -0.31, across: -0.12 }]
    const frontHand = grab === 'nose' || grab === 'mute' || grab === 'japan'
    // A Japan is the front hand on the toe edge behind the front foot (the knee tucks
    // past it); a safety is the back hand on the heel edge.
    const along = grab === 'nose' ? 0.62 : grab === 'tail' ? -0.62 : grab === 'japan' ? -0.08 : 0.06
    return [{ hand: frontHand ? 0 : 1, ski: 0, along, across: grab === 'safety' ? 0.12 : -0.12 }]
  }
  if (grab === 'truck') return [{ hand: 0, ski: 0, along: 0.42, across: 0 }, { hand: 1, ski: 1, along: 0.42, across: 0 }]
  const hand = grab === 'mute' || grab === 'japan' || grab === 'nose' ? 0 : 1
  const ski = grab === 'mute' || grab === 'safety' ? 1 : grab === 'critical' ? 0 : grab === 'japan' ? 1 : hand
  const along = grab === 'nose' ? 0.72 : grab === 'tail' ? -0.62 : grab === 'japan' ? 0.32 : 0.22
  return [{ hand, ski, along, across: grab === 'safety' ? -0.07 : grab === 'critical' ? 0.07 : 0 }]
}

/** How long a close call after a landing lasts, seconds. */
const BOBBLE_TIME = 1.1

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
  /** Idle moves while stopped or on a chair (`play` forces one, for the rider lab). */
  idles: ReturnType<typeof createIdlePlayer>
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
  const idles = createIdlePlayer()
  let cruiseTime = 0
  const props = createIdleProps(arms[1].hand)

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
  /** 0 to 1: how much the skis have been turning lately (fast up, about a second down). */
  let turning = 0
  /** Seconds since standing up off a chair; large when not unloading. */
  let sinceSeat = 99
  let counterHeading = 0
  const tuck = new Spring()
  const poling = new Spring()
  const brake = new Spring()
  const plow = new Spring()
  const skate = new Spring()
  const herring = new Spring()
  const steepStyle = new Spring()
  const powderStyle = new Spring()
  const iceStyle = new Spring()
  const fastStyle = new Spring()
  let powderPhase = 0
  let wasSkating = false
  let wigglePhase = 0
  /** Board hop cycle, 0 to 1 (0: not hopping). */
  let boardHop = 0
  /** 1: this push uses alternate arms; 0: double poles. */
  let strideStyle = 0
  let strideBlend = 0
  const airBlend = new Spring()
  const railBlend = new Spring()
  const press = new Spring()
  const look = new Spring()
  const boardLead = new Spring()
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
  /** Close call after a landing: how big (0 to 1), seconds since it began, and which side it throws to. */
  let bobble = 0
  let bobbleAge = 10
  let bobbleSide = 1
  let lastTrickSeq = -1
  const startBobble = (amount: number, side: number) => {
    if (amount < bobble * Math.max(0, 1 - bobbleAge / BOBBLE_TIME)) return
    bobble = Math.min(1, amount)
    bobbleAge = 0
    bobbleSide = side >= 0 ? 1 : -1
  }
  /** Chest folding over the knees as a landing is absorbed; decays via spring. */
  const landFold = new Spring()
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
  /** Recent peak of the lean (radians), so the crouch holds through an edge change. */
  let turnHold = 0
  /** Each hand's carried position (chest space), sprung so the arms lag and follow through. */
  const handSprings = [0, 1].map(() => [new Spring(), new Spring(), new Spring()])
  let handSpringsLive = false
  /** 1 while the elbows hang down carrying poles on snow, 0 in a tuck, the air, on a rail or a lift. */
  let elbowDrop = 0
  /** 1 while stopped on snow, eased so the standing pose blends in and out instead of popping at walking pace. */
  let stillBlend = 0
  /** 1 while the back takes its moving-on-snow hinge, eased through takeoffs, landings and stops. */
  let hingeBlend = 0
  /** The roll the skis and the board last showed, eased flat in the air instead of snapping at takeoff. */
  let skiRoll = 0
  /** Board skating: 1 with the back foot out of its binding pushing along the flat, and the stride's phase (0 to 1). */
  const boardSkate = new Spring()
  let boardSkatePhase = 0
  /** Skis in a traverse: the uphill ski leads (metres, + when the hill falls away to the right). */
  const traverseLead = new Spring()
  const freeFoot = new THREE.Vector3()
  const qFoot = new THREE.Quaternion()
  const boardInverse = new THREE.Matrix4()
  const qBoardInv = new THREE.Quaternion()
  /** The back boot drawn on the board (it follows the back foot when that steps off to skate). */
  const backBoot = boardGroup.children.filter((c) => c.name === 'snowboard-boot')[1] as THREE.Object3D | undefined
  const syncBackBoot = () => {
    if (!backBoot || !rig.boarding) return
    boardGroup.updateMatrix()
    backBoot.position.copy(skis[1].position).applyMatrix4(boardInverse.copy(boardGroup.matrix).invert())
    backBoot.quaternion.copy(qBoardInv.copy(boardGroup.quaternion).invert()).multiply(skis[1].quaternion)
    // Off the board the boot leaves its binding behind (the binding is drawn with the boot, so hide it).
    const off = boardSkate.x > 0.25
    backBoot.children.forEach((part, i) => { if (i >= 2) part.visible = !off })
  }
  let boardRoll = 0
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
      // Standing up off a chair is a slower, weightier move than the other switches.
      fadeTime = mode === 'crash' ? 0.55 : mode === 'sit' && next === 'stand' ? 0.6 : FADE_IN[next]
      if (mode === 'sit' && next === 'stand') sinceSeat = 0
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
  const hipLocal = new THREE.Vector3()
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
    bodyInverse.copy(body.matrix).invert()
    hips.position.copy(hipLocal.copy(hipRoot).applyMatrix4(bodyInverse))
    // Knee drive: leaning the hips into the turn stretched the outside leg until
    // its knee locked (6° of bend at 50° of edge, a stiff peg leg). Drop the hips
    // until the longer leg keeps at least SKI_MIN_KNEE of bend; both knees then
    // flex deeper into the carve, the way a skier drives the knees into the hill.
    for (let pass = 0; pass < 3; pass++) {
      root.updateMatrixWorld(true)
      let excess = 0
      for (let i = 0; i < 2; i++) {
        pointInRoot(legs[i].thigh, ORIGIN, socketAt)
        const reachTo = v1.copy(ANKLE_IN_SKI).applyQuaternion(skis[i].quaternion).add(skis[i].position).distanceTo(socketAt)
        excess = Math.max(excess, reachTo - SKI_LEG_MAX)
      }
      if (excess < 0.002) break
      hipRoot.y -= excess * 1.15 * weight
      hips.position.copy(hipLocal.copy(hipRoot).applyMatrix4(bodyInverse))
    }
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
    // Elbows point back and out. Carrying poles on snow they also drop (the carried arms
    // bend more now, and pointing them out flared them into chicken wings); folded into
    // a tuck or a grab they stay out, clear of the knees.
    elbowHint.set(arm.side * (0.6 - 0.32 * elbowDrop), -0.2 - 0.5 * elbowDrop, -1 + 0.35 * elbowDrop)
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

  /** The grab point on the equipment, in root space (the skis or board must be placed). */
  const grabPoint = (spec: GrabSpec, out: THREE.Vector3) => {
    if (rig.boarding) {
      boardGroup.updateMatrix()
      return out.set(spec.across, 0.035, spec.along).applyMatrix4(boardGroup.matrix)
    }
    const ski = skis[spec.ski]
    return out.set(spec.across, 0.06, spec.along).applyQuaternion(ski.quaternion).add(ski.position)
  }
  const grabAt = new THREE.Vector3()
  const grabPull = new THREE.Vector3()
  const socketAt = new THREE.Vector3()
  const gearUp = new THREE.Vector3()
  const kneeAt = new THREE.Vector3()
  const grabSeg = new THREE.Line3()
  const grabClosest = new THREE.Vector3()
  const kneeDir = new THREE.Vector3()
  const gearPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  const gearQuat = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()]
  const torsoBase = new Float64Array(6)
  /** Grab fold, per channel: pitch, roll and twist of the back, gear lift (m), gear tilt toward the grabbed end and gear roll onto an edge. */
  const grabDof = new Float64Array(6)
  const GRAB_LIMITS = [
    [0, 1.25], [-0.45, 0.45], [-0.7, 0.7], [0, 0.32], [-0.4, 0.4], [-0.45, 0.45],
  ] as const
  /** How much each channel costs per unit, so the fold prefers the natural ones (gear up, then bend). */
  const GRAB_COST = [0.05, 0.12, 0.1, 0.04, 0.25, 0.22]
  /** Pose the back and gear from grabDof, on top of the saved base pose. */
  const applyGrabDof = () => {
    const [pitch, roll, twist, lift, tilt, edge] = grabDof
    spine.rotation.set(torsoBase[0] + pitch * 0.55, torsoBase[1] + twist * 0.55, torsoBase[2] + roll * 0.6)
    chest.rotation.set(torsoBase[3] + pitch * 0.45, torsoBase[4] + twist * 0.45, torsoBase[5] + roll * 0.4)
    gearUp.set(0, 1, 0)
    if (rig.boarding) {
      boardGroup.position.copy(gearPos[2]).addScaledVector(gearUp, lift)
      boardGroup.quaternion.copy(gearQuat[2])
      boardGroup.rotateX(-tilt)
      boardGroup.rotateZ(edge)
      boardGroup.updateMatrix()
      for (let i = 0; i < 2; i++) {
        const { z, yaw } = BOARD_BINDINGS[i]
        skis[i].position.set(0, BOARD_BOOT_HEIGHT, z).applyMatrix4(boardGroup.matrix)
        skis[i].quaternion.copy(boardGroup.quaternion)
        skis[i].rotateY(yaw)
      }
    } else {
      for (let i = 0; i < 2; i++) {
        skis[i].position.copy(gearPos[i]).addScaledVector(gearUp, lift)
        skis[i].quaternion.copy(gearQuat[i])
        skis[i].rotateX(-tilt)
        skis[i].rotateZ(edge)
      }
    }
  }
  /** How far the hands are from their grab points past arm's reach, plus what the fold costs. */
  const hipsInRoot = new THREE.Matrix4()
  const spineInRoot = new THREE.Matrix4()
  const chestInRoot = new THREE.Matrix4()
  const sockets = [new THREE.Vector3(), new THREE.Vector3()]
  const grabShoulders = [new THREE.Vector3(), new THREE.Vector3()]
  const torsoAt = [new THREE.Vector3(), new THREE.Vector3()]
  /** Last frame's unblended grab fold and the grab it was for, to start the next search from. */
  const grabWarm = new Float64Array(6)
  let grabWarmKey = ''
  /**
   * How far the hands are from their grab points past arm's reach, plus what the
   * fold costs. Forward kinematics by hand (root space, from the hips' matrix):
   * a whole-rig matrix update per try cost about 17 ms a frame.
   */
  const grabCost = (specs: GrabSpec[]) => {
    applyGrabDof()
    spine.updateMatrix()
    chest.updateMatrix()
    spineInRoot.multiplyMatrices(hipsInRoot, spine.matrix)
    chestInRoot.multiplyMatrices(spineInRoot, chest.matrix)
    for (let i = 0; i < 2; i++) grabShoulders[i].copy(arms[i].shoulder.position).applyMatrix4(chestInRoot)
    torsoAt[0].copy(GRAB_TORSO[0]).applyMatrix4(spineInRoot)
    torsoAt[1].copy(GRAB_TORSO[1]).applyMatrix4(chestInRoot)
    let cost = 0
    for (const spec of specs) {
      grabPoint(spec, grabAt)
      cost += Math.max(0, grabShoulders[spec.hand].distanceTo(grabAt) - GRAB_REACH) * 8
    }
    if (rig.boarding) kneeDir.set(-1, 0, 0).applyQuaternion(boardGroup.quaternion)
    for (let i = 0; i < 2; i++) {
      // Each boot stays where the leg can reach it, with room for the knee to fold.
      const socket = sockets[i]
      const ankleAt = v3.copy(ANKLE_IN_SKI).applyQuaternion(skis[i].quaternion).add(skis[i].position)
      const leg = ankleAt.distanceTo(socket)
      cost += Math.max(0, GRAB_MIN_LEG - leg) * 10 + Math.max(0, leg - (THIGH_LENGTH + SHIN_LENGTH) * 0.97) * 10
      // Where the knee will fold to (over the toes), from the two-bone triangle, and
      // the shin below it, kept clear of the belly and chest.
      if (!rig.boarding) kneeDir.set(0, 0, 1).applyQuaternion(skis[i].quaternion)
      const d = Math.min(Math.max(leg, 1e-3), THIGH_LENGTH + SHIN_LENGTH)
      const along = (d * d + THIGH_LENGTH ** 2 - SHIN_LENGTH ** 2) / (2 * d)
      const out = Math.sqrt(Math.max(0, THIGH_LENGTH ** 2 - along * along))
      grabPull.copy(ankleAt).sub(socket).normalize()
      kneeAt.copy(socket).addScaledVector(grabPull, along)
      kneeDir.addScaledVector(grabPull, -kneeDir.dot(grabPull)).normalize()
      kneeAt.addScaledVector(kneeDir, out)
      for (const at of torsoAt) {
        grabSeg.set(socket, kneeAt)
        const thighGap = grabSeg.closestPointToPoint(at, true, grabClosest).distanceTo(at)
        grabSeg.set(kneeAt, ankleAt)
        const shinGap = grabSeg.closestPointToPoint(at, true, grabClosest).distanceTo(at)
        cost += (Math.max(0, GRAB_THIGH_GAP - thighGap) + Math.max(0, GRAB_KNEE_GAP - shinGap)) * 12
      }
    }
    for (let k = 0; k < grabDof.length; k++) cost += Math.abs(grabDof[k]) * GRAB_COST[k]
    return cost
  }
  /**
   * A grab is the gear coming up to the hand as much as the hand going down to
   * it. Arms alone fell 15 to 65 cm short (the hand hung beside the knee). A
   * small search over the back (pitch, roll, twist) and the gear (lift, tilt
   * toward the grabbed end, roll onto an edge) closes the gap the cheapest way
   * that keeps the knees off the chest, then the result blends in with the grab
   * (`amount`, 0 to 1). A held grab starts from last frame's answer.
   */
  const foldForGrab = (specs: GrabSpec[], amount: number, key: string) => {
    torsoBase.set([spine.rotation.x, spine.rotation.y, spine.rotation.z, chest.rotation.x, chest.rotation.y, chest.rotation.z])
    for (let i = 0; i < 2; i++) {
      gearPos[i].copy(skis[i].position)
      gearQuat[i].copy(skis[i].quaternion)
    }
    gearPos[2].copy(boardGroup.position)
    gearQuat[2].copy(boardGroup.quaternion)
    body.updateMatrix()
    hips.updateMatrix()
    hipsInRoot.multiplyMatrices(body.matrix, hips.matrix)
    for (let i = 0; i < 2; i++) sockets[i].copy(legs[i].thigh.position).applyMatrix4(hipsInRoot)
    const warm = key === grabWarmKey
    if (warm) grabDof.set(grabWarm)
    else grabDof.fill(0)
    let best = grabCost(specs)
    for (let step = warm ? 0.04 : 0.16; step > 0.01; step *= 0.5) {
      for (let pass = 0; pass < 3; pass++) {
        let moved = false
        for (let k = 0; k < grabDof.length; k++) {
          for (const dir of [1, -1]) {
            const was = grabDof[k]
            grabDof[k] = THREE.MathUtils.clamp(was + dir * step, GRAB_LIMITS[k][0], GRAB_LIMITS[k][1])
            if (grabDof[k] === was) continue
            const cost = grabCost(specs)
            if (cost < best - 1e-5) {
              best = cost
              moved = true
            } else grabDof[k] = was
          }
        }
        if (!moved) break
      }
    }
    grabWarm.set(grabDof)
    grabWarmKey = key
    for (let k = 0; k < grabDof.length; k++) grabDof[k] *= amount
    applyGrabDof()
    // The head keeps looking ahead over the fold.
    head.rotation.x -= grabDof[0] * 0.8
    head.rotation.y -= grabDof[2] * 0.5
  }

  const shoulderRest = new THREE.Vector3()
  /**
   * Pull a chest-space hand target in toward its shoulder so the arm keeps a bent
   * elbow (`share` of the full arm at most). Hands set at belt height a forward
   * reach out locked the arms straight, poles out like outriggers.
   */
  const keepElbowBent = (index: number, hand: THREE.Vector3, share = CARRY_REACH) => {
    shoulderRest.copy(arms[index].shoulder.position)
    const max = (UPPER_ARM + FORE_ARM) * share
    const d = hand.distanceTo(shoulderRest)
    if (d > max) hand.sub(shoulderRest).multiplyScalar(max / d).add(shoulderRest)
  }
  const tipHand = new THREE.Vector3()
  const gravityRoot = new THREE.Vector3()
  const carryBack = new THREE.Vector3()
  const carryOut = new THREE.Vector3()
  const qRootInv = new THREE.Quaternion()
  /**
   * Where a carried pole's tip goes (root space): hanging from the hand partly
   * under gravity (so it does not lie down along a steep pitch), angled back
   * and a little out, the way a skier holds poles between plants. A tip that would go
   * into the snow swings further back instead, so the shaft never stabs down through
   * the surface or sticks out sideways from a raised hand.
   */
  const carriedTip = (side: number, handChest: THREE.Vector3, out: THREE.Vector3) => {
    pointInRoot(chest, handChest, tipHand)
    root.getWorldQuaternion(qRootInv).invert()
    // Half gravity, half the slope's normal: the hand steers the pole, it does not hang free.
    // Only its fore-aft part: across a traverse, gravity would swing the downhill pole out sideways.
    gravityRoot.set(0, -1, 0).applyQuaternion(qRootInv).add(v2.set(0, -1, 0))
    gravityRoot.x = 0
    gravityRoot.normalize()
    carryBack.set(0, 0, -1).addScaledVector(gravityRoot, gravityRoot.z).normalize()
    carryOut.set(side, 0, 0)
    const back = Math.sin(POLE_CARRY_BACK)
    out.copy(gravityRoot).multiplyScalar(Math.cos(POLE_CARRY_BACK))
      .addScaledVector(carryBack, back * Math.cos(POLE_CARRY_OUT))
      .addScaledVector(carryOut, back * Math.sin(POLE_CARRY_OUT))
      .normalize().multiplyScalar(POLE_REACH).add(tipHand)
    const floor = 0.12
    if (out.y < floor) {
      // Swing back about the hand until the tip clears the snow.
      const down = Math.max(0, tipHand.y - floor)
      // Straight back along the skis (a low inside hand drags its pole behind, not out to the side).
      const along = Math.sqrt(Math.max(0, POLE_REACH * POLE_REACH - down * down))
      out.set(side * along * Math.sin(POLE_CARRY_OUT) * 0.5, -down, -along * Math.cos(POLE_CARRY_OUT * 0.5)).add(tipHand)
    }
    return out
  }

  const airTipAt = new THREE.Vector3()
  /** A pole's tip in the air: back from the hand along the skis, angled a little down and out. */
  const airTip = (side: number, handChest: THREE.Vector3) => {
    pointInRoot(chest, handChest, tipHand)
    return airTipAt.set(side * 0.25, -0.55, -0.8).normalize().multiplyScalar(POLE_REACH).add(tipHand)
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
    idles,
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

      // Idle moves: stopped on snow (not pushing, braking or turning), on a surface lift or a chair.
      // Off the chair: the stand-up and the glide down the ramp (see `rise` below).
      sinceSeat = pose === 'sit' ? 99 : sinceSeat + dt
      const unloading = pose === 'stand' && sinceSeat < 6
      const stopped = (pose === 'stand' && !unloading) || (pose === 'ski' && !crashed && state.grounded && !rail && !air &&
        state.speed < 0.5 && !input.tuck && input.brake < 0.2 && Math.abs(input.steer) < 0.05 && !input.jump)
      // Cruising in a straight line for a few seconds earns the small riding moves
      // (a shoulder check, loosening the shoulders); any input ends them.
      const cruisingStraight = pose === 'ski' && !crashed && state.grounded && !rail && !air && state.speed > 4 &&
        !input.tuck && input.brake < 0.1 && Math.abs(input.steer) < 0.08 && !input.jump && Math.abs(state.edgeAngle) < 0.12
      cruiseTime = cruisingStraight ? cruiseTime + dt : 0
      const ridingIdle = cruiseTime > 2.5
      const ip = idles.step(dt, { active: !rig.firstPerson && (pose === 'sit' || stopped || ridingIdle), sitting: pose === 'sit', boarding, riding: ridingIdle })
      props.show(ip)

      if (pose === 'sit' || crashed) {
        boardSkate.x = 0
        boardSkate.v = 0
        handSpringsLive = false
        elbowDrop = 0
      }
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
          legSwing: ip.legSwing,
        })
        if (ip.kind) {
          head.rotation.x += ip.headX
          head.rotation.y += ip.headY
          head.rotation.z += ip.headZ
          spine.rotation.x += ip.spineX * 0.5
          for (let i = 0; i < 2; i++) {
            const h = ip.hands[i]
            if (!h) continue
            const side = arms[i].side
            placeArm(i, v1.set(side * 0.2, -0.2, 0.34).lerp(v2.set(h.x, h.y, h.z), h.w).clone(), new THREE.Vector3(side * 0.3, 0.2, 1.2))
          }
        }
        applyFade(dt)
        syncBackBoot()
        rig.applyCloth()
        return
      }
      if (crashed) {
        // A fast crash slides and slowly spins on the snow, then squares up as the rider gathers.
        const spin = crashSpin(state)
        if (spin !== 0) root.quaternion.multiply(qFlip.setFromAxisAngle(ay.set(0, 1, 0), spin))
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
        syncBackBoot()
        rig.applyCloth()
        return
      }

      // ---- Read the sim ----
      const skiing = pose === 'ski' && state.grounded && !rail && !air
      const stance = state.ridingSwitch ? -1 : 1
      const speed = state.speed
      const still = skiing && speed < 0.5
      stillBlend += ((still ? 1 : 0) - stillBlend) * ease(4, dt)
      const tucked = skiing && state.tuck && speed >= PHYSICS.skateMaxSpeed
      // How steep the snow is (sine of the slope) and how much the rider is heading up it.
      const slopeSin = ground ? Math.min(1, Math.hypot(ground.normal.x, ground.normal.z)) : 0
      const uphill = ground && ground.normal.y > 0.3
        ? (ground.normal.x * Math.sin(state.heading) - ground.normal.z * Math.cos(state.heading)) / ground.normal.y
        : 0
      // The tuck settles in: from a high half tuck it folds down as the speed builds
      // and over the first second held (it used to drop straight to 70% the moment
      // the push turned into a tuck). Steeper snow folds sooner.
      const tuckIn = smooth(Math.min(1, Math.max(0, state.tuckTime - PHYSICS.tuckHold) / 0.9))
      const tuckDepth = tucked
        ? (0.42 + 0.58 * Math.min(1, Math.max(0, (speed - 7) / 10 + slopeSin * 0.8))) * (0.55 + 0.45 * tuckIn)
        : 0
      // A forward tap at cruising speed: one double-pole stroke.
      const poleStroke = skiing && state.poling && !boarding
      const braking = skiing && input.brake > 0.2 && speed > 1
      // Slow braking is a snowplough; faster it is a hockey stop (the sim turns the skis across).
      const plowing = braking && speed < 6 && !boarding
      // Skating: below the push speed, and on gentle snow a few more strokes past it
      // that fade as the tuck comes in (it snapped from skating to a tuck).
      const skateFade = speed < PHYSICS.skateMaxSpeed ? 1 : slopeSin < 0.12 ? 1 - smooth(Math.min(1, (speed - PHYSICS.skateMaxSpeed) / 2.5)) : 0
      // Carried along a glide track or through a booster (set by the sim where the mountain
      // has them): the rider works with it, skating or pushing at low speed without tuck
      // held, then settling low as the speed builds.
      const carried = state as SkiState & { gliding?: number; boosting?: boolean }
      const gliding = skiing && !braking ? THREE.MathUtils.clamp(carried.gliding ?? 0, 0, 1) : 0
      const glidePush = gliding > 0.3
      const glideSkate = gliding * (1 - smooth(THREE.MathUtils.clamp((speed - 7) / 4, 0, 1)))
      const skateWant = input.tuck ? skateFade : glidePush ? (boarding ? Math.min(skateFade, gliding) : glideSkate) : 0
      const glideLow = Math.max(carried.boosting && skiing ? 0.6 : 0, state.tuck ? 0 : gliding * smooth(THREE.MathUtils.clamp((speed - 7) / 4, 0, 1)) * 0.4)
      const skating = skiing && (input.tuck || glidePush) && !braking && skateWant > 0.02 && !boarding
      // Heading up a slope, the push becomes a herringbone: tips out, inside edges, short steps.
      const herringbone = skating ? smooth(Math.min(1, Math.max(0, (uphill - 0.04) / 0.1))) : 0
      const charging = skiing && state.popCharge > 0
      // At a standstill the sim's edge is not meaningful (it can settle on the downhill
      // edges after a hockey stop, which leaned the legs down the hill). A stopped rider
      // stands on the uphill edges, a little past level, and the pose eases there below
      // walking pace.
      const rightX = -Math.cos(state.heading)
      const rightZ = -Math.sin(state.heading)
      const slopeRoll = skiing && ground ? Math.asin(Math.max(-0.6, Math.min(0.6, ground.normal.x * rightX + ground.normal.z * rightZ))) : 0
      const resting = skiing ? smooth(THREE.MathUtils.clamp((1.3 - speed) / 0.9, 0, 1)) : 0
      const edge = skiing ? THREE.MathUtils.lerp(state.edgeAngle * stance, -slopeRoll * 1.25 * stance, resting) : 0
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
      // At an edge change the path can start curving the new way while the old edge
      // is still engaged (the edge rolls over at its own rate). The body cannot cross
      // over an edge that is still biting, or the hips swing out past the boots and
      // the thighs lean against the shins: hold the new lean back until the old edge
      // releases (full by CROSSOVER_EDGE).
      const pathLean = stance * Math.sign(lateralG) * Math.min(MAX_INCLINE, Math.atan(Math.abs(lateralG)))
      const edgeLean = stance * edge * 0.15 * (1 - resting)
      const crossing = pathLean * edgeLean < 0
        ? THREE.MathUtils.clamp((CROSSOVER_HOLD - Math.abs(edge)) / (CROSSOVER_HOLD - CROSSOVER_EDGE), 0, 1)
        : 1
      const lean = Math.abs(pathLean * crossing) > Math.abs(edgeLean) ? pathLean * crossing : edgeLean
      const wantIncline = !skiing ? 0 : boarding
        // A board rider leans a little less on the heel edge than on the toes, and never past BOARD_MAX_INCLINE.
        ? THREE.MathUtils.clamp(lean * (lean < 0 ? BOARD_LEAN_HEEL : BOARD_LEAN) - slopeRoll * 0.8, -BOARD_MAX_INCLINE, BOARD_MAX_INCLINE)
        : lean - slopeRoll * 0.8
      // Fast and near critically damped: the lean follows the physics with little lag.
      incline.step(wantIncline, dt, boarding ? BOARD_INCLINE_HZ : INCLINE_HZ, 0.9)
      // Board: the edge the board shows. A skidded or pivoted turn leans the rider well past
      // the sim's edge angle, and the body then hung 25° or more off the side of a nearly
      // flat board (sitting in the air behind the heel edge). The board rolls at least to
      // within BOARD_LEAN_PAST of the body's lean, so the rider always stands on it.
      let boardEdge = THREE.MathUtils.clamp(edge, -1, 1)
      if (boarding && skiing) {
        const need = incline.x - Math.sign(incline.x) * Math.min(Math.abs(incline.x), BOARD_LEAN_PAST)
        if (need * boardEdge >= 0 && Math.abs(need) > Math.abs(boardEdge)) boardEdge = need
      }

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
          // A strong skier releases the old edges by folding the legs (the skis come up
          // under the body), not by standing up: a small dip, no up-pop. A board rider
          // still rises a touch to unweight across the flat base.
          crouch.v += (boarding ? -0.5 : 0.6) * Math.min(1, speed / 10)
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
        const hit = Math.min(10, Math.max(0, -lastVy))
        crouch.v += 1.4 + hit * 0.4
        armFlare.v += 1.2 + Math.min(4, hit) * 0.35
        // A big hit folds the hips back and the chest down over the knees, then the legs push back up.
        fore.v += hit * 0.05
        landFold.v += 0.6 + hit * 0.22
        // Close call: landing across the skis, or very hard, rocks the rider; they catch it.
        const across = Math.abs(Math.atan2(Math.sin(state.heading - travel), Math.cos(state.heading - travel)))
        const off = Math.min(across, Math.PI - across)
        const shake = THREE.MathUtils.clamp((off - 0.18) / 0.45, 0, 1) + THREE.MathUtils.clamp((hit - 9) / 6, 0, 0.5)
        if (Math.hypot(state.vx, state.vz) > 2 && shake > 0.15) startBobble(shake, Math.sin(state.heading - travel))
      }
      // A sketchy landing the sim graded is always a close call.
      if (state.trick && state.trick.seq !== lastTrickSeq) {
        if (state.trick.grade === 'sketchy' && skiing) startBobble(1, 0)
        lastTrickSeq = state.trick.seq
      }
      bobbleAge += dt
      const bobbleEnv = bobble > 0 ? bobble * Math.max(0, 1 - bobbleAge / BOBBLE_TIME) ** 1.5 : 0
      if (bobbleEnv <= 0) bobble = 0
      landFold.step(0, dt, 2.6, 0.55)
      armFlare.step(0, dt, 3.2, 0.78)
      wasAir = Boolean(air)
      lastVy = state.vy

      // The sim keeps the grab name for scoring after the button is released.
      const grabbing = Boolean(air?.grab && input.grab)
      if (grabbing && air?.grab) lastGrab = air.grab
      grabBlend += ((grabbing ? 1 : 0) - grabBlend) * ease(14, dt)
      tuck.step(Math.max(tuckDepth, glideLow), dt, 1.4, 0.95)
      poling.step(poleStroke ? 1 : 0, dt, 3.2, 0.9)
      brake.step(braking && !plowing ? 1 : 0, dt, 2.6, 0.85)
      plow.step(plowing ? 1 : 0, dt, 2.4, 0.95)
      skate.step(skating ? skateWant : 0, dt, 2, 1)
      herring.step(herringbone, dt, 2, 1)
      // Pushing style for this push (picked when the push starts): double poles or
      // alternate arms (a diagonal stride) when nearly stopped.
      if (skating && !wasSkating) strideStyle = Math.random() < 0.5 ? 1 : 0
      wasSkating = skating
      strideBlend += (strideStyle - strideBlend) * ease(4, dt)
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
      // Board: the shoulders lead the turn (they turn toward it before the board does).
      boardLead.step(boarding && skiing && speed > 2 ? THREE.MathUtils.clamp(incline.x * BOARD_SHOULDER_LEAD + input.steer * 0.12, -0.5, 0.5) : 0, dt, 2.2, 0.85)

      // Counter-rotation: the upper body keeps facing down the fall line. Aimed from the
      // fall line, not the skis: the chest turns only CHEST_FOLLOW of the way with the
      // skis (less in a hockey stop), so it stays down the hill in short and long turns.
      // Riding switch the skier looks back over a shoulder instead (switchLook).
      // Riding style from the terrain: steeps keep the rider low and forward with the
      // hands out front and the chest facing down the hill; powder sits back a little
      // on a narrower stance with a bounce; ice goes low with the arms wide; speed
      // compacts the stance with the hands forward.
      steepStyle.step(skiing ? smooth(Math.min(1, Math.max(0, (slopeSin - 0.26) / 0.24))) : 0, dt, 1.2, 1)
      powderStyle.step(skiing ? Math.min(1, state.surface.depth / 0.3) : 0, dt, 1.2, 1)
      iceStyle.step(skiing && state.surface.kind === 'ice' ? 1 : 0, dt, 1.5, 1)
      fastStyle.step(skiing ? smooth(Math.min(1, Math.max(0, (speed - 12) / 10))) : 0, dt, 1, 1)
      if (powderStyle.x > 0.01 && speed > 3) powderPhase += dt * (5 + speed * 0.15)
      let wantCounter = 0
      if (skiing && ground && speed > 1.5 && !boarding && !state.ridingSwitch) {
        const fall = fallLineHeading(ground.normal)
        if (fall !== null) {
          const off = Math.atan2(Math.sin(state.heading - fall), Math.cos(state.heading - fall))
          const follow = (braking ? CHEST_FOLLOW * 0.5 : CHEST_FOLLOW) * (1 - steepStyle.x * 0.5)
          // It builds with speed: creeping across a hill the chest stays with the skis (it
          // used to twist the full 65° down the hill at walking pace).
          const moving = smooth(THREE.MathUtils.clamp((speed - 1.5) / 5, 0, 1))
          // The chest faces down the hill while the skis are working through turns. Holding a
          // line across the hill it comes back over the skis, facing where the skier is going
          // with a little of the hill left in it (it used to hold the full twist for as long
          // as the traverse lasted, hands hanging off the downhill side).
          const turnRate = Math.abs(Math.atan2(Math.sin(state.heading - counterHeading), Math.cos(state.heading - counterHeading))) / Math.max(dt, 1e-4)
          const working = braking ? 1 : smooth(THREE.MathUtils.clamp((turnRate - 0.12) / 0.5, 0, 1))
          turning += (working - turning) * ease(working > turning ? 7 : 1.1, dt)
          wantCounter = Math.max(-MAX_COUNTER, Math.min(MAX_COUNTER, off * (1 - follow))) * moving * (TRAVERSE_COUNTER + (1 - TRAVERSE_COUNTER) * turning)
        }
      }
      counterHeading = state.heading
      counter.step(wantCounter, dt, 3.5, 0.85)

      // Pushing on the flat: double-pole when nearly stopped, skate as speed builds.
      const doublePole = Math.max(skate.x * Math.max(0, Math.min(1, (2.4 - speed) / 1.2)) * (1 - strideBlend) * (1 - herring.x), poling.x)
      const skateAmount = Math.max(0, skate.x - doublePole)
      if (skateAmount > 0.01) skatePhase += dt * (4 + speed * 0.9 - herring.x * 1.5)
      const stride = Math.sin(skatePhase) * skateAmount
      if (doublePole > 0.01) dpPhase = (dpPhase + dt / DOUBLE_POLE_CYCLE) % 1
      const dp = doublePolePose(dpPhase, speed)

      // Board at a crawl: strapped in, the rider wiggles the board along and, pushing
      // to get going (tuck or steer held), hops it forward.
      const crawl = boarding && skiing ? smooth(Math.min(1, Math.max(0, (3 - speed) / 2.2))) : 0
      // Board on the flat with forward held: the back foot comes out of its binding and
      // pushes along beside the board (skating), the way riders cross a flat or a cat track.
      // Hops are left for steering at a standstill.
      const boardSkating = boarding && skiing && (input.tuck || glidePush) && !braking && !state.ridingSwitch && skateWant > 0.02 && slopeSin < 0.22
      boardSkate.step(boardSkating ? skateWant : 0, dt, 2.2, 1)
      const bSkate = THREE.MathUtils.clamp(boardSkate.x, 0, 1)
      if (bSkate > 0.01) boardSkatePhase = (boardSkatePhase + dt * (0.85 + speed * 0.09)) % 1
      // 0 to 1 through the push (foot on the snow, sliding back), then 0 to 1 through the swing forward.
      const pushing = boardSkatePhase < 0.55 ? boardSkatePhase / 0.55 : 0
      const swinging = boardSkatePhase >= 0.55 ? (boardSkatePhase - 0.55) / 0.45 : 0
      const wantHop = crawl > 0.5 && speed < 1.6 && !boardSkating && bSkate < 0.2 && Math.abs(input.steer) > 0.3
      if (crawl > 0.01) wigglePhase += dt * (4.5 + speed)
      if (wantHop || boardHop > 0) boardHop += dt / BOARD_HOP_TIME
      if (boardHop >= 1) boardHop = wantHop ? boardHop - 1 : 0
      const hopUp = boardHop > 0.3 ? Math.sin(((boardHop - 0.3) / 0.7) * Math.PI) : 0
      const hopDip = boardHop > 0 && boardHop < 0.3 ? Math.sin((boardHop / 0.3) * Math.PI) : 0
      if (boarding) root.position.y += hopUp * 0.12
      const wiggle = crawl * Math.sin(wigglePhase) * 0.11 * (1 - hopUp) * (1 - bSkate)
      // Athletic base flex, plus terrain absorption, edging, tuck, braking and pop.
      // A board rider cruises taller (about 35° of knee bend) and sits lower on the heel edge.
      // Standing up off a chair: the legs start folded as they were on the seat and push up
      // over the first second, the chest goes forward over the feet to get the weight off
      // the seat, and the arms come out for balance down the ramp before they settle.
      const rise = sinceSeat < 3 ? 1 - smooth(Math.min(1, sinceSeat / 1.15)) : 0
      const rampBalance = sinceSeat < 3 ? smooth(Math.min(1, sinceSeat / 0.35)) * (1 - smooth(THREE.MathUtils.clamp((sinceSeat - 1.1) / 1.4, 0, 1))) : 0
      let wantCrouch = pose === 'stand' ? 0.12 + (unloading ? 0.14 : 0) + rise * 0.5 : still ? (boarding ? 0.15 : 0.22) : boarding ? 0.2 : 0.34
      // Linked turns keep the legs flexed through the crossover: as the lean drains out
      // of a turn, the crouch holds on to the recent peak of it and lets go slowly
      // (following the lean alone stood the rider bolt upright at every edge change).
      turnHold = skiing ? Math.max(Math.abs(incline.x), turnHold - dt * TURN_HOLD_DECAY) : 0
      wantCrouch += Math.abs(incline.x) * (boarding && incline.x < 0 ? 0 : 0.3) + (boarding ? 0 : Math.max(0, turnHold - Math.abs(incline.x)) * 0.6) + (skiing ? Math.min(0.2, state.sink * 0.5) : 0)
      // Heelside the rider sits down into the highbacks; toeside the knees drive forward into the hill.
      if (boarding && skiing) wantCrouch += heelSide(boardEdge) * BOARD_HEEL_CROUCH + toeSide(boardEdge) * BOARD_TOE_CROUCH
      // Skating: the front knee dips as the back foot pushes off.
      wantCrouch += bSkate * (0.1 + 0.14 * Math.sin(pushing * Math.PI))
      if (skiing && ground?.mogulHeight) {
        // Fold the legs up on the face and extend into the next trough.
        wantCrouch += Math.min(0.48, ground.mogulHeight * Math.max(0, speed / 12 + state.vy * 0.14))
      }
      wantCrouch = Math.max(
        wantCrouch,
        tucked ? (boarding ? 0.45 + 0.5 * tuckDepth : tuckDepth) : 0,
        glideLow > 0 ? (boarding ? 0.3 + 0.5 * glideLow : glideLow) : 0,
        braking ? (plowing ? 0.38 : 0.6) : 0,
        // Double-poling is done from the waist on fairly straight legs (a dip on each push, below).
        skating ? 0.4 * (1 - doublePole) : 0,
        charging ? 0.45 + state.popCharge * 0.45 : 0,
        air ? 0.42 + grabBlend * 0.45 : 0,
        rail ? 0.42 : 0,
      )
      wantCrouch += doublePole * dp.crunch * 0.3
      wantCrouch += ip.crouch + hopDip * 0.35
      // Rolls and dips: the legs give as the snow pushes up and reach as it falls away.
      if (skiing && speed > 2) wantCrouch += THREE.MathUtils.clamp(accel.dot(bodyUp) * 0.012, -0.1, 0.18)
      wantCrouch += steepStyle.x * 0.1 + iceStyle.x * 0.06 + fastStyle.x * 0.08 +
        powderStyle.x * Math.sin(powderPhase) * 0.07 * Math.min(1, speed / 6)
      crouch.step(Math.min(1.05, wantCrouch), dt, 3, 0.6)
      const flex = Math.max(0, Math.min(1.1, crouch.x))
      // Hips back in a tuck and a hockey stop, forward over the skis in a press.
      fore.step(tuck.x * 0.16 + brake.x * 0.05 - press.x * 0.05 + skate.x * 0.03 + powderStyle.x * 0.04 - steepStyle.x * 0.02, dt, 2.5, 0.9)

      // ---- Skis ----
      // The stance opens a little as the lean builds: with the hips leaning over the
      // middle of it, the outside leg extends and the inside leg folds, more the
      // higher the edge (about 12 cm of difference at 45°).
      const halfStance = 0.13 - powderStyle.x * 0.035 + iceStyle.x * 0.015 + brake.x * 0.03 + plow.x * 0.14 + skate.x * 0.03 - railBlend.x * 0.04 - tuck.x * 0.015 +
        Math.min(1, Math.abs(incline.x)) * 0.02
      // Across a hill the uphill ski rides half a boot ahead of the downhill one.
      traverseLead.step(skiing && !boarding ? THREE.MathUtils.clamp(slopeRoll * 0.3, -0.08, 0.08) * (1 - plow.x) : 0, dt, 2, 1)
      const lead = incline.x * 0.12 - traverseLead.x
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
      // In the air the skis ease flat (they used to snap level on the frame of takeoff).
      skiRoll = air ? skiRoll * Math.exp(-9 * dt) : edgeVisual
      for (const ski of skis) ski.rotation.z = skiRoll
      skis[0].position.y += ip.skiLift[0]
      skis[1].position.y += ip.skiLift[1]
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
          // A herringbone opens the V wider and rolls both skis onto their inside edges;
          // the steps are short and lifted instead of a long glide.
          const h = herring.x
          // Nearly stopped on the flat with alternate arms, the skis stay parallel (a shuffle).
          const shuffle = strideBlend * Math.max(0, Math.min(1, (2.6 - speed) / 1.2)) * (1 - h)
          skis[i].rotation.y += s * ((0.16 + 0.14 * push) * (1 - shuffle) + 0.32 * h) * skateAmount
          skis[i].rotation.z += s * (0.22 * push * (1 - h) + 0.2 * h * skateAmount)
          skis[i].position.x += s * (0.2 * push * (1 - h) * (1 - shuffle) + 0.06 * h * skateAmount)
          skis[i].position.z -= 0.14 * push * (1 - h) - shuffle * 0.12 * push
          skis[i].position.y += (0.06 * (1 - h) + 0.1 * h) * recover * (1 - push)
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

      if (bobbleEnv > 0.01 && !air) {
        // One ski (the one the throw unloads) skips off the snow and comes back down.
        const skip = bobbleEnv * Math.max(0, Math.sin(bobbleAge * 9)) * 0.09
        skis[bobbleSide > 0 ? 1 : 0].position.y += skip
        skis[bobbleSide > 0 ? 1 : 0].rotation.z += bobbleSide * skip * 1.5
      }
      let boardLift = 0
      if (boarding) {
        const lift = (boardLift = air ? 0.18 + grabBlend * 0.2 : 0)
        const grabTilt = air && grabBlend > 0 ? (lastGrab === 'nose' ? -0.35 : lastGrab === 'tail' ? 0.3 : 0) * grabBlend : 0
        // Roll about the engaged edge (the physics edge) and let the nose lead the ollie.
        boardRoll = air ? boardRoll * Math.exp(-9 * dt) : boardEdge
        const roll = boardRoll
        const ollie = air ? -0.24 * Math.max(0, 1 - air.time / 0.27) * stance : 0
        placeBoard(
          shift * 0.6, 0.02 + 0.13 * Math.abs(Math.sin(roll)) + lift + Math.abs(press.x) * 0.07,
          -press.x * 0.1, roll, wiggle + hopUp * 0.12, ollie + grabTilt + (air ? 0 : press.x * 0.28) - hopUp * 0.1,
        )
      }

      // ---- Body ----
      // Idle: a slow weight shift and a look around.
      const idle = boarding ? 0 : stillBlend
      const sway = idle * Math.sin(state.time * 0.8) * 0.025
      // Skating moves the weight over the gliding ski; on a rail the body sways with the balance.
      // The whole body leans with the physics (about the snow under the skis or board).
      // Close call: the body rocks side to side as the rider catches the landing.
      const wobble = bobbleEnv * Math.sin(bobbleAge * 13) * 0.12 + bobbleEnv * bobbleSide * 0.06
      body.rotation.z = incline.x + (rail ? rail.balance * 0.32 : 0) + stride * 0.12 + sway + wobble + ip.sway + Math.sin(sinceSeat * 5.2) * 0.035 * rampBalance
      root.position.y += ip.hop
      // A landing folds the chest down; a close call rocks it back first.
      const landBend = Math.max(0, landFold.x) * 0.35 - bobbleEnv * Math.cos(bobbleAge * 9) * 0.18
      // Moving on snow the back hinges further forward from the hips (about 30° to 40°);
      // standing, in the air and folding into a tuck it keeps the older, more upright fit.
      hingeBlend += ((skiing ? 1 : 0) - hingeBlend) * ease(9, dt)
      const hingeOn = hingeBlend * (1 - stillBlend) * (1 - THREE.MathUtils.clamp(tuck.x, 0, 1))
      const bend = 0.12 + (SKI_HINGE - 0.12) * hingeOn + flex * (0.72 + (SKI_HINGE_FLEX - 0.72) * hingeOn) + landBend + herring.x * 0.2 + tuck.x * 0.6 + press.x * 0.18 + skateAmount * 0.18 + plow.x * 0.05 + doublePole * dp.crunch + rise * 0.32
      legFollow += ((skiing ? 1 : 0) - legFollow) * ease(10, dt)
      /** Board tuck: how far the hips and chest open toward the nose (reversed riding switch). */
      const tuckTurn = THREE.MathUtils.clamp(tuck.x, 0, 1) * (1 - 2 * switchLook)
      if (boarding) {
        // Facing the toes, open a little toward the nose. In the hips' frame +Z is
        // now the toe edge and +X the nose, so leaning across the board is about X.
        // (A tuck opens the hips further toward the nose.)
        hips.rotation.y = -Math.PI / 2 + 0.25 + tuckTurn * 0.4 + bSkate * 0.7
        // Skating, the weight rides the front foot.
        const foreAft = (1 - 2 * switchLook) * (0.04 + tuck.x * 0.09) + bSkate * 0.15
        // The legs' line leans off the board normal by the lean the board's roll does
        // not take, plus a little toward the toes (shins into the tongues) or back over
        // the heels (sitting into the highbacks).
        const roll = boardGroup.rotation.z
        const legLean = THREE.MathUtils.clamp(incline.x - roll, -0.45, 0.45) * legFollow +
          (toeSide(boardEdge) * BOARD_TOE_LEAN - heelSide(boardEdge) * BOARD_HEEL_SIT) * legFollow
        placeBoardHips(flex, legLean, foreAft, boardLift)
        // Torso: a forward hinge plus a share of the lean, so on the toe edge it stays
        // fairly upright over the toes and on the heel edge the chest comes over the knees.
        const keep = incline.x > 0 ? BOARD_TORSO_TOE : BOARD_TORSO_HEEL
        const toeIn = toeSide(boardEdge) * legFollow
        const hinge = (BOARD_HINGE + flex * 0.35) * (1 - toeIn * BOARD_TOE_UPRIGHT) * (1 - THREE.MathUtils.clamp(tuck.x, 0, 1) * 0.65)
        // A board tuck is a low crouch over the board with the chest turned toward the nose
        // and folded over the front knee, not a bow over the toe edge: most of the tuck's
        // fold goes on the turned back (below), only a little on the hips.
        const tuckFold = THREE.MathUtils.clamp(tuck.x, 0, 1) * 0.42
        const torso = hinge + landBend + tuck.x * 0.15 + press.x * 0.18 + keep * incline.x - incline.x
        // The pelvis tips with the fold (hips flex), so the back is not doing all of it.
        hips.rotation.x = torso * BOARD_PELVIS_SHARE
        spine.rotation.x = (torso * (1 - BOARD_PELVIS_SHARE) + tuckFold) * 0.55
        chest.rotation.x = (torso * (1 - BOARD_PELVIS_SHARE) + tuckFold) * 0.45
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
        ? 0.45 - switchLook * 0.78 + look.x * 0.28 + spinLead * 0.5 - boardLead.x - wiggle * 1.4 + tuckTurn * 0.45 + bSkate * (0.2 + 0.12 * Math.sin(boardSkatePhase * Math.PI * 2))
        : counter.x * 0.7 + spinLead * 0.5 + switchLook * 0.25 + railLook * 0.55 - stride * 0.12
      spine.rotation.y = upperTwist * 0.55
      chest.rotation.y = upperTwist * 0.45
      // Head looks where the skier is going; up the hill in a tuck.
      head.rotation.x = boarding
        ? -Math.max(0, hips.rotation.x + spine.rotation.x + chest.rotation.x) * 0.8 - tuck.x * 0.22
        : -bend * 0.8 - tuck.x * 0.22 + idle * Math.sin(state.time * 0.5) * 0.06
      head.rotation.y = boarding
        ? 0.75 - switchLook * 1.55 + look.x * 0.5 + spinLead * 0.4 - boardLead.x * 0.6
        : -counter.x * 0.3 + look.x + spinLead * 0.4 + switchLook * stance * 1.15 * (state.heading > 0 ? 1 : -1) + railLook * 0.4 +
          idle * Math.sin(state.time * 0.37) * 0.35
      // On snow the head stays near level with the horizon, whatever the body does.
      head.rotation.z = levelHead() * HEAD_LEVEL * legFollow
      // Breathing, standing still.
      spine.rotation.x += stillBlend * Math.sin(state.time * 1.6) * 0.012
      chest.rotation.x += stillBlend * Math.sin(state.time * 1.6 - 0.5) * 0.01
      if (ip.kind) {
        spine.rotation.x += ip.spineX * 0.6
        chest.rotation.x += ip.spineX * 0.4
        spine.rotation.z += ip.spineZ * 0.6
        chest.rotation.z += ip.spineZ * 0.4
        head.rotation.x += ip.headX
        head.rotation.y += ip.headY
        head.rotation.z += ip.headZ
      }

      const grabSpecs = grabBlend > 0.02 && air ? grabSpecsFor(lastGrab, boarding) : []
      if (grabSpecs.length > 0) foldForGrab(grabSpecs, grabBlend, `${lastGrab}`)
      else grabWarmKey = ''
      if (!boarding && legFollow > 0.001) placeHipsOverSkis(edgeVisual, skateAmount > 0.01 ? stride : 0, legFollow)
      if (idle > 0.01) {
        // Standing around, the weight settles on one leg and now and then moves to the other:
        // the hips slide over that ski and drop on the resting side, the shoulders stay level.
        const rest = Math.tanh(Math.sin(state.time * 0.19 + 0.6) * 2.5) * idle
        hips.position.x += rest * 0.04
        hips.rotation.z += rest * 0.07
        spine.rotation.z -= rest * 0.06
        chest.rotation.z -= rest * 0.03
      }
      if (boarding && bSkate > 0.001) {
        // The free foot, in root space: beside the board on the toe side, planted level with the
        // front foot, sliding back as the board glides on, then lifted and swung forward.
        const along = pushing > 0 ? 0.16 - pushing * 0.46 : -0.3 + smooth(swinging) * 0.46
        const lift = swinging > 0 ? Math.sin(swinging * Math.PI) * 0.11 : 0
        freeFoot.set(-0.27, 0.005 + lift, along)
        skis[1].position.lerp(freeFoot, smooth(bSkate))
        // Toes forward, a little out; the heel comes up as the push finishes.
        qFoot.setFromEuler(new THREE.Euler(pushing > 0.6 ? (pushing - 0.6) * 0.9 : swinging > 0 ? 0.36 * (1 - swinging) : 0, -0.2, 0, 'YXZ'))
        skis[1].quaternion.slerp(qFoot, smooth(bSkate))
      }
      fitLegs(boarding)

      // ---- Arms ----
      // Targets are in chest space: the shoulders sit at (±0.215, 0.21, 0).
      const cruise = skiing && !still && !tucked && !braking && !skating && speed > 1 && speed < 14 ? 1 : 0
      const breathe = idle * Math.sin(state.time * 1.6) * 0.01 + cruise * Math.sin(state.time * 1.1) * 0.006
      const idleHand =
        idle * 0.04 * Math.sin(state.time * 0.55) +
        cruise * 0.025 * Math.sin(state.time * 0.9 + 0.4)
      const handsBack = Math.max(0, Math.min(1, airBlend.x)) * (1 - grabBlend)
      elbowDrop += ((skiing && !boarding ? 1 - Math.min(1, Math.max(0, tuck.x)) : 0) - elbowDrop) * ease(8, dt)
      for (let i = 0; i < 2; i++) {
        const side = arms[i].side
        const inside = Math.sign(incline.x) === -side ? 1 : 0 // left hand (side 1) is inside on a left turn (incline < 0)
        const planting = plantSide === side && skiing ? plantWeight : 0
        // Hands forward and a little wide, about belt height, as if holding a tray
        // (HAND_DROP below the chest keeps them there over the athletic stance).
        // In a turn the inside hand reaches forward and down toward the next plant; the outside one stays wide.
        // Both hands stay in front (seen from behind, they show either side of the
        // hips): the inside hand comes forward and a little up to lead the turn, the
        // outside one stays a touch wider and lower by the outside knee.
        const lean = Math.min(1, Math.abs(incline.x))
        const hand = v1.set(
          side * (0.34 + (1 - inside) * lean * 0.04) + side * idleHand * 0.35,
          -HAND_DROP + CARRY_LIFT * (1 - idle) + breathe + inside * lean * 0.04 - (1 - inside) * lean * 0.12 + idle * Math.sin(state.time * 1.3 + side) * 0.012,
          0.36 + inside * lean * 0.06 + (1 - inside) * lean * 0.1 + cruise * Math.sin(state.time * 0.7 + side) * 0.02,
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
        // Terrain style: hands out front on steeps and at speed, wide on ice.
        hand.x += side * (iceStyle.x * 0.08 + steepStyle.x * 0.03)
        hand.z += steepStyle.x * 0.07 + fastStyle.x * 0.05
        hand.y += steepStyle.x * 0.03 - fastStyle.x * 0.03
        // Close call: arms windmill out and up for balance.
        if (bobbleEnv > 0.01) {
          const swing = Math.sin(bobbleAge * 11 + side * 1.7)
          hand.x += side * bobbleEnv * 0.2
          hand.y += bobbleEnv * (0.16 + swing * 0.14)
          hand.z += bobbleEnv * swing * 0.12
        }
        // Deep carve: inside hand drops toward the snow.
        if (skiing && Math.abs(edge) > 0.45) {
          const insideDrop = Math.min(1, (Math.abs(edge) - 0.45) / 0.35)
          if (Math.sign(edge) === side) hand.y -= insideDrop * 0.08
        }
        // Skating: the arm opposite the pushing leg swings forward.
        hand.z -= side * stride * 0.2
        hand.y += Math.abs(stride) * 0.04
        // The chest pitches forward with the crouch, which carries chest-space hands down
        // toward the knees: lift them back to the belt line (skiers hold their hands up as
        // they flex, they do not let them sink with the chest).
        hand.y += Math.max(0, bend - SKI_HINGE) * PITCH_HAND_LIFT * hingeOn
        hand.z -= Math.max(0, bend - SKI_HINGE) * PITCH_HAND_LIFT * 0.3 * hingeOn
        // Standing still the arms hang relaxed: hands lower and closer in, resting on the grips.
        hand.lerp(v2.set(side * 0.27 + side * idleHand * 0.35, -0.2 + breathe, 0.25), idle * 0.85)
        if (rampBalance > 0.001) {
          // One hand pushes off the seat behind the hip, then both ride wide and forward,
          // rocking a little as the skis find the snow.
          const pushOff = side < 0 ? 1 - smooth(Math.min(1, sinceSeat / 0.5)) : 0
          hand.lerp(v2.set(side * 0.44, 0.0 + Math.sin(sinceSeat * 6.5 + side) * 0.03, 0.3), rampBalance * 0.8)
          hand.lerp(v2.set(side * 0.3, -0.3, -0.12), pushOff * 0.8)
        }
        keepElbowBent(i, hand)
        // Holding a grab, the free arm swings out and up for balance (and clear of the knees
        // the grab pulls up); the grab itself is placed after this.
        const freeArm = grabBlend * Math.min(1, airBlend.x)
        hand.x += side * freeArm * 0.2
        hand.y += freeArm * 0.12
        hand.z -= freeArm * 0.08
        // Racing tuck: fists together in front of the chin, elbows inside the knees.
        hand.lerp(v2.set(side * 0.1, 0.27, 0.43), Math.max(0, Math.min(1, tuck.x)))
        hand.lerp(v2.set(side * 0.38, 0.0, 0.3), brake.x * 0.7)
        hand.lerp(v2.set(side * 0.34, -0.02, 0.44), plow.x * 0.6)
        // Double pole: both arms reach, drive down past the hips, swing back through.
        hand.lerp(v2.set(side * dp.handX, dp.handY, dp.handZ), doublePole)
        // In the air the hands stay out in front and a little wide, about chest height (spread
        // flat to the sides with the poles out, it read as flapping).
        hand.lerp(v2.set(side * 0.44, 0.02, 0.3), handsBack)
        // Arms out for balance on a rail; the low side reaches further.
        if (rail) {
          const pressAmt = press.x
          // Nose press: arms counterbalance aft; tail press: arms reach forward over the tip.
          const pressX = side * (0.5 + Math.max(0, side * rail.balance) * 0.14 + Math.abs(pressAmt) * 0.08)
          const pressY = 0.02 - side * rail.balance * 0.14 + Math.abs(pressAmt) * 0.06
          const pressZ = 0.2 - pressAmt * 0.22
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
          // Relaxed arms, hands about hip height and a little away from the body: the front
          // hand over the nose side, the back one by the back hip. (They used to ride up at
          // the chest with the elbows folded tight, which read as stiff.)
          hand.set(front ? 0.38 : -0.32, front ? -0.17 : -0.22, 0.22 + Math.abs(incline.x) * 0.06)
          // Skating, the arms swing against the pushing leg like a walk.
          hand.z += bSkate * (front ? -1 : 1) * Math.cos(boardSkatePhase * Math.PI * 2) * 0.1
          hand.x += bSkate * (front ? -0.06 : 0.1)
          // Heelside both hands come forward over the toes to balance the sit; toeside the
          // front hand reaches low over the toe edge and the back hand trails out by the tail.
          const heel = skiing ? heelSide(boardEdge) : 0
          const toes = skiing ? toeSide(boardEdge) : 0
          hand.lerp(v2.set(front ? 0.44 : -0.3, front ? 0.03 : 0, front ? 0.32 : 0.36), heel * 0.85)
          hand.lerp(v2.set(front ? 0.34 : -0.42, front ? -0.26 : -0.14, front ? 0.3 : 0.04), toes * 0.8)
          keepElbowBent(i, hand, 0.9)
          // Tuck: the front hand low ahead of the front knee, the back hand tucked behind the back.
          hand.lerp(v2.set(front ? 0.2 : -0.2, front ? -0.06 : -0.14, front ? 0.3 : -0.1), THREE.MathUtils.clamp(tuck.x, 0, 1))
          hand.lerp(v2.set(side * 0.48, front ? 0.04 : -0.04, 0.16), Math.max(handsBack, Math.min(1, railBlend.x)))
          if (rig.firstPerson) hand.y += 0.3
          if (bobbleEnv > 0.01) {
            const swing = Math.sin(bobbleAge * 11 + side * 1.7)
            hand.y += bobbleEnv * (0.2 + swing * 0.16)
            hand.x += side * bobbleEnv * 0.12
          }
          // Low over the edge in a carve, never into the snow.
          if (skiing) {
            pointInRoot(chest, hand, handRoot)
            if (handRoot.y < BOARD_HAND_FLOOR) {
              handRoot.y = BOARD_HAND_FLOOR
              rootToLocal(chest, handRoot, hand)
            }
          }
        }
        // Follow-through: the hands carry a little weight, so they lag a quick change
        // (an edge change, landing, a push) and settle instead of snapping. A plant
        // stiffens the spring so the reach stays crisp.
        const hs = handSprings[i]
        if (!handSpringsLive) {
          hs[0].x = hand.x
          hs[1].x = hand.y
          hs[2].x = hand.z
          for (const k of hs) k.v = 0
        }
        const hz = HAND_HZ + planting * 6 + Math.min(1, railBlend.x + airBlend.x) * 3
        hand.set(hs[0].step(hand.x, dt, hz, HAND_ZETA), hs[1].step(hand.y, dt, hz, HAND_ZETA), hs[2].step(hand.z, dt, hz, HAND_ZETA))
        const idleTarget = ip.hands[i]
        if (idleTarget) hand.lerp(v2.set(idleTarget.x, idleTarget.y, idleTarget.z), idleTarget.w)
        const handLocal = hand.clone()
        // Pole tip: carried just off the snow behind the boots, planted on a plant,
        // under the arms in a tuck.
        const tipTarget = carriedTip(side, handLocal, v3)
        // Standing, the poles rest planted just outside the boots.
        tipTarget.lerp(v2.set(side * 0.4, 0, 0.2), idle)
        // The tip strikes beside its own ski (the skis have slid out under the lean, so a
        // spot fixed to the root's centre stretched the pole out sideways).
        if (planting > 0) tipTarget.lerp(v2.set(skis[side === 1 ? 0 : 1].position.x + side * 0.28, -0.02, Math.max(-0.6, PLANT_AHEAD - speed * Math.max(0, plantAge - PLANT_REACH))), planting)
        if (skateAmount > 0.01) {
          // Each pole plants beside the boots as its arm comes forward, then pushes back.
          const reach = Math.max(0, -side * stride)
          tipTarget.lerp(v2.set(side * 0.5, 0, 0.3 - (1 - reach) * 0.9), skateAmount)
          // Herringbone: poles planted behind and wide, pushing up the hill.
          tipTarget.lerp(v2.set(side * 0.6, 0, -0.45 - reach * 0.2), herring.x)
        }
        tipTarget.lerp(v2.set(side * 0.42, dp.tipY, dp.tipZ), doublePole)
        tipTarget.lerp(v2.set(side * 0.22, 0.95, -1.15), Math.max(0, Math.min(1, tuck.x)))
        // On a rail the poles go out wide for balance; in the air they trail back from the hands.
        tipTarget.lerp(v2.set(side * 0.9, 0.3, -0.5), Math.max(0, Math.min(1, railBlend.x)))
        if (airBlend.x > 0.01 && !rail) tipTarget.lerp(v2.copy(airTip(side, handLocal)), Math.max(0, Math.min(1, airBlend.x)))
        // A hand busy with an idle lets its pole hang from the strap, tip just off the snow.
        if (idleTarget) tipTarget.lerp(v2.set(side * 0.3, 0.02, 0.2), idleTarget.w)
        placeArm(i, handLocal, tipTarget.clone())
      }
      if (grabSpecs.length > 0) {
        // Reach a point on the equipment so the hand moves with it.
        for (const spec of grabSpecs) {
          const target = grabPoint(spec, v1)
          root.updateMatrixWorld(true)
          const current = root.worldToLocal(arms[spec.hand].hand.getWorldPosition(v2))
          target.lerp(current, 1 - grabBlend)
          // The grabbing hand's pole trails back and out from the grip, not off to a fixed spot.
          const tipAt = v3.set(arms[spec.hand].side * 0.35, 0.25, -0.9).normalize().multiplyScalar(POLE_REACH).add(target)
          placeArm(spec.hand, target.clone(), tipAt.clone(), true)
        }
      }
      handSpringsLive = true
      applyFade(dt)
      syncBackBoot()
      rig.applyCloth()
    },
  }
}

/**
 * Idle props in the right hand: a can of beer and a cigarette (with an ember).
 * Built in code, hidden unless an idle move holds one.
 */
function createIdleProps(hand: THREE.Object3D) {
  const can = new THREE.Group()
  can.name = 'idle-can'
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.118, 14), new THREE.MeshStandardMaterial({ color: '#c8ccd2', metalness: 0.75, roughness: 0.3 }))
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0315, 0.0315, 0.07, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#1f5fbf', roughness: 0.5 }))
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.02), new THREE.MeshStandardMaterial({ color: '#9aa0a8', metalness: 0.8, roughness: 0.3 }))
  tab.position.set(0, 0.06, 0.008)
  can.add(body, label, tab)
  // In the fist: the bone hangs down -Y; the can sits across the palm, top toward the thumb.
  can.position.set(0, -0.085, 0.035)
  can.rotation.set(0.25, 0, 0)
  const cigarette = new THREE.Group()
  cigarette.name = 'idle-cigarette'
  const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.075, 8), new THREE.MeshStandardMaterial({ color: '#f2efe8', roughness: 0.8 }))
  const filter = new THREE.Mesh(new THREE.CylinderGeometry(0.0047, 0.0047, 0.022, 8), new THREE.MeshStandardMaterial({ color: '#c98a3c', roughness: 0.8 }))
  filter.position.y = -0.048
  const emberMaterial = new THREE.MeshStandardMaterial({ color: '#331100', emissive: new THREE.Color('#ff5a1a'), emissiveIntensity: 1.2 })
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.0052, 8, 6), emberMaterial)
  ember.position.y = 0.04
  cigarette.add(paper, filter, ember)
  // Pinched between the fingers, pointing forward out of the fist.
  cigarette.position.set(0, -0.1, 0.03)
  cigarette.rotation.set(Math.PI / 2, 0, 0)
  for (const prop of [can, cigarette]) {
    prop.visible = false
    prop.traverse((o) => (o.castShadow = true))
    hand.add(prop)
  }
  return {
    show(pose: IdlePose) {
      can.visible = pose.prop === 'can'
      tab.rotation.x = pose.canOpen ? -0.9 : 0
      // Tipped up to drink.
      can.rotation.x = 0.25 - pose.sip * 1.3
      cigarette.visible = pose.prop === 'cigarette'
      // The ember brightens on a drag.
      emberMaterial.emissiveIntensity = pose.kind === 'smoke' && pose.hands[1] && Math.abs(pose.hands[1].y - 0.33) < 0.03 ? 3 : 1.2
    },
  }
}
