/**
 * Minimal HUD: the run name and clock stay hidden while you ski and show for
 * a few seconds when the title changes (new run, gate, lift top). Timed runs
 * and events pin them on screen. Pure so it can be tested without a DOM.
 */
export interface HudPeek {
  /** Call every frame with the current title; a change starts a peek. */
  update(title: string, now: number): void
  /** Restart the peek, for spawns and restarts with the same title. */
  poke(now: number): void
  /** Whether the run name and clock should be on screen. */
  visible(now: number, pinned: boolean): boolean
}

export const PEEK_MS = 3500

export function createHudPeek(holdMs = PEEK_MS): HudPeek {
  let title: string | null = null
  let until = -Infinity
  return {
    update(next, now) {
      if (next === title) return
      title = next
      until = now + holdMs
    },
    poke(now) {
      until = now + holdMs
    },
    visible: (now, pinned) => pinned || now < until,
  }
}
