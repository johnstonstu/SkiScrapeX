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
  gateCrossing,
  progressAlong,
  type Gate,
  type MedalTargets,
} from '../world/challenges'

export type Challenge =
  | { kind: 'free' }
  | { kind: 'time'; id: string; run: Run; line: Point2[]; targets: MedalTargets | null }
  | { kind: 'slalom'; id: string; run: Run; line: Point2[]; gates: Gate[]; targets: MedalTargets | null }
  | { kind: 'park'; id: string; site: ParkSite; layout: string; line: Point2[]; targets: MedalTargets }

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
}

export type SessionEvent =
  | { type: 'gate'; result: 'pass' | 'miss'; index: number; total: number }
  | { type: 'finish' }
  | { type: 'offCourse' }

/** Seconds allowed far off the course before the attempt ends. */
const OFF_COURSE_SECONDS = 4

export function createSession(challenge: Challenge) {
  const stats: RunStats = { time: 0, distance: 0, vertical: 0, topSpeed: 0, gatesPassed: 0, gatesMissed: 0, penalty: 0 }
  const line = challenge.kind === 'free' ? null : challenge.line
  const length = line ? polylineLength(line) : 0
  const offLimit = challenge.kind === 'park' ? 45 : challenge.kind === 'free' ? Infinity : runHalfWidth(challenge.run) + 60
  let timing = false
  let finished = false
  let lastX = NaN
  let lastZ = NaN
  let lastY = NaN
  let maxS = 0
  let offTime = 0
  let nextGate = 0

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
    /** Advance one frame. Returns what happened, for the HUD. */
    step(skier: SkiState, dt: number): SessionEvent[] {
      const events: SessionEvent[] = []
      if (finished) return events
      if (!timing && skier.speed > 1) timing = true
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
        if (challenge.kind === 'slalom' && Number.isFinite(lastX)) {
          const gates = challenge.gates
          while (nextGate < gates.length) {
            const gate = gates[nextGate]
            let result = gateCrossing(lastX, lastZ, skier.x, skier.z, gate)
            // Skipped wide or crossed some other way: once well past the gate, it is missed.
            if (!result && s > gate.s + 12) result = 'miss'
            if (!result) break
            if (result === 'pass') stats.gatesPassed++
            else {
              stats.gatesMissed++
              stats.penalty += GATE_PENALTY
            }
            events.push({ type: 'gate', result, index: nextGate, total: gates.length })
            nextGate++
          }
        }
        const [ex, ez] = line[line.length - 1]
        const atEnd = Math.hypot(ex - skier.x, ez - skier.z) < FINISH_RADIUS || (challenge.kind === 'park' && s > length - 10)
        if (atEnd && maxS > length * 0.8) {
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
