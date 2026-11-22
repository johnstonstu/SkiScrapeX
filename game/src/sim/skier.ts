import { carve, LOAD_MAX, type CarveStatus } from './carve'
import { PHYSICS, steerYawRate } from './constants'
import type { SampleTerrain, Slope, SurfaceSample } from './slopes'
import { SURFACES, blendSurface, groomedEverywhere, type SampleSurface, type SurfaceParams } from './surface'
import type { Rail } from './rails'
import { railAt } from './rails'
import {
  FREESTYLE,
  gradeLanding,
  newAir,
  predictLanding,
  railPoints,
  railTrickName,
  stepRail,
  stepRotation,
  trickName,
  trickPoints,
  tryCaptureRail,
  type AirState,
  type GrabKind,
  type RailState,
  type TrickEvent,
} from './freestyle'
import {
  clamp,
  dot,
  moveTowardAngle,
  moveTowardZero,
  projectOnPlane,
  scale,
  unit,
  wrapAngle,
  type Vec3,
} from './vec'

/**
 * Kinematic ski model. A held stick slews the skis toward a traverse and
 * stops there. The slew is slower at higher speed and cannot outrun the yaw
 * the edge can hold. Edge grip cancels lateral acceleration up to a limit
 * and, with whatever grip is left, rotates velocity toward the ski heading.
 * Lateral speed grip cannot catch is skid and is dissipated. That split is
 * the carve-versus-skid rule described in game/research/open-source-survey.md,
 * reimplemented here. alpine-challenge and SnowboardAnywhere are unlicensed,
 * so none of their code is included.
 *
 * Carved radius and turn load come from the MIT ski-coach `carve` port.
 * Above LOAD_MAX the edge washes out and more of the turn becomes skid.
 */

export type SkiMode =
  | 'still'
  | 'straight'
  | 'carving'
  | 'skidding'
  | 'braking'
  | 'tucked'
  | 'air'
  | 'rail'
  | 'crashed'
  | 'off-map'

export interface SkiInput {
  /** -1..1. Positive yaws the skis to the skier's right (toward -X when facing south). */
  steer: number
  /** Turn relative to the current heading, as with keyboard steering. */
  directionalSteering?: boolean
  /** 0..1 snowplow / hockey-stop. */
  brake: number
  tuck: boolean
  /** Held to crouch and charge; releasing pops. In powder the pop is a bounce. */
  jump?: boolean
  /** Held in the air to grab. */
  grab?: boolean
  /** Which grab to start, chosen by the controls. */
  grabKind?: GrabKind
  /** -1..1 in the air: positive front flip, negative back flip. On a rail: positive nose press, negative tail press. */
  pitch?: number
}

/** World inputs beyond the height sampler. Both are optional. */
export interface SkiEnv {
  sampleSurface?: SampleSurface
  rails?: readonly Rail[]
  /** Snap rotations to landable angles near touchdown. Default on. */
  assist?: boolean
  /** Ski model: sidecut radius (m) and base area relative to the default skis. */
  ski?: { sidecutRadius: number; floatScale: number }
}

export interface SkiState {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Radians. 0 faces +Z. Positive is the skier's right. */
  heading: number
  /** Metres per second, full 3D speed. */
  speed: number
  /** Fall-line angle of the surface under the skier, radians. */
  pitch: number
  /** Signed edge angle, radians. Positive edges to the skier's right. */
  edgeAngle: number
  /** 0..1 share of speed that is across the skis after grip, before skid drag. */
  skid: number
  carveRadius: number
  carveLoad: number
  carveStatus: CarveStatus | 'straight'
  grounded: boolean
  offMap: boolean
  tuck: boolean
  mode: SkiMode
  /** Smoothed snow parameters under the skis. */
  surface: SurfaceParams
  /** Powder penetration, metres. */
  sink: number
  /** Seconds left of a powder bounce (unweighted). */
  unweight: number
  /** Required over available lateral grip (above 1 the edge is losing hold). */
  gripRatio: number
  /** 0..1 edge chatter intensity, for camera shake and haptics. */
  chatter: number
  /** Seconds left of an edge washout. */
  washout: number
  jumpHeld: boolean
  popCharge: number
  /** -1..1 spin stored by holding a direction while crouched before takeoff. */
  windup: number
  /** Rode switch (backwards) into the last takeoff. */
  switchTakeoff: boolean
  ridingSwitch: boolean
  air: AirState | null
  rail: RailState | null
  /** Seconds left lying in the snow after a crash. */
  crashed: number
  /** Seconds before the rail just left can catch the skier again. */
  railCooldown: number
  /** Pitch held off a rail, or off a takeoff without a pop, does not flip until it is let go. */
  flipLock: boolean
  /** Last trick or rail scored; `seq` increases with each one. */
  trick: TrickEvent | null
  time: number
}

