import { createBarScheduler, type BarScheduler } from './musicClock'
import { composeStep, createMusicSession, MOOD_MIX, MUSIC_LAYERS, type MusicLayer, type MusicSession } from './musicScore'
import { createMusicTracker, type MusicInput, type MusicMood } from './musicState'
import { createTrackPlayer, readManifest, type MusicTrack, type NowPlaying, type TrackPlayer } from './musicTracks'
import { libraryOf, songsFor, SYNTH_SONGS, type LibraryEntry, type MusicSource, type RadioMix } from './musicLibrary'
import { createVoiceKit, type VoiceKit } from './musicVoices'

export type { MusicTrack, NowPlaying } from './musicTracks'
export { libraryOf, RADIO_MIXES, songsFor, SYNTH_SONGS, type LibraryEntry, type MusicSource, type RadioMix } from './musicLibrary'

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
  /** What is actually playing (tracks and radio fall back to procedural when none are installed). */
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
  paused: boolean
  contextState: AudioContextState | 'none'
}

/**
 * Adaptive music. The tracker picks a mood from the game every frame; the
 * bar scheduler, pumped from a timer but timed by the audio clock, plays the
 * matching stems and cross-fades their levels from the next bar line. Bundled
 * tracks and the radio play through `musicTracks.ts`. Its own AudioContext,
 * unlocked by the first gesture, suspended while the tab is hidden.
 */
