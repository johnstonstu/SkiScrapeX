/**
 * The radio playlist: a shuffle bag over the songs, so every song plays once
 * before any repeats, plus the previous-button rule players expect (restart the
 * song if it has been playing a while, else go back one). Pure; the audio lives
 * in `musicTracks.ts`.
 */

/** Seconds into a song after which "previous" restarts it instead of going back. */
export const PREV_RESTART_SECONDS = 3

export interface Playlist {
  /** Index into the song list of what is playing now. */
  readonly current: number
  /** Position in the play order (0 = first song this session). */
  readonly position: number
  readonly length: number
  /** Advance to the next song, refilling the bag when it runs out. */
  next(): number
  /** Go back, or report a restart: `{ index, restart }`. */
  prev(elapsed: number): { index: number; restart: boolean }
  /** Jump to a song by index (for example, a tap on a list). */
  select(index: number): number
}

/** Fisher-Yates shuffle of 0..n-1 using `random` (0..1). */
export function shuffleOrder(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/**
 * A playlist over `n` songs. With `shuffle`, each pass through the bag is a new
 * order whose first song is never the last song of the previous pass.
 */
export function createPlaylist(n: number, options: { shuffle: boolean; random?: () => number }): Playlist {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Playlist needs at least one song, got ${n}`)
  const random = options.random ?? Math.random
  const makePass = (avoidFirst: number | null): number[] => {
    if (!options.shuffle) return Array.from({ length: n }, (_, i) => i)
    const order = shuffleOrder(n, random)
    if (avoidFirst !== null && n > 1 && order[0] === avoidFirst) [order[0], order[1]] = [order[1], order[0]]
    return order
  }
  // History of everything played, so "previous" walks back through real plays.
  const history: number[] = []
  let bag = makePass(null)
  let bagAt = 0
  history.push(bag[bagAt])
  let at = 0

  const pull = (): number => {
    bagAt++
    if (bagAt >= bag.length) {
      bag = makePass(bag[bag.length - 1])
      bagAt = 0
    }
    return bag[bagAt]
  }

  return {
    get current() {
      return history[at]
    },
    get position() {
      return at
    },
    length: n,
    next() {
      if (at < history.length - 1) {
        at++
      } else {
        history.push(pull())
        at = history.length - 1
      }
      return history[at]
    },
    prev(elapsed: number) {
      if (elapsed > PREV_RESTART_SECONDS || at === 0) return { index: history[at], restart: true }
      at--
      return { index: history[at], restart: false }
    },
    select(index: number) {
      const i = ((Math.floor(index) % n) + n) % n
      history.splice(at + 1)
      history.push(i)
      at = history.length - 1
      return i
    },
  }
}
