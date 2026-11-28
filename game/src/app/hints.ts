/**
 * Free-ski control prompts: one short line at a time at the bottom of the
 * screen (a key and a verb), each gone as soon as the player does it. They
 * teach steering, speed and the jump in the first run off the chair without a
 * card or a pause, and never come back once done. The tutorial (app/tutorial.ts)
 * is the longer lesson for those who want one.
 */
import type { SkiInput, SkiState } from '../sim'
import { KEYS, readJson, writeJson } from './storage'
import type { InputMode } from './tutorial'

interface Hint {
  id: string
  text: Record<InputMode, string>
  /** Worth showing now (the prompt waits until it is). */
  ready?: (skier: SkiState) => boolean
  /** Called each frame, shown or not; true once the player has done it. */
  done: (skier: SkiState, input: SkiInput, dt: number, memo: Record<string, number>) => boolean
  /** Seconds on screen before it steps aside (default `SHOW_SECONDS`). A prompt with no `done` action ends this way. */
  seconds?: number
}

export const HINTS: Hint[] = [
  {
    id: 'steer',
    text: {
      keys: '<kbd>A</kbd> <kbd>D</kbd> steer',
      touch: 'Slide the stick left and right to steer',
      pad: '<kbd>L stick</kbd> steer',
    },
    done: (_s, input, dt, memo) => {
      if (input.steer < -0.3) memo.left = (memo.left ?? 0) + dt
      if (input.steer > 0.3) memo.right = (memo.right ?? 0) + dt
      const left = memo.left ?? 0
      const right = memo.right ?? 0
      return (left > 0.3 && right > 0.3) || left + right > 1.6
    },
  },
  {
    id: 'speed',
    text: {
      keys: '<kbd>W</kbd> tuck · <kbd>S</kbd> brake',
      touch: 'Stick up to tuck · down to brake',
      pad: '<kbd>Stick up</kbd> tuck · <kbd>LT</kbd> brake',
    },
    done: (_s, input, dt, memo) => {
      if (input.tuck) memo.tuck = (memo.tuck ?? 0) + dt
      if (input.brake > 0.3) memo.brake = (memo.brake ?? 0) + dt
      return (memo.tuck ?? 0) > 0.7 || (memo.brake ?? 0) > 0.5
    },
  },
  {
    id: 'jump',
    text: {
      keys: 'Hold <kbd>Space</kbd>, let go to jump',
      touch: 'Hold <b>Jump</b>, let go to pop',
      pad: 'Hold <kbd>A</kbd>, let go to jump',
    },
    ready: (s) => s.grounded && s.speed > 5,
    done: (s, input, _dt, memo) => {
      if (input.jump) memo.held = 1
      return memo.held === 1 && Boolean(s.air && s.air.time > 0.15)
    },
  },
  {
    id: 'more',
    text: {
      keys: '<kbd>T</kbd> trail map · <kbd>Esc</kbd> pause and all controls',
      touch: 'Pause has the trail map and all controls',
      pad: '<kbd>Start</kbd> pause, trail map and all controls',
    },
    done: () => false,
    seconds: 6,
  },
]

/**
 * Riding switch (backwards): how to hop back round. It sits outside the sequence above, since
 * it only helps at the moment it happens: it shows after `SWITCH_WAIT` seconds of riding switch,
 * steps in front of any other prompt, and is done for good once the player hops out.
 */
export const SWITCH_HINT: Hint = {
  id: 'switch',
  text: {
    keys: 'Riding switch: tap <kbd>Space</kbd> with <kbd>A</kbd> or <kbd>D</kbd> to hop round',
    touch: 'Riding switch: tap <b>Jump</b> with the stick left or right to hop round',
    pad: 'Riding switch: tap <kbd>A</kbd> with the stick left or right to hop round',
  },
  done: () => false,
  seconds: 10,
}
export const SWITCH_WAIT = 2

/** Seconds a prompt stays up if the player does not do it. */
export const SHOW_SECONDS = 14
/** Quiet seconds after the hand-over and between prompts. */
const GAP = 1.4
/** A prompt ignored this many times stops coming back. */
const MAX_SEEN = 2

interface Saved {
  done: string[]
  seen: Record<string, number>
}

