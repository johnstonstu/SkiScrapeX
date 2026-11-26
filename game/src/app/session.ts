/**
 * One run from spawn to finish: stats for the results screen, and the rules
 * of whichever challenge is being played. Called once per frame after the
 * physics step.
 */
import type { SkiState } from '../sim'
import type { ParkSite } from '../world/park'
import { polylineLength, runHalfWidth, type Point2, type Run } from '../world/resort'
import {
  FINISH_RADIUS,
  GATE_PENALTY,
  GATE_HALF_WIDTH,
  gateLateral,
  progressAlong,
  type Gate,
  type MedalTargets,
} from '../world/challenges'
import type { EventCourse } from '../world/events'

export type Challenge =
  | { kind: 'free' }
  | { kind: 'time'; id: string; run: Run; line: Point2[]; targets: MedalTargets | null }
  | { kind: 'slalom'; id: string; run: Run; line: Point2[]; gates: Gate[]; targets: MedalTargets | null }
  | { kind: 'park'; id: string; site: ParkSite; layout: string; line: Point2[]; targets: MedalTargets }
  /**
   * An Apex race event. `run` stands in for the course in the HUD. For Match
   * Your Time, `firstRun` holds run one's time while run two is skied.
   */
  | { kind: 'event'; id: string; course: EventCourse; run: Run; line: Point2[]; gates: Gate[]; targets: MedalTargets | null; firstRun?: number }

export interface RunStats {
  /** Clock time, seconds (no penalties). */
  time: number
  /** Horizontal metres skied. */
  distance: number
  /** Metres of descent. */
  vertical: number
  /** m/s */
  topSpeed: number
  gatesPassed: number
  gatesMissed: number
  /** Seconds added for missed gates. */
  penalty: number
  /** Fastest speed through the radar, m/s (0 when there is no trap or it was not reached). */
  trapSpeed: number
  /** Clock time at each split passed, seconds. */
  splits: number[]
}

export type SessionEvent =
  /** `lateral` is where across the gate it was crossed (null when it was skipped), `skid` the skis' skid then. */
  | { type: 'gate'; result: 'pass' | 'miss'; index: number; total: number; lateral: number | null; skid: number }
  | { type: 'finish' }
  | { type: 'offCourse' }
  | { type: 'split'; index: number; time: number }
  /** Left the radar zone: the speed it clocked. */
  | { type: 'trap'; speed: number }
  /** A race gate missed in an event: the attempt is over. */
  | { type: 'disqualified'; gate: number }
  /** The clock is running but the racer has not moved on down the course for `STALL_SECONDS`. */
  | { type: 'stalled' }

/** Seconds allowed far off the course before the attempt ends. */
const OFF_COURSE_SECONDS = 4
/** With the clock running, less than `STALL_METRES` of progress down the course in this long ends the attempt. */
export const STALL_SECONDS = 20
export const STALL_METRES = 3

