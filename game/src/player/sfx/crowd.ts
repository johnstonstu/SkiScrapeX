/**
 * People on a chairlift cheering a landing below them: whoops, a "yeww", a
 * "yeah", the "ohh" of a watched crash, and mittens clapping. Like every game
 * sound these are synthesized: a voice is a pulse wave (the vocal folds)
 * through three moving resonances (the mouth), with the pitch gesture of the
 * shout. The plan (who shouts what, and when) and the curves are plain
 * numbers, so they can be unit tested; `createCrowd` plays them in Web Audio.
 */

/** How much the riders make of it. `ooh` is the wince at a crash. */
export type CheerSize = 'small' | 'medium' | 'big' | 'ooh'
export type Shout = 'woo' | 'yeww' | 'yeah' | 'ooh'

export interface CheerVoice {
  shout: Shout
  /** Seconds after the cheer starts. */
  delay: number
  seconds: number
  /** The highest pitch of the shout, Hz. */
  pitch: number
  /** Size of the mouth and throat: 1 is a man, about 1.16 a woman. Scales the resonances. */
  tract: number
  level: number
}

export interface ClapRun {
  delay: number
  count: number
  /** Seconds between claps. */
  gap: number
  level: number
  /** 0 is thick mittens (a low thud), 1 thin gloves (a brighter pat). */
  bright: number
  /** Ski poles knocked together instead of hands. */
  poles: boolean
}

export interface CheerPlan {
  voices: CheerVoice[]
  claps: ClapRun[]
  /** Until the last sound has finished. */
  seconds: number
}

/** People take a beat to react to a landing. */
const REACTION = 0.22

const PITCH: Record<Shout, { man: [number, number]; woman: [number, number]; seconds: [number, number] }> = {
  // A whoop is head voice: high, nearly a whistle.
  woo: { man: [600, 800], woman: [860, 1120], seconds: [0.5, 0.95] },
  yeww: { man: [350, 460], woman: [500, 660], seconds: [0.7, 1.1] },
  yeah: { man: [225, 300], woman: [360, 460], seconds: [0.36, 0.55] },
  ooh: { man: [185, 240], woman: [310, 390], seconds: [0.75, 1.1] },
}

/**
 * Who on a chair of `riders` people does what for a cheer of this size.
 * `random` returns 0..1.
 */
export function planCheer(size: CheerSize, riders: number, random: () => number): CheerPlan {
  const between = (a: number, b: number) => a + (b - a) * random()
  const people = Math.max(1, Math.round(riders))
  const voices: CheerVoice[] = []
  const claps: ClapRun[] = []
  const voice = (shout: Shout, delay: number, level: number) => {
    const woman = random() < 0.45
    const range = PITCH[shout]
    const [low, high] = woman ? range.woman : range.man
    voices.push({
      shout,
      delay: REACTION + delay,
      seconds: between(range.seconds[0], range.seconds[1]),
      pitch: between(low, high),
      tract: (woman ? 1.16 : 1) * between(0.96, 1.05),
      level,
    })
  }
  const clap = (delay: number, count: number, level: number, poles = false) =>
    claps.push({ delay: REACTION + delay, count, gap: poles ? between(0.15, 0.19) : between(0.2, 0.26), level, bright: random(), poles })

  if (size === 'ooh') {
    const count = Math.min(people, 2)
    for (let i = 0; i < count; i++) voice('ooh', i * between(0.04, 0.16), i ? 0.4 : 0.55)
  } else if (size === 'small') {
    voice(random() < 0.6 ? 'woo' : 'yeww', 0, 0.6)
    if (people > 1 && random() < 0.35) clap(between(0.25, 0.5), 4, 0.5)
  } else if (size === 'medium') {
    voice(random() < 0.5 ? 'woo' : 'yeww', 0, 0.7)
    if (people > 1) voice(random() < 0.5 ? 'yeah' : 'woo', between(0.12, 0.35), 0.5)
    clap(between(0.3, 0.55), 5 + Math.floor(random() * 3), 0.55)
    // Someone joins in late, which is also what carries the cheer over your head as you pass under.
    if (people > 2 && random() < 0.5) voice('woo', between(1.1, 1.5), 0.45)
  } else {
    const order: Shout[] = random() < 0.5 ? ['woo', 'yeww', 'yeah'] : ['yeww', 'woo', 'woo']
    const count = Math.min(people, 3)
    for (let i = 0; i < count; i++) voice(order[i], i * between(0.1, 0.3), i ? 0.6 : 0.8)
    clap(between(0.3, 0.5), 7 + Math.floor(random() * 4), 0.6)
    if (people > 1) clap(between(0.4, 0.7), 6, 0.45, random() < 0.5)
    if (people > 2) voice(random() < 0.5 ? 'woo' : 'yeww', between(1.3, 1.8), 0.55)
  }
  const seconds = Math.max(
    ...voices.map((v) => v.delay + v.seconds),
    ...claps.map((c) => c.delay + c.count * c.gap),
  ) + 0.1
  return { voices, claps, seconds }
}

