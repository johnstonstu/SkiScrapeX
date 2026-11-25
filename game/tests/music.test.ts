import { describe, expect, it } from 'vitest'
import { createBarScheduler } from '../src/player/musicClock'
import { chordNotes, composeStep, createMusicSession, MUSIC_LAYERS, MOOD_MIX } from '../src/player/musicScore'
import { createMusicTracker, MUSIC_TUNING, type MusicInput, type MusicMood } from '../src/player/musicState'

const frame = (over: Partial<MusicInput> = {}): MusicInput => ({
  dt: 0.1,
  riding: false,
  menu: false,
  speed: 8,
  slopeDeg: 15,
  airborne: false,
  airTime: 0,
  onRail: false,
  inPark: false,
  crashed: false,
  trickSeq: 0,
  ...over,
})

/** Run `seconds` of identical frames and return the committed mood. */
const hold = (tracker: ReturnType<typeof createMusicTracker>, seconds: number, over: Partial<MusicInput> = {}) => {
  let mood: MusicMood = tracker.mood
  for (let t = 0; t < seconds - 1e-9; t += 0.1) mood = tracker.update(frame(over))
  return mood
}

describe('music state choice', () => {
  it('picks a mood for representative inputs once it has settled', () => {
    const cases: [Partial<MusicInput>, MusicMood][] = [
      [{ speed: 8, slopeDeg: 15 }, 'cruise'],
      [{ speed: 19, slopeDeg: 18 }, 'drive'],
      [{ speed: 10, slopeDeg: 32 }, 'drive'],
      [{ speed: 7, inPark: true }, 'freestyle'],
      [{ speed: 9, onRail: true }, 'freestyle'],
      [{ speed: 6, riding: true }, 'ambient'],
      [{ speed: 0, slopeDeg: 5 }, 'ambient'],
      [{ speed: 12, menu: true }, 'ambient'],
    ]
    for (const [input, expected] of cases) {
      const tracker = createMusicTracker('cruise')
      expect(hold(tracker, 12, input), JSON.stringify(input)).toBe(expected)
    }
  })

  it('counts long air as freestyle but not a small bump', () => {
    const bump = createMusicTracker('cruise')
    for (let i = 0; i < 40; i++) bump.update(frame({ airborne: i % 10 < 3, airTime: (i % 10) * 0.1 }))
    expect(bump.wanted).toBe('cruise')
    const big = createMusicTracker('cruise')
    hold(big, 5)
    expect(hold(big, 1, { airborne: true, airTime: 0.8 })).toBe('freestyle')
  })

  it('a landed trick holds freestyle for a few seconds after leaving the park', () => {
    const tracker = createMusicTracker('cruise')
    hold(tracker, 5)
    expect(hold(tracker, 1, { trickSeq: 3 })).toBe('freestyle')
    expect(hold(tracker, MUSIC_TUNING.freestyleHold - 1.5, { trickSeq: 3 })).toBe('freestyle')
    expect(hold(tracker, 8, { trickSeq: 3 })).toBe('cruise')
  })

  it('does not flap between cruise and drive around one speed (Schmitt band)', () => {
    const tracker = createMusicTracker('cruise')
    expect(hold(tracker, 8, { speed: 18 })).toBe('drive')
    // Hovering at 13 m/s, below the 15 m/s entry but above the 11 m/s exit, stays drive.
    let changes = 0
    let last = tracker.mood
    for (let i = 0; i < 300; i++) {
      const mood = tracker.update(frame({ speed: 12 + Math.sin(i * 0.7) * 1.5 }))
      if (mood !== last) changes++
      last = mood
    }
    expect(changes).toBe(0)
    expect(last).toBe('drive')
    expect(hold(tracker, 8, { speed: 8 })).toBe('cruise')
  })

  it('needs a new mood to persist and the old one to dwell before changing', () => {
    const tracker = createMusicTracker('cruise')
    hold(tracker, 10)
    // A short burst of speed (a bump, a gust of tuck) is smoothed away and never commits.
    expect(hold(tracker, 0.3, { speed: 30 })).toBe('cruise')
    expect(hold(tracker, 3)).toBe('cruise')
    // A real change commits, then cannot hand back before the dwell time even
    // though cruise has been wanted for longer than its confirm time.
    expect(hold(tracker, 2, { speed: 30 })).toBe('drive')
    expect(hold(tracker, 3, { speed: 7 })).toBe('drive')
    expect(tracker.wanted).toBe('cruise')
    expect(hold(tracker, 2, { speed: 7 })).toBe('cruise')
  })

  it('holds the mood through a crash', () => {
    const tracker = createMusicTracker('cruise')
    expect(hold(tracker, 8, { speed: 20 })).toBe('drive')
    expect(hold(tracker, 6, { speed: 0, crashed: true })).toBe('drive')
  })

  it('goes ambient quickly on a lift, skipping the dwell time', () => {
    const tracker = createMusicTracker('cruise')
    hold(tracker, 5)
    hold(tracker, 1, { inPark: true })
    expect(tracker.mood).toBe('freestyle')
    expect(hold(tracker, 0.7, { riding: true })).toBe('ambient')
  })

  it('reports intensity from smoothed speed', () => {
    const tracker = createMusicTracker('cruise')
    hold(tracker, 5, { speed: 2 })
    const slow = tracker.intensity
    hold(tracker, 5, { speed: 20 })
    expect(slow).toBeLessThan(0.15)
    expect(tracker.intensity).toBeGreaterThan(0.8)
  })
})

