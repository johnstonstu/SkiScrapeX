/**
 * Keyboard steering ramps like an analog stick: a tap is a light edge, a hold
 * commits. The ramp runs on the real key times, not on frames, and each
 * frame hands the sim the average steer over the time it covers. A 17 ms tap
 * then steers the same at 5 fps as at 60, where reading the keys once per
 * frame held it for the whole 200 ms frame.
 */

/** A steer key change: from `t` (ms) the keys ask for `want` (-1 left, 0, 1 right). */
export interface KeyChange {
  t: number
  want: number
}

/** Integration step, seconds. */
const STEP = 0.002
/**
 * A fresh press or a reversal starts at the edge two 60 fps frames of rise
 * would give (about 0.37), as the frame-based ramp did, instead of from zero.
 */
const PRESS_JUMP = 2 / 60

/**
 * Ramp `value` from `from` to `to` (ms) with the wanted direction given by
 * `want` at the start and the `changes` inside the window. `rise` and
 * `release` are per second. Returns the value at `to` and its mean over the window.
 */
export function rampKeySteer(
  value: number,
  want: number,
  changes: readonly KeyChange[],
  from: number,
  to: number,
  rise: number,
  release: number,
): { value: number; mean: number } {
  const span = (to - from) / 1000
  if (span <= 0) return { value, mean: value }
  let t = from
  let area = 0
  let k = 0
  while (t < to) {
    while (k < changes.length && changes[k].t <= t) want = changes[k++].want
    const next = Math.min(to, k < changes.length ? Math.max(changes[k].t, t) : to, t + STEP * 1000)
    const dt = (next - t) / 1000
    if (want === 0) value = Math.sign(value) * Math.max(0, Math.abs(value) - release * dt)
    else if (Math.sign(want) !== Math.sign(value)) value = want * Math.min(1, rise * PRESS_JUMP)
    else value = want * Math.min(1, Math.abs(value) + rise * dt)
    area += value * dt
    t = next
  }
  return { value, mean: area / span }
}
