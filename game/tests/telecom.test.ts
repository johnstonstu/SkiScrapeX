import { describe, expect, it } from 'vitest'
import { apexMountainTowers, beaconsfieldTowers, BEACONSFIELD_TOWERS, summitNear } from '../src/world/telecom'

/** A cone-shaped peak at (px, pz), 600 m high, falling 0.3 m per metre. */
const cone = (px: number, pz: number) => (x: number, z: number) => 600 - 0.3 * Math.hypot(x - px, z - pz)

describe('telecom towers', () => {
  it('finds the top of a peak near the mapped point', () => {
    const top = summitNear(cone(1000, 1000), 940, 1060)
    expect(top).not.toBeNull()
    expect(Math.hypot(top!.x - 1000, top!.z - 1000)).toBeLessThanOrEqual(10)
  })

  it('builds the Apex Mountain farm on its summit, standing on the ground', () => {
    const heightAt = cone(1768, 3988)
    const sites = apexMountainTowers(heightAt, { x: 1700, z: 3950 })
    expect(sites.filter((s) => s.kind === 'lattice')).toHaveLength(2)
    expect(sites.filter((s) => s.kind === 'monopole')).toHaveLength(1)
    for (const site of sites) {
      expect(Math.hypot(site.x - 1768, site.z - 3988)).toBeLessThan(60)
      // Never above the ground at its own centre, never more than a few metres below it.
      const ground = heightAt(site.x, site.z)
      expect(site.y).toBeLessThanOrEqual(ground + 1e-6)
      expect(site.y).toBeGreaterThan(ground - 3)
    }
  })

  it('puts a tower and a cabinet on each Beaconsfield site, and nothing outside the data', () => {
    const sites = beaconsfieldTowers(cone(1520, 1555))
    expect(sites).toHaveLength(BEACONSFIELD_TOWERS.length * 2)
    expect(sites.filter((s) => s.kind === 'cabinet')).toHaveLength(BEACONSFIELD_TOWERS.length)
    expect(beaconsfieldTowers(() => NaN)).toHaveLength(0)
  })
})