describe('music scheduler (fake clock)', () => {
  const bpm = 120 // 0.125 s per 16th, 2 s per bar

  it('schedules each step once, on exact audio-clock times, under jittery pumping', () => {
    const scheduler = createBarScheduler({ bpm, start: 1, mood: 'cruise', lookahead: 0.1 })
    const times: number[] = []
    let now = 0
    for (let i = 0; i < 200; i++) {
      now += 0.02 + (i % 7) * 0.006 // irregular timer, like setTimeout drift
      for (const step of scheduler.pump(now)) {
        expect(step.time).toBeLessThan(now + 0.1 + 1e-9)
        times.push(step.time)
      }
    }
    expect(times.length).toBeGreaterThan(30)
    times.forEach((t, i) => expect(t).toBeCloseTo(1 + i * 0.125, 9))
  })

  it('applies a mood change only on the next bar line', () => {
    const scheduler = createBarScheduler({ bpm, start: 0, mood: 'cruise', lookahead: 0.1 })
    scheduler.pump(0.55) // steps 0..5 of bar 0 scheduled
    scheduler.request('drive')
    const steps: ReturnType<typeof scheduler.pump> = []
    for (let now = 0.6; now < 4.5; now += 0.05) steps.push(...scheduler.pump(now))
    const firstDrive = steps.find((s) => s.mood === 'drive')!
    expect(firstDrive.stepInBar).toBe(0)
    expect(firstDrive.bar).toBe(1)
    expect(firstDrive.time).toBeCloseTo(2, 9)
    expect(firstDrive.moodChanged).toBe(true)
    expect(steps.filter((s) => s.bar === 0).every((s) => s.mood === 'cruise')).toBe(true)
    expect(steps.filter((s) => s.moodChanged)).toHaveLength(1)
  })

  it('cancels a pending change that is undone before the bar line', () => {
    const scheduler = createBarScheduler({ bpm, start: 0, mood: 'cruise' })
    scheduler.pump(0.3)
    scheduler.request('freestyle')
    scheduler.request('cruise')
    const steps: ReturnType<typeof scheduler.pump> = []
    for (let now = 0.35; now < 3; now += 0.05) steps.push(...scheduler.pump(now))
    expect(steps.every((s) => s.mood === 'cruise' && !s.moodChanged)).toBe(true)
  })

  it('skips to the next bar line after the clock jumps instead of bursting late notes', () => {
    const scheduler = createBarScheduler({ bpm, start: 0, mood: 'cruise', lookahead: 0.1 })
    scheduler.pump(0.5)
    expect(scheduler.pump(9.3)).toEqual([]) // nothing late, nothing yet
    const after = scheduler.pump(9.95)
    expect(after[0].stepInBar).toBe(0)
    expect(after[0].time).toBeCloseTo(10, 9)
    expect(scheduler.barAtOrAfter(9.3)).toBeCloseTo(10, 9)
    expect(scheduler.barAtOrAfter(10)).toBeCloseTo(10, 9)
  })
})

describe('music score', () => {
  it('keeps one key and tempo per session, repeatable from the seed', () => {
    const a = createMusicSession(42)
    expect(createMusicSession(42)).toEqual(a)
    expect([96, 100, 104, 108]).toContain(a.bpm)
    const inKey = new Set(a.scale.map((s) => (a.root + s) % 12))
    for (const mood of ['ambient', 'cruise', 'drive', 'freestyle'] as MusicMood[]) {
      for (let bar = 0; bar < 8; bar++) {
        for (let step = 0; step < 16; step++) {
          for (const note of composeStep(a, mood, bar, step)) {
            for (const midi of note.notes) expect(inKey.has(((midi % 12) + 12) % 12)).toBe(true)
            expect(note.velocity).toBeGreaterThan(0)
            expect(note.velocity).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  })

  it('gives each mood its character', () => {
    const s = createMusicSession(7)
    const bar = (mood: MusicMood, b = 3) => Array.from({ length: 16 }, (_, i) => composeStep(s, mood, b, i)).flat()
    const count = (mood: MusicMood, layer: string) => bar(mood).filter((n) => n.layer === layer).length
    expect(count('ambient', 'kick') + count('ambient', 'snare') + count('ambient', 'hat')).toBe(0)
    expect(count('cruise', 'kick')).toBe(2)
    expect(count('drive', 'kick')).toBe(4)
    expect(count('drive', 'hat')).toBe(16)
    expect(count('drive', 'perc')).toBe(4) // tom fill on the fourth bar
    expect(count('freestyle', 'stab')).toBeGreaterThan(0)
    expect(count('cruise', 'stab')).toBe(0)
    for (const mood of Object.keys(MOOD_MIX) as MusicMood[]) expect(Object.keys(MOOD_MIX[mood]).sort()).toEqual([...MUSIC_LAYERS].sort())
  })

  it('walks the progression one chord per bar', () => {
    const s = createMusicSession(3)
    const roots = [0, 1, 2, 3, 4].map((b) => chordNotes(s, b)[0])
    expect(roots[4]).toBe(roots[0])
    expect(new Set(roots.slice(0, 4)).size).toBeGreaterThan(1)
  })
})
