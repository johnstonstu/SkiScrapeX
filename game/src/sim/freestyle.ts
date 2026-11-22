import { PHYSICS } from './constants'
import { nearestRail, railAt, railLength, type Rail } from './rails'
import type { SampleTerrain } from './slopes'
import { clamp, dot, moveTowardZero, projectOnPlane, wrapAngle, type Vec3 } from './vec'

/**
 * Freestyle: pop, air rotation, grabs, landing grades and rails.
 * Model and starting values from game/research/ski-physics-and-freestyle.md
 * (POWDER LINE, SnowGlider and Bord techniques reimplemented; equivalent fall
 * height from McNeil and Hubbard). No code is copied from those projects.
 */
export const FREESTYLE = {
  /** Pop speed along the surface normal at zero and full charge, m/s. */
  popMin: 1.2,
  popMax: 3.0,
  /** Seconds to reach full crouch charge. */
  chargeTime: 0.4,
  spinRateMax: 7.9,
  /** Spin rate (rad/s) past which pitch corks the spin instead of flipping. */
  corkSpinRate: 3,
  /** Cork tilt rates in and out, per second. */
  corkIn: 2.6,
  corkOut: 2.2,
  spinAccel: 14,
  flipRateMax: 5.7,
  flipAccel: 10,
  /** Rotation authority in the air without pre-wind (0..1). */
  airAuthority: 0.6,
  /** In the last this-many seconds before landing, rotation snaps to a landable angle. */
  assistWindow: 0.45,
  /** Equivalent fall height limits, metres: perfect, clean, sketchy. */
  efhPerfect: 0.8,
  efhClean: 1.8,
  efhSketchy: 3.5,
  /** Rail capture: horizontal reach beyond half width, vertical window around the top. */
  railReach: 0.6,
  railBelow: -0.15,
  railAbove: 0.35,
  railMaxRise: 0.8,
  railAlignDeg: 35,
  railFriction: 0.06,
  boxFriction: 0.04,
  /** Balance is an unstable pendulum: b'' = λ² b − c b' + K·steer + noise. */
  balanceLambda: 1.9,
  balanceDamping: 1.0,
  balanceGain: 8,
  /** Curvature takeoff: leave the snow when moving away from the next surface faster than this, m/s. */
  takeoffNormalSpeed: 1.5,
  crashTime: 1.6,
} as const

export type GrabKind = 'mute' | 'safety' | 'japan' | 'tail' | 'nose' | 'critical' | 'truck'
export type LandingGrade = 'perfect' | 'clean' | 'sketchy' | 'crash'

export interface TrickEvent {
  /** Increments on every event so the game can tell new ones apart. */
  seq: number
  kind: 'air' | 'rail'
  name: string
  points: number
  grade: LandingGrade
  efh: number
  airTime: number
  spinDeg: number
  flips: number
  grab: GrabKind | null
  grabTime: number
  switchLanding: boolean
  railMetres: number
}

export interface AirState {
  time: number
  spin: number
  spinRate: number
  flip: number
  flipRate: number
  grab: GrabKind | null
  grabTime: number
  /** Seconds until the predicted landing, or Infinity. */
  timeToLand: number
  predictedFrom: number
  /** 0..1 tilt of the spin axis: a cork. Signed by the stick (forward or back). */
  cork: number
  /** Seconds spent with the axis tilted past halfway. */
  corkTime: number
}

export interface RailState {
  rail: Rail
  s: number
  /** Signed speed along the rail tangent, m/s. */
  vs: number
  /** -1..1 balance; past ±1 the skier falls off. */
  balance: number
  balanceRate: number
  style: '5050' | 'slide'
  /** Heading relative to the rail tangent, kept while sliding. */
  headingOffset: number
  entrySpeed: number
  metres: number
}

export function newAir(windup: number): AirState {
  return {
    time: 0,
    spin: 0,
    spinRate: windup * FREESTYLE.spinRateMax,
    flip: 0,
    flipRate: 0,
    grab: null,
    grabTime: 0,
    timeToLand: Infinity,
    predictedFrom: 0,
    cork: 0,
    corkTime: 0,
  }
}

