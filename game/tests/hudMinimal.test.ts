import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, minimalHud, readSettings } from '../src/app/settings'
import { createHudPeek, PEEK_MS } from '../src/ui/hudPeek'

describe('minimal HUD setting', () => {
  it('Auto is minimal on touch screens and full elsewhere', () => {
    expect(DEFAULT_SETTINGS.hud).toBe('auto')
    expect(minimalHud({ hud: 'auto' }, true)).toBe(true)
    expect(minimalHud({ hud: 'auto' }, false)).toBe(false)
  })

  it('an explicit choice wins over the device', () => {
    expect(minimalHud({ hud: 'full' }, true)).toBe(false)
    expect(minimalHud({ hud: 'minimal' }, false)).toBe(true)
  })

  it('saves from before the setting existed read as Auto', () => {
    const store = new Map<string, string>([['skiscrapex.settings', JSON.stringify({ volume: 0.5 })]])
    const original = globalThis.localStorage
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage
    try {
      expect(readSettings().hud).toBe('auto')
      store.set('skiscrapex.settings', JSON.stringify({ hud: 'tiny' }))
      expect(readSettings().hud).toBe('auto')
    } finally {
      globalThis.localStorage = original
    }
  })
})

describe('run name and clock peek', () => {
  it('shows for a few seconds when the title changes, then hides', () => {
    const peek = createHudPeek()
    peek.update("Grandfather's Trail", 0)
    expect(peek.visible(100, false)).toBe(true)
    expect(peek.visible(PEEK_MS - 1, false)).toBe(true)
    expect(peek.visible(PEEK_MS + 1, false)).toBe(false)
  })

  it('the same title every frame does not keep it up', () => {
    const peek = createHudPeek()
    for (let t = 0; t <= PEEK_MS + 500; t += 16) peek.update('Gunbarrel', t)
    expect(peek.visible(PEEK_MS + 500, false)).toBe(false)
  })

  it('a new title or a restart shows it again', () => {
    const peek = createHudPeek()
    peek.update('Gunbarrel', 0)
    peek.update('Top of Quickdraw', 10000)
    expect(peek.visible(10500, false)).toBe(true)
    peek.poke(20000)
    expect(peek.visible(20500, false)).toBe(true)
    expect(peek.visible(30000, false)).toBe(false)
  })

  it('timed runs and events pin it on screen', () => {
    const peek = createHudPeek()
    expect(peek.visible(99999, true)).toBe(true)
  })
})
