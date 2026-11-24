import { afterEach, expect, it, vi } from 'vitest'
import { createGamepadInput } from '../src/player/gamepad'
import type { Action } from '../src/player/input'

function connectPad() {
  const pad = { index: 0, connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }
  vi.stubGlobal('navigator', { getGamepads: () => [pad] })
  const input = createGamepadInput()
  const actions = new Set<Action>()
  return { pad, input, actions, poll: (ms: number, menu: boolean) => input.poll(ms, menu, actions).commands }
}

afterEach(() => vi.unstubAllGlobals())

it('routes the D-pad to menu navigation without triggering skiing shortcuts', () => {
  const { pad, actions, poll } = connectPad()
  pad.buttons[9].pressed = true
  poll(0, false)
  expect(actions).toEqual(new Set(['pause']))
  actions.clear()
  pad.buttons[9].pressed = false
  pad.buttons[13].pressed = true
  expect(poll(16, true)).toEqual(['down'])
  expect(poll(200, true)).toEqual([])
  expect(poll(350, true)).toEqual(['down'])
  expect(actions.size).toBe(0)
  pad.buttons[13].pressed = false
  poll(400, false)
  pad.buttons[13].pressed = true
  poll(416, false)
  expect(actions).toEqual(new Set(['map']))
})

it('waits for release before a menu accept turns into a jump', () => {
  const { pad, input, poll } = connectPad()
  pad.buttons[0].pressed = true
  expect(poll(0, true)).toEqual(['accept'])
  poll(16, false)
  expect(input.state.jump).toBe(false)
  pad.buttons[0].pressed = false
  poll(32, false)
  pad.buttons[0].pressed = true
  poll(48, false)
  expect(input.state.jump).toBe(true)
})
