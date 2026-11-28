import type { SkiState } from '../../sim'

/**
 * What the ski sounds are made of, worked out from the sim state each frame.
 * Pure numbers (gains 0..1, filter frequencies in Hz), so the mapping can be
 * unit tested; `engine.ts` pushes them into Web Audio nodes.
 */

/** The part of the sim state the sound reads. A full `SkiState` fits. */
export type SfxSkier = Pick<
  SkiState,
  'speed' | 'vy' | 'edgeAngle' | 'skid' | 'carveLoad' | 'grounded' | 'tuck' | 'mode' | 'surface' | 'sink' | 'chatter' | 'washout' | 'rail' | 'crashed' | 'crashSpeed' | 'trick'
>

/** A lift ride in progress, for the lift sounds. */
export interface SfxRide {
  /** Chairlift (true) or a surface lift such as the T-bar (false). */
  aerial: boolean
  /** Metres along the ride. */
  s: number
  total: number
  /** Metres per second right now (faster while fast-forwarding). */
  speed: number
  /** Distance along the ride of each tower. */
  towers: readonly number[]
  /** Getting off at the top. */
  unloading: boolean
}

/** Where the listener is on the mountain, each 0..1. */
export interface SfxScene {
  /** Close to the village buildings. */
  village: number
  /** In or beside the trees. */
  forest: number
  /** Open, high ground above the trees. */
  alpine: number
  /** Close to a lift station. */
  station: number
  /** Weather wind right now (gusts included). */
  wind: number
}

