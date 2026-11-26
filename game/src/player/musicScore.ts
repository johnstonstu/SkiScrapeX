import type { MusicMood } from './musicState'

/**
 * The procedural score: one key, scale, progression and tempo per session,
 * and the notes each layer (stem) plays on each 16th step for each mood.
 * Pure, so the notes can be tested; `music.ts` turns them into sound.
 */

export type MusicLayer = 'pad' | 'bass' | 'kick' | 'snare' | 'hat' | 'perc' | 'arp' | 'stab'

export const MUSIC_LAYERS: readonly MusicLayer[] = ['pad', 'bass', 'kick', 'snare', 'hat', 'perc', 'arp', 'stab']

export interface NoteEvent {
  layer: MusicLayer
  /** MIDI notes (several for chords); empty for unpitched drums. */
  notes: number[]
  /** 0 to 1. */
  velocity: number
  /** Length in 16th steps. */
  steps: number
  /** Hats: open rather than closed. Perc: pitch index for a tom fill. */
  variant?: number
}

export interface MusicSession {
  /** MIDI note of the key's root in the bass octave. */
  root: number
  bpm: number
  /** Semitone offsets of the scale from the root. */
  scale: readonly number[]
  /** Scale degrees (0-based) of the chord for each bar, cycling. */
  progression: readonly number[]
  name: string
}

const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10] as const
const DORIAN = [0, 2, 3, 5, 7, 9, 10] as const
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const ROOTS = [38, 40, 41, 43, 45] // D2, E2, F2, G2, A2
const TEMPOS = [96, 100, 104, 108]
const PROGRESSIONS: { scale: readonly number[]; chords: readonly number[]; mode: string }[] = [
  { scale: NATURAL_MINOR, chords: [0, 5, 2, 6], mode: 'minor' }, // i VI III VII
  { scale: NATURAL_MINOR, chords: [0, 3, 5, 4], mode: 'minor' }, // i iv VI v
  { scale: DORIAN, chords: [0, 3, 0, 6], mode: 'dorian' }, // i IV i VII
]

/** Small seeded generator so a session (and a test) is repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Key, tempo and progression for one session. */
export function createMusicSession(seed: number): MusicSession {
  const rand = mulberry32(seed)
  const root = ROOTS[Math.floor(rand() * ROOTS.length)]
  const bpm = TEMPOS[Math.floor(rand() * TEMPOS.length)]
  const prog = PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)]
  return { root, bpm, scale: prog.scale, progression: prog.chords, name: `${NOTE_NAMES[root % 12]} ${prog.mode}, ${bpm} bpm` }
}

/** MIDI note of scale degree `degree` (may exceed the scale, wraps by octaves) above `base`. */
export function scaleNote(session: MusicSession, degree: number, base = session.root): number {
  const n = session.scale.length
  const octave = Math.floor(degree / n)
  const index = ((degree % n) + n) % n
  return base + octave * 12 + session.scale[index]
}

/** Triad (root, third, fifth) on the bar's chord degree, `octaves` above the bass root. */
export function chordNotes(session: MusicSession, bar: number, octaves = 1): number[] {
  const degree = session.progression[((bar % session.progression.length) + session.progression.length) % session.progression.length]
  const base = session.root + 12 * octaves
  return [scaleNote(session, degree, base), scaleNote(session, degree + 2, base), scaleNote(session, degree + 4, base)]
}

/** 16-step patterns: `x` full, `o` soft, `.` rest. */
const pattern = (p: string) => [...p].map((c) => (c === 'x' ? 1 : c === 'o' ? 0.55 : 0))

const KICK: Record<MusicMood, number[]> = {
  ambient: pattern('................'),
  cruise: pattern('x.......x.......'),
  drive: pattern('x...x...x...x...'),
  freestyle: pattern('x.....x...x..o..'),
}
const SNARE: Record<MusicMood, number[]> = {
  ambient: pattern('................'),
  cruise: pattern('............o...'),
  drive: pattern('....x.......x...'),
  freestyle: pattern('....x..o....x..o'),
}
const HAT: Record<MusicMood, number[]> = {
  ambient: pattern('................'),
  cruise: pattern('..x...x...x...x.'),
  drive: pattern('xoxoxoxoxoxoxoxo'),
  freestyle: pattern('x.x.xox.x.xox.xx'),
}
const BASS: Record<MusicMood, number[]> = {
  ambient: pattern('x...............'),
  cruise: pattern('x.....x.x.......'),
  drive: pattern('x.x.x.x.x.x.x.x.'),
  freestyle: pattern('x..x..x...x.o...'),
}
const STAB: Record<MusicMood, number[]> = {
  ambient: pattern('................'),
  cruise: pattern('................'),
  drive: pattern('................'),
  freestyle: pattern('..x..x....x.....'),
}
/** Arpeggio rhythm per mood; the note walks the chord. */
const ARP: Record<MusicMood, number[]> = {
  ambient: pattern('x.....o...o.....'),
  cruise: pattern('x.o.x.o.x.o.x.o.'),
  drive: pattern('xoxoxoxoxoxoxoxo'),
  freestyle: pattern('................'),
}