export interface SkiFrame {
  forward: Vec3
  side: Vec3
  up: Vec3
}

export function createSkiState(pose?: { x?: number; y?: number; z?: number; heading?: number }): SkiState {
  return {
    x: pose?.x ?? 0,
    y: pose?.y ?? 0,
    z: pose?.z ?? 0,
    vx: 0,
    vy: 0,
    vz: 0,
    heading: pose?.heading ?? 0,
    speed: 0,
    pitch: 0,
    edgeAngle: 0,
    skid: 0,
    carveRadius: Number.POSITIVE_INFINITY,
    carveLoad: 1,
    carveStatus: 'straight',
    grounded: true,
    offMap: false,
    tuck: false,
    mode: 'still',
    surface: SURFACES.groomed,
    sink: 0,
    unweight: 0,
    gripRatio: 0,
    chatter: 0,
    washout: 0,
    jumpHeld: false,
    popCharge: 0,
    windup: 0,
    switchTakeoff: false,
    ridingSwitch: false,
    air: null,
    rail: null,
    crashed: 0,
    railCooldown: 0,
    flipLock: false,
    trick: null,
    time: 0,
  }
}

export function createSkier(slope: Slope): SkiState {
  const state = createSkiState(slope.spawn)
  const ground = readSample(slope.sampleTerrain, state.x, state.z)
  if (slope.sampleSurface) state.surface = slope.sampleSurface(state.x, state.z)
  if (!ground) throw new Error(`Spawn (${state.x}, ${state.z}) is outside the slope`)
  state.y = ground.height
  state.pitch = pitchOf(ground.normal)
  return state
}

export function resetSkier(state: SkiState, slope: Slope): void {
  const trick = state.trick
  const next = createSkier(slope)
  Object.assign(state, next)
  // Keep the event counter so the game does not replay an old trick.
  state.trick = trick
}

/** Ski axes on the surface. `side` is the skier's right. */
export function skiFrame(heading: number, normal: Vec3): SkiFrame {
  const up = normal.y < 0 ? scale(normal, -1) : normal
  // Heading is a map bearing. Solve the vertical component on the slope so
  // crossing a steep fall line does not twist the skis away from that bearing.
  const x = -Math.sin(heading), z = Math.cos(heading)
  const forward = unit({ x, y: -(up.x * x + up.z * z) / Math.max(0.001, up.y), z })
  // skier's right = forward × up, for an upward normal.
  const sideRaw = {
    x: forward.y * up.z - forward.z * up.y,
    y: forward.z * up.x - forward.x * up.z,
    z: forward.x * up.y - forward.y * up.x,
  }
  const sideLength = Math.hypot(sideRaw.x, sideRaw.y, sideRaw.z)
  const side = sideLength < 1e-6 ? { x: -1, y: 0, z: 0 } : scale(sideRaw, 1 / sideLength)
  return { forward, side, up }
}

export function stepSkier(
  state: SkiState,
  input: SkiInput,
  sampleTerrain: SampleTerrain,
  dt: number,
  env: SkiEnv = {},
): void {
  if (!Number.isFinite(dt) || dt <= 0) return
  state.time += dt
  state.railCooldown = Math.max(0, state.railCooldown - dt)
  const steer = clamp(input.steer, -1, 1)
  const brake = clamp(input.brake, 0, 1)
  state.tuck = input.tuck
  if (state.offMap) {
    holdOffMap(state)
    return
  }
  if (state.crashed > 0) {
    stepCrashed(state, sampleTerrain, dt)
    finish(state, steer, brake)
    return
  }
  const jump = Boolean(input.jump)
  const released = state.jumpHeld && !jump
  state.jumpHeld = jump
  if (state.rail) {
    stepOnRail(state, input, steer, released, sampleTerrain, dt)
    finish(state, steer, brake)
    return
  }
  if (!state.grounded) {
    stepAir(state, input, steer, sampleTerrain, dt, env)
    finish(state, steer, brake)
    return
  }
  // Crouch while held; remember the spin direction as pre-wind.
  if (jump) {
    state.popCharge = Math.min(1, state.popCharge + dt / FREESTYLE.chargeTime)
    state.windup = Math.abs(steer) > PHYSICS.steerDeadzone ? steer : state.windup * 0.9
  }
  stepGround(state, steer, brake, sampleTerrain, dt, env, released, input.directionalSteering)
  // Leaving the snow without a pop (a mogul, a lip, a drop): pitch already
  // held, usually the brake, does not flip until it is let go and pressed again.
  if (!state.grounded && !released) state.flipLock = Math.abs(input.pitch ?? 0) > FREESTYLE.pressThreshold
  if (!released && !jump) {
    state.popCharge = 0
    state.windup = 0
  }
  finish(state, steer, brake)
}

