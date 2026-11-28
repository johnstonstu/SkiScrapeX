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

export type TurnModel = 'classic' | 'wide'

/** Optional world and equipment inputs beyond the height sampler. */
export interface SkiEnv {
  turnModel?: TurnModel
  sampleSurface?: SampleSurface
  rails?: readonly Rail[]
  /** Snap rotations to landable angles near touchdown. Default on. */
  assist?: boolean
  /** Ski model: sidecut radius (m) and base area relative to the default skis. */
  ski?: { sidecutRadius: number; floatScale: number }
  /** A judged comp (moguls, aerials): every air off a feature is scored, even a short straight one. */
  judgedAirs?: boolean
  /**
   * The glide track under a point, if any (world/glide.ts): a flat mapped stretch that carries
   * the skier at `cruise` while they travel along it, faster inside a booster zone.
   */
  glide?: (x: number, z: number) => { dirX: number; dirZ: number; cruise: number; boost: boolean; toX?: number; toZ?: number } | null
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
  /** Seconds the forward control has been held. */
  tuckTime: number
  /** Pushing with both poles this step (a forward tap at moderate speed). */
  poling: boolean
  /** 0..1: how hard a glide track is carrying the skier this step (0 off a track or at cruising speed). */
  gliding: number
  /** Inside a booster zone and being pushed by it this step. */
  boosting: boolean
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
  /** Planar speed (m/s) at the moment of the crash, for pose and slide length. */
  crashSpeed: number
  /** Seconds since the crash started, for tumble animation. */
  crashAge: number
  /** Travel heading at impact (atan2(-vx, vz)), for directional tumble. */
  crashHeading: number
  /** Hard-crash skis / board still on the snow as world pickups. */
  missingSkis: boolean
  /** Hard-crash poles still on the snow as world pickups. */
  missingPoles: boolean
  /** Seconds before the rail just left can catch the skier again. */
  railCooldown: number
  /** Seconds after getting up from a crash in which a tree knocks the rider aside instead of down again. */
  crashGrace: number
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
    tuckTime: 0,
    poling: false,
    gliding: 0,
    boosting: false,
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
    crashSpeed: 0,
    crashAge: 0,
    crashHeading: 0,
    missingSkis: false,
    missingPoles: false,
    railCooldown: 0,
    crashGrace: 0,
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
  const roll = slope.spawn.speed ?? 0
  if (roll > 0) {
    const { forward } = skiFrame(state.heading, ground.normal)
    state.vx = forward.x * roll
    state.vy = forward.y * roll
    state.vz = forward.z * roll
    state.speed = roll
  }
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
  state.crashGrace = Math.max(0, state.crashGrace - dt)
  const steer = clamp(input.steer, -1, 1)
  const brake = clamp(input.brake, 0, 1)
  // Forward means different things at different speeds: skate when slow, a pole push
  // when cruising (a tap is one stroke), and a tuck when held or already fast.
  state.tuckTime = input.tuck ? state.tuckTime + dt : 0
  state.poling =
    input.tuck && state.grounded && state.speed >= PHYSICS.skateMaxSpeed && state.speed < PHYSICS.polePushMaxSpeed && state.tuckTime < PHYSICS.tuckHold
  state.tuck = input.tuck && !state.poling
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
  // Hands off the steering on a glide track, the skis follow the track round its bends (and ease
  // back toward its middle), so being carried along a cat track does not run you off its edge.
  // Any steering or braking from the player takes over at once.
  if (Math.abs(steer) <= PHYSICS.steerDeadzone && brake <= PHYSICS.brakeEngage && state.speed > PHYSICS.glideStartSpeed) {
    const track = env.glide?.(state.x, state.z)
    if (track) {
      const aimX = track.dirX * PHYSICS.glideLookAhead + (track.toX ?? 0)
      const aimZ = track.dirZ * PHYSICS.glideLookAhead + (track.toZ ?? 0)
      const aim = Math.atan2(-aimX, aimZ)
      // A plain yaw, not a steer: the stick aims at a traverse off the fall line, the track does not.
      const error = Math.abs(wrapAngle(aim - state.heading))
      if (error < Math.acos(PHYSICS.glideAlign)) state.heading = moveTowardAngle(state.heading, aim, Math.min(PHYSICS.glideSteerMax, error * PHYSICS.glideSteer) * dt)
    }
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
  const edgeCap = Math.min(PHYSICS.maxEdgeDeg, surface.maxEdgeDeg, directionalSteering && !braking ? keyboardEdgeCap(speed) : Infinity)
  let edgeTarget = (edgeSign * edgeMag * edgeCap * Math.PI) / 180
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
  // A bounce unweight opens the turn (Steep-style float yaw).
  const powderYaw =
    (1 / (1 + state.sink / PHYSICS.powderTurnDepth)) *
    (state.unweight > 0 ? PHYSICS.powderUnweightYaw : 1)

  if (braking && speed > 1) {
    const target = travel + brakeSide * Math.PI * 0.5
    travelBearing = moveTowardAngle(travelBearing, target, PHYSICS.hockeyYawRate * brake * dt)
  } else {
    // The skis turn on their sidecut when edged, or are pivoted by the legs.
    // Neither is limited by grip: if the snow cannot turn the travel
    // direction as fast, the skis skid and the skid scrubs speed. That is how
    // a skier controls speed on a steep pitch.
    const yawRate = skiYawRate(speed, steerMag, edgeRad, sidecut, env.turnModel) * Math.min(1, powderYaw)
    // Slow on gentle ground (cat tracks, flats) the stick just turns, so you can
    // face any way; on a real pitch it aims at a traverse even when stopped.
    // Every input (keys, pad, touch) aims at a traverse measured from the fall line,
    // so holding one way settles across the hill and the other way links the turn.
    const gentle = speed < PHYSICS.turnAroundSpeed && Math.hypot(n.x, n.z) < PHYSICS.turnAroundSlopeSin
    const before = travelBearing
    travelBearing = slewHeading(travelBearing, steer, yawRate, dt, gentle ? null : fallLineHeading(n))
    // Arcade carve: the skis may not swing further across the path than
    // `maxLeadDeg`, so the turn rounds out on the edge instead of sliding out.
    if (speed > PHYSICS.skateMaxSpeed && state.washout <= 0) {
      const cap = (PHYSICS.maxLeadDeg * Math.PI) / 180
      const leadBefore = wrapAngle(before - travel)
      const lead = wrapAngle(travelBearing - travel)
      if (Math.abs(lead) > cap && Math.abs(lead) > Math.abs(leadBefore)) {
        travelBearing = wrapAngle(travel + Math.sign(lead) * Math.max(cap, Math.abs(leadBefore)))
      }
    }
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
  // Deep powder plows rather than washing an edge; groomed/ice still wash out.
  // Washout only softens grip and chatters; it does not tip into a crash on its own.
  if (
    state.sink < PHYSICS.powderNoWashoutSink &&
    state.gripRatio > surface.washoutRatio &&
    edgeDeg > 35 &&
    speed > 8 &&
    state.washout <= 0
  ) {
    state.washout = PHYSICS.washoutTime
  }
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
  if (state.poling && !braking) {
    const bogged = 1 - 0.5 * clamp((state.sink - 0.1) / 0.2, 0, 1)
    along += PHYSICS.polePushAccel * bogged * (1 - speed / PHYSICS.polePushMaxSpeed) * dt
  }

  // A glide track (a flat cat track or ridge traverse) carries a moving skier up to its
  // cruising speed, so the flats need no skating; a booster zone pushes harder and faster.
  // It starts once you are moving or press forward, and brakes or a turn across the track drop it.
  state.gliding = 0
  state.boosting = false
  const track = braking || state.washout > 0 ? null : env.glide?.(state.x, state.z)
  if (track && (speed > PHYSICS.glideStartSpeed || state.tuck || state.poling)) {
    const flatLength = Math.hypot(edged.forward.x, edged.forward.z) || 1
    const align = (edged.forward.x * track.dirX + edged.forward.z * track.dirZ) / flatLength
    if (align > PHYSICS.glideAlign) {
      const target = track.boost ? PHYSICS.boostSpeed : track.cruise
      const want = clamp((target - speed) / PHYSICS.glideEase, 0, 1)
      along += (track.boost ? PHYSICS.boostAccel : PHYSICS.glideAccel) * want * align * dt
      state.gliding = want
      state.boosting = track.boost && want > 0
    }
  }

  // Attack angle between the skis and the travel direction. The edge's
  // cutting force turns the path by cos(attack) and brakes it by sin(attack)
  // (Komissarov 2021), so skis thrown across the travel scrub speed while a
  // clean carve keeps it.
  const planarSpeed = Math.hypot(along, across)
  const attack = planarSpeed > 0.02 ? Math.min(Math.abs(Math.atan2(across, along)), Math.PI / 2) : 0
  if (planarSpeed > 0.02 && spareGrip > 0) {
    const misalign = Math.atan2(across, along)
    // Full assist up to `carveAssistKmh[0]`, none by `[1]`, so fast turns still need room.
    const [assistFull, assistNone] = PHYSICS.carveAssistKmh
    const assistShare = clamp((assistNone - planarSpeed * 3.6) / (assistNone - assistFull), 0, 1)
    const assist = braking ? 1 : 1 + (PHYSICS.carveAssist - 1) * assistShare
    const maxDelta = ((assist * spareGrip * Math.max(Math.cos(attack), 0.2)) / planarSpeed) * dt
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
    // Deeper-than-normal packs are softer: more static sink, plane a little later.
    const softness = 1 + Math.max(0, surface.depth - 0.35) * 1.5
    const loaded = normalAccel + lateralLoad * 0.1
    const staticSink = softness * PHYSICS.mass * loaded / (PHYSICS.powderK * PHYSICS.skiArea * (env.ski?.floatScale ?? 1))
    const planeSpeed = surface.vPlane * (0.9 + 0.25 * Math.min(1, surface.depth / 0.5))
    let equilibrium = Math.min(surface.depth, staticSink / (1 + (v / planeSpeed) ** 2))
    if (state.unweight > 0) equilibrium *= 0.22
    state.sink += (equilibrium - state.sink) * Math.min(1, dt / PHYSICS.sinkTime)
    // Compaction only resists while moving forward through new snow, so a
    // standing skier can still get going on a gentle pitch.
    const compaction = PHYSICS.skiWidthTotal * (PHYSICS.powderK / softness) * state.sink ** 2 * 0.45 * Math.min(1, v / 2.2)
    const displaced = 1 + Math.max(0, surface.depth - 0.2) * 4.2
    // Lined-up tips plow less; skidding throws a face-shot wall of snow.
    const plow = PHYSICS.plowCoefficient * PHYSICS.snowDensity * PHYSICS.skiWidthTotal * state.sink * v * v * displaced
    const decel = (compaction + plow) * (1 + state.skid * 1.85) / PHYSICS.mass
    const cut = decel * dt
    if (v <= cut) {
      along = 0
      across = 0
    } else {
      along *= (v - cut) / v
      across *= (v - cut) / v
      // Soft yaw damp: across decays gently so the float still turns.
      across *= Math.exp(-state.sink * v * dt * 0.55)
    }
  } else {
    state.sink = Math.max(0, state.sink - dt * 2)
  }

  if (brake > 0) {
    const mag = Math.hypot(along, across)
    // Pressing the skis into the snow: less of it on a steep pitch, where gravity also pulls along.
    const cut = PHYSICS.brakeDecel * brake * Math.max(n.y, 0) * dt
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
  // Flex through short mogul crests. Holding crouch absorbs more, while release still pops.
  const overMogul = Math.max(ground.mogulHeight ?? 0, ahead.mogulHeight ?? 0) > 0.06
  const absorb = overMogul ? (state.jumpHeld ? 1.5 : 0.45) : 0
  const crest = planar2 > 4 && awayFromNext > FREESTYLE.takeoffNormalSpeed + absorb
  if (pop || crest || (predictedY > next.height + PHYSICS.snapDistance && planar2 > 2)) {
    let px = vx
    let py = vy
    let pz = vz
    if (pop) {
      // In deep snow a light pop is a bounce to unweight and open a turn.
      const charge = state.popCharge
      if (state.sink > 0.1 && charge < 0.7) {
        state.unweight = PHYSICS.powderUnweightTime
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
  // Short hops (bumps, small pops, rail approaches) are not graded harshly.
  const hop = air.time < 0.55 && Math.abs(air.flip) < 0.7 && Math.abs(air.spin) < 1.15
  // Deep powder cushions imperfect landings — face-shot sink, not a bail.
  const powderCushion =
    state.surface.depth > 0.15 &&
    landing.flipErrDeg < 50 &&
    landing.spinErrDeg < 50 &&
    !input.grab
  let grade = hop && landing.grade !== 'crash' ? 'clean' : landing.grade
  if (grade === 'crash' && powderCushion) grade = 'sketchy'
  // Soften the normal hit a little even on graded landings so big drops absorb through the legs.
  const powderKeep = powderCushion ? 0.88 + 0.08 * Math.min(1, state.surface.depth / 0.4) : 1
  // The legs soak up the first part of the impact on a short hop; only a hard slap costs speed.
  const keep = hop
    ? clamp(1 - Math.max(0, -dot(velocity, n) - PHYSICS.hopAbsorb) / PHYSICS.landingSoften, 0.6, 1)
    : landing.keep <= 0 && grade === 'crash'
      ? 0
      : Math.max(0, (landing.keep > 0 ? landing.keep : 0.72) * powderKeep * (1 - Math.min(0.15, landing.efh * 0.018)))
  state.x = nextX
  state.y = ground.height
  state.z = nextZ
  state.vx = tangent.x * keep
  state.vy = tangent.y * keep
  state.vz = tangent.z * keep
  state.grounded = true
  state.offMap = false
  state.flipLock = false
  state.sink = Math.min(state.surface.depth, state.sink + Math.min(0.35, landing.efh * 0.28 + (powderCushion ? 0.08 : 0)))
  if (powderCushion && grade !== 'crash') state.unweight = Math.max(state.unweight, 0.18)
  state.ridingSwitch = landing.switchLanding && grade !== 'crash'
  if (grade === 'crash') {
    crash(state)
  }
  // A comp counts every air off its features; free skiing ignores small hops.
  const judged = Boolean(env.judgedAirs) && air.time > JUDGED_AIR_MIN
  if (!hop || judged) finishAir(state, grade, landing.switchLanding, landing.efh, judged)
  else state.air = null
}

/** Score the air that just ended and publish it as a trick event. */
function finishAir(state: SkiState, grade: TrickEvent['grade'], switchLanding: boolean, efh = 0, judged = false): void {
  const air = state.air
  state.air = null
  if (!air) return
  const tricky = judged || air.time > 0.5 || Math.abs(air.spin) > 2.5 || Math.abs(air.flip) > 3 || air.grabTime > 0.3
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

/**
 * Start a crash. `entrySpeed` is the planar speed (m/s) that sets how long
 * the rider stays down and how far they slide; defaults to current velocity.
 */
export function beginCrash(state: SkiState, entrySpeed = Math.hypot(state.vx, state.vz)): void {
  state.crashSpeed = Math.max(0, entrySpeed)
  state.crashAge = 0
  const planar = Math.hypot(state.vx, state.vz)
  state.crashHeading = planar > 0.2 ? Math.atan2(-state.vx, state.vz) : state.heading
  // About 1.2 s at a crawl, up to about 2.8 s past 25 m/s.
  state.crashed = FREESTYLE.crashTime * (0.75 + Math.min(1.25, state.crashSpeed / 18))
  state.grounded = true
  state.mode = 'crashed'
  state.rail = null
  state.air = null
}

function crash(state: SkiState): void {
  beginCrash(state)
}

function stepCrashed(state: SkiState, sampleTerrain: SampleTerrain, dt: number): void {
  state.crashed -= dt
  state.crashAge += dt
  // Slow with snow friction plus tumble loss so fast crashes slide farther.
  const speed = Math.hypot(state.vx, state.vz)
  const decel = 3.5 + Math.min(10, speed * 0.28)
  const keep = speed > 0 ? Math.max(0, 1 - (decel * dt) / speed) : 0
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
    // Get up facing down the hill; gear is back under the boots (view re-attaches).
    state.crashed = 0
    state.crashSpeed = 0
    state.crashAge = 0
    state.crashHeading = 0
    state.vx = state.vz = 0
    const fall = fallLineHeading(facingUp(ground.normal))
    state.ridingSwitch = false
    if (fall !== null) state.heading = fall
    state.crashGrace = PHYSICS.crashGraceTime
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
  // Leave the rail: carry the tangent velocity, plus a pop or a soft step-off.
  const { tangent } = railAt(rail.rail, rail.s)
  if (pop) state.vy += FREESTYLE.popMin + (FREESTYLE.popMax - FREESTYLE.popMin) * Math.max(0.5, state.popCharge)
  else state.vy += 0.55
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
  state.railCooldown = 0.35
  state.flipLock = Math.abs(pitch) > FREESTYLE.pressThreshold
  state.grounded = false
  // Short dismount air is graded as a hop so step-offs do not false-bail.
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
  if (fallLine === null) return moveTowardAngle(heading, heading + Math.sign(steer) * Math.PI * 0.5, rate * dt)
  // Work in angles from the fall line, without wrapping, so going from one
  // traverse to the other turns down through the fall line, never the short
  // way round through uphill.
  const off = wrapAngle(heading - fallLine)
  const targetOff = steer * ((PHYSICS.maxTraverseDeg * Math.PI) / 180)
  const delta = targetOff - off
  // Never turn against the stick (past the traverse it holds instead).
  if (Math.sign(delta) !== Math.sign(steer)) return heading
  const step = Math.sign(delta) * Math.min(Math.abs(delta), rate * dt)
  return wrapAngle(fallLine + off + step)
}

/** Ski yaw in rad/s, from the sidecut or a leg pivot. */
export function skiYawRate(speed: number, steerMag: number, edgeRad: number, sidecut: number, model: TurnModel = 'classic'): number {
  const v = Math.max(0, speed)
  const pivot = steerYawRate(v, steerMag)
  if (steerMag <= PHYSICS.steerDeadzone) return pivot

  const radius = sidecut * Math.cos(Math.min(edgeRad, 1.4))
  const sidecutRate = edgeRad < 0.02 ? 0 : v / radius
  const classic = Math.max(pivot, Math.min(sidecutRate, LOAD_MAX * PHYSICS.gravity / Math.max(v, 1)))
  if (model === 'classic' || v <= 28 / 3.6) return classic

  // Blend out the leg pivot above short-swing speeds. Limit the carve rate
  // at speed so the requested radius grows with centripetal acceleration.
  const transition = clamp((v * 3.6 - 28) / 12, 0, 1)
  const blend = transition * transition * (3 - 2 * transition)
  const widePivot = pivot / (1 + ((v - 15 / 3.6) / 2.5) ** 2)
  const wideCarve = Math.min(sidecutRate, 0.75 * PHYSICS.gravity / v) * steerMag
  return classic + (Math.max(widePivot, wideCarve) - classic) * blend
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

/** Shortest air a judged comp scores, seconds (a mogul crest is less). */
export const JUDGED_AIR_MIN = 0.25

/** The most edge keyboard steering asks for at this speed (m/s), degrees. */
export function keyboardEdgeCap(speed: number): number {
  const [from, to] = PHYSICS.keyEdgeFadeKmh
  const t = clamp((speed * 3.6 - from) / (to - from), 0, 1)
  return PHYSICS.maxEdgeDeg + (PHYSICS.keyEdgeHighDeg - PHYSICS.maxEdgeDeg) * t
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
