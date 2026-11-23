import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, lighterQuality, resolveQuality } from '../src/app/settings'

const auto = { ...DEFAULT_SETTINGS, quality: 'auto' as const }

describe('choosing the graphics level', () => {
  it('Auto follows the hardware, or High on desktops and Low on touch when unknown', () => {
    expect(resolveQuality(auto, false).level).toBe('high')
    expect(resolveQuality(auto, true).level).toBe('low')
    expect(resolveQuality(auto, false, 'low').level).toBe('low')
    expect(resolveQuality(auto, false, 'medium').level).toBe('medium')
  })

  it('Auto never goes above the limit learned on this machine', () => {
    expect(resolveQuality(auto, false, 'high', 'medium').level).toBe('medium')
    expect(resolveQuality(auto, false, 'low', 'medium').level).toBe('low')
  })

  it('a level picked by hand is kept', () => {
    expect(resolveQuality({ ...DEFAULT_SETTINGS, quality: 'high' }, false, 'low', 'low').level).toBe('high')
  })

  it('lighter levels bottom out at Low', () => {
    expect(lighterQuality('high')).toBe('medium')
    expect(lighterQuality('low')).toBe('low')
  })

  it('Low leaves out the close-up snow detail', () => {
    expect(resolveQuality(auto, false, 'low').snowDetail).toBe(false)
    expect(resolveQuality(auto, false, 'high').snowDetail).toBe(true)
  })
})