function stepGround(
  state: SkiState,
  steer: number,
  brake: number,
  sampleTerrain: SampleTerrain,
  dt: number,
  env: SkiEnv,
  pop: boolean,
  directionalSteering = false,
): void {
  const ground = readSample(sampleTerrain, state.x, state.z)
  if (!ground) {
    holdOffMap(state)
    return
  }
  const n = facingUp(ground.normal)
  const target = (env.sampleSurface ?? groomedEverywhere)(state.x, state.z)
  state.surface = blendSurface(state.surface, target, Math.min(1, dt / PHYSICS.surfaceBlendTime))
  const surface = state.surface
  state.washout = Math.max(0, state.washout - dt)
  state.unweight = Math.max(0, state.unweight - dt)
  state.pitch = pitchOf(n)
  if (state.ridingSwitch && state.speed < PHYSICS.stillSpeed) state.ridingSwitch = false
  const stanceOffset = state.ridingSwitch ? Math.PI : 0
  let travelBearing = state.heading + stanceOffset
  const frame = skiFrame(travelBearing, n)
  const planar = projectOnPlane({ x: state.vx, y: state.vy, z: state.vz }, n)
  let along = dot(planar, frame.forward)
  let across = dot(planar, frame.side)
  const speed = Math.hypot(along, across)
  const braking = brake > PHYSICS.brakeEngage
  const travel = Math.atan2(-planar.x, planar.z)
  const brakeSide = chooseBrakeSide(steer, travelBearing, travel)
  const steerMag = Math.abs(steer)
  const edgeMag = braking ? Math.max(steerMag, PHYSICS.brakeEdge * brake) : steerMag
  const edgeSign = steerMag > PHYSICS.steerDeadzone ? Math.sign(steer) : braking ? brakeSide : 0
  let edgeTarget = (edgeSign * edgeMag * Math.min(PHYSICS.maxEdgeDeg, surface.maxEdgeDeg) * Math.PI) / 180
  if (edgeSign === 0 && speed > 0.5) {
    // Stick centred across the hill: stand on the uphill edges, as a skier
    // does without thinking, so a traverse holds instead of side-slipping.
    const fall = fallLineHeading(n)
    if (fall !== null) {
      const off = wrapAngle(travelBearing - fall)
      const crossing = clamp((Math.abs(off) - Math.PI / 6) / (Math.PI / 4), 0, 1)
      edgeTarget = Math.sign(off) * crossing * (PHYSICS.traverseEdgeDeg * Math.PI) / 180
    }
  }
  // The edge rolls on and off at a finite rate instead of snapping.
  const edgeStep = (PHYSICS.edgeRateDeg * Math.PI * dt) / 180
  state.edgeAngle = clampStep(state.edgeAngle, edgeTarget, edgeStep)
  const edgeRad = Math.abs(state.edgeAngle)
  const edgeDeg = (edgeRad * 180) / Math.PI

  const normalAccel = PHYSICS.gravity * Math.max(n.y, 0)
  const sidecut = env.ski?.sidecutRadius ?? PHYSICS.sidecutRadius
  // Deep snow resists swinging the skis: slower yaw the deeper you sit.
  const powderYaw = (1 / (1 + state.sink / PHYSICS.powderTurnDepth)) * (state.unweight > 0 ? 2 : 1)

  if (braking && speed > 1) {
    const target = travel + brakeSide * Math.PI * 0.5
    travelBearing = moveTowardAngle(travelBearing, target, PHYSICS.hockeyYawRate * brake * dt)
  } else {
    // The skis turn on their sidecut when edged, or are pivoted by the legs.
    // Neither is limited by grip: if the snow cannot turn the travel
    // direction as fast, the skis skid and the skid scrubs speed. That is how
    // a skier controls speed on a steep pitch.
    const yawRate = skiYawRate(speed, steerMag, edgeRad, sidecut) * Math.min(1, powderYaw)
    // Slow on gentle ground (cat tracks, flats) the stick just turns, so you can
    // face any way; on a real pitch it aims at a traverse even when stopped.
    const gentle = speed < PHYSICS.skateMaxSpeed && Math.hypot(n.x, n.z) < PHYSICS.turnAroundSlopeSin
    travelBearing = slewHeading(travelBearing, steer, yawRate, dt, directionalSteering || gentle ? null : fallLineHeading(n))
  }

  state.heading = wrapAngle(travelBearing - stanceOffset)
  const edged = skiFrame(travelBearing, n)
  along = dot(planar, edged.forward)
  across = dot(planar, edged.side)

  const turned = carve({ kmh: speed * 3.6, edge: edgeDeg, sidecut })
  state.carveRadius = edgeDeg >= 1 ? turned.radius : Number.POSITIVE_INFINITY
  state.carveLoad = edgeDeg >= 1 ? turned.load : 1
  state.carveStatus = edgeDeg >= 1 ? turned.status : 'straight'
  // Edge hold: required centripetal over the lateral acceleration the edge
  // can hold. Near the limit the edge chatters; well past it it washes out.
  const available = edgeGrip(normalAccel, edgeRad, false, surface.latMax)
  const required = edgeDeg >= 1 && Number.isFinite(state.carveRadius) ? (speed * speed) / state.carveRadius : 0
  state.gripRatio = available > 0 ? required / available : 0
  if (state.gripRatio > PHYSICS.washoutRatio && edgeDeg > 35 && speed > 8 && state.washout <= 0) state.washout = PHYSICS.washoutTime
  const band = clamp((state.gripRatio - 1) / 1.2, 0, 1)
  state.chatter = speed > 8 && edgeDeg > 30 ? surface.chatter * Math.sin(band * Math.PI) : 0
  let gripScale = 1
  if (state.washout > 0) gripScale *= PHYSICS.washoutGrip
  if (state.chatter > 0) gripScale *= 1 - 0.15 * state.chatter * (0.5 + 0.5 * Math.sin(state.time * Math.PI * 2 * 12))

  const gravity = projectOnPlane({ x: 0, y: -PHYSICS.gravity, z: 0 }, n)
  const gravityAlong = dot(gravity, edged.forward)
  const gravityAcross = dot(gravity, edged.side)
  const grip = edgeGrip(normalAccel, edgeRad, braking, surface.latMax) * gripScale
  const cancelled = clamp(gravityAcross, -grip, grip)
  // Gravity can help a skier enter the fall line and opposes the finish of
  // the same turn. Account for its direction when budgeting edge pressure.
  const spareGrip = Math.max(0, grip - Math.sign(across) * cancelled)

  along += gravityAlong * dt
  across += (gravityAcross - cancelled) * dt

  // At low speed the forward control skates or pushes with poles.
  if (state.tuck && !braking && speed < PHYSICS.skateMaxSpeed) {
    const bogged = 1 - 0.4 * clamp((state.sink - 0.15) / 0.15, 0, 1)
    const polePush = 1 + 0.5 * Math.max(0, 1 - speed / 1.5)
    along += PHYSICS.skateAccel * bogged * polePush * (1 - speed / PHYSICS.skateMaxSpeed) * dt
  }

  // Attack angle between the skis and the travel direction. The edge's
  // cutting force turns the path by cos(attack) and brakes it by sin(attack)
  // (Komissarov 2021), so skis thrown across the travel scrub speed while a
  // clean carve keeps it.
  const planarSpeed = Math.hypot(along, across)
  const attack = planarSpeed > 0.02 ? Math.min(Math.abs(Math.atan2(across, along)), Math.PI / 2) : 0
  if (planarSpeed > 0.02 && spareGrip > 0) {
    const misalign = Math.atan2(across, along)
    const maxDelta = ((spareGrip * Math.max(Math.cos(attack), 0.2)) / planarSpeed) * dt
    const delta = clamp(misalign, -maxDelta, maxDelta)
    const cosine = Math.cos(delta)
    const sine = Math.sin(delta)
    const turnedAlong = along * cosine + across * sine
    const turnedAcross = -along * sine + across * cosine
    along = turnedAlong
    across = turnedAcross
  }
  state.skid = planarSpeed > 0.4 ? Math.sin(attack) : 0
  const cutting = edgeGrip(normalAccel, edgeRad, false, surface.latMax) * gripScale
  const scrub = PHYSICS.skidFriction * cutting * Math.sin(attack) * (braking ? PHYSICS.brakeSkidScale : 1) * dt
  const sliding = Math.hypot(along, across)
  if (sliding <= scrub) {
    along = 0
    across = 0
  } else if (scrub > 0) {
    along *= (sliding - scrub) / sliding
    across *= (sliding - scrub) / sliding
  }
  // Base friction scales with total load, so a hard carve costs some speed.
  const lateralLoad = Math.min(required, grip)
  along = moveTowardZero(along, surface.mu * Math.hypot(normalAccel, lateralLoad) * dt)

  // Powder: sink toward an equilibrium that shrinks with speed (planing),
  // then pay compaction drag (worse when skidding) and plow drag.
  if (surface.depth > 0.02) {
    const v = Math.hypot(along, across)
    const softness = 1 + Math.max(0, surface.depth - 0.35) * 1.6
    const staticSink = softness * (PHYSICS.mass * normalAccel) / (PHYSICS.powderK * PHYSICS.skiArea * (env.ski?.floatScale ?? 1))
    let equilibrium = Math.min(surface.depth, staticSink / (1 + (v / surface.vPlane) ** 2))
    if (state.unweight > 0) equilibrium *= 0.3
    state.sink += (equilibrium - state.sink) * Math.min(1, dt / PHYSICS.sinkTime)
    // Compaction only resists while moving forward through new snow, so a
    // standing skier can still get going on a gentle pitch.
    const compaction = ((PHYSICS.skiWidthTotal * PHYSICS.powderK * state.sink * state.sink) / 2) * Math.min(1, v / 2.5)
    const plow = PHYSICS.plowCoefficient * PHYSICS.snowDensity * PHYSICS.skiWidthTotal * state.sink * v * v
    const decel = (compaction * (1 + 2 * state.skid) + plow) / (PHYSICS.mass * softness ** 2)
    const cut = decel * dt
    if (v <= cut) {
      along = 0
      across = 0
    } else {
      along *= (v - cut) / v
      across *= (v - cut) / v
    }
  } else {
    state.sink = Math.max(0, state.sink - dt * 2)
  }

  if (brake > 0) {
    const mag = Math.hypot(along, across)
    const cut = PHYSICS.brakeDecel * brake * dt
    if (mag <= cut) {
      along = 0
      across = 0
    } else {
      const keep = (mag - cut) / mag
      along *= keep
      across *= keep
    }
  }

  const dragArea = state.tuck && !braking && speed >= PHYSICS.skateMaxSpeed ? PHYSICS.dragAreaTuck : PHYSICS.dragAreaUpright
  applyDrag(along, across, dragArea, dt, (nextAlong, nextAcross) => {
    along = nextAlong
    across = nextAcross
  })

  if (Math.abs(along) < 1e-6) along = 0
  if (Math.abs(across) < 1e-6) across = 0

  const vx = edged.forward.x * along + edged.side.x * across
  const vz = edged.forward.z * along + edged.side.z * across
  const nextX = state.x + vx * dt
  const nextZ = state.z + vz * dt
  const next = readSample(sampleTerrain, nextX, nextZ)
  if (!next) {
    holdOffMap(state)
    return
  }

  const vy = edged.forward.y * along + edged.side.y * across
  const predictedY = state.y + vy * dt
  const planar2 = Math.hypot(along, across)
  // Look a quarter metre ahead: smoothed normals spread a lip over several
  // steps, so comparing with the very next sample would miss it.
  const look = 0.25 / Math.max(planar2, 0.1)
  const ahead = readSample(sampleTerrain, nextX + vx * look, nextZ + vz * look) ?? next
  const nextUp = facingUp(ahead.normal)
  const awayFromNext = vx * nextUp.x + vy * nextUp.y + vz * nextUp.z
  const crest = planar2 > 4 && awayFromNext > FREESTYLE.takeoffNormalSpeed
  if (pop || crest || (predictedY > next.height + PHYSICS.snapDistance && planar2 > 2)) {
    let px = vx
    let py = vy
    let pz = vz
    if (pop) {
      // In deep snow a pop is mostly a bounce to unweight the skis.
      const charge = state.popCharge
      if (state.sink > 0.12 && charge < 0.6) {
        state.unweight = 0.25
        state.popCharge = 0
      } else {
        const rampScale = clamp(1 - Math.max(0, vy) / FREESTYLE.popRampSpeed, FREESTYLE.popRampMin, 1)
        const v = (FREESTYLE.popMin + (FREESTYLE.popMax - FREESTYLE.popMin) * charge) * rampScale
        px += n.x * v
        py += n.y * v
        pz += n.z * v
      }
    }
    if (pop && state.unweight > 0 && !crest) {
      // Bounce only: stay on the snow this step.
    } else {
      state.grounded = false
      state.x = nextX
      state.y = Math.max(predictedY, next.height + 0.02)
      state.z = nextZ
      state.vx = px
      state.vy = py
      state.vz = pz
      beginAir(state)
      return
    }
  }

  const landed = skiFrame(travelBearing, facingUp(next.normal))
  state.x = nextX
  state.y = next.height
  state.z = nextZ
  state.vx = landed.forward.x * along + landed.side.x * across
  state.vy = landed.forward.y * along + landed.side.y * across
  state.vz = landed.forward.z * along + landed.side.z * across
  state.pitch = pitchOf(next.normal)
  state.grounded = true
  state.offMap = false
}

