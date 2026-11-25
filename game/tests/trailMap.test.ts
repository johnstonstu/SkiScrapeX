import { describe, expect, it } from 'vitest'
import { PARK_WAY_NAMES, parkSitesFromLines, placeLineup } from '../src/world/park'
import { hitTrail, trailLabel } from '../src/ui/trailMap'
import type { Run } from '../src/world/resort'
import type { ParkSite } from '../src/world/park'

const run = (name: string, parts: [number, number][][]): Run => ({
  id: name,
  name,
  difficulty: 'intermediate',
  groomed: true,
  kind: 'line',
  parts,
})

describe('trail map picking', () => {
  it('selects the nearest run within the hit radius', () => {
    const blue = run('Okanagan Run', [[[0, 0], [0, 100]]])
    const green = run('Easy Rider', [[[40, 0], [40, 100]]])
    const nearBlue = hitTrail(2, 40, [blue, green], [], 12)
    expect(nearBlue?.kind).toBe('run')
    if (nearBlue?.kind === 'run') expect(nearBlue.run.name).toBe('Okanagan Run')
    expect(hitTrail(38, 20, [blue, green], [], 12)).toMatchObject({ kind: 'run', run: { name: 'Easy Rider' } })
    expect(hitTrail(20, 20, [blue, green], [], 8)).toBeNull()
  })

  it('prefers a park when the click is closer to the park line', () => {
    const blue = run('Okanagan Run', [[[0, 0], [0, 120]]])
    const park: ParkSite = { id: '1', name: 'Claim Jumper', line: [[18, 0], [18, 120]], layout: 'claimJumper' }
    expect(hitTrail(17, 40, [blue], [park], 12)).toMatchObject({ kind: 'park', site: { name: 'Claim Jumper' } })
  })

  it('labels runs and parks for the hover tip', () => {
    const blue = run('Okanagan Run', [[[0, 0], [0, 100]]])
    const park: ParkSite = { id: '1', name: 'Claim Jumper', line: [[18, 0], [18, 120]], layout: 'claimJumper' }
    expect(trailLabel({ kind: 'run', run: blue })).toBe('Okanagan Run')
    expect(trailLabel({ kind: 'park', site: park })).toBe('Claim Jumper')
    expect(trailLabel(null)).toBe('')
  })
})

describe('park way naming', () => {
  it('maps unnamed OSM ways by id, not length', () => {
    const line: [number, number][] = [[0, 0], [0, 100]]
    const sites = parkSitesFromLines([
      { name: null, line, osmId: 'way/374339369' },
      { name: null, line, osmId: 'way/374339370' },
      { name: 'Park', line, osmId: 'way/1105323712' },
      { name: 'Claim Jumper', line, osmId: 'way/374339381' },
    ])
    expect(sites.map((site) => site.name)).toEqual(['Okanagan Park', 'Aerial Site', 'Little Nuggets', 'Claim Jumper'])
    expect(sites.map((site) => site.layout)).toEqual(['okanagan', 'aerial', 'nuggets', 'claimJumper'])
    expect(PARK_WAY_NAMES['way/374339369']).toBe('Okanagan Park')
  })

  it('keeps the Claim Jumper centreline from OSM (no left/uphill offset)', () => {
    const line: [number, number][] = [
      [1912, 838],
      [2000, 740],
      [2100, 640],
      [2251, 521],
    ]
    const [site] = parkSitesFromLines([{ name: 'Claim Jumper', line, osmId: 'way/374339381' }])
    expect(site.line).toEqual(line)
  })
})

describe('park lane rows', () => {
  it('places side-by-side features at the same station', () => {
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [0, i * 20] as [number, number])
    const placed = placeLineup(line, [['kickerS', 'kickerM'], 'rail'], 20)
    const kickers = placed.filter((feature) => feature.spec.kind === 'kicker')
    expect(kickers).toHaveLength(2)
    expect(Math.abs(kickers[0].z - kickers[1].z)).toBeLessThan(1)
    expect(Math.abs(kickers[0].x - kickers[1].x)).toBeGreaterThan(5)
  })
})
