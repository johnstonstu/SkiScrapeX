import { createBarScheduler, type BarScheduler } from './musicClock'
import { composeStep, createMusicSession, MOOD_MIX, MUSIC_LAYERS, type MusicLayer, type MusicSession } from './musicScore'
import { createMusicTracker, type MusicInput, type MusicMood } from './musicState'
import { createVoiceKit, type VoiceKit } from './musicVoices'

export type MusicSource = 'procedural' | 'tracks'

/** One entry of `public/audio/music/tracks.json`. */
export interface MusicTrack {
  file: string
  title: string
  author: string
  licence: string
  url: string
}

const MANIFEST_URL = 'audio/music/tracks.json'

/** How a mood shapes a bundled track, which cannot change its arrangement: a filter and a level. */
const TRACK_SHAPE: Record<MusicMood, { cutoff: number; level: number }> = {
  ambient: { cutoff: 900, level: 0.65 },
  cruise: { cutoff: 5200, level: 0.85 },
  drive: { cutoff: 18000, level: 1 },
  freestyle: { cutoff: 18000, level: 1 },
}

export interface MusicStatus {
  source: MusicSource | 'off'
  /** What is actually playing (tracks fall back to procedural when none are installed). */
  playing: MusicSource | 'none'
  mood: MusicMood
  wanted: MusicMood
  /** Mood of the last scheduled bar. */
  barMood: MusicMood
  intensity: number
  session: string
  track: string | null
  /** Seconds into the current track while it plays, else null. */
  trackTime: number | null
  contextState: AudioContextState | 'none'
}

/**
 * Adaptive music. The tracker picks a mood from the game every frame; the
 * bar scheduler, pumped from a timer but timed by the audio clock, plays the
 * matching stems and cross-fades their levels from the next bar line. Its own
 * AudioContext, unlocked by the first gesture, suspended while the tab is hidden.
 */
