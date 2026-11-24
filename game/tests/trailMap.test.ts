import { describe, expect, it } from 'vitest'
import { adjustClaimJumperLine, placeLineup } from '../src/world/park'
import { hitTrail } from '../src/ui/trailMap'
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
    const park: ParkSite = { id: '1', name: 'Claim Jumper', line: [[18, 0], [18, 120]], layout: 'lanes' }
    expect(hitTrail(17, 40, [blue], [park], 12)).toMatchObject({ kind: 'park', site: { name: 'Claim Jumper' } })
  })
})

describe('Claim Jumper start', () => {
  it('moves the top of the line left and uphill, leaving the bottom nearly fixed', () => {
    const line: [number, number][] = [
      [1912, 838],
      [2000, 740],
      [2100, 640],
      [2251, 521],
    ]
    const adjusted = adjustClaimJumperLine(line)
    expect(adjusted[0][0]).toBeLessThan(line[0][0] - 40)
    expect(adjusted[0][1]).toBeLessThan(line[0][1] - 25)
    expect(adjusted.at(-1)).toEqual(line.at(-1))
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
