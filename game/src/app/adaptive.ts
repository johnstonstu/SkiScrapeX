/**
 * Watches frame times while skiing and reports once if the game is running
 * too slowly to be playable, so Auto graphics can lighten the load: lower the
 * resolution and shadows now, and start a level lower next time.
 */
export interface FrameWatchOptions {
  /** Seconds of active play ignored first (shader compiles, streaming). */
  warmup: number
  /** Seconds of active play measured. */
  window: number
  /** Below this median frame rate the watch trips. */
  minFps: number
}

export function createFrameWatch(options: FrameWatchOptions = { warmup: 5, window: 6, minFps: 24 }) {
  const samples: number[] = []
  let active = 0
  let done = false
  return {
    /** Feed one frame; returns true the one time the game is found too slow. */
    sample(frameMs: number, playing: boolean): boolean {
      if (done || !playing || !(frameMs > 0) || frameMs > 1000) return false
      active += frameMs / 1000
      if (active < options.warmup) return false
      samples.push(frameMs)
      if (active < options.warmup + options.window) return false
      done = true
      const sorted = [...samples].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      return 1000 / median < options.minFps
    },
    get finished() {
      return done
    },
  }
}