/** Rotate in the air toward the stick, with a landing snap assist near touchdown. */
export function stepRotation(
  air: AirState,
  input: { steer: number; pitch: number; grab: boolean; grabKind?: GrabKind },
  dt: number,
  assist: boolean,
): number {
  air.time += dt
  const authority = Math.abs(air.spinRate) > 0.5 ? 1 : FREESTYLE.airAuthority
  const spinTarget = input.steer * FREESTYLE.spinRateMax * authority
  // Pitch during an established spin tilts the spin axis (a cork) instead of
  // starting a flip. Letting go brings the axis back level for the landing.
  const spinning = Math.abs(air.spinRate) > FREESTYLE.corkSpinRate
  const corking = spinning && Math.abs(input.pitch) > 0.4 && Math.abs(air.flip) < 0.3
  const corkTarget = corking ? Math.sign(input.pitch) : 0
  air.cork = approach(air.cork, corkTarget, (corking ? FREESTYLE.corkIn : FREESTYLE.corkOut) * dt)
  if (Math.abs(air.cork) > 0.5) air.corkTime += dt
  const flipTarget = corking || Math.abs(air.cork) > 0.05 ? 0 : input.pitch * FREESTYLE.flipRateMax
  air.spinRate = approach(air.spinRate, spinTarget, FREESTYLE.spinAccel * dt)
  air.flipRate = approach(air.flipRate, flipTarget, FREESTYLE.flipAccel * dt)

  if (assist && air.timeToLand < FREESTYLE.assistWindow) {
    const left = Math.max(air.timeToLand, 0.05)
    const spinGoal = nearestMultiple(air.spin, Math.PI, air.spinRate)
    const flipGoal = nearestMultiple(air.flip, Math.PI * 2, air.flipRate)
    air.spinRate = clamp((spinGoal - air.spin) / left, -FREESTYLE.spinRateMax * 1.2, FREESTYLE.spinRateMax * 1.2)
    air.flipRate = clamp((flipGoal - air.flip) / left, -FREESTYLE.flipRateMax * 1.2, FREESTYLE.flipRateMax * 1.2)
    air.cork = approach(air.cork, 0, (Math.abs(air.cork) / left) * dt * 1.2)
  }
  const dSpin = air.spinRate * dt
  air.spin += dSpin
  air.flip += air.flipRate * dt
  air.timeToLand -= dt

  if (input.grab) {
    if (!air.grab) air.grab = input.grabKind ?? 'mute'
    air.grabTime += dt
  } else if (air.grab && air.grabTime < 0.15) {
    // A tap shorter than this does not count as a grab.
    air.grab = null
    air.grabTime = 0
  }
  return dSpin
}

/** Ballistic look-ahead for the assist and the camera. Returns seconds to touchdown or Infinity. */
export function predictLanding(
  position: Vec3,
  velocity: Vec3,
  sampleTerrain: SampleTerrain,
  horizon = 3,
  step = 0.04,
): number {
  let { x, y, z } = position
  let vy = velocity.y
  for (let t = step; t <= horizon; t += step) {
    x += velocity.x * step
    z += velocity.z * step
    vy -= PHYSICS.gravity * step
    y += vy * step
    const ground = sampleTerrain(x, z)
    if (!ground) return Infinity
    if (y <= ground.height) return t
  }
  return Infinity
}

export interface LandingResult {
  grade: LandingGrade
  efh: number
  spinErrDeg: number
  flipErrDeg: number
  switchLanding: boolean
  /** Multiply tangential speed by this. */
  keep: number
}

/**
 * Grade a touchdown from the equivalent fall height (normal impact), how far
 * the skis are from the direction of travel (switch allowed) and how far the
 * body is from upright.
 */
export function gradeLanding(
  velocity: Vec3,
  normal: Vec3,
  heading: number,
  air: AirState,
  grabHeld: boolean,
): LandingResult {
  const vn = dot(velocity, normal)
  const efh = (vn * vn) / (2 * PHYSICS.gravity)
  const tangent = projectOnPlane(velocity, normal)
  const travel = Math.atan2(-tangent.x, tangent.z)
  const misalign = Math.abs(wrapAngle(heading - travel))
  const switchLanding = misalign > Math.PI / 2
  const spinErr = switchLanding ? Math.PI - misalign : misalign
  // Landing still corked is landing off-axis.
  const flipErr = Math.abs(wrapAngle(air.flip)) + Math.abs(air.cork) * (70 * Math.PI) / 180
  const spinErrDeg = (spinErr * 180) / Math.PI
  const flipErrDeg = (flipErr * 180) / Math.PI
  const speed = Math.hypot(tangent.x, tangent.y, tangent.z)
  const slow = speed < 2

  let grade: LandingGrade
  if ((spinErrDeg < 8 || slow) && flipErrDeg < 10 && efh < FREESTYLE.efhPerfect && !grabHeld) grade = 'perfect'
  else if ((spinErrDeg < 15 || slow) && flipErrDeg < 20 && efh < FREESTYLE.efhClean) grade = 'clean'
  else if ((spinErrDeg < 45 || slow) && flipErrDeg < 50 && efh < FREESTYLE.efhSketchy && !(grabHeld && flipErrDeg > 30)) grade = 'sketchy'
  else grade = 'crash'

  const keep =
    grade === 'perfect' ? 1.03 : grade === 'clean' ? 1 : grade === 'sketchy' ? 1 - (0.15 + 0.2 * Math.min(1, efh / 3)) : 0
  return { grade, efh, spinErrDeg, flipErrDeg, switchLanding, keep }
}