function beginAir(state: SkiState): void {
  const travel = Math.atan2(-state.vx, state.vz)
  state.switchTakeoff = Math.abs(wrapAngle(state.heading - travel)) > Math.PI / 2
  state.air = newAir(state.windup)
  state.popCharge = 0
  state.windup = 0
  state.sink = 0
}

function stepAir(
  state: SkiState,
  input: SkiInput,
  steer: number,
  sampleTerrain: SampleTerrain,
  dt: number,
  env: SkiEnv,
): void {
  const air = state.air ?? (state.air = newAir(0))
  const pitchIn = clamp(input.pitch ?? 0, -1, 1)
  if (state.flipLock && Math.abs(pitchIn) < 0.2) state.flipLock = false
  // Re-predict the landing a few times a second for the snap assist.
  if (air.time - air.predictedFrom > 0.05 || air.time === 0) {
    air.timeToLand = predictLanding(state, { x: state.vx, y: state.vy, z: state.vz }, sampleTerrain)
    air.predictedFrom = air.time
  }
  const dSpin = stepRotation(
    air,
    { steer, pitch: state.flipLock ? 0 : pitchIn, grab: Boolean(input.grab), grabKind: input.grabKind },
    dt,
    env.assist ?? true,
  )
  state.heading = wrapAngle(state.heading + dSpin)
  const dragArea = state.tuck || air.grab ? PHYSICS.dragAreaTuck : PHYSICS.dragAreaUpright
  const speed = Math.hypot(state.vx, state.vy, state.vz)
  if (speed > 0) {
    const accel = (0.5 * PHYSICS.airDensity * dragArea * speed * speed) / PHYSICS.mass
    const keep = Math.max(0, 1 - (accel * dt) / speed)
    state.vx *= keep
    state.vy *= keep
    state.vz *= keep
  }
  state.vy -= PHYSICS.gravity * dt
  const nextX = state.x + state.vx * dt
  const nextY = state.y + state.vy * dt
  const nextZ = state.z + state.vz * dt

  if (env.rails?.length && state.railCooldown <= 0) {
    const caught = tryCaptureRail(env.rails, { x: nextX, y: nextY, z: nextZ }, { x: state.vx, y: state.vy, z: state.vz }, state.heading)
    if (caught) {
      caught.pressArmed = Math.abs(input.pitch ?? 0) <= FREESTYLE.pressThreshold
      finishAir(state, 'clean', false)
      state.rail = caught
      placeOnRail(state)
      return
    }
  }

  const ground = readSample(sampleTerrain, nextX, nextZ)
  if (!ground) {
    holdOffMap(state)
    return
  }
  state.pitch = pitchOf(ground.normal)
  if (nextY > ground.height) {
    state.x = nextX
    state.y = nextY
    state.z = nextZ
    state.grounded = false
    return
  }
  const n = facingUp(ground.normal)
  const velocity = { x: state.vx, y: state.vy, z: state.vz }
  const landing = gradeLanding(velocity, n, state.heading, air, Boolean(input.grab))
  const tangent = projectOnPlane(velocity, n)
  // Short hops (bumps, small pops) are not graded harshly.
  const hop = air.time < 0.35 && Math.abs(air.flip) < 0.5 && Math.abs(air.spin) < 0.8
  const grade = hop && landing.grade !== 'crash' ? 'clean' : landing.grade
  const keep = hop ? clamp(1 - Math.max(0, -dot(velocity, n)) / PHYSICS.landingSoften, 0.6, 1) : landing.keep
  state.x = nextX
  state.y = ground.height
  state.z = nextZ
  state.vx = tangent.x * keep
  state.vy = tangent.y * keep
  state.vz = tangent.z * keep
  state.grounded = true
  state.offMap = false
  state.flipLock = false
  state.sink = Math.min(state.surface.depth, state.sink + Math.min(0.3, landing.efh * 0.2))
  state.ridingSwitch = landing.switchLanding && grade !== 'crash'
  if (grade === 'crash') {
    crash(state)
  }
  if (!hop) finishAir(state, grade, landing.switchLanding, landing.efh)
  else state.air = null
}

