/** Fixed physics rate. The survey recommends about 120 Hz. */
export const FIXED_HZ = 120
export const FIXED_DT = 1 / FIXED_HZ

/**
 * Tunable ski model. Distances are metres, angles feeding the stepper are
 * converted at the use site, and the frame is +X east, +Y up, +Z south.
 *
 * Friction and drag sit in the ranges cited in game/research/open-source-survey.md:
 * ski–snow μ about 0.02–0.05 (0.07 in some carve simulations) and drag area
 * about 0.2 m² in a tuck to about 0.66 m² upright.
 */
export const PHYSICS = {
  gravity: 9.81,
  mass: 80,
  airDensity: 1.05,
  dragAreaUpright: 0.66,
  /**
   * A recreational tuck: above a race tuck (~0.2 m²), so a straight run on 25°
   * tops out near 160 km/h and the Chute's 151 km/h benchmark can be reached.
   */
  dragAreaTuck: 0.3,
  snowFriction: 0.035,
  /** Scale on the braking share (sin of the attack angle) of the edge's cutting force. */
  skidFriction: 0.8,
  edgeFriction: 1.15,
  sidecutRadius: 14,
  maxEdgeDeg: 50,
  /**
   * A held direction (stick or key) slews the skis toward this angle off the
   * local fall line and stops there: just short of straight across, so a held
   * turn settles in a slow traverse instead of winding uphill and stopping.
   * Turning to a stop is the brake's job. Was 100 before 0.9.40 (guess, tune in play).
   */
  maxTraverseDeg: 86,
  /**
   * Below this speed (m/s) on gentle ground the steer turns freely so a
   * stopped skier can face any way. Above it the fall line still sets the
   * traverse, so a slow cat track cannot spin the skier backwards.
   */
  turnAroundSpeed: 1.5,
  /**
   * The most the skis may lead the travel direction while turning on the
   * snow (attack angle), degrees. The steer cannot swing the skis further
   * across the path than this, so a turn carves round instead of the skis
   * sliding out sideways. Braking and landings are not limited. Guess, tune in play.
   */
  maxLeadDeg: 16,
  /** Arcade edge hold: scale on the grip that rotates the path toward the skis while turning. Guess, tune in play. */
  carveAssist: 1.3,
  /** Speeds (km/h) over which the carve assist fades out. Guess, tune in play. */
  carveAssistKmh: [45, 85],
  /** Below this slope (sine of the pitch) the fall line is undefined and steering turns freely. */
  flatSlopeSin: 0.03,
  /** Below this slope (sine) and skating speed, the stick turns freely so you can turn around. */
  turnAroundSlopeSin: 0.14,
  /** Leg pivot of the skis at a standstill, rad/s, falling off as 1 / (1 + v / yawSpeedReference). */
  maxYawRate: 2.2,
  yawSpeedReference: 30,
  /** Body angulation added to the edge for grip once the edge is committed, degrees. */
  angulationDeg: 15,
  /** Uphill edge held with the stick centred on a traverse, degrees. */
  traverseEdgeDeg: 22,
  /** Hockey-stop braking on top of the skid scrub, m/s² on the flat; scales with the cosine of the pitch. */
  brakeDecel: 4,
  /** Brake input above this engages the hockey-stop yaw and the braking state. */
  brakeEngage: 0.2,
  /** Edge fraction used while braking when the stick is centered. */
  brakeEdge: 0.85,
  /** Grip kept while braking, so the stop skids instead of carving the new heading. */
  brakeGripScale: 0.35,
  /** Multiplier on lateral skid friction while braking. */
  brakeSkidScale: 0.3,
  hockeyYawRate: 2.4,
  /** After getting up from a crash, seconds in which trees knock the rider aside instead of down. Guess. */
  crashGraceTime: 2.5,
  /** Airborne steering is this fraction of the on-snow yaw rate. */
  airYawScale: 0.65,
  /** Stick inside this absolute value counts as centered. */
  steerDeadzone: 0.05,
  /** Edge, in degrees, required before the HUD calls a turn a carve. */
  carveEdgeMinDeg: 5,
  /** Below this speed the state is `still`. */
  stillSpeed: 0.25,
  /** Braking is reported only while speed is still above this. */
  brakeModeSpeed: 0.35,
  /** Skid fraction that reports `skidding` instead of a carve. */
  skidMode: 0.3,
  /** Edge roll rate toward the stick's target, degrees per second: 0 to 50° in about 0.28 s. Below about 160 the Teck GS pace line stops clearing gate 5. */
  edgeRateDeg: 180,
  /**
   * Keyboard steering is all or nothing, so its edge is capped by speed: the
   * full edge up to `keyEdgeFadeKmh[0]`, falling to `keyEdgeHighDeg` at
   * `keyEdgeFadeKmh[1]`. A tap at speed then holds an arc instead of washing out.
   */
  keyEdgeHighDeg: 32,
  keyEdgeFadeKmh: [60, 110],
  /** Seconds to blend surface parameters when the snow changes underfoot. */
  surfaceBlendTime: 0.15,
  /** How long an edge washout lasts and the grip left. The ratio that starts one is per snow (`SurfaceParams.washoutRatio`). */
  washoutTime: 0.18,
  washoutGrip: 0.65,
  /** Powder (Lind and Sanders compaction law, n = 1): k in Pa/m, total ski base area m². */
  powderK: 7200,
  skiArea: 0.385,
  skiWidthTotal: 0.22,
  sinkTime: 0.32,
  plowCoefficient: 0.11,
  snowDensity: 100,
  /** Sink depth at which yaw rate halves, metres. Deeper = softer Steep-like yaw. Was 0.11 before 0.9.40, when powder turned a third slower than a groomer (guess). */
  powderTurnDepth: 0.2,
  /** Bounce-unweight window after a light powder pop, seconds. */
  powderUnweightTime: 0.4,
  /** Yaw multiplier while unweighted (bounce turns). */
  powderUnweightYaw: 2.7,
  /** Above this sink, edge washout is skipped — deep snow plows instead of tipping. */
  powderNoWashoutSink: 0.08,
  /** Skate push while tucked below `skateMaxSpeed`, m/s². */
  skateAccel: 2.2,
  skateMaxSpeed: 5,
  /**
   * Between skating and tucking speeds, forward is a double-pole push: a tap is one
   * stroke, and holding it settles into a tuck after `tuckHold` seconds.
   */
  polePushAccel: 2.6,
  polePushMaxSpeed: 11,
  tuckHold: 0.35,
  snapDistance: 0.3,
  landingSoften: 12,
  /** Normal impact speed the legs soak up on a short hop without losing speed, m/s. */
  hopAbsorb: 2.5,
  /** A normal shorter than this is a bad sample, same as a hole. */
  minNormalLength: 1e-3,
  maxFrameDt: 0.25,
  /** Must cover `maxFrameDt * FIXED_HZ` (30) so a clamped frame cannot backlog. */
  maxSubsteps: 32,
  /** Pitch used by the braking acceptance check, in degrees. */
  testPitchDeg: 15,
} as const

/** Leg pivot of the skis, rad/s: quick when slow, harder at speed. The sidecut turn is in `skiYawRate`. */
export function steerYawRate(speed: number, steer: number): number {
  const v = Math.max(0, speed)
  return (steer * PHYSICS.maxYawRate) / (1 + v / PHYSICS.yawSpeedReference)
}
