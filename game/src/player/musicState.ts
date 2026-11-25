/**
 * Which kind of music fits what the player is doing. Pure: no Web Audio, no
 * DOM, so it is unit tested (tests/music.test.ts) and the player only reads
 * `mood` and `intensity`.
 */

export type MusicMood = 'ambient' | 'cruise' | 'drive' | 'freestyle'

export const MUSIC_MOODS: readonly MusicMood[] = ['ambient', 'cruise', 'drive', 'freestyle']

/** One frame of what the game knows about the player. */
export interface MusicInput {
  /** Seconds since the last update. */
  dt: number
  /** On a lift. */
  riding: boolean
  /** A menu or the title screen is open. */
  menu: boolean
  /** m/s. */
  speed: number
  /** Fall-line slope under the skier, degrees. */
  slopeDeg: number
  airborne: boolean
  /** Seconds in the current air (0 on the ground). */
  airTime: number
  onRail: boolean
  /** Snow under the skis is park snow (inside a terrain park). */
  inPark: boolean
  crashed: boolean
  /** Increments with each scored trick or rail (`SkiState.trick.seq`), 0 for none. */
  trickSeq: number
}

/** Thresholds, exported so tests and tuning read the same numbers. */
export const MUSIC_TUNING = {
  /** Smoothing time constant for speed, seconds, so a single bump does not count. */
  speedSmoothing: 0.6,
  /** Drive starts above this speed (about 54 km/h) ... */
  driveEnterSpeed: 15,
  /** ... or on a steep pitch at a moderate speed. */
  driveEnterSlope: 27,
  driveEnterSlopeSpeed: 8,
  /** Drive ends only below both of these (the Schmitt band). */
  driveExitSpeed: 11,
  driveExitSlope: 22,
  /** Freestyle stays this long after the last park, air, rail or trick cue. */
  freestyleHold: 6,
  /** Air shorter than this is a bump, not freestyle. */
  freestyleAirTime: 0.45,
  /** Standing still this long counts as idle. */
  idleAfter: 4,
  idleSpeed: 1.5,
  /** Idle ends above this speed. */
  idleExitSpeed: 3,
  /** Seconds a new mood must keep winning before it is committed. */
  confirm: { ambient: 2, cruise: 2, drive: 1.2, freestyle: 0.3 } as Record<MusicMood, number>,
  /** Least time a committed mood plays before another can take over. */
  minDwell: 4,
}

export interface MusicTracker {
  /** Feed one frame; returns the committed mood. */
  update(input: MusicInput): MusicMood
  readonly mood: MusicMood
  /** 0 to 1: how hard the music should push inside the mood (speed-led, smoothed). */
  readonly intensity: number
  /** The mood the input points at this frame, before hysteresis (for the debug readout). */
  readonly wanted: MusicMood
  reset(mood?: MusicMood): void
}

/**
 * Hysteresis in three layers:
 * 1. Schmitt bands on speed and slope (enter drive at 15 m/s, leave below 11),
 *    and a freestyle hold timer refreshed by park snow, air, rails and tricks.
 * 2. A new mood must win for `confirm[mood]` seconds in a row.
 * 3. A committed mood plays at least `minDwell` seconds (lifts and menus skip
 *    this, they are deliberate).
 * While crashed the mood is held, so a tumble does not change the music.
 */
export function createMusicTracker(start: MusicMood = 'ambient', tuning = MUSIC_TUNING): MusicTracker {
  let mood: MusicMood = start
  let wanted: MusicMood = start
  let candidate: MusicMood = start
  let candidateTime = 0
  let dwell = 0
  let speed = 0
  let intensity = 0
  let driving = false
  let idle = true
  let stillTime = 0
  let freestyle = 0
  let lastTrick = 0

  const pick = (input: MusicInput): MusicMood => {
    const dt = Math.max(0, input.dt)
    const k = 1 - Math.exp(-dt / tuning.speedSmoothing)
    speed += (input.speed - speed) * k
    intensity += (Math.min(1, speed / 22) - intensity) * k

    if (input.trickSeq !== lastTrick) {
      if (input.trickSeq > 0) freestyle = tuning.freestyleHold
      lastTrick = input.trickSeq
    }
    if (input.inPark || input.onRail || (input.airborne && input.airTime >= tuning.freestyleAirTime)) freestyle = tuning.freestyleHold
    else freestyle = Math.max(0, freestyle - dt)

    if (driving) driving = speed >= tuning.driveExitSpeed || (input.slopeDeg >= tuning.driveExitSlope && speed >= tuning.driveEnterSlopeSpeed)
    else driving = speed > tuning.driveEnterSpeed || (input.slopeDeg > tuning.driveEnterSlope && speed > tuning.driveEnterSlopeSpeed)

    stillTime = input.speed < tuning.idleSpeed && !input.airborne ? stillTime + dt : 0
    if (idle) idle = speed < tuning.idleExitSpeed && !input.airborne
    else idle = stillTime >= tuning.idleAfter

    if (input.menu || input.riding) return 'ambient'
    if (freestyle > 0) return 'freestyle'
    if (driving) return 'drive'
    if (idle) return 'ambient'
    return 'cruise'
  }

  return {
    update(input) {
      const dt = Math.max(0, input.dt)
      dwell += dt
      wanted = pick(input)
      if (input.crashed && !input.menu) return mood
      if (wanted === mood) {
        candidate = mood
        candidateTime = 0
        return mood
      }
      if (wanted !== candidate) {
        candidate = wanted
        candidateTime = 0
      }
      candidateTime += dt
      const deliberate = input.menu || input.riding
      const confirm = deliberate ? 0.5 : tuning.confirm[candidate]
      if (candidateTime >= confirm && (deliberate || dwell >= tuning.minDwell)) {
        mood = candidate
        dwell = 0
        candidateTime = 0
      }
      return mood
    },
    get mood() {
      return mood
    },
    get intensity() {
      return intensity
    },
    get wanted() {
      return wanted
    },
    reset(next: MusicMood = 'ambient') {
      mood = wanted = candidate = next
      candidateTime = dwell = speed = intensity = stillTime = freestyle = 0
      driving = false
      idle = true
    },
  }
}