export function createMusic(options: { enabled: boolean; source: MusicSource; mix: RadioMix; volume: number; muted: boolean }) {
  let { enabled, source, mix, volume, muted } = options
  let ctx: AudioContext | undefined
  let out: GainNode, duckGain: GainNode, tone: BiquadFilterNode, bus: GainNode, send: GainNode, delay: DelayNode
  const layers = {} as Record<MusicLayer, GainNode>
  let kit: VoiceKit | undefined
  let scheduler: BarScheduler | null = null
  let timer = 0
  let session: MusicSession = createMusicSession((Math.random() * 2 ** 32) >>> 0)
  const tracker = createMusicTracker('ambient')
  let barMood: MusicMood = 'ambient'
  let manifest: MusicTrack[] | null = null
  let manifestTried = false
  let player: TrackPlayer | null = null
  let paused = false
  /** A file picked from the list, played once the list it is in is loaded. */
  let pendingFile: string | null = null
  /** Title of a named synth song, while one plays. */
  let synthTitle: string | null = null
  /** Songs hold while a menu is open, so the lyrics pick up where they left off. */
  let menuHeld = false
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((fn) => fn())

  const listFor = (s: MusicSource) => songsFor(manifest ?? [], s, mix)
  const playing = (): MusicSource | 'none' => {
    if (!enabled || !ctx) return 'none'
    if (source === 'procedural') return 'procedural'
    if (!manifestTried) return 'none'
    return listFor(source).length > 0 ? source : 'procedural'
  }
  const level = () => (enabled && !muted && !paused ? volume * 0.5 : 0)
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
    delay = c.createDelay(2)
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
    player = createTrackPlayer(c, bus, changed)
  }

  const pump = () => {
    if (!ctx || !kit || ctx.state !== 'running' || paused) return
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
      .then((json: unknown) => {
        manifest = readManifest(json)
      })
      .catch((error: unknown) => {
        console.warn('Music: could not read the track list, playing procedural music instead.', error)
        manifest = []
      })
      .finally(() => {
        manifestTried = true
        syncSource()
      })
  }

  /** New key and tempo for the procedural music (its "next song"). */
  const reroll = (seed = (Math.random() * 2 ** 32) >>> 0, title: string | null = null) => {
    synthTitle = title
    session = createMusicSession(seed)
    scheduler = null
    if (ctx) delay.delayTime.setTargetAtTime((60 / session.bpm) * 0.75, ctx.currentTime, 0.05)
    changed()
  }

  /** Start or stop the procedural stems and the track player to match the settings. */
  const syncSource = () => {
    if (!ctx || !player) return
    if (enabled && source !== 'procedural' && !manifestTried) loadManifest()
    const now = playing()
    if (now === 'tracks' || now === 'radio') {
      for (const layer of MUSIC_LAYERS) layers[layer].gain.setTargetAtTime(0, ctx.currentTime, 0.2)
      scheduler = null
      player.setList(listFor(now))
      if (pendingFile && manifestTried) {
        player.select(pendingFile)
        pendingFile = null
      }
      player.setPaused(paused || menuHeld)
      player.setActive(true)
    } else {
      player.setActive(false)
      if (now === 'none') scheduler = null
    }
    if (enabled && !timer) timer = window.setInterval(pump, 25)
    if (!enabled && timer) {
      window.clearInterval(timer)
      timer = 0
      scheduler = null
    }
    applyLevel()
    changed()
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
      player?.suspend()
      void ctx.suspend().catch(() => {})
    } else {
      // Browsers may refuse this without a gesture; then the next key or tap resumes it.
      void ctx.resume().then(syncSource, () => {})
    }
  })

  /** Step through the named synth songs. */
  const nextSynth = (step: number) => {
    const at = SYNTH_SONGS.findIndex((s) => s.title === synthTitle)
    const next = SYNTH_SONGS[(at + step + SYNTH_SONGS.length) % SYNTH_SONGS.length]
    reroll(next.seed, next.title)
  }

  const onTracks = () => playing() === 'tracks' || playing() === 'radio'

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
    get source() {
      return source
    },
    setMix(value: RadioMix) {
      mix = value
      syncSource()
    },
    get mix() {
      return mix
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
    /** The song list, loading it if needed. */
    library(): LibraryEntry[] | null {
      if (!manifestTried) {
        loadManifest()
        return null
      }
      return libraryOf(manifest ?? [])
    },
    /** Play a file from the list; switch source and mix first so the file is in the playing list. */
    playFile(file: string) {
      unlock()
      pendingFile = file
      syncSource()
    },
    /** Play a named synth song (switch the source to procedural first). */
    playSynth(seed: number) {
      unlock()
      const song = SYNTH_SONGS.find((s) => s.seed === seed)
      reroll(seed, song?.title ?? null)
    },
    next() {
      unlock()
      if (onTracks()) player?.next()
      else if (playing() === 'procedural') nextSynth(1)
    },
    prev() {
      unlock()
      if (onTracks()) player?.prev()
      else if (playing() === 'procedural') nextSynth(-1)
    },
    togglePause() {
      unlock()
      paused = !paused
      player?.setPaused(paused || menuHeld)
      applyLevel()
      changed()
    },
    /** Called whenever the song, source or pause state changes. */
    onChange(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    /** What the player screen shows. Procedural music reports its session as the title. */
    nowPlaying(): (NowPlaying & { source: MusicSource | 'none' }) | null {
      const now = playing()
      if (now === 'none') return null
      if (now === 'procedural') {
        const n = SYNTH_SONGS.findIndex((s) => s.title === synthTitle)
        return { source: now, file: null, title: synthTitle ?? session.name, artist: synthTitle ? `Synth · ${session.name}` : 'Synth', number: n + 1, count: n >= 0 ? SYNTH_SONGS.length : 1, time: 0, duration: 0, paused, lyrics: null }
      }
      const np = player?.nowPlaying()
      return np ? { ...np, source: now } : null
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
      if (input.menu !== menuHeld) {
        menuHeld = input.menu
        player?.setPaused(paused || menuHeld)
      }
      if (!ctx) return
      const t = ctx.currentTime
      const now = playing()
      player?.setMood(tracker.mood)
      if (now === 'radio') {
        // The radio plays flat so the vocals stay clear.
        tone.frequency.setTargetAtTime(20000, t, 0.4)
        bus.gain.setTargetAtTime(1, t, 0.4)
      } else if (now === 'tracks') {
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
      const np = onTracks() ? player?.nowPlaying() : null
      return {
        source: enabled ? source : 'off',
        playing: playing(),
        mood: tracker.mood,
        wanted: tracker.wanted,
        barMood,
        intensity: Math.round(tracker.intensity * 100) / 100,
        session: session.name,
        track: np?.title ?? null,
        trackTime: np && !np.paused ? Math.round(np.time * 10) / 10 : null,
        paused,
        contextState: ctx ? ctx.state : 'none',
      }
    },
  }
}

export type Music = ReturnType<typeof createMusic>