export interface ShoutCurves {
  /** Voice pitch, Hz. */
  pitch: Float32Array
  /** The three resonances of the mouth, Hz. */
  f1: Float32Array
  f2: Float32Array
  f3: Float32Array
  /** Loudness, 0..1. */
  amp: Float32Array
  /** Breath through the voice, 0..1. */
  breath: Float32Array
}

/** Curve points per second. */
export const CURVE_RATE = 200

const smooth = (v: number) => {
  const k = Math.max(0, Math.min(1, v))
  return k * k * (3 - 2 * k)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * A shout as curves over its length: the pitch gesture (a whoop swoops up and
 * falls away, a "yeww" slides down, an "ohh" sinks) with a singer's vibrato
 * and the small unsteadiness of a real voice, and the mouth moving from the
 * opening sound to the vowel.
 */
export function shoutCurves(voice: CheerVoice, random: () => number): ShoutCurves {
  const n = Math.max(8, Math.ceil(voice.seconds * CURVE_RATE))
  const curves: ShoutCurves = {
    pitch: new Float32Array(n), f1: new Float32Array(n), f2: new Float32Array(n), f3: new Float32Array(n), amp: new Float32Array(n), breath: new Float32Array(n),
  }
  const { shout, seconds, tract } = voice
  const attack = { woo: 0.07, yeww: 0.05, yeah: 0.035, ooh: 0.1 }[shout]
  const release = { woo: 0.16, yeww: 0.22, yeah: 0.12, ooh: 0.3 }[shout]
  const vibratoHz = 5.6 + random() * 1.2
  const vibratoPhase = random() * Math.PI * 2
  // Everyone's shout is a little different.
  const lean = 0.85 + random() * 0.3
  let drift = 0
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const t = u * seconds
    let shape: number
    let from: [number, number, number], to: [number, number, number], open: number
    switch (shout) {
      case 'woo':
        // "w" with the lips closed, opening to "oo"; up fast, a held top, then falling off.
        shape = (0.6 + 0.4 * smooth(u / (0.24 * lean))) * (1 - 0.32 * smooth((u - 0.5) / 0.5))
        from = [300, 620, 2400]; to = [380, 950, 2550]; open = smooth(u / 0.2)
        break
      case 'yeww':
        // "ee" sliding back to "oo" while the pitch falls a long way.
        shape = (0.82 + 0.18 * smooth(u / 0.14)) * (1 - 0.46 * lean * smooth((u - 0.2) / 0.8))
        from = [310, 2250, 2950]; to = [370, 980, 2450]; open = smooth((u - 0.08) / 0.45)
        break
      case 'yeah':
        // "y" opening wide to "ah", pushed up then dropped.
        shape = (0.86 + 0.14 * smooth(u / 0.3)) * (1 - 0.3 * smooth((u - 0.4) / 0.6))
        from = [300, 2150, 2850]; to = [740, 1620, 2500]; open = smooth((u - 0.04) / 0.3)
        break
      default:
        // "oh" closing to "oo" as it sinks: a wince.
        shape = 1 - 0.36 * lean * smooth(u / 0.9)
        from = [540, 920, 2500]; to = [390, 800, 2400]; open = smooth((u - 0.15) / 0.8)
    }
    drift = drift * 0.9 + (random() - 0.5) * 0.004
    // Vibrato comes in once the note is held, as it does when people sustain a shout.
    const vibrato = Math.sin(t * vibratoHz * Math.PI * 2 + vibratoPhase) * 0.014 * smooth((u - 0.35) / 0.3)
    const pitch = voice.pitch * shape * (1 + vibrato + drift)
    curves.pitch[i] = pitch
    // A shouter opens the mouth until the first resonance sits on the pitch, which is what makes a shout carry.
    const f1 = Math.max(lerp(from[0], to[0], open) * tract, pitch * 1.03)
    // In head voice the second resonance rides the octave above the note.
    const f2 = shout === 'woo' ? Math.max(lerp(from[1], to[1], open) * tract, Math.min(2300, pitch * 2)) : lerp(from[1], to[1], open) * tract
    curves.f1[i] = f1
    curves.f2[i] = Math.max(f2, f1 * 1.25)
    curves.f3[i] = Math.max(lerp(from[2], to[2], open) * tract, curves.f2[i] * 1.2)
    const fade = smooth(t / attack) * smooth((seconds - t) / release)
    curves.amp[i] = fade * (0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.4)))
    // Air at the start and as the voice lets go.
    curves.breath[i] = fade * (0.25 + 0.75 * Math.max(1 - smooth(t / 0.09), smooth((u - 0.7) / 0.3)))
  }
  return curves
}

