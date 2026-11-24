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
  /** Higher than a real race tuck (~0.2 m²) so recreational top speed stays under ~100 km/h on 15°. */
  dragAreaTuck: 0.42,
  snowFriction: 0.035,
  /** Scale on the braking share (sin of the attack angle) of the edge's cutting force. */
  skidFriction: 0.8,
  edgeFriction: 1.15,
  sidecutRadius: 14,
  maxEdgeDeg: 50,
  /**
   * A held stick slews the skis toward this angle off the local fall line and
   * stops there. Past 90° the skis point slightly uphill, which is how a
   * skier turns to a stop or holds a cat track.
   */
  maxTraverseDeg: 100,
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
  brakeDecel: 5.2,
  /** Brake input above this engages the hockey-stop yaw and the braking state. */
  brakeEngage: 0.2,
  /** Edge fraction used while braking when the stick is centered. */
  brakeEdge: 0.85,
  /** Grip kept while braking, so the stop skids instead of carving the new heading. */
  brakeGripScale: 0.35,
  /** Multiplier on lateral skid friction while braking. */
  brakeSkidScale: 1.35,
  hockeyYawRate: 2.4,
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
  /** Edge roll rate toward the stick's target, degrees per second. */
  edgeRateDeg: 260,
  /** Seconds to blend surface parameters when the snow changes underfoot. */
  surfaceBlendTime: 0.15,
  /** Grip ratio past which the edge washes out, for how long, and the grip left. */
  washoutRatio: 1.9,
  washoutTime: 0.18,
  washoutGrip: 0.65,
  /** Sustained washout above this speed (m/s) can tip into a crash. */
  washoutCrashSpeed: 14,
  /** Powder (Lind and Sanders compaction law, n = 1): k in Pa/m, total ski base area m². */
  powderK: 6800,
  skiArea: 0.385,
  skiWidthTotal: 0.22,
  sinkTime: 0.25,
  plowCoefficient: 0.1,
  snowDensity: 100,
  /** Sink depth at which yaw rate halves, metres. */
  powderTurnDepth: 0.15,
  /** Skate push while tucked below `skateMaxSpeed`, m/s². */
  skateAccel: 2.2,
  skateMaxSpeed: 5,
  snapDistance: 0.3,
  landingSoften: 12,
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