/** Score the air that just ended and publish it as a trick event. */
function finishAir(state: SkiState, grade: TrickEvent['grade'], switchLanding: boolean, efh = 0): void {
  const air = state.air
  state.air = null
  if (!air) return
  const tricky = air.time > 0.5 || Math.abs(air.spin) > 2.5 || Math.abs(air.flip) > 3 || air.grabTime > 0.3
  if (!tricky) return
  const spinDeg = Math.round(Math.abs(air.spin) / Math.PI) * 180
  const flips = Math.round(Math.abs(air.flip) / (Math.PI * 2))
  state.trick = {
    seq: (state.trick?.seq ?? 0) + 1,
    kind: 'air',
    name: trickName(air.spin, air.flip, air.grabTime > 0.3 ? air.grab : null, state.switchTakeoff, air.corkTime),
    points: trickPoints(air, grade),
    grade,
    efh,
    airTime: air.time,
    spinDeg,
    flips,
    grab: air.grabTime > 0.3 ? air.grab : null,
    grabTime: air.grabTime,
    switchLanding,
    railMetres: 0,
  }
}

function crash(state: SkiState): void {
  state.crashed = FREESTYLE.crashTime
  state.grounded = true
  state.mode = 'crashed'
}

function stepCrashed(state: SkiState, sampleTerrain: SampleTerrain, dt: number): void {
  state.crashed -= dt
  // Tumble to a stop in a couple of metres.
  const speed = Math.hypot(state.vx, state.vz)
  const keep = speed > 0 ? Math.max(0, 1 - (9 * dt) / speed) : 0
  state.vx *= keep
  state.vz *= keep
  state.x += state.vx * dt
  state.z += state.vz * dt
  const ground = readSample(sampleTerrain, state.x, state.z)
  if (!ground) {
    holdOffMap(state)
    return
  }
  state.y = ground.height
  state.vy = 0
  if (state.crashed <= 0) {
    // Get up facing down the hill.
    state.crashed = 0
    state.vx = state.vz = 0
    const fall = fallLineHeading(facingUp(ground.normal))
    state.ridingSwitch = false
    if (fall !== null) state.heading = fall
    state.air = null
    state.rail = null
  }
}

