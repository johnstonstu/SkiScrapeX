import { describe, expect, it } from 'vitest'
import { touchModeAfter } from '../src/player/touchMode'

describe('touch controls follow the input used', () => {
  it('a finger on the screen turns them on', () => {
    expect(touchModeAfter(false, { kind: 'pointer', pointerType: 'touch' })).toBe(true)
  })

  it('mouse and pen clicks leave them as they are', () => {
    for (const current of [true, false]) {
      expect(touchModeAfter(current, { kind: 'pointer', pointerType: 'mouse' })).toBe(current)
      expect(touchModeAfter(current, { kind: 'pointer', pointerType: 'pen' })).toBe(current)
    }
  })

  it('skiing with the keyboard turns them off', () => {
    for (const code of ['KeyW', 'KeyA', 'ArrowLeft', 'Space']) {
      expect(touchModeAfter(true, { kind: 'key', code })).toBe(false)
    }
  })

  it('menu and shortcut keys do not', () => {
    for (const code of ['Escape', 'KeyT', 'KeyP', 'Enter', 'ShiftLeft']) {
      expect(touchModeAfter(true, { kind: 'key', code })).toBe(true)
    }
  })
})