export function createSession(challenge: Challenge) {
  const stats: RunStats = { time: 0, distance: 0, vertical: 0, topSpeed: 0, gatesPassed: 0, gatesMissed: 0, penalty: 0, trapSpeed: 0, splits: [] }
  const line = challenge.kind === 'free' ? null : challenge.line
  const length = line ? polylineLength(line) : 0
  const offLimit =
    challenge.kind === 'park' ? 45 : challenge.kind === 'free' ? Infinity : challenge.kind === 'event' ? challenge.course.def.corridor : runHalfWidth(challenge.run) + 60
  const trap = challenge.kind === 'event' ? challenge.course.trap : null
  const splitAt = challenge.kind === 'event' ? challenge.course.splits : []
  let inTrap = false
  // Race events start the clock at GO from the start gate, not on the first movement.
  const waitForGo = challenge.kind === 'event' && challenge.course.def.format !== 'aerials'
  let timing = false
  let finished = false
  let lastX = NaN
  let lastZ = NaN
  let lastY = NaN
  let maxS = 0
  let offTime = 0
  let nextGate = 0
  // Progress mark for the stall rule: the furthest point reached, and the clock time since it last moved on.
  const stallRule = challenge.kind === 'event' || challenge.kind === 'slalom' || challenge.kind === 'time'
  let stallMark = 0
  let stallTime = 0

  return {
    challenge,
    stats,
    get timing() {
      return timing
    },
    get finished() {
      return finished
    },
    /** Time with gate penalties, the number medals use. */
    get total() {
      return stats.time + stats.penalty
    },
    get nextGate() {
      return nextGate
    },
    /** GO from the start gate: the clock runs from now. */
    startClock() {
      timing = true
    },
    /** Stop the clock and the rules: the attempt has ended some other way (a crash). */
    abandon() {
      finished = true
    },
    /** Advance one frame. Returns what happened, for the HUD. */
    step(skier: SkiState, dt: number): SessionEvent[] {
      const events: SessionEvent[] = []
      if (finished) return events
      if (!timing && !waitForGo && skier.speed > 1) timing = true
      if (timing) stats.time += dt
      if (Number.isFinite(lastX)) {
        stats.distance += Math.hypot(skier.x - lastX, skier.z - lastZ)
        if (skier.y < lastY) stats.vertical += lastY - skier.y
      }
      stats.topSpeed = Math.max(stats.topSpeed, skier.speed)

      if (line) {
        const { s, off } = progressAlong(skier.x, skier.z, line)
        maxS = Math.max(maxS, s)
        offTime = off > offLimit ? offTime + dt : 0
        if (offTime > OFF_COURSE_SECONDS) {
          finished = true
          events.push({ type: 'offCourse' })
          return events
        }
        if (stallRule && timing) {
          if (maxS > stallMark + STALL_METRES) {
            stallMark = maxS
            stallTime = 0
          } else stallTime += dt
          if (stallTime > STALL_SECONDS) {
            finished = true
            events.push({ type: 'stalled' })
            return events
          }
        }
        if (timing && trap) {
          const inside = s >= trap[0] && s <= trap[1]
          if (inside) stats.trapSpeed = Math.max(stats.trapSpeed, skier.speed)
          if (inTrap && !inside && stats.trapSpeed > 0) events.push({ type: 'trap', speed: stats.trapSpeed })
          inTrap = inside
        }
        while (timing && stats.splits.length < splitAt.length && s >= splitAt[stats.splits.length]) {
          stats.splits.push(stats.time)
          events.push({ type: 'split', index: stats.splits.length - 1, time: stats.time })
        }
        if ((challenge.kind === 'slalom' || challenge.kind === 'event') && Number.isFinite(lastX)) {
          const gates = challenge.gates
          while (nextGate < gates.length) {
            const gate = gates[nextGate]
            const lateral = gateLateral(lastX, lastZ, skier.x, skier.z, gate)
            let result: 'pass' | 'miss' | null = lateral === null ? null : Math.abs(lateral) <= (gate.halfWidth ?? GATE_HALF_WIDTH) ? 'pass' : 'miss'
            // Skipped wide or crossed some other way: once well past the gate, it is missed.
            if (!result && s > gate.s + 12) result = 'miss'
            if (!result) break
            if (result === 'pass') stats.gatesPassed++
            else {
              stats.gatesMissed++
              if (challenge.kind === 'slalom') stats.penalty += GATE_PENALTY
            }
            events.push({ type: 'gate', result, index: nextGate, total: gates.length, lateral, skid: skier.skid })
            nextGate++
            // Race rules: a missed gate is a disqualification, not a time penalty.
            if (result === 'miss' && challenge.kind === 'event') {
              finished = true
              events.push({ type: 'disqualified', gate: nextGate - 1 })
              return events
            }
          }
        }
        const [ex, ez] = line[line.length - 1]
        const atEnd =
          Math.hypot(ex - skier.x, ez - skier.z) < FINISH_RADIUS || ((challenge.kind === 'park' || challenge.kind === 'event') && s > length - 10)
        if (atEnd && maxS > length * 0.8) {
          // An event gate never reached before the line is still a disqualification.
          if (challenge.kind === 'event' && nextGate < challenge.gates.length) {
            finished = true
            events.push({ type: 'disqualified', gate: nextGate })
            return events
          }
          // Gates never reached count as missed.
          if (challenge.kind === 'slalom') {
            const left = challenge.gates.length - nextGate
            stats.gatesMissed += left
            stats.penalty += left * GATE_PENALTY
            nextGate = challenge.gates.length
          }
          finished = true
          events.push({ type: 'finish' })
        }
      }
      lastX = skier.x
      lastZ = skier.z
      lastY = skier.y
      return events
    },
  }
}

export type Session = ReturnType<typeof createSession>
