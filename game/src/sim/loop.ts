import { FIXED_DT, PHYSICS } from './constants'
import type { SampleTerrain } from './slopes'
import { stepSkier, type SkiEnv, type SkiInput, type SkiState } from './skier'

export interface SimClock {
  accumulator: number
  /** Seconds already integrated. Useful for tests and the HUD. */
  time: number
  fixedDt: number
}

export function createClock(): SimClock {
  return { accumulator: 0, time: 0, fixedDt: FIXED_DT }
}

/**
 * Run as many fixed steps as `frameDt` covers. Render frame rate changes how
 * often this is called, not the physics step. A tiny epsilon absorbs the
 * binary rounding of frame deltas such as 1/144 so an integer number of
 * seconds lands on the same step count at 30, 60 and 144 fps.
 */
export function advance(
  clock: SimClock,
  state: SkiState,
  input: SkiInput,
  sampleTerrain: SampleTerrain,
  frameDt: number,
  env?: SkiEnv,
): number {
  if (!Number.isFinite(frameDt) || frameDt <= 0) return 0
  const capped = Math.min(frameDt, PHYSICS.maxFrameDt)
  clock.accumulator += capped
  let steps = 0
  while (clock.accumulator >= clock.fixedDt - 1e-9 && steps < PHYSICS.maxSubsteps) {
    stepSkier(state, input, sampleTerrain, clock.fixedDt, env)
    clock.accumulator -= clock.fixedDt
    clock.time += clock.fixedDt
    steps += 1
  }
  return steps
}
