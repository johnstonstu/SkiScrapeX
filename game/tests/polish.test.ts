import { describe, expect, it } from 'vitest'
import { applyCorrections } from '../src/world/corrections'
import { emptyProgress, renameRuns } from '../src/app/progress'
import { DEFAULT_SETTINGS, QUALITY, shadowsOn } from '../src/app/settings'
import type { Resort } from '../src/world/resort'

describe('official run spellings', () => {
  it('renames OSM spellings and still applies difficulty fixes', () => {
    const run = (name: string, difficulty = 'easy') => ({ id: name, name, difficulty, groomed: true, kind: 'line', parts: [] })
    const resort = { runs: [run('Dude ney Trail'), run('Grommit', 'expert'), run('97', 'advanced'), run('Upper Wishbone')], peaks: [] } as unknown as Resort
    applyCorrections(resort)
    expect(resort.runs.map((r) => r.name)).toEqual(['Dude-Ney Trail', 'Gromit', 'Highway 97', 'Upper Wishbone'])
    expect(resort.runs[3].difficulty).toBe('intermediate')
  })

  it('carries saved medals, bests and coverage across a rename', () => {
    const progress = emptyProgress()
    progress.medals = { 'time:Grommit': 'gold', 'slalom:Little Joe': 'silver' }
    progress.bests = { 'time:Grommit': 41.5 }
    progress.covered = { 'Dude ney Trail': 900 }
    renameRuns(progress)
    expect(progress.medals).toEqual({ 'time:Gromit': 'gold', 'slalom:Little Joe': 'silver' })
    expect(progress.bests).toEqual({ 'time:Gromit': 41.5 })
    expect(progress.covered).toEqual({ 'Dude-Ney Trail': 900 })
  })
})

describe('shadows', () => {
  it('auto is off on Low and on elsewhere; on and off override', () => {
    const auto = { ...DEFAULT_SETTINGS }
    expect(shadowsOn(auto, QUALITY.low)).toBe(false)
    expect(shadowsOn(auto, QUALITY.medium)).toBe(true)
    expect(shadowsOn(auto, QUALITY.high)).toBe(true)
    expect(shadowsOn({ ...auto, shadows: 'on' }, QUALITY.low)).toBe(true)
    expect(shadowsOn({ ...auto, shadows: 'off' }, QUALITY.high)).toBe(false)
  })
})
