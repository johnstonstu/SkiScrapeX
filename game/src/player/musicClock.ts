import type { MusicMood } from './musicState'

/**
 * Look-ahead step scheduler on the audio clock. Pure: the caller passes the
 * current time (`AudioContext.currentTime` in the game, a fake clock in tests)
 * and gets back steps with exact start times to schedule. A timer only pumps
 * it, so timer drift never moves a note. Mood changes wait for the next bar.
 */

export interface MusicStep {
  /** Steps since the scheduler started. */
  index: number
  bar: number
  /** 0 .. stepsPerBar - 1. */
  stepInBar: number
  /** Audio-clock time the step starts, seconds. */
  time: number
  /** Mood in force for this step (changes only on step 0 of a bar). */
  mood: MusicMood
  /** True on the first step of a bar where the mood just changed. */
  moodChanged: boolean
}

export interface SchedulerOptions {
  bpm: number
  beatsPerBar?: number
  stepsPerBeat?: number
  /** How far ahead of `now` to schedule, seconds. */
  lookahead?: number
  /** Audio time of step 0. */
  start: number
  mood: MusicMood
}

export interface BarScheduler {
  /** Every step whose start falls before `now + lookahead`, in order. */
  pump(now: number): MusicStep[]
  /** Ask for a mood; it takes effect on the next bar line that has not been scheduled yet. */
  request(mood: MusicMood): void
  /** Mood of the most recently scheduled step. */
  readonly mood: MusicMood
  readonly stepSeconds: number
  readonly barSeconds: number
  /** Start time of the first bar line at or after `time`. */
  barAtOrAfter(time: number): number
}

export function createBarScheduler(options: SchedulerOptions): BarScheduler {
  const beatsPerBar = options.beatsPerBar ?? 4
  const stepsPerBeat = options.stepsPerBeat ?? 4
  const stepsPerBar = beatsPerBar * stepsPerBeat
  const lookahead = options.lookahead ?? 0.12
  const stepSeconds = 60 / options.bpm / stepsPerBeat
  const barSeconds = stepSeconds * stepsPerBar
  const start = options.start
  let index = 0
  let mood = options.mood
  let pending: MusicMood | null = null

  const timeOf = (i: number) => start + i * stepSeconds

  return {
    pump(now) {
      const out: MusicStep[] = []
      // Fell far behind (tab was asleep, audio clock jumped): skip to the next
      // bar line instead of playing a burst of late notes.
      if (timeOf(index) < now - 0.05) {
        const bars = Math.ceil((now - start) / barSeconds)
        index = Math.max(index, bars * stepsPerBar)
      }
      while (timeOf(index) < now + lookahead) {
        const stepInBar = index % stepsPerBar
        let moodChanged = false
        if (stepInBar === 0 && pending !== null) {
          moodChanged = pending !== mood
          mood = pending
          pending = null
        }
        out.push({ index, bar: Math.floor(index / stepsPerBar), stepInBar, time: timeOf(index), mood, moodChanged })
        index++
      }
      return out
    },
    request(next) {
      pending = next === mood ? null : next
    },
    get mood() {
      return mood
    },
    stepSeconds,
    barSeconds,
    barAtOrAfter(time) {
      return start + Math.max(0, Math.ceil((time - start) / barSeconds - 1e-9)) * barSeconds
    },
  }
}
