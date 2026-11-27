/**
 * Park pace: the arcade speed control on a park's run-ins. Coming at a jump,
 * the speed you will have at the lip (coasting from here) is eased toward
 * the middle of that jump's landing window, so a rider who just points it
 * down the main line comes down in the sweet spot every time. Tuck to carry
 * more speed than the assist wants, brake to scrub more. Ahead of a rail or
 * box the speed is eased into the slide window instead.
 *
 * Pure: no DOM, so the park bots in the tests ride with the same assist.
 */
import type { Rail, SkiInput, SkiState } from '../sim'
import { coastTo, featureAhead, jumpOutcome, type JumpOutcome, type PlacedFeature } from '../world/park'

/** Share of the gap to the wanted speed closed per second. */
const EASE = 2.4
/** The most the assist adds or takes away, m/s². A gentle pump, not a tow rope. */
const MAX_PUSH = 1.4
const MAX_SCRUB = 4
/** Ahead of a slide: the speed that rides a box or rail cleanly, m/s. */
const SLIDE_TARGET = 7
/** Where in a jump's window the assist aims, 0 (slowest) to 1 (fastest). */
const AIM = 0.5
/** Lip speeds this share of the window either side of the aim are left alone. */
const BAND = 0.2
/** The assist works over the last this-many metres to a lip, where the coasting estimate holds. */
const RANGE = 55
/** Never eases a rider below this, m/s: the park keeps you rolling. */
const MIN_ROLL = 4
/** On a run-in the assist holds at least this share of the jump's target speed. */
const HOLD_FLOOR = 0.8
/** At takeoff the lip speed is trimmed to this far inside the window either side. */
const SNAP_INSET = 0.12

export interface PaceCue {
  feature: PlacedFeature
  /** Metres to the lip along the direction of travel. */
  distance: number
  /** Speed at the lip if the rider coasts from here, m/s. */
  predicted: number
  /** The speed the assist is easing the lip speed toward, m/s. */
  target: number
}

/** The next jump ahead and the speed the rider would have at its lip, or null. */
export function paceCue(skier: SkiState, features: PlacedFeature[]): PaceCue | null {
  const travel = Math.hypot(skier.vx, skier.vz)
  if (travel < 1) return null
  const dirX = skier.vx / travel
  const dirZ = skier.vz / travel
  const next = featureAhead(features, skier.x, skier.z, dirX, dirZ, 60)
  const f = next?.feature
  if (!f || !f.lip || !f.window) return null
  const predicted = coastTo(skier.speed, skier.y - f.lip.y, next.distance)
  const [lo, hi] = f.window
  return { feature: f, distance: next.distance, predicted, target: lo + (hi - lo) * AIM }
}

/** A box or rail straight ahead within `range` metres, by its take-on. */
function slideAhead(skier: SkiState, rails: readonly Rail[], range = 30): boolean {
  const travel = Math.hypot(skier.vx, skier.vz)
  if (travel < 1) return false
  const dirX = skier.vx / travel
  const dirZ = skier.vz / travel
  for (const rail of rails) {
    const p = rail.points[0]
    if (!p) continue
    const dx = p.x - skier.x
    const dz = p.z - skier.z
    const ahead = dx * dirX + dz * dirZ
    if (ahead > 0 && ahead < range && Math.abs(-dx * dirZ + dz * dirX) < 2.5) return true
  }
  return false
}

/**
 * Per physics step, on the snow in a park: ease the speed toward what the
 * next feature wants. Changes the skier's velocity along its direction of
 * travel. `strength` 0 turns it off (the cue still shows), 1 is full.
 */