/** Trick name such as "Switch 540 Mute" or "Backflip Japan". */
export function trickName(spin: number, flip: number, grab: GrabKind | null, switchTakeoff: boolean, corkTime = 0): string {
  const spinDeg = Math.round(Math.abs(spin) / Math.PI) * 180
  const flips = Math.round(Math.abs(flip) / (Math.PI * 2))
  const parts: string[] = []
  if (switchTakeoff) parts.push('Switch')
  const cork = corkLevel(spinDeg, corkTime)
  if (cork) parts.push(cork === 2 ? 'Double Cork' : 'Cork')
  if (flips > 0) {
    const count = flips === 1 ? '' : flips === 2 ? 'Double ' : flips === 3 ? 'Triple ' : `${flips}x `
    parts.push(`${count}${flip > 0 ? 'Front' : 'Back'}flip`)
  }
  if (spinDeg > 0) parts.push(String(spinDeg))
  if (grab) parts.push(GRAB_NAMES[grab])
  if (!parts.length || (parts.length === 1 && switchTakeoff)) parts.push('Air')
  return parts.join(' ')
}

export const GRAB_NAMES: Record<GrabKind, string> = {
  mute: 'Mute',
  safety: 'Safety',
  japan: 'Japan',
  tail: 'Tail Grab',
  nose: 'Nose Grab',
  critical: 'Critical',
  truck: 'Truck Driver',
}

/** Harder or more stylish grabs score a little more per second held. */
export const GRAB_STYLE: Record<GrabKind, number> = { mute: 1, safety: 1, tail: 1, nose: 1.1, japan: 1.15, critical: 1.15, truck: 1.3 }

const GRADE_FACTOR: Record<LandingGrade, number> = { perfect: 1.25, clean: 1, sketchy: 0.5, crash: 0 }

/** 0 no cork, 1 cork (540+ held off-axis 0.25 s), 2 double cork (1080+ held 0.7 s). */
export function corkLevel(spinDeg: number, corkTime: number): 0 | 1 | 2 {
  if (spinDeg >= 1080 && corkTime >= 0.7) return 2
  if (spinDeg >= 540 && corkTime >= 0.25) return 1
  return 0
}

export function trickPoints(air: AirState, grade: LandingGrade): number {
  const spinHalf = Math.round(Math.abs(air.spin) / Math.PI)
  const flips = Math.round(Math.abs(air.flip) / (Math.PI * 2))
  const base = 120 * air.time + 280 * spinHalf + 900 * flips + 320 * Math.min(air.grabTime, 2) * (air.grab ? GRAB_STYLE[air.grab] : 1)
  const cork = corkLevel(Math.round(Math.abs(air.spin) / Math.PI) * 180, air.corkTime)
  return Math.round(base * GRADE_FACTOR[grade] * (cork === 2 ? 1.7 : cork === 1 ? 1.35 : 1))
}

/** Snap onto a rail if position, height, vertical speed and direction all fit. */
export function tryCaptureRail(
  rails: readonly Rail[],
  position: Vec3,
  velocity: Vec3,
  heading: number,
): RailState | null {
  if (!rails.length) return null
  const hit = nearestRail(rails, position.x, position.z, FREESTYLE.railReach)
  if (!hit) return null
  const dy = position.y - hit.top
  if (dy < FREESTYLE.railBelow || dy > FREESTYLE.railAbove) return null
  const vAlong = dot(velocity, hit.tangent)
  const riseRelative = velocity.y - vAlong * hit.tangent.y
  if (riseRelative > FREESTYLE.railMaxRise) return null
  const horizontal = Math.hypot(velocity.x, velocity.z)
  if (horizontal < 1) return null
  const tangentHeading = Math.atan2(-hit.tangent.x, hit.tangent.z)
  const travel = Math.atan2(-velocity.x, velocity.z)
  const travelOff = Math.abs(wrapAngle(travel - tangentHeading))
  const align = (FREESTYLE.railAlignDeg * Math.PI) / 180
  if (travelOff > align && Math.PI - travelOff > align) return null
  // Skis along the rail (50-50) or across it (slide), either way round.
  const skiOff = wrapAngle(heading - tangentHeading)
  const along = Math.min(Math.abs(skiOff), Math.PI - Math.abs(skiOff))
  const style: RailState['style'] = along < align ? '5050' : Math.abs(along - Math.PI / 2) < align ? 'slide' : '5050'
  const headingOffset =
    style === '5050' ? (Math.abs(skiOff) < Math.PI / 2 ? 0 : Math.PI) : Math.sign(skiOff || 1) * (Math.PI / 2)
  return {
    rail: hit.rail,
    s: hit.s,
    vs: vAlong,
    balance: 0,
    balanceRate: 0,
    style,
    headingOffset,
    entrySpeed: Math.abs(vAlong),
    metres: 0,
  }
}