function placeOnRail(state: SkiState): void {
  const rail = state.rail
  if (!rail) return
  const { point, tangent } = railAt(rail.rail, rail.s)
  state.x = point.x
  state.y = point.y
  state.z = point.z
  state.vx = tangent.x * rail.vs
  state.vy = tangent.y * rail.vs
  state.vz = tangent.z * rail.vs
  const railHeading = Math.atan2(-tangent.x, tangent.z)
  state.heading = wrapAngle(railHeading + rail.headingOffset)
  state.grounded = true
}

function stepOnRail(
  state: SkiState,
  input: SkiInput,
  steer: number,
  pop: boolean,
  sampleTerrain: SampleTerrain,
  dt: number,
): void {
  const rail = state.rail
  if (!rail) return
  const noise = Math.sin(state.time * 7.3) * 0.9 + Math.sin(state.time * 13.1 + 1.7) * 0.6
  const pitch = clamp(input.pitch ?? 0, -1, 1)
  const outcome = pop ? 'end' : stepRail(rail, steer, dt, noise, pitch)
  placeOnRail(state)
  state.edgeAngle = 0
  state.skid = rail.style === 'slide' ? 1 : 0
  if (outcome === 'riding') return
  // Leave the rail: carry the tangent velocity, plus a pop or a sideways fall.
  const { tangent } = railAt(rail.rail, rail.s)
  if (pop) state.vy += FREESTYLE.popMin + (FREESTYLE.popMax - FREESTYLE.popMin) * Math.max(0.5, state.popCharge)
  if (outcome === 'fell') {
    const side = { x: -tangent.z, z: tangent.x }
    state.vx += side.x * Math.sign(rail.balance) * 1.5
    state.vz += side.z * Math.sign(rail.balance) * 1.5
  }
  state.y += 0.05
  state.trick = {
    seq: (state.trick?.seq ?? 0) + 1,
    kind: 'rail',
    name: `${railTrickName(rail)}${outcome === 'fell' ? ' (slipped off)' : ''}`,
    points: outcome === 'fell' ? Math.round(railPoints(rail) * 0.3) : railPoints(rail),
    grade: outcome === 'fell' ? 'sketchy' : 'clean',
    efh: 0,
    airTime: 0,
    spinDeg: 0,
    flips: 0,
    grab: null,
    grabTime: 0,
    switchLanding: false,
    railMetres: rail.metres,
  }
  state.rail = null
  state.railCooldown = 0.5
  state.flipLock = Math.abs(pitch) > FREESTYLE.pressThreshold
  state.grounded = false
  state.air = newAir(0)
  state.popCharge = 0
  const ground = readSample(sampleTerrain, state.x, state.z)
  if (!ground) holdOffMap(state)
}

