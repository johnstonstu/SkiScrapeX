import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyCorrections, buildingName, DROPPED_BUILDINGS, SUMMIT_HUT_FOOTPRINT } from '../src/world/corrections'
import { placeHut } from '../src/world/village'
import { createTerrainGrid } from '../src/world/terrainGrid'
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

  it('leaves one building on the summit: the Billy Goat Hut footprint', () => {
    const square = (x: number) => [{ x, z: 0 }, { x: x + 5, z: 0 }, { x: x + 5, z: 5 }, { x, z: 5 }]
    const ids = [SUMMIT_HUT_FOOTPRINT, ...DROPPED_BUILDINGS, 'way/1']
    const resort = { runs: [], peaks: [], buildings: ids.map((id, i) => ({ id, points: square(i * 10) })) } as unknown as Resort
    applyCorrections(resort)
    expect(resort.buildings.map((b) => b.id)).toEqual([SUMMIT_HUT_FOOTPRINT, 'way/1'])
  })

  it('puts the hut on its footprint, door toward the lift top', () => {
    const grid = createTerrainGrid({ columns: 21, rows: 21, stepMetres: 5 }, new Float32Array(21 * 21).fill(500))
    const lift = { name: 'Quickdraw', top: [50, 20], bottom: [50, 90] } as never
    const hut = placeHut([lift], [], grid, [[20, 20], [26, 20], [26, 26], [20, 26]])
    expect(hut?.x).toBeCloseTo(23)
    expect(hut?.z).toBeCloseTo(23)
    // Same door convention as the free placement (atan2 of the offset to the lift top).
    expect(Math.sin(hut!.heading)).toBeLessThan(0)
  })

  it('applies official difficulty and adds Apex Mountain', () => {
    const resort = { runs: [{ id: 'a', name: 'Upper Wishbone', difficulty: 'easy', groomed: true, kind: 'line', parts: [] }], peaks: [] } as unknown as Resort
    applyCorrections(resort)
    expect(resort.runs[0].difficulty).toBe('intermediate')
    expect(resort.peaks.map((p) => p.name)).toContain('Apex Mountain')
    applyCorrections(resort)
    expect(resort.peaks.filter((p) => p.name === 'Apex Mountain')).toHaveLength(1)
  })

  it('renames OSM spellings that the grooming report uses', () => {
    const resort = {
      runs: [
        { id: '1', name: 'Westbank', difficulty: 'advanced', groomed: true, kind: 'line', parts: [] },
        { id: '2', name: "Kristi's", difficulty: 'intermediate', groomed: true, kind: 'line', parts: [] },
        { id: '3', name: "Greenhorn's Traverse", difficulty: 'easy', groomed: true, kind: 'line', parts: [] },
      ],
      peaks: [],
    } as unknown as Resort
    applyCorrections(resort)
    expect(resort.runs.map((run) => run.name)).toEqual(['West Bank', "Kristi's Run", 'Greenhorn Traverse'])
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
    expect(rating('Wishbone')).toBe('intermediate')
    expect(rating("Grandmother's Trail")).toBe('intermediate')
    expect(rating('Gunbarrel')).toBe('expert')
    expect(rating('Okanagan Run')).toBe('intermediate')
    expect(rating("Grandfather's Trail")).toBe('easy')
  }, 30000)
})