export type RailOutcome = 'riding' | 'end' | 'fell'

/** Slide along the rail: gravity along the tangent, friction, drag and the balance pendulum. */
export function stepRail(rail: RailState, steer: number, dt: number, noise: number): RailOutcome {
  const { tangent } = railAt(rail.rail, rail.s)
  const mu = rail.rail.kind === 'box' ? FREESTYLE.boxFriction : FREESTYLE.railFriction
  const normalShare = Math.sqrt(Math.max(0, 1 - tangent.y * tangent.y))
  rail.vs += -PHYSICS.gravity * tangent.y * dt
  rail.vs = moveTowardZero(rail.vs, mu * PHYSICS.gravity * normalShare * dt)
  const drag = (0.5 * PHYSICS.airDensity * PHYSICS.dragAreaUpright * rail.vs * rail.vs) / PHYSICS.mass
  rail.vs = moveTowardZero(rail.vs, drag * dt)
  const ds = rail.vs * dt
  rail.s += ds
  rail.metres += Math.abs(ds)

  const { balanceLambda: l, balanceDamping: c, balanceGain: k } = FREESTYLE
  // Boxes are wider and more forgiving.
  const width = rail.rail.kind === 'box' ? 0.55 : 1
  const accel = (l * l * width) * rail.balance - c * rail.balanceRate + k * steer + noise
  rail.balanceRate += accel * dt
  rail.balance += rail.balanceRate * dt
  if (Math.abs(rail.balance) > 1) return 'fell'
  if (rail.s < 0 || rail.s > railLength(rail.rail) || Math.abs(rail.vs) < 0.3) return 'end'
  return 'riding'
}

export function railPoints(rail: RailState): number {
  return Math.round(150 + 60 * rail.metres + (rail.style === 'slide' ? 100 : 0))
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step)
}

/** Nearest multiple of `unitAngle` ahead in the direction of `rate` (or nearest if stopped). */
function nearestMultiple(angle: number, unitAngle: number, rate: number): number {
  const k = angle / unitAngle
  if (Math.abs(rate) < 0.5) return Math.round(k) * unitAngle
  const ahead = rate > 0 ? Math.ceil(k - 0.25) : Math.floor(k + 0.25)
  return ahead * unitAngle
}

export interface LandingPrediction {
  x: number
  y: number
  z: number
  normal: { x: number; y: number; z: number }
  /** Seconds until touchdown. */
  time: number
  /** Rotation will line up with the landing (within clean-landing tolerances). */
  lined: boolean
}

/**
 * Where an airborne skier comes down if nothing changes: a ballistic arc
 * (gravity only, drag ignored) stepped until it meets the terrain. The
 * rotation check extrapolates the current spin and flip rates.
 */
export function landingSpot(
  pos: { x: number; y: number; z: number; vx: number; vy: number; vz: number },
  air: Pick<AirState, 'spin' | 'spinRate' | 'flip' | 'flipRate'>,
  sampleTerrain: (x: number, z: number) => { height: number; normal: { x: number; y: number; z: number } } | null,
  gravity = 9.81,
  maxTime = 4,
  step = 1 / 40,
): LandingPrediction | null {
  let { x, y, z, vy } = pos
  for (let t = step; t <= maxTime; t += step) {
    x += pos.vx * step
    z += pos.vz * step
    vy -= gravity * step
    y += vy * step
    const ground = sampleTerrain(x, z)
    if (!ground) return null
    if (y <= ground.height) {
      const spin = air.spin + air.spinRate * t
      const flip = air.flip + air.flipRate * t
      const half = Math.PI
      const spinErr = Math.abs(spin - Math.round(spin / half) * half)
      const flipErr = Math.abs(flip - Math.round(flip / (2 * half)) * 2 * half)
      return { x, y: ground.height, z, normal: ground.normal, time: t, lined: spinErr < (25 * Math.PI) / 180 && flipErr < (30 * Math.PI) / 180 }
    }
  }
  return null
}
