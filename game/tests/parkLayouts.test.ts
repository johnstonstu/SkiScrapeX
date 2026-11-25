import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYOUT, FEATURES, LAYOUTS, parkOnRun, parkSitesFromLines, placeFeatures } from '../src/world/park'

describe('Apex park layouts', () => {
  it('offers two or three features at every station of the named parks', () => {
    for (const id of new Set(Object.values(DEFAULT_LAYOUT))) {
      if (id === 'rollers') continue // Boarder Cross is a single course by design.
      const layout = LAYOUTS.find((l) => l.id === id)!
      for (const slot of layout.features) {
        expect(Array.isArray(slot), `${id}: ${JSON.stringify(slot)}`).toBe(true)
        expect((slot as string[]).length).toBeGreaterThanOrEqual(2)
        expect((slot as string[]).length).toBeLessThanOrEqual(3)
        for (const feature of slot as string[]) expect(FEATURES[feature], feature).toBeDefined()
      }
    }
  })

  it('makes Claim Jumper the XL line, and Prospector the jib park with a step-over', () => {
    const big = LAYOUTS.find((l) => l.id === 'claimJumper')!.features.flat()
    expect(big.filter((f) => f === 'kickerPro' || f === 'kickerXL').length).toBeGreaterThanOrEqual(6)
    const jib = LAYOUTS.find((l) => l.id === 'prospector')!.features.flat()
    expect(jib).toContain('stepOver')
    expect(jib.filter((f) => FEATURES[f].kind.toLowerCase().includes('rail') || FEATURES[f].kind === 'box').length).toBeGreaterThanOrEqual(8)
  })

  it('runs the Claim Jumper features on a straight line down its lower part', () => {
    const line: [number, number][] = [[0, 0], [0, 100], [60, 200], [200, 400]]
    const [site] = parkSitesFromLines([{ name: 'Claim Jumper', line, osmId: 'way/374339381' }])
    expect(site.line).toEqual(line)
    expect(site.featureLine).toHaveLength(2)
    const features = placeFeatures(site, 'claimJumper')
    expect(features.length).toBeGreaterThan(6)
    // Every row points the same way down the straight line.
    for (const f of features) expect(Math.atan2(f.dirZ, f.dirX)).toBeCloseTo(Math.atan2(features[0].dirZ, features[0].dirX), 3)
  })

  it('lays Prospector downhill whichever way the run was traced', () => {
    const heightAt = (x: number) => 100 - x * 0.2
    const site = parkOnRun('Prospector', [[300, 0], [0, 0]], heightAt)
    expect(site.line[0][0]).toBe(0)
    expect(site.layout).toBe('prospector')
  })
})
