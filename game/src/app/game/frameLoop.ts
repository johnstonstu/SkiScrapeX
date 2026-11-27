import { PHYSICS } from '../../sim'

/**
 * The requestAnimationFrame driver. Each frame gets its delta in seconds
 * (clamped to `PHYSICS.maxFrameDt`, so a stall cannot launch the sim), a
 * smoothed frame time for the HUD, and the raw interval for the slow-frame
 * watch. The fixed physics step lives in sim/loop.ts; this only measures time.
 */
export function startFrameLoop(frame: (dt: number, smoothedMs: number, rawMs: number) => void) {
  let last = performance.now()
  let smoothed = 16.7
  const step = (now: number) => {
    const rawMs = now - last
    const dt = Math.min(PHYSICS.maxFrameDt, Math.max(0, rawMs / 1000))
    last = now
    smoothed += (dt * 1000 - smoothed) * 0.05
    frame(dt, smoothed, rawMs)
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
