import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HINTS, SHOW_SECONDS, SWITCH_HINT, createHints } from '../src/app/hints'
import type { SkiInput, SkiState } from '../src/sim'

const skier = (over: Partial<SkiState> = {}) => ({ speed: 8, grounded: true, crashed: 0, air: null, ...over }) as unknown as SkiState
const input = (over: Partial<SkiInput> = {}) => ({ steer: 0, brake: 0, tuck: false, ...over }) as SkiInput

/** The one line of screen the prompts need. */
function line() {
  return { hidden: true, innerHTML: '', dataset: {} as Record<string, string> } as unknown as HTMLElement
}

function storage() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) })
  vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => {} })
}

const run = (hints: ReturnType<typeof createHints>, seconds: number, s = skier(), i = input(), active = true) => {
  for (let t = 0; t < seconds; t += 0.1) hints.update(s, i, 0.1, active)
}

describe('free-ski control prompts', () => {
  beforeEach(storage)

  it('shows steering first, after a quiet moment, and drops it once the player has steered both ways', () => {
    const el = line()
    const hints = createHints(el, () => 'keys')
    run(hints, 1)
    expect(hints.showing).toBeNull()
    run(hints, 1)
    expect(hints.showing).toBe('steer')
    expect(el.innerHTML).toContain('<kbd>A</kbd>')
    run(hints, 0.5, skier(), input({ steer: -1 }))
    expect(hints.showing).toBe('steer')
    run(hints, 0.5, skier(), input({ steer: 1 }))
    expect(hints.showing).toBeNull()
    expect(el.dataset.state).toBe('done')
    // Then speed, after another quiet moment.
    run(hints, 2)
    expect(hints.showing).toBe('speed')
  })

  it('walks through every prompt and then stays quiet, also after a reload', () => {
    const el = line()
    const hints = createHints(el, () => 'keys')
    run(hints, 3, skier(), input({ steer: -1 }))
    run(hints, 3, skier(), input({ tuck: true }))
    run(hints, 2)
    expect(hints.showing).toBe('jump')
    run(hints, 0.3, skier(), input({ jump: true }))
    run(hints, 0.3, skier({ grounded: false, air: { time: 0.3 } as SkiState['air'] }))
    expect(hints.showing).toBeNull()
    run(hints, 2)
    expect(hints.showing).toBe('more')
    run(hints, 7)
    expect(hints.allDone).toBe(true)
    expect(createHints(line(), () => 'keys').allDone).toBe(true)
  })

  it('a prompt nobody takes up steps aside, and stops coming back after two visits', () => {
    const first = createHints(line(), () => 'touch')
    run(first, 2)
    expect(first.showing).toBe('steer')
    run(first, SHOW_SECONDS + 0.5)
    expect(first.showing).toBeNull()
    // Not again this visit: the next prompt takes its turn.
    run(first, 2)
    expect(first.showing).toBe('speed')
    const second = createHints(line(), () => 'touch')
    run(second, 2)
    expect(second.showing).toBe('steer')
    run(second, SHOW_SECONDS + 0.5)
    const third = createHints(line(), () => 'touch')
    run(third, 2)
    expect(third.showing).toBe('speed')
  })

  it('stays out of the way of rides, challenges and crashes, and waits for speed before the jump', () => {
    const hints = createHints(line(), () => 'pad')
    run(hints, 3, skier(), input(), false)
    expect(hints.showing).toBeNull()
    run(hints, 2, skier({ crashed: 1 }))
    expect(hints.showing).toBeNull()
    run(hints, 2, skier(), input({ steer: 1 }))
    run(hints, 1, skier({ speed: 2 }), input({ brake: 1 }))
    run(hints, 3, skier({ speed: 2 }))
    expect(hints.showing).toBeNull()
    run(hints, 0.2, skier({ speed: 9 }))
    expect(hints.showing).toBe('jump')
  })

  it('riding switch brings up how to hop round, in front of the other prompts, until the player has done it', () => {
    const hints = createHints(line(), () => 'keys')
    const back = (over: Partial<SkiState> = {}) => skier({ ridingSwitch: true, trick: null, ...over })
    run(hints, 2.5)
    expect(hints.showing).toBe('steer')
    run(hints, 1.5, back())
    expect(hints.showing).toBe('steer')
    run(hints, 1, back())
    expect(hints.showing).toBe('switch')
    // Back forward some other way (a stop, a crash): it steps aside and waits for the next visit.
    run(hints, 0.2, skier())
    expect(hints.showing).toBeNull()
    run(hints, 4, back())
    expect(hints.showing).not.toBe('switch')
    // Next visit: shown again, and done for good after a hop 180 out of switch.
    const again = createHints(line(), () => 'pad')
    run(again, 3, back())
    expect(again.showing).toBe('switch')
    run(again, 0.2, skier({ trick: { seq: 1, hop: true, switchLanding: false } as SkiState['trick'] }))
    expect(again.showing).toBeNull()
    const later = createHints(line(), () => 'pad')
    run(later, 6, back())
    expect(later.showing).not.toBe('switch')
    for (const mode of ['keys', 'touch', 'pad'] as const) expect(SWITCH_HINT.text[mode]).toContain('hop round')
  })

  it('every prompt has a line for keyboard, touch and gamepad', () => {
    for (const hint of HINTS) for (const mode of ['keys', 'touch', 'pad'] as const) expect(hint.text[mode].length).toBeGreaterThan(8)
  })
})