function applyDrag(
  along: number,
  across: number,
  dragArea: number,
  dt: number,
  write: (along: number, across: number) => void,
): void {
  const speed = Math.hypot(along, across)
  if (speed <= 0) {
    write(along, across)
    return
  }
  const accel = (0.5 * PHYSICS.airDensity * dragArea * speed * speed) / PHYSICS.mass
  const keep = Math.max(0, 1 - (accel * dt) / speed)
  write(along * keep, across * keep)
}

function finish(state: SkiState, steer: number, brake: number): void {
  state.speed = Math.hypot(state.vx, state.vy, state.vz)
  state.mode = classify(state, steer, brake)
}

function classify(state: SkiState, steer: number, brake: number): SkiMode {
  if (state.offMap) return 'off-map'
  if (state.crashed > 0) return 'crashed'
  if (state.rail) return 'rail'
  if (!state.grounded) return 'air'
  if (brake > PHYSICS.brakeEngage && state.speed > PHYSICS.brakeModeSpeed) return 'braking'
  if (state.speed < PHYSICS.stillSpeed) return 'still'
  if (state.skid >= PHYSICS.skidMode) return 'skidding'
  const edgeHeld = Math.abs(state.edgeAngle) >= (PHYSICS.carveEdgeMinDeg * Math.PI) / 180
  if (edgeHeld && Math.abs(steer) > PHYSICS.steerDeadzone) return 'carving'
  if (state.tuck) return 'tucked'
  return 'straight'
}

