import { describe, expect, it } from 'vitest'
import { createSkiState, SURFACES, type SkiState, type SurfaceKind } from '../src/sim'
import { cardSound } from '../src/player/sfx/cards'
import { chimeHz, crashImpact, DEFAULT_KEY, landingImpact, sceneMix, snowCharacter, snowMix, windMix } from '../src/player/sfx/mix'

const riding = (on: SurfaceKind, over: Partial<SkiState> = {}): SkiState => ({ ...createSkiState(), grounded: true, mode: 'carving', speed: 16, surface: SURFACES[on], ...over })
const carving = (on: SurfaceKind) => riding(on, { edgeAngle: 0.8, carveLoad: 2.4, skid: 0.05 })
const skidding = (on: SurfaceKind) => riding(on, { edgeAngle: 0.45, carveLoad: 1.2, skid: 0.8, mode: 'skidding' })

describe('snow character', () => {
  it('reads each surface as the snow it is', () => {
    expect(snowCharacter(SURFACES.groomed)).toMatchObject({ loose: 0, gritty: 0 })
    expect(snowCharacter(SURFACES.groomed).icy).toBe(0)
    expect(snowCharacter(SURFACES.park).icy).toBe(0)
    expect(snowCharacter(SURFACES.ice).icy).toBe(1)
    expect(snowCharacter(SURFACES.powder)).toEqual({ loose: 1, icy: 0, gritty: 0 })
    expect(snowCharacter(SURFACES.forest).loose).toBeGreaterThan(0.5)
    expect(snowCharacter(SURFACES.rock).gritty).toBe(1)
    expect(snowCharacter(SURFACES.rock).icy).toBe(0)
  })
})

describe('snow mix', () => {
  it('is silent in the air, on a rail, on a lift and standing still', () => {
    for (const s of [riding('groomed', { grounded: false }), riding('groomed', { speed: 0 }), riding('groomed', { rail: {} as SkiState['rail'] })]) {
      const m = snowMix(s, false)
      expect(m.glide.gain + m.edge.gain + m.skid.gain + m.scrape.gain + m.float.gain + m.rumble).toBe(0)
    }
    expect(snowMix(carving('groomed'), true).edge.gain).toBe(0)
  })

  it('a carve is mostly edge and a skid is mostly scrape', () => {
    const carve = snowMix(carving('groomed'), false)
    const skid = snowMix(skidding('groomed'), false)
    expect(carve.edge.gain).toBeGreaterThan(carve.skid.gain * 4)
    expect(skid.skid.gain).toBeGreaterThan(skid.edge.gain * 4)
    expect(skid.skid.gain).toBeGreaterThan(carve.skid.gain * 4)
  })

  it('ice is brighter than a groomer, powder duller and quieter underfoot', () => {
    const groomed = snowMix(carving('groomed'), false)
    const ice = snowMix(carving('ice'), false)
    const powder = snowMix(carving('powder'), false)
    expect(ice.edge.freq).toBeGreaterThan(groomed.edge.freq * 1.4)
    expect(ice.glide.lowpass).toBeGreaterThan(groomed.glide.lowpass)
    expect(ice.scrape.gain).toBeGreaterThan(0.05)
    expect(groomed.scrape.gain).toBe(0)
    expect(powder.edge.freq).toBeLessThan(groomed.edge.freq * 0.6)
    expect(powder.glide.gain).toBeLessThan(groomed.glide.gain * 0.5)
    expect(powder.float.gain).toBeGreaterThan(0)
    expect(groomed.float.gain).toBe(0)
    expect(powder.rumble).toBe(0)
  })

  it('gets louder with speed and pans toward the loaded edge', () => {
    const slow = snowMix(riding('groomed', { speed: 5, edgeAngle: 0.5 }), false)
    const fast = snowMix(riding('groomed', { speed: 25, edgeAngle: -0.5 }), false)
    expect(fast.glide.gain).toBeGreaterThan(slow.glide.gain * 2)
    expect(slow.pan).toBeGreaterThan(0)
    expect(fast.pan).toBeLessThan(0)
  })

  it('a hockey stop scrapes even before the sim reports the skid, and a fallen rider only slides', () => {
    expect(snowMix(riding('groomed', { mode: 'braking', skid: 0.1 }), false).skid.gain).toBeGreaterThan(0.2)
    const down = snowMix(riding('groomed', { crashed: 2, mode: 'crashed', edgeAngle: 0.8 }), false)
    expect(down.edge.gain).toBe(0)
    expect(down.skid.gain).toBeGreaterThan(0)
  })

  it('chatter only on hard snow', () => {
    expect(snowMix(riding('ice', { chatter: 0.8 }), false).chatter.depth).toBeGreaterThan(0.4)
    expect(snowMix(riding('powder', { chatter: 0.8 }), false).chatter.depth).toBe(0)
  })

  it('keeps every level in range across surfaces and speeds', () => {
    for (const on of Object.keys(SURFACES) as SurfaceKind[]) {
      for (const speed of [0.5, 8, 20, 40]) {
        for (const s of [carving(on), skidding(on), riding(on, { sink: 0.4, chatter: 1, washout: 1 })]) {
          const m = snowMix({ ...s, speed }, false)
          for (const level of [m.glide.gain, m.edge.gain, m.skid.gain, m.scrape.gain, m.float.gain, m.rumble, m.chatter.depth, m.skid.grit]) {
            expect(level).toBeGreaterThanOrEqual(0)
            expect(level).toBeLessThanOrEqual(1.2)
          }
          for (const hz of [m.glide.highpass, m.glide.lowpass, m.edge.freq, m.skid.freq, m.scrape.freq, m.float.lowpass]) {
            expect(hz).toBeGreaterThan(100)
            expect(hz).toBeLessThan(12000)
          }
        }
      }
    }
  })
})

