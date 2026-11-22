import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyCorrections, buildingName } from '../src/world/corrections'
import { OVERLAY_RUNS } from '../src/world/runOverlay'
import { resortFromFeatures, type Resort } from '../src/world/resort'
import { loadDiskGrid } from './diskGrid'

describe('Apex corrections', () => {
  it('fixes building names', () => {
    expect(buildingName('The Gunbarell Saloon')).toBe('Gunbarrel Saloon')
    expect(buildingName('Apex Mtn Inn')).toBe('Apex Mountain Inn')
    expect(buildingName('Ticket Office')).toBe('Ticket Office')
    expect(buildingName(null)).toBeNull()
  })

  it('applies official difficulty and adds Apex Mountain', () => {
    const resort = { runs: [{ id: 'a', name: 'Upper Wishbone', difficulty: 'easy', groomed: true, kind: 'line', parts: [] }], peaks: [] } as unknown as Resort
    applyCorrections(resort)
    expect(resort.runs[0].difficulty).toBe('intermediate')
    expect(resort.peaks.map((p) => p.name)).toContain('Apex Mountain')
    applyCorrections(resort)
    expect(resort.peaks.filter((p) => p.name === 'Apex Mountain')).toHaveLength(1)
  })

  it('names the traced runs the trail maps confirm', () => {
    const byRef = Object.fromEntries(OVERLAY_RUNS.map((run) => [run.ref, run]))
    expect(byRef.L8.name).toBe('Highway 97C')
    expect(byRef.L8.difficulty).toBe('intermediate')
    expect(byRef.L12.name).toBe('Mini-Colorado')
    expect(byRef.L12.difficulty).toBe('expert')
  })

  const DATA = 'public/data/'
  it.skipIf(!existsSync(`${DATA}features.json`))('OSM difficulties agree with the official list after corrections', () => {
    const grid = loadDiskGrid(DATA)
    const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
    applyCorrections(resort)
    const rating = (name: string) => resort.runs.find((run) => run.name === name)?.difficulty
    // Spot checks against Wikipedia's list by lift.
    expect(rating('Upper Wishbone')).toBe('intermediate')
    expect(rating('Gunbarrel')).toBe('expert')
    expect(rating('Okanagan Run')).toBe('intermediate')
    expect(rating("Grandfather's Trail")).toBe('easy')
  }, 30000)
})