export function stepParkPace(skier: SkiState, input: SkiInput, features: PlacedFeature[], rails: readonly Rail[], dt: number, strength = 1): PaceCue | null {
  if (!skier.grounded || skier.rail || skier.crashed > 0 || strength <= 0) return null
  const cue = paceCue(skier, features)
  let want: number | null = null
  if (cue && cue.distance < RANGE) {
    const [lo, hi] = cue.feature.window!
    const band = (hi - lo) * BAND
    if (cue.predicted < cue.target - band || cue.predicted > cue.target + band) {
      // The current speed that coasts to the target at the lip (v² differs by the same amount all the way down).
      const gain = cue.predicted ** 2 - skier.speed ** 2
      // Never hold the rider far under the jump's own speed: on a steep run-in the takeoff snap trims the rest.
      want = Math.max(MIN_ROLL, cue.target * HOLD_FLOOR, Math.sqrt(Math.max(0, cue.target ** 2 - gain)))
    }
  } else if (cue) return cue
  else if (slideAhead(skier, rails)) want = SLIDE_TARGET
  if (want === null) return cue
  let change = (want - skier.speed) * EASE * dt
  // The rider's own input wins: a tuck keeps the extra speed, the brake keeps scrubbing.
  if (change > 0 && input.brake > 0.1) change = 0
  if (change < 0 && input.tuck) change = 0
  change = Math.max(-MAX_SCRUB * dt, Math.min(MAX_PUSH * dt, change)) * strength
  const speed = skier.speed + change
  if (speed > 0.5 && skier.speed > 0.5) {
    const scale = speed / skier.speed
    skier.vx *= scale
    skier.vy *= scale
    skier.vz *= scale
    skier.speed = speed
  }
  return cue
}

/** What happened on a jump the assist saw: the feature and where it came down. */
export interface JumpLanding {
  feature: PlacedFeature
  outcome: JumpOutcome
  /** Lip speed as the rider left, m/s (after any snap). */
  lipSpeed: number
}

/**
 * The park assist for one rider. Call `step` after every physics step: it
 * trims the lip speed into the landing window on the step the rider takes
 * off (the arcade part: the jump flies to the sweet spot), notes where a
 * jump came down, and eases the run-in speed for the next step.
 */
export function createParkPace() {
  let flight: { feature: PlacedFeature; lipSpeed: number; at: number } | null = null
  let wasOnSnow = true
  let landing: JumpLanding | null = null
  let cue: PaceCue | null = null
  return {
    /** The next jump and its predicted lip speed after the last step, if any. */
    get cue() {
      return cue
    },
    reset() {
      flight = null
      wasOnSnow = true
      landing = null
      cue = null
    },
    /** The jump that came down since the last call, if any. */
    takeLanding(): JumpLanding | null {
      const done = landing
      landing = null
      return done
    },
    step(skier: SkiState, input: SkiInput, features: PlacedFeature[], rails: readonly Rail[], dt: number, strength: number): void {
      const onSnow = skier.grounded || Boolean(skier.rail)
      if (wasOnSnow && !onSnow && skier.crashed <= 0) {
        const feature = features.find((f) => f.lip && f.window && Math.hypot(f.lip.x - skier.x, f.lip.z - skier.z) < 3.5)
        if (feature) {
          if (strength > 0) snapLipSpeed(skier, feature.window!, strength)
          flight = { feature, lipSpeed: skier.speed, at: skier.time }
        } else flight = null
      }
      if (flight && onSnow) {
        const done = flight
        flight = null
        // A hop off the transition before the lip is not the jump.
        if (skier.crashed <= 0 && !skier.rail && skier.time - done.at >= 0.3) {
          const outcome = jumpOutcome(done.feature, skier.x, skier.z)
          if (outcome) landing = { feature: done.feature, outcome, lipSpeed: done.lipSpeed }
        }
      }
      wasOnSnow = onSnow
      cue = stepParkPace(skier, input, features, rails, dt, strength) ?? (onSnow ? paceCue(skier, features) : null)
    },
  }
}

/** Scale the velocity (keeping the launch angle) so the speed sits inside the window. */
export function snapLipSpeed(skier: SkiState, [lo, hi]: [number, number], strength = 1): void {
  const inset = (hi - lo) * SNAP_INSET
  const clamped = Math.min(hi - inset, Math.max(lo + inset, skier.speed))
  const speed = skier.speed + (clamped - skier.speed) * strength
  if (skier.speed < 0.5 || Math.abs(speed - skier.speed) < 1e-3) return
  const scale = speed / skier.speed
  skier.vx *= scale
  skier.vy *= scale
  skier.vz *= scale
  skier.speed = speed
}
