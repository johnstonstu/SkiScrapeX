import { describe, expect, it } from 'vitest'
import { createFrameWatch } from '../src/app/adaptive'

const run = (frameMs: number, seconds: number, playing = true) => {
  const watch = createFrameWatch({ warmup: 2, window: 3, minFps: 24 })
  let tripped = false
  for (let t = 0; t < seconds; t += frameMs / 1000) tripped = watch.sample(frameMs, playing) || tripped
  return { tripped, finished: watch.finished }
}

describe('frame watch', () => {
  it('trips once when play runs below the minimum frame rate', () => {
    expect(run(60, 8)).toEqual({ tripped: true, finished: true })
  })
  it('stays quiet at a playable frame rate', () => {
    expect(run(25, 8)).toEqual({ tripped: false, finished: true })
  })
  it('ignores menus and pauses', () => {
    expect(run(60, 8, false)).toEqual({ tripped: false, finished: false })
  })
})