export function createMusic(options: { enabled: boolean; source: MusicSource; volume: number; muted: boolean }) {
  let { enabled, source, volume, muted } = options
  let ctx: AudioContext | undefined
  let out: GainNode, duckGain: GainNode, tone: BiquadFilterNode, bus: GainNode, send: GainNode
  const layers = {} as Record<MusicLayer, GainNode>
  let kit: VoiceKit | undefined
  let scheduler: BarScheduler | null = null
  let timer = 0
  const session: MusicSession = createMusicSession((Math.random() * 2 ** 32) >>> 0)
  const tracker = createMusicTracker('ambient')
  let barMood: MusicMood = 'ambient'
  let tracks: MusicTrack[] | null = null
  let trackIndex = 0
  let audioEl: HTMLAudioElement | null = null
  let manifestTried = false

  const playing = (): MusicSource | 'none' => {
    if (!enabled || !ctx) return 'none'
    if (source === 'tracks' && tracks && tracks.length > 0) return 'tracks'
    return source === 'tracks' && !manifestTried ? 'none' : 'procedural'
  }
  const level = () => (enabled && !muted ? volume * 0.5 : 0)
  const applyLevel = () => {
    if (ctx) out.gain.setTargetAtTime(level(), ctx.currentTime, 0.08)
  }

  const build = (c: AudioContext) => {
    out = c.createGain()
    out.gain.value = 0
    duckGain = c.createGain()
    tone = c.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 2000
    tone.Q.value = 0.5
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    bus = c.createGain()
    bus.connect(tone).connect(comp).connect(duckGain).connect(out).connect(c.destination)
    // A dotted-eighth echo on the arp and stabs.
    const delay = c.createDelay(2)
    delay.delayTime.value = (60 / session.bpm) * 0.75
    const feedback = c.createGain()
    feedback.gain.value = 0.32
    const wet = c.createGain()
    wet.gain.value = 0.28
    send = c.createGain()
    send.connect(delay).connect(feedback).connect(delay)
    delay.connect(wet).connect(bus)
    for (const layer of MUSIC_LAYERS) {
      const g = c.createGain()
      g.gain.value = MOOD_MIX.ambient[layer]
      g.connect(bus)
      if (layer === 'arp' || layer === 'stab') g.connect(send)
      layers[layer] = g
    }
    kit = createVoiceKit(c)
  }

  const pump = () => {
    if (!ctx || !kit || ctx.state !== 'running') return
    if (playing() !== 'procedural') return
    if (!scheduler) scheduler = createBarScheduler({ bpm: session.bpm, start: ctx.currentTime + 0.1, mood: tracker.mood })
    scheduler.request(tracker.mood)
    const bright = tracker.intensity
    for (const step of scheduler.pump(ctx.currentTime)) {
      if (step.moodChanged || step.index === 0) {
        // Cross-fade stems over about a beat from the bar line.
        for (const layer of MUSIC_LAYERS) layers[layer].gain.setTargetAtTime(MOOD_MIX[step.mood][layer], step.time, scheduler.stepSeconds * 1.5)
        barMood = step.mood
      }
      for (const note of composeStep(session, step.mood, step.bar, step.stepInBar)) kit.play(note, step.time, scheduler.stepSeconds, layers[note.layer], bright)
    }
  }

  const loadManifest = () => {
    if (manifestTried) return
    void fetch(MANIFEST_URL)
      .then((res) => (res.ok ? res.json() : { tracks: [] }))
      .then((json: { tracks?: MusicTrack[] }) => {
        tracks = Array.isArray(json.tracks) ? json.tracks.filter((t) => t && typeof t.file === 'string') : []
      })
      .catch((error: unknown) => {
        console.warn('Music: could not read the track list, playing procedural music instead.', error)
        tracks = []
      })
      .finally(() => {
        manifestTried = true
        syncSource()
      })
  }

  const playTrack = () => {
    if (!ctx || !tracks || tracks.length === 0) return
    if (!audioEl) {
      audioEl = new Audio()
      audioEl.preload = 'none'
      ctx.createMediaElementSource(audioEl).connect(bus)
      audioEl.addEventListener('ended', () => {
        trackIndex = (trackIndex + 1) % tracks!.length
        playTrack()
      })
      audioEl.addEventListener('error', () => console.warn(`Music: could not play ${audioEl?.src}`))
    }
    const track = tracks[trackIndex % tracks.length]
    const url = `audio/music/${track.file}`
    if (!audioEl.src.endsWith(url)) audioEl.src = url
    void audioEl.play().catch((error: unknown) => console.warn('Music: track playback was refused.', error))
  }

  /** Start or stop the procedural stems and the track player to match the settings. */
  const syncSource = () => {
    if (!ctx) return
    if (enabled && source === 'tracks' && !manifestTried) loadManifest()
    const now = playing()
    if (now === 'tracks') {
      for (const layer of MUSIC_LAYERS) layers[layer].gain.setTargetAtTime(0, ctx.currentTime, 0.2)
      scheduler = null
      playTrack()
    } else {
      audioEl?.pause()
      if (now === 'none') scheduler = null
    }
    if (enabled && !timer) timer = window.setInterval(pump, 25)
    if (!enabled && timer) {
      window.clearInterval(timer)
      timer = 0
      scheduler = null
    }
    applyLevel()
  }

  const unlock = () => {
    if (!enabled || muted || !window.AudioContext) return
    if (!ctx) {
      ctx = new AudioContext()
      build(ctx)
      syncSource()
    }
    if (ctx.state === 'suspended' && !document.hidden) void ctx.resume().then(syncSource, () => {})
  }
  window.addEventListener('keydown', unlock)
  window.addEventListener('pointerdown', unlock)
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) {
      audioEl?.pause()
      void ctx.suspend().catch(() => {})
    } else {
      // Browsers may refuse this without a gesture; then the next key or tap resumes it.
      void ctx.resume().then(syncSource, () => {})
    }
  })

  return {
    setEnabled(value: boolean) {
      enabled = value
      if (enabled) unlock()
      syncSource()
    },
    setSource(value: MusicSource) {
      source = value
      syncSource()
    },
    setVolume(value: number) {
      volume = Math.max(0, Math.min(1, value))
      applyLevel()
    },
    setMuted(value: boolean) {
      muted = value
      if (!muted) unlock()
      applyLevel()
    },
    /** Duck under a crash or hard impact: `amount` 0..1. */
    duck(amount: number) {
      if (!ctx || amount <= 0) return
      const t = ctx.currentTime
      const floor = 1 - Math.min(1, amount) * 0.75
      duckGain.gain.cancelScheduledValues(t)
      duckGain.gain.setTargetAtTime(floor, t, 0.02)
      duckGain.gain.setTargetAtTime(1, t + 0.35 + amount * 0.6, 0.5)
    },
    /** Per frame: pick the mood and shape the sound. */
    update(input: MusicInput) {
      tracker.update(input)
      if (!ctx) return
      const t = ctx.currentTime
      if (playing() === 'tracks') {
        const shape = TRACK_SHAPE[tracker.mood]
        tone.frequency.setTargetAtTime(shape.cutoff, t, 0.6)
        bus.gain.setTargetAtTime(shape.level, t, 0.6)
      } else {
        // Inside a mood, speed opens the filter: from muffled when slow to full at top speed.
        const cutoff = tracker.mood === 'ambient' ? 2200 : 3500 + tracker.intensity * 14000
        tone.frequency.setTargetAtTime(cutoff, t, 0.4)
        bus.gain.setTargetAtTime(1, t, 0.4)
      }
    },
    status(): MusicStatus {
      return {
        source: enabled ? source : 'off',
        playing: playing(),
        mood: tracker.mood,
        wanted: tracker.wanted,
        barMood,
        intensity: Math.round(tracker.intensity * 100) / 100,
        session: session.name,
        track: playing() === 'tracks' && tracks ? tracks[trackIndex % tracks.length].title : null,
        trackTime: audioEl && !audioEl.paused ? Math.round(audioEl.currentTime * 10) / 10 : null,
        contextState: ctx ? ctx.state : 'none',
      }
    },
  }
}