describe('wind', () => {
  it('rises with speed, brightens in the air and whistles only when fast', () => {
    const at = (speed: number, over = {}) => windMix({ speed, grounded: true, tuck: false, rail: null, ...over }, false)
    expect(at(30).gain).toBeGreaterThan(at(15).gain * 3)
    expect(at(15).gain).toBeGreaterThan(at(5).gain * 3)
    expect(at(20, { grounded: false }).lowpass).toBeGreaterThan(at(20).lowpass)
    expect(at(10).whistle.gain).toBe(0)
    expect(at(30).whistle.gain).toBeGreaterThan(0.05)
    expect(at(10).buffet).toBe(0)
  })

  it('a storm is heard standing still', () => {
    const still = { speed: 0, grounded: true, tuck: false, rail: null }
    expect(windMix(still, false, 1).gain).toBeGreaterThan(windMix(still, false, 0).gain * 5)
  })
})

describe('impacts', () => {
  it('bigger drops land harder, powder lands soft and long, ice slaps', () => {
    expect(landingImpact(8, SURFACES.groomed, 'clean').level).toBeGreaterThan(landingImpact(2, SURFACES.groomed, 'clean').level)
    const powder = landingImpact(6, SURFACES.powder, 'clean')
    const groomed = landingImpact(6, SURFACES.groomed, 'clean')
    const ice = landingImpact(6, SURFACES.ice, 'clean')
    expect(powder.crunch.seconds).toBeGreaterThan(groomed.crunch.seconds * 2)
    expect(powder.crunch.freq).toBeLessThan(groomed.crunch.freq)
    expect(powder.slap).toBe(0)
    expect(ice.slap).toBeGreaterThan(groomed.slap)
    expect(landingImpact(6, SURFACES.groomed, 'sketchy').level).toBeGreaterThan(groomed.level)
  })

  it('a crash outweighs any landing and tumbles more the faster it was', () => {
    expect(crashImpact(4, SURFACES.groomed).level).toBeGreaterThanOrEqual(0.7)
    expect(crashImpact(20, SURFACES.groomed).tumbles).toBeGreaterThan(crashImpact(3, SURFACES.groomed).tumbles)
  })
})

describe('places', () => {
  const nowhere = { village: 0, forest: 0, alpine: 0, station: 0, wind: 0 }
  it('each place brings its own layer', () => {
    expect(sceneMix({ ...nowhere, village: 1 }, 0, false).crowd).toBeGreaterThan(0.3)
    expect(sceneMix({ ...nowhere, forest: 1 }, 0, false)).toMatchObject({ crowd: 0, howl: 0 })
    expect(sceneMix({ ...nowhere, forest: 1 }, 0, false).birds).toBeGreaterThan(0)
    expect(sceneMix({ ...nowhere, alpine: 1, wind: 1 }, 0, false).howl).toBeGreaterThan(0.5)
  })

  it('speed pushes the background down and birds stop in a storm', () => {
    expect(sceneMix({ ...nowhere, village: 1 }, 25, false).crowd).toBeLessThan(sceneMix({ ...nowhere, village: 1 }, 0, false).crowd * 0.5)
    expect(sceneMix({ ...nowhere, forest: 1, wind: 1 }, 0, false).birds).toBe(0)
    expect(sceneMix({ ...nowhere, forest: 1 }, 25, false).birds).toBe(0)
    expect(sceneMix({ ...nowhere, forest: 1 }, 25, true).birds).toBeGreaterThan(0)
  })
})

describe('chimes', () => {
  it('play chord tones of the key, in one register whatever the root', () => {
    const d = chimeHz(DEFAULT_KEY, 0)
    expect(d).toBeCloseTo(587.33, 1) // D5
    expect(chimeHz(DEFAULT_KEY, 1) / d).toBeCloseTo(2 ** (4 / 12), 5) // major third
    expect(chimeHz(DEFAULT_KEY, 2) / d).toBeCloseTo(2 ** (7 / 12), 5)
    expect(chimeHz(DEFAULT_KEY, 3) / d).toBeCloseTo(2, 5)
    const minor = { root: 45, scale: [0, 2, 3, 5, 7, 8, 10] }
    expect(chimeHz(minor, 1) / chimeHz(minor, 0)).toBeCloseTo(2 ** (3 / 12), 5) // minor third
    for (const root of [38, 40, 41, 43, 45]) {
      expect(chimeHz({ root, scale: minor.scale }, 0)).toBeGreaterThan(520)
      expect(chimeHz({ root, scale: minor.scale }, 0)).toBeLessThan(1000)
    }
  })

  it('cards map to chimes; crash cards stay silent', () => {
    expect(cardSound('Backflip', 'Perfect', 'perfect')).toBe('perfect')
    expect(cardSound('Banked', '1,200 total', 'bank')).toBe('bank')
    expect(cardSound('Finish', '1:02.3', 'bank')).toBe('finish')
    expect(cardSound('Gold nugget', 'Beanie unlocked', 'bank')).toBe('found')
    expect(cardSound('Missed gate', '+2 s', 'crash')).toBe('fail')
    expect(cardSound('Tree!', '40 km/h impact', 'crash')).toBeNull()
    expect(cardSound('Bail!', 'Backflip', 'crash')).toBeNull()
  })
})
