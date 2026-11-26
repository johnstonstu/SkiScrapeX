/**
 * The mogul comp's rhythm mechanic, with no rendering. Each bump is a beat:
 * tap left or right as you reach it and the skier holds that line round the
 * bump. Good taps build a streak and raise the target speed, so the beats come
 * quicker; a miss drops the speed back; three misses in a row and you are out
 * of the line (DNF). Airs are skied with the normal freestyle controls and
 * judged like aerials. The score is out of 100: turns 60, air 20, speed 20,
 * the split the real judges use.
 */
import type { SkiInput, SkiState, TrickEvent } from '../sim'
import { LINE_SWING, laneHeading, lanePoint, type MogulCourse } from '../world/mogulCourse'
import { judgeJump, type JudgedJump } from './judging'
import { headingFor } from '../world/resort'
import { steerToward } from './race'

export type TurnGrade = 'perfect' | 'good' | 'off' | 'miss'

/** Seconds either side of the beat for a perfect and a good tap. */
export const PERFECT = 0.08
export const GOOD = 0.18
/** A tap more than this long before its beat is ignored (not yet the turn). */
export const EARLIEST = 0.45
/** Past the beat by more than GOOD with no tap: missed. */
export const START_SPEED = 6
export const TOP_SPEED = 11
export const MISS_DROP = 1.5
/** Misses in a row that throw you out of the line. */
export const OUT_AFTER = 3
/**
 * The autopilot's turn shape: on each beat the skis pivot this many degrees
 * across the fall line toward the new side, as a mogul skier's do. The steer
 * changes at most STEER_RATE per second, so a new beat never snaps the skis.
 */
export const PIVOT_DEG = 20
export const STEER_RATE = 9
/**
 * Speed is held by the legs and the skid through the bumps, not a hockey stop:
 * over the target speed, the comp takes this share of the excess off per
 * second (`holdSpeed`). Only this far over target (m/s) does the autopilot
 * touch the brake as well.
 */
export const ABSORB_RATE = 2.5
export const BRAKE_MARGIN = 3
const RAISE: Record<TurnGrade, number> = { perfect: 0.35, good: 0.2, off: 0, miss: 0 }
const TURN_POINTS: Record<TurnGrade, number> = { perfect: 1, good: 0.8, off: 0.5, miss: 0 }

export type MogulEvent =
  | { type: 'turn'; index: number; grade: TurnGrade; streak: number }
  | { type: 'out' }
  | { type: 'air'; jump: JudgedJump }

export interface MogulScore {
  turns: number
  air: number
  speed: number
  total: number
}

