import { describe, expect, it } from 'vitest'
import { RiderSnow, type SnowInput } from '../src/render/rider/riderSnow'

const base: SnowInput = { crashed: 0, crashSpeed: 0, crashHeading: 0, heading: 0, sink: 0, speed: 10, grounded: true }

function run(snow: RiderSnow, seconds: number, input: Partial<SnowInput>) {
  for (let t = 0; t < seconds; t += 1 / 60) snow.step({ ...base, ...input }, 1 / 60)
}

describe('snow on the rider', () => {
  it('packs on in a crash, more for a faster fall, and fades within a couple of minutes', () => {
    const soft = new RiderSnow()
    run(soft, 0.1, { crashed: 1, crashSpeed: 3, speed: 0 })
    const hard = new RiderSnow()
    run(hard, 0.1, { crashed: 1, crashSpeed: 20, speed: 0 })
    expect(soft.crash).toBeGreaterThan(0.4)
    expect(hard.crash).toBeGreaterThan(soft.crash + 0.2)
    run(hard, 2, { crashed: 1, crashSpeed: 20, speed: 0 })
    const fresh = hard.crash
    run(hard, 30, { speed: 10 })
    expect(hard.crash).toBeLessThan(fresh * 0.7)
    expect(hard.crash).toBeGreaterThan(0.1)
    run(hard, 90, { speed: 10 })
    expect(hard.crash).toBe(0)
  })

  it('lands on the side that hit the snow', () => {
    const backward = new RiderSnow()
    run(backward, 0.1, { crashed: 1, crashSpeed: 10, crashHeading: Math.PI, heading: 0 })
    expect(backward.side.z).toBeLessThan(-0.5)
    const forward = new RiderSnow()
    run(forward, 0.1, { crashed: 1, crashSpeed: 10, crashHeading: 0, heading: 0 })
    expect(forward.side.z).toBeGreaterThan(0.5)
  })

  it('cakes the legs higher in deeper powder and clears on groomed snow', () => {
    const shallow = new RiderSnow()
    run(shallow, 3, { sink: 0.08, speed: 8 })
    const deep = new RiderSnow()
    run(deep, 3, { sink: 0.25, speed: 8 })
    expect(shallow.legAmount).toBe(1)
    expect(deep.legHeight).toBeGreaterThan(shallow.legHeight + 0.15)
    // No snow from groomers.
    const groomed = new RiderSnow()
    run(groomed, 3, { sink: 0.01, speed: 15 })
    expect(groomed.legAmount).toBe(0)
    run(deep, 10, { sink: 0 })
    expect(deep.legAmount).toBeGreaterThan(0.3)
    run(deep, 20, { sink: 0 })
    expect(deep.legAmount).toBe(0)
  })
})