export function createHints(line: HTMLElement, mode: () => InputMode, storageKey: string = KEYS.hints) {
  const saved = readJson<Saved>(storageKey, { done: [], seen: {} })
  const save = () => writeJson(storageKey, saved)
  const finished = (hint: Hint) => saved.done.includes(hint.id) || (saved.seen[hint.id] ?? 0) >= MAX_SEEN
  let memo: Record<string, number> = {}
  /** The prompt on screen, and for how long. */
  let showing: Hint | null = null
  let shownFor = 0
  let shownMode: InputMode | null = null
  let gap = GAP
  let hideTimer = 0
  /** Prompts that stepped aside this visit: they wait for the next one. */
  const passed = new Set<string>()
  /** Seconds riding switch on the snow, and the last trick seen, for `SWITCH_HINT`. */
  let switchFor = 0
  let trickSeq = -1

  const hide = (state: 'done' | 'hide') => {
    if (!showing) return
    showing = null
    shownMode = null
    line.dataset.state = state
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => (line.hidden = true), state === 'done' ? 900 : 450)
  }
  const show = (hint: Hint) => {
    window.clearTimeout(hideTimer)
    showing = hint
    shownFor = 0
    shownMode = mode()
    line.innerHTML = hint.text[shownMode]
    line.hidden = false
    line.dataset.state = 'show'
  }

  return {
    /** The id of the prompt on screen, or null. */
    get showing() {
      return showing?.id ?? null
    },
    get allDone() {
      return HINTS.every(finished)
    },
    /** Per frame. `active`: free skiing with nothing else on screen asking for attention. */
    update(skier: SkiState, input: SkiInput, dt: number, active: boolean) {
      if (!finished(SWITCH_HINT)) {
        const seq = skier.trick?.seq ?? 0
        const hoppedOut = trickSeq >= 0 && seq !== trickSeq && Boolean(skier.trick?.hop) && !skier.trick?.switchLanding
        trickSeq = seq
        const riding = active && Boolean(skier.ridingSwitch) && skier.crashed <= 0
        switchFor = riding && skier.grounded && skier.speed > 3 ? switchFor + dt : riding ? switchFor : 0
        if (hoppedOut) {
          saved.done.push(SWITCH_HINT.id)
          save()
          if (showing === SWITCH_HINT) hide('done')
          gap = GAP
        } else if (showing === SWITCH_HINT) {
          shownFor += dt
          if (shownMode !== mode()) show(showing)
          if (!riding || shownFor > SWITCH_HINT.seconds!) {
            // Not taken up (or they got out another way): it gets one more chance.
            saved.seen[SWITCH_HINT.id] = (saved.seen[SWITCH_HINT.id] ?? 0) + 1
            save()
            passed.add(SWITCH_HINT.id)
            gap = GAP
            hide('hide')
          }
          return
        } else if (switchFor > SWITCH_WAIT && !passed.has(SWITCH_HINT.id)) {
          memo = {}
          show(SWITCH_HINT)
          return
        }
      }
      const next = HINTS.find((hint) => !finished(hint) && !passed.has(hint.id))
      if (!next || !active) {
        if (showing) hide('hide')
        gap = Math.max(gap, 0.6)
        return
      }
      // Doing it counts whether or not the prompt is up yet.
      if (next.done(skier, input, dt, memo)) {
        saved.done.push(next.id)
        save()
        memo = {}
        gap = GAP
        if (showing) hide('done')
        return
      }
      if (showing) {
        shownFor += dt
        if (shownMode !== mode()) show(showing)
        if (shownFor > (showing.seconds ?? SHOW_SECONDS)) {
          // Not taken up: step aside. It gets one more chance next session.
          saved.seen[showing.id] = (saved.seen[showing.id] ?? 0) + 1
          passed.add(showing.id)
          if (!next.ready && showing.seconds) saved.done.push(showing.id)
          save()
          memo = {}
          gap = GAP
          hide('hide')
        }
        return
      }
      gap -= dt
      if (gap <= 0 && skier.crashed <= 0 && (next.ready?.(skier) ?? true)) show(next)
    },
    /** Hide whatever is up (a menu, a ride, a challenge starting). */
    clear() {
      if (showing) hide('hide')
      gap = GAP
    },
  }
}

export type Hints = ReturnType<typeof createHints>
