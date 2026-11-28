import type { SkiState } from '../sim'
import { createSfxEngine, type SampleKind, type SfxEngine, type UiSound } from './sfx/engine'
import type { ChimeKey, SfxRide, SfxScene } from './sfx/mix'

/** Optional one-shot WAVs under `public/audio/` layered on the synthesized sounds (missing files are fine). */
const SAMPLE_URLS: Record<SampleKind, string> = {
  plant: 'audio/plant.wav',
  landing: 'audio/landing.wav',
  latch: 'audio/latch.wav',
}

export interface SkiAudioHooks {
  /** A crash or hard landing just sounded; `level` 0..1. The music ducks under it. */
  onImpact?(level: number): void
  /** The Sound button changed. */
  onMute?(muted: boolean): void
}

/**
 * The game's sound effects (`sfx/engine.ts`) on the page's audio output:
 * started by the first user gesture, muted by the Sound button, silent while
 * the tab is hidden.
 */
export function createSkiAudio(button: HTMLButtonElement, hooks: SkiAudioHooks = {}) {
  let ctx: AudioContext | undefined
  let master: GainNode | undefined
  let engine: SfxEngine | undefined
  let muted = false
  let paused = false
  let level = 0.8
  let key: ChimeKey | null = null
  const scene: Partial<SfxScene> = {}
  const samples: Partial<Record<SampleKind, AudioBuffer>> = {}
  try { muted = localStorage.getItem('apex.soundMuted') === 'true' } catch { /* Private storage. */ }
  const label = () => {
    button.textContent = muted ? 'Sound · Off' : 'Sound · On'
    button.setAttribute('aria-pressed', String(!muted))
  }
  const volume = () => {
    if (!ctx || !master) return
    master.gain.setTargetAtTime(muted || document.hidden ? 0 : 0.6 * level, ctx.currentTime, 0.025)
    // Nothing to hear: let the audio thread sleep (battery on phones).
    if (muted || document.hidden) {
      if (ctx.state === 'running') void ctx.suspend().catch(() => {})
    } else if (ctx.state !== 'running') void ctx.resume().catch(() => {})
  }
  const loadSamples = () => {
    for (const [kind, url] of Object.entries(SAMPLE_URLS) as [SampleKind, string][]) {
      void fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((raw) => ctx!.decodeAudioData(raw))
        .then((buf) => {
          samples[kind] = buf
        })
        .catch(() => {
          /* Synthesized only when the file is missing. */
        })
    }
  }
  const unlock = () => {
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (muted || !AudioCtor) return
    if (!ctx) {
      ctx = new AudioCtor({ latencyHint: 'interactive' })
      master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)
      engine = createSfxEngine(ctx, master, { onImpact: hooks.onImpact, samples })
      engine.setPaused(paused)
      engine.setScene(scene)
      engine.setKey(key)
      loadSamples()
      // iOS drops the context to "interrupted" after a call or Siri; pick it back up.
      ctx.addEventListener('statechange', () => {
        if (ctx && (ctx.state as string) === 'interrupted' && !document.hidden && !muted) void ctx.resume().catch(() => {})
      })
    }
    volume()
  }
  // Phones only count the end of a touch as the gesture that may start audio, so listen for both ends.
  for (const type of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const) window.addEventListener(type, unlock, { passive: true })
  document.addEventListener('visibilitychange', volume)
  button.addEventListener('click', () => {
    muted = !muted
    try { localStorage.setItem('apex.soundMuted', String(muted)) } catch { /* Private storage. */ }
    unlock()
    volume()
    label()
    hooks.onMute?.(muted)
  })
  label()
  const audible = () => Boolean(engine) && !muted
  return {
    get muted() { return muted },
    /** A menu is open: the mountain goes quiet, interface sounds still play. */
    pause(value: boolean) {
      paused = value
      engine?.setPaused(value)
    },
    /** 0 to 1, from settings. */
    setVolume(value: number) { level = Math.max(0, Math.min(1, value)); volume() },
    reset() { engine?.reset() },
    /** Soft whoosh when another skier passes close without contact. */
    nearMiss(closing: number) { if (audible() && !paused) engine!.nearMiss(closing) },
    /** Into a tree (`crash`) or knocked aside by one. `into` is the speed into the trunk, m/s. */
    treeHit(into: number, crash: boolean) { if (audible() && !paused) engine!.treeHit(into, crash) },
    /** An interface sound: menu moves, the race count, trick cards. */
    ui(kind: UiSound) { if (audible()) engine!.ui(kind) },
    /** Where the rider is on the mountain, for the background layers. */
    setScene(next: Partial<SfxScene>) {
      Object.assign(scene, next)
      engine?.setScene(next)
    },
    /** Tune the chimes to the music's key (null for the default). */
    setKey(next: ChimeKey | null) {
      key = next
      engine?.setKey(next)
    },
    update(s: SkiState, ride: SfxRide | null) {
      if (engine && ctx?.state === 'running') engine.update(s, ride)
    },
  }
}

export type SkiAudio = ReturnType<typeof createSkiAudio>
