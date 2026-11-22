import { describe, expect, it } from 'vitest'
import { STEPS } from '../src/app/tutorial'
import type { SkiInput, SkiState } from '../src/sim'

const skier = (over: Partial<SkiState>) => ({ speed: 0, grounded: true, skid: 0, edgeAngle: 0, air: null, ...over }) as unknown as SkiState
const input = (steer = 0) => ({ steer, brake: 0, tuck: false }) as SkiInput
const step = (title: string) => STEPS.find((s) => s.title === title)!

describe('tutorial lessons', () => {
  it('get moving needs some speed', () => {
    expect(step('Get moving').check(skier({ speed: 2 }), input(), 0.1, {})).toBe(false)
    expect(step('Get moving').check(skier({ speed: 5 }), input(), 0.1, {})).toBe(true)
  })

  it('turning needs both directions', () => {
    const memo = {}
    const check = step('Turn both ways').check
    for (let i = 0; i < 10; i++) expect(check(skier({ speed: 3 }), input(-1), 0.1, memo)).toBe(false)
    let done = false
    for (let i = 0; i < 10; i++) done = check(skier({ speed: 3 }), input(1), 0.1, memo)
    expect(done).toBe(true)
  })

  it('stopping needs speed first, then a stop', () => {
    const memo = {}
    const check = step('Stop').check
    expect(check(skier({ speed: 0.2 }), input(), 0.1, memo)).toBe(false)
    expect(check(skier({ speed: 5 }), input(), 0.1, memo)).toBe(false)
    expect(check(skier({ speed: 0.3 }), input(), 0.1, memo)).toBe(true)
  })

  it('carving needs a held, clean edge', () => {
    const memo = {}
    const check = step('Carve').check
    const clean = skier({ speed: 6, skid: 0.1, edgeAngle: 0.4 })
    const skidding = skier({ speed: 6, skid: 0.8, edgeAngle: 0.4 })
    for (let i = 0; i < 10; i++) expect(check(skidding, input(), 0.1, memo)).toBe(false)
    let done = false
    for (let i = 0; i < 14 && !done; i++) done = check(clean, input(), 0.1, memo)
    expect(done).toBe(true)
  })

  it('jump and grab watch the air state', () => {
    expect(step('Jump').check(skier({ air: { time: 0.3 } as SkiState['air'] }), input(), 0.1, {})).toBe(true)
    expect(step('Grab').check(skier({ air: { time: 0.3, grab: null } as unknown as SkiState['air'] }), input(), 0.1, {})).toBe(false)
    expect(step('Grab').check(skier({ air: { time: 0.3, grab: 'safety' } as unknown as SkiState['air'] }), input(), 0.1, {})).toBe(true)
  })
})