export function createMogulRun(course: MogulCourse) {
  let next = 0
  let side = 0
  let target = START_SPEED
  let streak = 0
  let bestStreak = 0
  let inRow = 0
  let out = false
  const grades: TurnGrade[] = []
  const jumps: JudgedJump[] = []
  const down = laneHeading(course)
  // Which way the heading turns to face the +lateral side of the lane.
  const [ox, oz] = lanePoint(course, 0, 0)
  const [lx, lz] = lanePoint(course, 0, 1)
  const toPlus = Math.sign(wrap(headingFor(lx - ox, lz - oz) - down)) || 1
  let lastSteer = 0

  const resolve = (grade: TurnGrade): MogulEvent[] => {
    const events: MogulEvent[] = []
    const turn = course.turns[next]
    grades.push(grade)
    // The line carries on round the bump either way; a miss is a skid and a scramble.
    side = turn.dir
    if (grade === 'miss') {
      streak = 0
      inRow++
      target = Math.max(START_SPEED - 1, target - MISS_DROP)
    } else {
      streak++
      bestStreak = Math.max(bestStreak, streak)
      inRow = 0
      target = Math.min(TOP_SPEED, target + RAISE[grade])
    }
    events.push({ type: 'turn', index: next, grade, streak })
    next++
    if (inRow >= OUT_AFTER) {
      out = true
      events.push({ type: 'out' })
    }
    return events
  }

  return {
    get targetSpeed() {
      return target
    },
    get streak() {
      return streak
    },
    get bestStreak() {
      return bestStreak
    },
    get out() {
      return out
    },
    get grades(): readonly TurnGrade[] {
      return grades
    },
    get jumps(): readonly JudgedJump[] {
      return jumps
    },
    /**
     * Advance with the racer `along` metres down the lane at `speed` m/s and
     * `tap` this frame (-1 left, 1 right, 0 none). Returns what happened.
     */
    step(along: number, speed: number, tap: -1 | 0 | 1): MogulEvent[] {
      if (out || next >= course.turns.length) return []
      const turn = course.turns[next]
      const toBeat = (turn.s - along) / Math.max(speed, 1)
      if (tap !== 0 && toBeat <= EARLIEST) {
        if (tap !== turn.dir) return resolve('miss')
        const off = Math.abs(toBeat)
        return resolve(off <= PERFECT ? 'perfect' : off <= GOOD ? 'good' : 'off')
      }
      if (toBeat < -GOOD) return resolve('miss')
      return []
    },
    /** A landed (or crashed) air: judged and kept. */
    addAir(trick: TrickEvent): MogulEvent {
      const jump = judgeJump(trick)
      jumps.push(jump)
      return { type: 'air', jump }
    },
    /** The next turns as beat cues: direction and seconds to the beat. */
    cues(along: number, speed: number, count = 4): { dir: -1 | 1; inSeconds: number }[] {
      return course.turns.slice(next, next + count).map((turn) => ({ dir: turn.dir, inSeconds: Math.max(0, (turn.s - along) / Math.max(speed, 1)) }))
    },
    /** Whether the racer is in an air's run-in, flight or landing (the autopilot lets go, taps do nothing). */
    inAirZone(along: number): boolean {
      return course.airs.some((air) => along > air.s - 10 && along < air.s + 16)
    },
    /**
     * The autopilot: hold the chosen side of the zipper line and the target
     * speed. Returns steer, brake and tuck to put into the skier's input.
     */
    drive(skier: SkiState, along: number, dt = 1 / 60): Pick<SkiInput, 'steer' | 'brake' | 'tuck'> {
      const centre = this.inAirZone(along)
      const speed = skier.speed
      const goal = this.goalAt(along)
      let want: number
      if (centre) {
        // Square up to the ramp: aim where the skier is going, not just the skis, so a
        // skid out of the last turn does not carry across the lip.
        const [tx, tz] = lanePoint(course, along + 6, 0)
        const travel = headingFor(skier.vx, skier.vz)
        want = headingFor(tx - skier.x, tz - skier.z) + (skier.speed > 1 ? wrap(skier.heading - travel) : 0)
      } else {
        // Hold the line toward this beat's side, with the skis pivoted across it.
        const [tx, tz] = lanePoint(course, along + 4, side * LINE_SWING)
        const line = headingFor(tx - skier.x, tz - skier.z)
        want = line + side * toPlus * PIVOT_DEG * (Math.PI / 180)
      }
      // In the air the player spins and flips: no autopilot steer, and none carried over.
      let steer = 0
      if (skier.grounded) {
        const raw = Math.max(-1, Math.min(1, wrap(want - skier.heading) * 3))
        const step = STEER_RATE * dt
        steer = lastSteer + Math.max(-step, Math.min(step, raw - lastSteer))
      }
      lastSteer = steer
      return {
        steer,
        tuck: speed < goal - 0.6,
        brake: Math.max(0, Math.min(1, (speed - goal - BRAKE_MARGIN) * 0.4)),
      }
    },
    /** The speed the line is held to at `along` (more into an air: the ramp needs it). */
    goalAt(along: number): number {
      return this.inAirZone(along) ? Math.max(target, 8) : target
    },
    /** The score out of 100 for a run of `time` seconds. */
    score(time: number): MogulScore {
      const turns = course.turns.length ? (60 * grades.reduce((sum, g) => sum + TURN_POINTS[g], 0)) / course.turns.length : 0
      // Each air is worth up to 10: a perfect straight air is 5, a clean backflip about 8.
      const air = jumps
        .map((j) => Math.min(10, (j.score / 19) * 10))
        .sort((a, b) => b - a)
        .slice(0, 2)
        .reduce((sum, v) => sum + v, 0)
      const average = time > 0 ? course.length / time : 0
      const speed = 20 * Math.max(0, Math.min(1, (average - 4) / 5))
      const round = (v: number) => Math.round(v * 10) / 10
      return { turns: round(turns), air: round(air), speed: round(speed), total: round(turns + air + speed) }
    },
  }
}

export type MogulRun = ReturnType<typeof createMogulRun>

/**
 * Hold a racer in the mogul line to `goal` m/s: take ABSORB_RATE of the excess
 * off per second, along the direction of travel (grounded only).
 */
export function holdSpeed(skier: SkiState, goal: number, dt: number): void {
  if (!skier.grounded || skier.speed <= goal) return
  const cut = Math.min(skier.speed - goal, (skier.speed - goal) * ABSORB_RATE * dt)
  const scale = (skier.speed - cut) / skier.speed
  skier.vx *= scale
  skier.vy *= scale
  skier.vz *= scale
  skier.speed -= cut
}

/** Turn a frame's steering into a tap: the moment it crosses 0.3 one way. */
export function createTapReader() {
  let last = 0
  return (steer: number): -1 | 0 | 1 => {
    const now = steer > 0.3 ? 1 : steer < -0.3 ? -1 : 0
    const tap = now !== 0 && now !== last ? now : 0
    last = now
    return tap
  }
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}