export interface SnowCharacter {
  /** Soft, deep snow (powder, forest). */
  loose: number
  /** Hard, glassy snow (ice). */
  icy: number
  /** Thin cover over rock. */
  gritty: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The surface as three continuous traits. The sim blends surface fields across
 * a run edge, so reading the fields (not the kind) keeps the sound from popping.
 */
export function snowCharacter(surface: SfxSkier['surface']): SnowCharacter {
  const loose = clamp01(surface.depth / 0.4)
  const gritty = clamp01((surface.mu - 0.05) / 0.06) * (1 - loose)
  const icy = clamp01((surface.chatter - 0.35) / 0.65) * (1 - loose) * (1 - gritty)
  return { loose, icy, gritty }
}

export interface SnowMix {
  /** Base on snow: a broad hiss that follows speed. */
  glide: { gain: number; highpass: number; lowpass: number }
  /** A loaded edge cutting a clean arc: a narrower, brighter tearing sound. */
  edge: { gain: number; freq: number; q: number }
  /** Skis going sideways: a rough, wide scrape. `grit` is how broken up it is. */
  skid: { gain: number; freq: number; grit: number }
  /** Ringing scrape of an edge on ice or rock. */
  scrape: { gain: number; freq: number }
  /** Deep snow pushed aside: a low, soft rush. */
  float: { gain: number; lowpass: number }
  /** Low rumble of the skis on hard snow at speed. */
  rumble: number
  /** Edge chatter: how deep the flutter cuts and how fast. */
  chatter: { depth: number; rate: number }
  /** -1..1, toward the loaded edge. */
  pan: number
}

const SILENT_SNOW: SnowMix = {
  glide: { gain: 0, highpass: 900, lowpass: 5000 },
  edge: { gain: 0, freq: 3000, q: 1.5 },
  skid: { gain: 0, freq: 1800, grit: 0 },
  scrape: { gain: 0, freq: 4200 },
  float: { gain: 0, lowpass: 700 },
  rumble: 0,
  chatter: { depth: 0, rate: 24 },
  pan: 0,
}

/** Full-speed reference for the snow layers, m/s (about 120 km/h). */
const SNOW_TOP_SPEED = 33

export function snowMix(s: SfxSkier, riding: boolean): SnowMix {
  const crashedSlide = s.crashed > 0 && s.grounded
  const sliding = !riding && s.grounded && !s.rail
  if (!sliding || s.speed < 0.15) return SILENT_SNOW
  const { loose, icy, gritty } = snowCharacter(s.surface)
  const hard = 1 - loose
  const v = clamp01(s.speed / SNOW_TOP_SPEED)
  // Snow noise grows quickly at first, then more slowly: a slow glide is already audible.
  const run = Math.pow(v, 0.7)
  const edgeAmount = clamp01(Math.abs(s.edgeAngle) / 0.95)
  if (crashedSlide) {
    // A body sliding on its back: no edges, just a dull scrape that dies with the speed.
    const slide = clamp01(s.speed / 14)
    return {
      ...SILENT_SNOW,
      glide: { gain: slide * 0.2, highpass: 300, lowpass: mix(2600, 1100, loose) },
      skid: { gain: slide * 0.34, freq: mix(1300, 600, loose), grit: 0.7 },
      float: { gain: slide * loose * 0.3, lowpass: 600 },
      rumble: slide * hard * 0.25,
    }
  }
  const braking = s.mode === 'braking'
  const skid = clamp01(Math.max(s.skid, braking ? 0.75 : 0) + (s.washout > 0 ? 0.35 : 0))
  // Load above 1 g presses the edge in; a turn that is all skid has little clean edge left.
  const load = clamp01((s.carveLoad - 0.8) / 1.8)
  const carve = edgeAmount * (0.45 + load * 0.55) * (1 - skid * 0.8)

  return {
    glide: {
      // Powder is nearly silent underfoot; ice hisses.
      gain: run * (0.15 + icy * 0.08 - loose * 0.1 + gritty * 0.08),
      highpass: mix(mix(700, 1500, icy), 180, loose),
      lowpass: mix(mix(mix(4800, 9000, icy), 3200, gritty), 1500, loose),
    },
    edge: {
      gain: run * carve * (0.95 + icy * 0.3) * (1 - loose * 0.75),
      freq: mix(mix(2300, 4600, icy), 1100, loose) + edgeAmount * mix(1500, 500, loose) + v * 600,
      q: mix(1.1, 2.6, icy),
    },
    skid: {
      gain: run * skid * mix(0.62 + icy * 0.12 + gritty * 0.1, 0.34, loose),
      freq: mix(mix(1700, 2500, icy), 620, loose) + v * 500,
      // Groomed snow scrapes in a steady roar, ice and rock break it up, powder is smooth.
      grit: mix(0.3 + icy * 0.4 + gritty * 0.5, 0.05, loose),
    },
    scrape: {
      gain: run * (icy * (0.1 + skid * 0.5 + edgeAmount * 0.22) + gritty * (0.16 + skid * 0.3)),
      freq: mix(4300, 2700, gritty) + v * 900,
    },
    float: {
      gain: loose * (clamp01(s.sink / 0.3) * 0.5 + skid * 0.3 + 0.08) * Math.pow(v, 0.5),
      lowpass: 450 + v * 700 + skid * 300,
    },
    rumble: hard * v * v * (0.35 + icy * 0.3 + gritty * 0.3) + hard * clamp01(s.chatter) * 0.25,
    chatter: { depth: clamp01(s.chatter) * hard * 0.75, rate: 19 + v * 16 },
    pan: Math.max(-0.6, Math.min(0.6, s.edgeAngle * 1.0)),
  }
}

export interface WindMix {
  gain: number
  lowpass: number
  /** A thin, tuned whistle past the helmet at speed. */
  whistle: { gain: number; freq: number }
  /** Low flutter of fast air beating on the ears. */
  buffet: number
}

/** Wind of the rider's own speed, plus the weather wind standing still. */
export function windMix(s: Pick<SfxSkier, 'speed' | 'grounded' | 'tuck' | 'rail'>, riding: boolean, weather = 0): WindMix {
  const v = clamp01(s.speed / SNOW_TOP_SPEED)
  const air = !riding && !s.grounded && !s.rail
  const own = v * v * (air ? 0.62 : 0.5) + (s.tuck && !air ? v * 0.05 : 0)
  return {
    gain: 0.012 + own + weather * 0.16,
    lowpass: 260 + v * 900 + (air ? 420 : 0) + (s.tuck ? 160 : 0) + weather * 180,
    whistle: { gain: clamp01((v - 0.42) / 0.58) ** 2 * (s.tuck ? 0.07 : 0.11) + weather * 0.025, freq: 820 + v * 1500 },
    buffet: clamp01((v - 0.5) / 0.5) * (s.tuck ? 0.25 : 0.55),
  }
}

export interface Impact {
  /** 0..1 overall weight. */
  level: number
  /** Low thump start and end pitch, Hz, and length, seconds. */
  thump: { from: number; to: number; seconds: number }
  /** Snow crunch: filter centre, length, and how soft the attack is. */
  crunch: { freq: number; seconds: number; attack: number; gain: number }
  /** A hard slap on top, for ice and firm snow. */
  slap: number
}

/** A landing: `descent` is the vertical speed into the snow, m/s. */
export function landingImpact(descent: number, surface: SfxSkier['surface'], grade: 'perfect' | 'clean' | 'sketchy' | 'crash' | null): Impact {
  const { loose, icy } = snowCharacter(surface)
  const sketchy = grade === 'sketchy'
  const level = clamp01(0.12 + descent * 0.062 + (sketchy ? 0.15 : 0) - (grade === 'perfect' ? 0.05 : 0))
  return {
    level,
    thump: { from: mix(125, 85, loose), to: mix(52, 40, loose), seconds: mix(0.11, 0.2, loose) + level * 0.05 },
    crunch: {
      freq: mix(mix(1700, 3400, icy), 520, loose),
      seconds: mix(mix(0.1, 0.06, icy), 0.38, loose) + (sketchy ? 0.08 : 0),
      attack: mix(0.002, 0.03, loose),
      gain: mix(0.55, 0.8, loose),
    },
    slap: (1 - loose) * (0.25 + icy * 0.6) * (sketchy ? 1.3 : 1),
  }
}

/** A fall: heavier and longer than any landing, with tumbles to follow. */
export function crashImpact(crashSpeed: number, surface: SfxSkier['surface']): Impact & { tumbles: number } {
  const { loose, icy } = snowCharacter(surface)
  const hard = clamp01(crashSpeed / 18)
  return {
    level: 0.7 + hard * 0.3,
    thump: { from: mix(105, 80, loose), to: 36, seconds: 0.24 },
    crunch: { freq: mix(mix(1200, 2200, icy), 480, loose), seconds: mix(0.26, 0.5, loose), attack: 0.004, gain: 0.8 },
    slap: (1 - loose) * (0.3 + icy * 0.5),
    tumbles: Math.round(1 + hard * 3),
  }
}

export interface SceneMix {
  crowd: number
  pines: number
  howl: number
  machinery: number
  /** Chance per second of a bird call. */
  birds: number
}

/** Background layers for where the rider is. Speed pushes them under the wind. */
export function sceneMix(scene: SfxScene, speed: number, riding: boolean): SceneMix {
  const calm = riding ? 0.9 : 1 - clamp01(speed / 22) * 0.75
  return {
    crowd: scene.village * 0.7 * calm,
    pines: scene.forest * (0.18 + scene.wind * 0.5) * calm,
    howl: scene.alpine * (0.12 + scene.wind * 0.6),
    machinery: scene.station * 0.6 * calm,
    // Chickadees keep to the trees and go quiet in a storm.
    birds: scene.forest * (1 - scene.wind) * (1 - scene.village * 0.5) * (speed < 14 || riding ? 0.09 : 0),
  }
}

/** The key the interface chimes play in: a MIDI root and its scale (semitone offsets, seven notes). */
export interface ChimeKey {
  root: number
  scale: readonly number[]
}

export const DEFAULT_KEY: ChimeKey = { root: 62, scale: [0, 2, 4, 5, 7, 9, 11] }

/**
 * Chord tone `step` (0 root, 1 third, 2 fifth, 3 the root an octave up, ...) of the
 * key, in Hz, lifted into the chime register. Following the music's key keeps a
 * chime from clashing with the song under it.
 */
export function chimeHz(key: ChimeKey, step: number): number {
  const tones = [key.scale[0] ?? 0, key.scale[2] ?? 4, key.scale[4] ?? 7]
  const octave = Math.floor(step / 3)
  // Fold the root into the octave above middle C so every key chimes in the same register.
  const base = 72 + (((key.root % 12) + 12) % 12)
  const note = base + octave * 12 + tones[((step % 3) + 3) % 3]
  return 440 * 2 ** ((note - 69) / 12)
}
