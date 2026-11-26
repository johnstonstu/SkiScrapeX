/**
 * The run-out after a finish line. The clock has already stopped; the racer
 * keeps skiing while the game brakes them, and the result shows once they
 * have slowed down (or after a few seconds if they cannot stop).
 */
import type { SkiInput, SkiState } from '../sim'

/** Below this speed the run-out is over, m/s (10 km/h). */
export const RUNOUT_STOP_SPEED = 10 / 3.6
/** Longest run-out before the result shows anyway, seconds. */
export const RUNOUT_MAX_SECONDS = 5
/** Shortest run-out, so a slow finish still reads as crossing the line, seconds. */
export const RUNOUT_MIN_SECONDS = 0.6

export function createRunout() {
  let then: (() => void) | null = null
  let time = 0
  return {
    get active() {
      return then !== null
    },
    /** Start braking after the line; `done` runs once the racer has stopped. */
    start(done: () => void) {
      then = done
      time = 0
    },
    /** Drop a pending run-out without its result (a restart). */
    cancel() {
      then = null
    },
    /** Per frame, before physics: a hockey stop, no tuck, no jump. */
    input(input: SkiInput) {
      if (!then) return
      input.brake = 1
      input.tuck = false
      input.jump = false
      input.pitch = 0
    },
    /** Per frame, after physics. Returns true on the frame the run-out ends. */
    step(skier: Pick<SkiState, 'speed'>, dt: number): boolean {
      if (!then) return false
      time += dt
      const stopped = skier.speed < RUNOUT_STOP_SPEED && time >= RUNOUT_MIN_SECONDS
      if (!stopped && time < RUNOUT_MAX_SECONDS) return false
      const done = then
      then = null
      done()
      return true
    },
  }
}
