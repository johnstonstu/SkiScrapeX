import { describe, expect, it } from 'vitest'
import { createPlaylist, PREV_RESTART_SECONDS, shuffleOrder } from '../src/player/radio'

/** Deterministic random for repeatable shuffles. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}

describe('shuffleOrder', () => {
  it('is a permutation of 0..n-1', () => {
    const order = shuffleOrder(6, seeded(3))
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4, 5])
  })
})

describe('createPlaylist', () => {
  it('plays every song once before any repeats, across several passes', () => {
    const list = createPlaylist(6, { shuffle: true, random: seeded(42) })
    const played = [list.current]
    for (let i = 0; i < 17; i++) played.push(list.next())
    for (let pass = 0; pass < 3; pass++) {
      expect(new Set(played.slice(pass * 6, pass * 6 + 6)).size).toBe(6)
    }
    // No song plays twice in a row across a pass boundary.
    for (let i = 1; i < played.length; i++) expect(played[i]).not.toBe(played[i - 1])
  })

  it('wraps in order when not shuffled', () => {
    const list = createPlaylist(3, { shuffle: false })
    expect([list.current, list.next(), list.next(), list.next()]).toEqual([0, 1, 2, 0])
  })

  it('previous restarts after the threshold and goes back before it', () => {
    const list = createPlaylist(4, { shuffle: false })
    list.next()
    list.next()
    expect(list.prev(PREV_RESTART_SECONDS + 1)).toEqual({ index: 2, restart: true })
    expect(list.prev(1)).toEqual({ index: 1, restart: false })
    expect(list.prev(1)).toEqual({ index: 0, restart: false })
    // At the first song there is nothing earlier, so it restarts.
    expect(list.prev(1)).toEqual({ index: 0, restart: true })
  })

  it('next after previous replays the same history', () => {
    const list = createPlaylist(5, { shuffle: true, random: seeded(7) })
    const a = list.current
    const b = list.next()
    list.prev(0)
    expect(list.current).toBe(a)
    expect(list.next()).toBe(b)
  })

  it('rejects an empty playlist', () => {
    expect(() => createPlaylist(0, { shuffle: true })).toThrow()
  })
})
