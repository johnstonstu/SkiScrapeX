import { describe, expect, it } from 'vitest'
import { applyCorrections, splitRun } from '../src/world/corrections'
import { renameRuns } from '../src/app/progress'
import { OVERLAY_RUNS, joinOverlayEnds } from '../src/world/runOverlay'
import type { Resort, Run } from '../src/world/resort'

const line = (name: string, points: [number, number][], difficulty = 'intermediate'): Run =>
  ({ id: name, name, difficulty, groomed: true, kind: 'line', parts: [points] }) as Run

describe('run pass A (research handoff)', () => {
  it('cuts a run into upper and lower parts at the junction', () => {
    const [upper, lower] = splitRun(line('Gambit', [[0, 0], [0, 100], [0, 200]]), { at: [5, 120], upper: 'Upper Gambit', lower: 'Lower Gambit' })
    expect(upper.name).toBe('Upper Gambit')
    expect(lower.name).toBe('Lower Gambit')
    expect(upper.parts[0].at(-1)).toEqual([0, 120])
    expect(lower.parts[0][0]).toEqual([0, 120])
    expect(lower.parts[0].at(-1)).toEqual([0, 200])
    // A junction far from the line leaves the run whole.
    expect(splitRun(line('Gambit', [[0, 0], [0, 200]]), { at: [500, 100], upper: 'U', lower: 'L' })).toHaveLength(1)
  })

  it('splits Gambit, Spruce Hollow and Hang em High, and merges Wishbone', () => {
    const resort = {
      runs: [
        line('Gambit', [[2700, 1100], [2740, 1255], [2800, 1400]]),
        line('Spruce Hollow', [[2600, 800], [2649, 891], [2700, 990]]),
        line("Hang'em High", [[2400, 2100], [2623, 2138], [2900, 2050]], 'advanced'),
        line('Upper Wishbone', [[1571, 535], [1800, 600]], 'easy'),
        line('Lower Wishbone', [[1806, 552], [2153, 470]]),
      ],
      peaks: [],
    } as unknown as Resort
    applyCorrections(resort)
    const names = resort.runs.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['Upper Gambit', 'Lower Gambit', 'Upper Spruce Hollow', 'Lower Spruce Hollow', "Upper Hang 'em High", "Lower Hang 'em High", 'Wishbone']))
    const wishbone = resort.runs.filter((r) => r.name === 'Wishbone')
    expect(wishbone).toHaveLength(1)
    expect(wishbone[0].parts).toHaveLength(2)
    expect(wishbone[0].difficulty).toBe('intermediate')
  })

  it('names the Wildside traces and adds the south-face runs', () => {
    const name = (ref: string) => OVERLAY_RUNS.find((r) => r.ref === ref)?.name
    expect([name('W3'), name('W4'), name('W5'), name('W6')]).toEqual(['Jackpot', 'Gun Slinger', 'ShootOut', 'Showdown'])
    // Chaser moved from the L3 trace to the Quickdraw bowl (bowl pass, 2026-11-27).
    expect(name('L3')).toBe('Unnamed cut L3')
    expect(name('P-CH')).toBe('Chaser')
    for (const run of ['Toilet Bowl', 'Essendale Ward 1', 'Essendale Ward 2', 'Tooth Tusk', 'Sweet Sue', 'Wildly Easy']) {
      expect(OVERLAY_RUNS.some((r) => r.name === run), run).toBe(true)
    }
    expect(OVERLAY_RUNS.some((r) => r.name.startsWith('Unmapped'))).toBe(false)
  })

  it('carries saved medals and bests across the renames and splits', () => {
    const progress = renameRuns({
      medals: { 'time:Wildside cut 3': 'gold', "time:Hang'em High": 'silver' },
      bests: { 'time:Gambit': 61.2, 'Upper Wishbone': 40 },
      covered: { 'Unmapped run L3': true },
    } as never)
    expect(progress.medals['time:Jackpot']).toBe('gold')
    expect(progress.medals["time:Upper Hang 'em High"]).toBe('silver')
    expect(progress.bests['time:Upper Gambit']).toBe(61.2)
    expect(progress.bests['Wishbone']).toBe(40)
    expect(progress.covered['Unnamed cut L3']).toBe(true)
  })

  it('links trace ends to the runs they leave and feed, and leaves real gaps alone', () => {
    const trace = { ...line('Trace', [[0, 30], [0, 200]]), id: 'lidar/T' }
    const far = { ...line('Far trace', [[500, 0], [500, 100]]), id: 'lidar/F' }
    const resort = {
      runs: [line('Ridge', [[-100, 0], [100, 0]]), line('Runout', [[-100, 240], [100, 240]]), trace, far],
      lifts: [],
      parks: [],
    } as unknown as Resort
    // Height falls to the south (+z), so lines run downhill with z.
    joinOverlayEnds(resort, (_x, z) => -z)
    expect(trace.parts).toHaveLength(3)
    expect(trace.parts[0]).toEqual([[0, 30], [0, 200]])
    expect(trace.parts[1]).toEqual([[0, 0], [0, 30]])
    expect(trace.parts[2]).toEqual([[0, 200], [0, 240]])
    // 400 m from anything: not a tracing shortfall, so no link.
    expect(far.parts).toHaveLength(1)
  })
})