/** Every note to start on one step. Deterministic for a session, mood, bar and step. */
export function composeStep(session: MusicSession, mood: MusicMood, bar: number, step: number): NoteEvent[] {
  const out: NoteEvent[] = []
  const chord = chordNotes(session, bar, 1)
  // Pads: a new chord each bar (every two bars when ambient, held through).
  if (step === 0 && (mood !== 'ambient' || bar % 2 === 0)) {
    out.push({ layer: 'pad', notes: chordNotes(session, bar, 2), velocity: mood === 'ambient' ? 0.8 : 0.6, steps: mood === 'ambient' ? 32 : 16 })
  }
  const bassHit = BASS[mood][step]
  if (bassHit) {
    // Drive bounces root and octave; freestyle answers with the fifth.
    const octave = mood === 'drive' && step % 4 === 2 ? 12 : 0
    const fifth = mood === 'freestyle' && step === 10 ? 7 : 0
    out.push({ layer: 'bass', notes: [chord[0] - 12 + octave + fifth], velocity: bassHit, steps: mood === 'ambient' ? 16 : mood === 'drive' ? 2 : 3 })
  }
  if (KICK[mood][step]) out.push({ layer: 'kick', notes: [], velocity: KICK[mood][step], steps: 1 })
  if (SNARE[mood][step]) out.push({ layer: 'snare', notes: [], velocity: SNARE[mood][step], steps: 1 })
  if (HAT[mood][step]) {
    const open = (mood === 'cruise' && step === 14) || (mood === 'freestyle' && step === 15)
    out.push({ layer: 'hat', notes: [], velocity: HAT[mood][step], steps: 1, variant: open ? 1 : 0 })
  }
  if (STAB[mood][step]) out.push({ layer: 'stab', notes: chordNotes(session, bar, 2), velocity: STAB[mood][step], steps: 1 })
  const arpHit = ARP[mood][step]
  if (arpHit) {
    const walk = [0, 1, 2, 1, 0, 2, 1, 2]
    const octave = mood === 'ambient' ? 3 : 2
    const tones = chordNotes(session, bar, octave)
    out.push({ layer: 'arp', notes: [tones[walk[(step >> 1) % walk.length]]], velocity: arpHit * (mood === 'ambient' ? 0.6 : 1), steps: mood === 'ambient' ? 6 : 2 })
  }
  // Drive: a tom fill closes every fourth bar. Freestyle: a clap-shaker on the offbeats.
  if (mood === 'drive' && bar % 4 === 3 && step >= 12) out.push({ layer: 'perc', notes: [], velocity: 0.7 + (step - 12) * 0.08, steps: 1, variant: 15 - step })
  if (mood === 'freestyle' && step % 4 === 2) out.push({ layer: 'perc', notes: [], velocity: 0.45, steps: 1, variant: 4 })
  return out
}

/** Layer levels per mood. The player cross-fades between these over a beat from the bar line. */
export const MOOD_MIX: Record<MusicMood, Record<MusicLayer, number>> = {
  ambient: { pad: 1, bass: 0.5, kick: 0, snare: 0, hat: 0, perc: 0, arp: 0.55, stab: 0 },
  cruise: { pad: 0.8, bass: 0.75, kick: 0.6, snare: 0.4, hat: 0.4, perc: 0, arp: 0.5, stab: 0 },
  drive: { pad: 0.55, bass: 0.95, kick: 0.95, snare: 0.8, hat: 0.65, perc: 0.7, arp: 0.6, stab: 0 },
  freestyle: { pad: 0.4, bass: 0.95, kick: 0.95, snare: 0.85, hat: 0.7, perc: 0.6, arp: 0, stab: 0.75 },
}