/** Stick deflection slews heading toward a traverse and does not pass it. */
function slewHeading(heading: number, steer: number, rate: number, dt: number, fallLine: number | null = null): number {
  if (Math.abs(steer) <= PHYSICS.steerDeadzone) return heading
  // On a slope the held stick slews toward a heading measured from the local
  // fall line, so it settles in a traverse. On the flat (or in the air) it
  // just keeps turning.
  const target =
    fallLine === null
      ? heading + Math.sign(steer) * Math.PI * 0.5
      : fallLine + steer * ((PHYSICS.maxTraverseDeg * Math.PI) / 180)
  if (fallLine !== null && Math.sign(wrapAngle(target - heading)) !== Math.sign(steer)) return heading
  return moveTowardAngle(heading, target, rate * dt)
}

/**
 * How fast the skis yaw, rad/s: the faster of the sidecut (v / R, with R =
 * sidecut x cos(edge), capped where the carve would need more than
 * LOAD_MAX g) and a leg pivot that is quick when slow and harder at speed.
 */
export function skiYawRate(speed: number, steerMag: number, edgeRad: number, sidecut: number): number {
  const v = Math.max(0, speed)
  const pivot = steerYawRate(v, steerMag)
  if (steerMag <= PHYSICS.steerDeadzone || edgeRad < 0.02) return pivot
  const radius = sidecut * Math.cos(Math.min(edgeRad, 1.4))
  const carve = Math.min(v / radius, (LOAD_MAX * PHYSICS.gravity) / Math.max(v, 1))
  return Math.max(pivot, carve)
}

/** Heading that points straight down the slope, or null on the flat. */
export function fallLineHeading(n: Vec3): number | null {
  const horizontal = Math.hypot(n.x, n.z)
  if (horizontal < PHYSICS.flatSlopeSin) return null
  // The normal leans toward downhill, so its horizontal part is the fall line.
  return Math.atan2(-n.x, n.z)
}

/**
 * Lateral acceleration the edges can hold, m/s². Edge plus some angulation
 * sets the cutting resistance (tan of the angle, plus 0.2 for a flat ski,
 * after Komissarov 2021); the snow caps it at `latMax` g-units.
 */
export function edgeGrip(normalAccel: number, edgeRad: number, braking: boolean, latMax: number): number {
  const edge = Math.abs(edgeRad)
  const angulation = (PHYSICS.angulationDeg * Math.PI) / 180 * clamp((edge - 0.17) / 0.35, 0, 1)
  const mu = Math.min(Math.tan(Math.min(edge + angulation, 1.3)) + 0.2, latMax)
  const grip = normalAccel * mu
  return braking ? grip * PHYSICS.brakeGripScale : grip
}

/**
 * Hockey-stop side. The stick wins. Otherwise yaw toward the side the skis
 * are already on relative to travel. Perfectly aligned skis open to the right.
 */
function chooseBrakeSide(steer: number, heading: number, travel: number): number {
  if (Math.abs(steer) > PHYSICS.steerDeadzone) return Math.sign(steer)
  const misalign = wrapAngle(heading - travel)
  if (Math.abs(misalign) > PHYSICS.steerDeadzone) return Math.sign(misalign)
  return 1
}

function clampStep(current: number, target: number, step: number): number {
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step)
}

function holdOffMap(state: SkiState): void {
  state.offMap = true
  state.grounded = false
  state.vx = 0
  state.vy = 0
  state.vz = 0
  state.speed = 0
  state.skid = 0
  state.mode = 'off-map'
}

function readSample(sampleTerrain: SampleTerrain, x: number, z: number): SurfaceSample | null {
  const sample = sampleTerrain(x, z)
  if (!sample) return null
  const { height, normal } = sample
  if (!Number.isFinite(height) || !Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
    return null
  }
  if (Math.hypot(normal.x, normal.y, normal.z) < PHYSICS.minNormalLength) return null
  return sample
}

function facingUp(normal: Vec3): Vec3 {
  const n = unit(normal)
  return n.y < 0 ? scale(n, -1) : n
}

function pitchOf(normal: Vec3): number {
  return Math.acos(clamp(Math.abs(unit(normal).y), 0, 1))
}
