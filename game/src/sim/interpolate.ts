import type { SkiState } from './skier'
import type { AirState } from './freestyle'

/**
 * Render smoothing between fixed physics steps. The sim runs at 120 Hz and a
 * display at 75, 90 or 144 Hz (or a dropped frame) gets 0, 1 or 2 steps a
 * frame, so drawing the newest step makes the rider and camera move in uneven
 * jumps. The render instead draws a blend of the last two steps, `alpha` of
 * the way along (the leftover accumulator over the step), as in "Fix Your
 * Timestep". That shows the sim at most one step (8 ms) late and evenly paced.
 *
 * Only what the rider view and camera read for motion is blended; everything
 * else (mode, flags, trick state) is the newest step's.
 */
export interface Pose {
  x: number
  y: number
  z: number
  heading: number
  edgeAngle: number
  time: number
  spin: number
  flip: number
  airborne: boolean
}

export interface PoseHistory {
  /** State before the newest step. */
  prev: Pose
  /** State after the newest step: if `SkiState` no longer matches it, something moved the skier outside the sim. */
  curr: Pose
  valid: boolean
}

export function createPoseHistory(): PoseHistory {
  return { prev: emptyPose(), curr: emptyPose(), valid: false }
}

function emptyPose(): Pose {
  return { x: 0, y: 0, z: 0, heading: 0, edgeAngle: 0, time: 0, spin: 0, flip: 0, airborne: false }
}

export function capturePose(into: Pose, state: SkiState): void {
  into.x = state.x
  into.y = state.y
  into.z = state.z
  into.heading = state.heading
  into.edgeAngle = state.edgeAngle
  into.time = state.time
  into.airborne = state.air !== null
  into.spin = state.air?.spin ?? 0
  into.flip = state.air?.flip ?? 0
}

function copyPose(into: Pose, from: Pose): void {
  Object.assign(into, from)
}

/** True when `state` is still exactly where the sim left it. */
function matches(pose: Pose, state: SkiState): boolean {
  return pose.x === state.x && pose.y === state.y && pose.z === state.z && pose.heading === state.heading && pose.time === state.time
}

/** Shortest-way angle blend, radians. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  else if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * A copy of `state` with position, heading, edge, clock and air rotation
 * blended `alpha` (0..1) from the previous step to the newest. A skier moved
 * outside the sim (spawn, lift ride, reset) shows where it is and starts a new
 * history. `out` and `air` are reused between frames, so hold no reference to
 * the result past the frame.
 */
export function blendState(history: PoseHistory, state: SkiState, alpha: number, out: SkiState, air: AirState): SkiState {
  Object.assign(out, state)
  if (!history.valid || !matches(history.curr, state)) {
    capturePose(history.prev, state)
    capturePose(history.curr, state)
    history.valid = true
    return out
  }
  const t = Math.min(1, Math.max(0, alpha))
  const { prev, curr } = history
  out.x = lerp(prev.x, curr.x, t)
  out.y = lerp(prev.y, curr.y, t)
  out.z = lerp(prev.z, curr.z, t)
  out.heading = lerpAngle(prev.heading, curr.heading, t)
  out.edgeAngle = lerp(prev.edgeAngle, curr.edgeAngle, t)
  out.time = lerp(prev.time, curr.time, t)
  // Spin and flip are unwrapped totals while airborne: blend straight, only within one jump.
  if (state.air && prev.airborne) {
    out.air = Object.assign(air, state.air, { spin: lerp(prev.spin, curr.spin, t), flip: lerp(prev.flip, curr.flip, t) })
  }
  return out
}

/** Called by `advance` around each step. */
export function recordStep(history: PoseHistory, state: SkiState, phase: 'before' | 'after'): void {
  if (phase === 'before') {
    // The first step of a frame starts from where the last one ended (or from a teleport).
    if (history.valid && matches(history.curr, state)) copyPose(history.prev, history.curr)
    else capturePose(history.prev, state)
  } else {
    capturePose(history.curr, state)
    history.valid = true
  }
}
