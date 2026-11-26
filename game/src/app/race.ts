/**
 * The race system shared by every race event, with no rendering:
 *
 * - The start gate: a 3-2-1 countdown with the racer held in the start.
 *   Holding the push button through the count is fine: the racer goes at GO.
 *   A push timed onto GO (just before or just after) is a fast start. There
 *   are no false starts.
 * - Gate grading: a carved pass close to the turning pole is "tight" and
 *   earns a little speed, a carved pass further out is "clean", a skidded
 *   one earns nothing (the skid has already cost the speed).
 * - The racing line assist: steering toward the next gate's turning side is
 *   pulled toward the ideal arc; steering away gets no help, so the racer
 *   still has to commit to every turn.
 */
import type { SkiState } from '../sim'
import { GATE_HALF_WIDTH, type Gate } from '../world/challenges'
import { headingFor } from '../world/resort'

/** Seconds from the start of the count to GO. */
export const COUNTDOWN = 3
/** A push this soon after GO is a fast start. */
export const PUSH_WINDOW = 0.3
/** A push this soon before GO also counts: the racer timed it onto the beep. */
export const ANTICIPATE = 0.35
/** Speed a fast start adds down the line, m/s. */
export const FAST_START_KICK = 2

export type StartEvent = 'go' | 'fastStart'

/**
 * The start gate. Call `step` every frame with whether the push button is
 * down; it reports whether to hold the racer still and what happened. The
 * racer can hold the button through the count and simply goes at GO.
 */
export function createStartGate() {
  let t = 0
  let wasDown = true // a button still held from the menu is not a push
  let lastPush = -Infinity
  let done = false
  let fastDue = false
  return {
    /** Seconds left to GO (3, 2, 1), or 0 once the gate is open. */
    get count() {
      return t < COUNTDOWN ? Math.min(COUNTDOWN, Math.ceil(COUNTDOWN - t)) : 0
    },
    get open() {
      return t >= COUNTDOWN
    },
    step(dt: number, pushDown: boolean): { hold: boolean; event: StartEvent | null } {
      const push = pushDown && !wasDown
      wasDown = pushDown
      if (done) return { hold: false, event: null }
      if (t < COUNTDOWN) {
        if (push) lastPush = t
        t += dt
        if (t >= COUNTDOWN) {
          // A push in the last moments before GO, still held, is a fast start on the next frame.
          fastDue = pushDown && COUNTDOWN - lastPush <= ANTICIPATE
          return { hold: false, event: 'go' }
        }
        return { hold: true, event: null }
      }
      t += dt
      if (fastDue || push) {
        done = true
        return { hold: false, event: fastDue || t - COUNTDOWN <= PUSH_WINDOW ? 'fastStart' : null }
      }
      if (t - COUNTDOWN > PUSH_WINDOW) done = true
      return { hold: false, event: null }
    },
  }
}

export type GateGrade = 'tight' | 'clean' | 'skid'

/** Carving means less than this share of the speed is going sideways. */
export const CARVE_SKID = 0.22
/** Within this many metres of the turning pole is a tight line. */
export const TIGHT_METRES = 1.5
/** Speed a tight gate adds, m/s. */
export const TIGHT_KICK = 0.5

/**
 * Grade a gate pass from where across the gate it was crossed (`lateral`,
 * metres along (dirZ, -dirX) from the gate centre) and how much the skis
 * were skidding. Gates set on the line (no turning pole) are clean or skid.
 */
export function gradeGate(gate: Gate, lateral: number, skid: number, offset: number): { grade: GateGrade; poleDistance: number | null } {
  if (skid >= CARVE_SKID) return { grade: 'skid', poleDistance: null }
  if (offset <= 0) return { grade: 'clean', poleDistance: null }
  const half = gate.halfWidth ?? GATE_HALF_WIDTH
  // The turning pole is the one nearer the course line: the gate sits `side` of it.
  const pole = -gate.side * half
  const poleDistance = Math.abs(lateral - pole)
  return { grade: poleDistance <= TIGHT_METRES ? 'tight' : 'clean', poleDistance }
}

/** Add speed along the direction of travel. */
export function kick(skier: SkiState, metresPerSecond: number): void {
  const speed = Math.hypot(skier.vx, skier.vz)
  if (speed < 0.1) {
    skier.vx += -Math.sin(skier.heading) * metresPerSecond
    skier.vz += Math.cos(skier.heading) * metresPerSecond
  } else {
    skier.vx += (skier.vx / speed) * metresPerSecond
    skier.vz += (skier.vz / speed) * metresPerSecond
  }
  skier.speed = Math.hypot(skier.vx, skier.vy, skier.vz)
}

/** How strongly the assist pulls a committed turn toward the ideal arc. */
export const ASSIST_STRENGTH = 0.6

/**
 * The point to aim at for a gate: just inside the turning pole for an offset
 * gate, the centre for one set on the line.
 */
export function gateAim(gate: Gate, offset: number): [number, number] {
  const half = gate.halfWidth ?? GATE_HALF_WIDTH
  const lateral = offset > 0 ? -gate.side * Math.max(0, half - 1.2) : 0
  return [gate.x + gate.dirZ * lateral, gate.z - gate.dirX * lateral]
}

/** Start aiming for the gate after next this many metres before passing a gate, as a racer starts the next turn early. */
export const ASSIST_LEAD = 4
/** The assist only looks at a gate this close ahead, metres along the course. */
export const ASSIST_RANGE = 30

/** The gate to aim for: the first not yet passed that is more than ASSIST_LEAD metres ahead, if within range. */
export function aimGate(gates: readonly Gate[], nextIndex: number, along: number): Gate | null {
  for (let i = nextIndex; i < gates.length; i++) {
    if (gates[i].s <= along + ASSIST_LEAD) continue
    return gates[i].s - along <= ASSIST_RANGE ? gates[i] : null
  }
  return null
}

/** The steer that points the skis at (tx, tz), as the pace bot steers. */
export function steerToward(skier: SkiState, tx: number, tz: number): number {
  const want = headingFor(tx - skier.x, tz - skier.z)
  const error = Math.atan2(Math.sin(want - skier.heading), Math.cos(want - skier.heading))
  return Math.max(-1, Math.min(1, error * 2.5))
}

/**
 * The racing line assist. `ideal` is the steer that would carve the ideal
 * line. A player steering the same way is pulled toward it; a player steering
 * the other way, or not at all, is left alone.
 */
export function assistSteer(player: number, ideal: number, strength = ASSIST_STRENGTH): number {
  if (Math.abs(player) < 0.15 || Math.sign(player) !== Math.sign(ideal)) return player
  return player + strength * (ideal - player)
}