/** How fast the overtones of the voice fall away: a head-voice whoop is nearly pure, a shout is bright and buzzy. */
const TILT: Record<Shout, number> = { woo: 1.6, yeww: 1.05, yeah: 0.95, ooh: 1.35 }
/**
 * How far each of the three resonances stands out of the voice, dB. They
 * shape the overtones without removing the ones between them: a voice cut
 * down to its resonances alone is a whistle, not a person.
 */
const RESONANCE: Record<Shout, [number, number, number]> = { woo: [3, 6, 9], yeww: [4, 14, 11], yeah: [5, 13, 12], ooh: [5, 9, 6] }
/** Evens the shouts out, since the bright ones carry more level through the mouth. */
const MAKEUP: Record<Shout, number> = { woo: 0.5, yeww: 0.4, yeah: 0.5, ooh: 0.28 }

export interface CrowdTools {
  random: () => number
  /** A few seconds of white noise. */
  noise: AudioBuffer
  burst(time: number, spec: { type?: BiquadFilterType; freq: number; q?: number; level: number; attack?: number; decay: number; out?: AudioNode }): void
  tone(time: number, spec: { freq: number; to?: number; level: number; attack?: number; decay: number; out?: AudioNode; bell?: boolean }): void
}

export function createCrowd(ctx: BaseAudioContext, tools: CrowdTools) {
  const { random, noise } = tools
  const waves = new Map<Shout, PeriodicWave>()
  const wave = (shout: Shout) => {
    let made = waves.get(shout)
    if (!made) {
      const harmonics = 40
      const real = new Float32Array(harmonics + 1), imag = new Float32Array(harmonics + 1)
      for (let k = 1; k <= harmonics; k++) imag[k] = 1 / Math.pow(k, TILT[shout])
      made = ctx.createPeriodicWave(real, imag)
      waves.set(shout, made)
    }
    return made
  }

  /** One person's shout. */
  function shout(time: number, voice: CheerVoice, out: AudioNode) {
    const curves = shoutCurves(voice, random)
    const { seconds } = voice
    const end = time + seconds
    const folds = ctx.createOscillator()
    folds.setPeriodicWave(wave(voice.shout))
    folds.frequency.setValueCurveAtTime(curves.pitch, time, seconds)
    const level = ctx.createGain()
    level.gain.value = 0
    level.gain.setValueCurveAtTime(curves.amp.map((v) => v * voice.level), time, seconds)
    level.connect(out)
    // A hard "yeah" has gravel in it.
    let voiced: AudioNode = folds
    if (voice.shout === 'yeah') {
      const rasp = ctx.createGain()
      rasp.gain.value = 0.8
      const growl = ctx.createOscillator()
      growl.frequency.value = 62 + random() * 26
      const depth = ctx.createGain()
      depth.gain.value = 0.2
      growl.connect(depth).connect(rasp.gain)
      growl.start(time)
      growl.stop(end + 0.05)
      folds.connect(rasp)
      voiced = rasp
    }
    // Breath: noise through the same mouth.
    const air = ctx.createBufferSource()
    air.buffer = noise
    air.loop = true
    const airLevel = ctx.createGain()
    airLevel.gain.value = 0
    airLevel.gain.setValueCurveAtTime(curves.breath.map((v) => v * 0.12), time, seconds)
    air.connect(airLevel)
    const mouth = ctx.createGain()
    mouth.gain.value = MAKEUP[voice.shout]
    voiced.connect(mouth)
    airLevel.connect(mouth)
    let shaped: AudioNode = mouth
    const tracks: [Float32Array, number][] = [[curves.f1, 3], [curves.f2, 5], [curves.f3, 6]]
    tracks.forEach(([track, q], i) => {
      const peak = ctx.createBiquadFilter()
      peak.type = 'peaking'
      peak.Q.value = q
      peak.gain.value = RESONANCE[voice.shout][i]
      peak.frequency.value = track[0]
      peak.frequency.setValueCurveAtTime(track, time, seconds)
      shaped.connect(peak)
      shaped = peak
    })
    // Nothing useful above the consonants, nothing below the note.
    const top = ctx.createBiquadFilter()
    top.type = 'lowpass'
    top.frequency.value = 5200
    const bottom = ctx.createBiquadFilter()
    bottom.type = 'highpass'
    bottom.frequency.value = voice.pitch * 0.45
    shaped.connect(top).connect(bottom).connect(level)
    folds.start(time)
    folds.stop(end + 0.05)
    air.start(time, random() * (noise.duration - 0.1))
    air.stop(end + 0.05)
  }

  /** A run of claps (mittens: more thud than slap) or ski poles knocked together. */
  function clapRun(time: number, run: ClapRun, out: AudioNode) {
    let at = time
    const pole = 2200 + random() * 700
    for (let i = 0; i < run.count; i++) {
      // People speed up a little and no two claps land the same.
      const level = run.level * (0.7 + random() * 0.3) * (i === 0 ? 0.8 : 1)
      if (run.poles) {
        tools.tone(at, { freq: pole * (0.99 + random() * 0.02), level: level * 0.4, attack: 0.001, decay: 0.07, bell: true, out })
        tools.tone(at, { freq: pole * 1.37, level: level * 0.2, attack: 0.001, decay: 0.04, out })
        tools.burst(at, { freq: 4200, q: 3, level: level * 0.3, decay: 0.012, out })
      } else {
        const body = 760 + run.bright * 1100 + random() * 120
        tools.burst(at, { freq: body, q: 1.3, level: level * 1.5, attack: 0.001, decay: 0.032 + random() * 0.012, out })
        tools.burst(at, { type: 'lowpass', freq: 330 + run.bright * 200, level: level * 0.5, attack: 0.001, decay: 0.05, out })
        tools.tone(at, { freq: 190, to: 120, level: level * 0.2, attack: 0.001, decay: 0.035, out })
      }
      at += run.gap * (1 - i * 0.012) + (random() - 0.5) * 0.03
    }
  }

  return {
    /** Play a whole cheer into `out`, starting at `time`. */
    play(time: number, plan: CheerPlan, out: AudioNode) {
      for (const voice of plan.voices) shout(time + voice.delay, voice, out)
      for (const run of plan.claps) clapRun(time + run.delay, run, out)
    },
  }
}
