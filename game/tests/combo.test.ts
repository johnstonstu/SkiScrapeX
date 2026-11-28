import { describe, expect, it } from 'vitest'
import { addToCombo, type ComboState, parkAdvice } from '../src/app/tricks'

const fresh = (): ComboState => ({ tricks: [], counted: 0, multiplier: 1, points: 0 })

describe('trick combos', () => {
  it('a string of small flat ollies does not build a multiplier', () => {
    const combo = fresh()
    for (const points of [143, 65, 60, 62, 70, 58, 61]) addToCombo(combo, 'Air', points)
    expect(combo.multiplier).toBe(1)
  })

  it('the same trick again scores half and does not raise the multiplier', () => {
    const combo = fresh()
    expect(addToCombo(combo, '360', 400)).toBe(400)
    expect(addToCombo(combo, '360', 400)).toBe(200)
    expect(combo.multiplier).toBe(1)
  })

  it('different real tricks chain up to ×5', () => {
    const combo = fresh()
    for (const name of ['360', 'Mute', 'Backflip', '50-50 Rail', '540 Japan', '720']) addToCombo(combo, name, 300)
    expect(combo.multiplier).toBe(5)
    expect(combo.points).toBe(1800)
  })
})

describe('park results advice', () => {
  const base = { repeats: 0, repeatLoss: 0, bestMultiplier: 1 }
  it('explains the pop and the grab when nothing was landed', () => {
    expect(parkAdvice(base, 0)).toMatch(/let go at the lip/)
  })
  it('names what repeats cost', () => {
    expect(parkAdvice({ repeats: 6, repeatLoss: 2363, bestMultiplier: 1 }, 7)).toMatch(/2,363 points/)
  })
  it('points at the multiplier when the tricks did not vary enough', () => {
    expect(parkAdvice({ ...base, bestMultiplier: 2 }, 3)).toMatch(/×2 of ×5/)
  })
  it('says nothing to a run that built a combo without repeats', () => {
    expect(parkAdvice({ repeats: 1, repeatLoss: 200, bestMultiplier: 4 }, 6)).toBeNull()
  })
})
