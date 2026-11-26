import type { NoteEvent } from './musicScore'

/** Synth voices for the procedural music: one short-lived node graph per note, all on the audio clock. */

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

export interface VoiceKit {
  /** Start `note` at `time`; `step` is the length of a 16th in seconds; `bright` 0..1 opens filters. */
  play(note: NoteEvent, time: number, step: number, out: AudioNode, bright: number): void
}

export function createVoiceKit(ctx: AudioContext): VoiceKit {
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = noiseBuffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const env = (time: number, peak: number, attack: number, hold: number, release: number) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, time)
    g.gain.linearRampToValueAtTime(peak, time + attack)
    if (hold > 0) g.gain.setValueAtTime(peak, time + attack + hold)
    g.gain.setTargetAtTime(0, time + attack + hold, release / 3)
    return { gain: g, end: time + attack + hold + release * 1.5 }
  }
  const osc = (type: OscillatorType, freq: number, time: number, end: number, detune = 0) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.value = freq
    o.detune.value = detune
    o.start(time)
    o.stop(end)
    return o
  }
  const noise = (time: number, end: number) => {
    const n = ctx.createBufferSource()
    n.buffer = noiseBuffer
    n.loop = true
    n.start(time, Math.random() * 0.5)
    n.stop(end)
    return n
  }
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }

  return {
    play(note, time, step, out, bright) {
      const v = note.velocity
      const length = note.steps * step
      switch (note.layer) {
        case 'pad': {
          // Detuned saws through a soft low-pass, slow swell and long tail.
          const { gain, end } = env(time, 0.05 * v, Math.min(1.2, length * 0.35), length * 0.5, 1.6)
          const lp = filter('lowpass', 700 + bright * 1500, 0.4)
          lp.connect(gain).connect(out)
          for (const midi of note.notes) {
            osc('sawtooth', hz(midi), time, end, -7).connect(lp)
            osc('sawtooth', hz(midi), time, end, 7).connect(lp)
          }
          break
        }
        case 'bass': {
          const { gain, end } = env(time, 0.2 * v, 0.01, Math.max(0.04, length - 0.08), 0.12)
          const lp = filter('lowpass', 420 + bright * 500, 1.2)
          lp.connect(gain).connect(out)
          osc('triangle', hz(note.notes[0]), time, end).connect(lp)
          const sub = ctx.createGain()
          sub.gain.value = 0.7
          osc('sine', hz(note.notes[0] - 12), time, end).connect(sub).connect(gain)
          break
        }
        case 'kick': {
          const { gain, end } = env(time, 0.7 * v, 0.002, 0.02, 0.3)
          const o = osc('sine', 150, time, end)
          o.frequency.setValueAtTime(150, time)
          o.frequency.exponentialRampToValueAtTime(42, time + 0.13)
          o.connect(gain).connect(out)
          break
        }
        case 'snare': {
          const { gain, end } = env(time, 0.32 * v, 0.002, 0.01, 0.16)
          noise(time, end).connect(filter('bandpass', 1900, 0.8)).connect(gain).connect(out)
          const body = env(time, 0.18 * v, 0.002, 0, 0.08)
          osc('triangle', 190, time, body.end).connect(body.gain).connect(out)
          break
        }
        case 'hat': {
          const open = note.variant === 1
          const { gain, end } = env(time, (open ? 0.09 : 0.07) * v, 0.001, 0, open ? 0.26 : 0.045)
          noise(time, end).connect(filter('highpass', 7200, 0.8)).connect(gain).connect(out)
          break
        }
        case 'perc': {
          if (note.variant === 4) {
            // Shaker.
            const { gain, end } = env(time, 0.05 * v, 0.004, 0, 0.06)
            noise(time, end).connect(filter('bandpass', 5200, 1.5)).connect(gain).connect(out)
          } else {
            // Tom: higher variants pitch up, like a fill rolling down the kit.
            const pitch = 95 + (note.variant ?? 0) * 28
            const { gain, end } = env(time, 0.35 * v, 0.002, 0, 0.24)
            const o = osc('sine', pitch, time, end)
            o.frequency.setValueAtTime(pitch * 1.4, time)
            o.frequency.exponentialRampToValueAtTime(pitch, time + 0.08)
            o.connect(gain).connect(out)
          }
          break
        }
        case 'arp': {
          const { gain, end } = env(time, 0.07 * v, 0.005, 0, Math.max(0.12, length * 0.8))
          const lp = filter('lowpass', 1800 + bright * 3000, 0.5)
          lp.connect(gain).connect(out)
          osc('triangle', hz(note.notes[0]), time, end).connect(lp)
          osc('sine', hz(note.notes[0] + 12), time, end).connect(lp)
          break
        }
        case 'stab': {
          const { gain, end } = env(time, 0.045 * v, 0.003, 0.02, 0.16)
          const lp = filter('lowpass', 2600 + bright * 2400, 2)
          lp.frequency.setValueAtTime(4200, time)
          lp.frequency.exponentialRampToValueAtTime(900, time + 0.18)
          lp.connect(gain).connect(out)
          for (const midi of note.notes) osc('square', hz(midi), time, end).connect(lp)
          break
        }
      }
    },
  }
}
