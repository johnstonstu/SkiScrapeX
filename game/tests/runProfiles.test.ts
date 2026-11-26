import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { isClear } from '../src/world/surface'
import { pointAlong, polylineLength, type Point2, type Run } from '../src/world/resort'

/**
 * Runs against the Apex research handoff's measurements
 * (docs/review/apex-terrain/run-profiles.json): pitch and length from the
 * LidarBC 2025 1 m DTM along the same lines, and the median canopy-free width
 * across each line. The game builds its runs from those lines on its own 2 m
 * grid, so pitches should agree closely; widths are compared more loosely
 * (see each test for why).
 */
const DATA = 'public/data/'
const PROFILES = '../docs/review/apex-terrain/run-profiles.json'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

interface Profile {
  name: string
  officialDifficulty: string
  geometry: string
  lengthM: number | null
  verticalM: number | null
  avgPitchDeg: number | null
  medianOpenWidthM: number | null
  edgeTreeDensity: number | null
  mogulsObserved?: boolean
  surfaceObserved?: string[] | null
}

const profiles: Profile[] = existsSync(PROFILES) ? JSON.parse(readFileSync(PROFILES, 'utf8')).runs : []
/** Names compared without apostrophes, "(part n)" or a trailing "Trail". */
const key = (name: string) => name.toLowerCase().replace(/\(part \d\)/, '').replace(/[^a-z0-9]/g, '').replace(/trail$/, '')

/** The game line a profile describes: same name, and the part whose length is nearest. */
function match(profile: Profile, runs: Run[]): { run: Run; line: Point2[]; lengthError: number } | null {
  let best: { run: Run; line: Point2[]; lengthError: number } | null = null
  for (const run of runs) {
    if (run.kind !== 'line' || key(run.name) !== key(profile.name)) continue
    for (const line of run.parts) {
      const lengthError = Math.abs(polylineLength(line) - profile.lengthM!) / profile.lengthM!
      if (!best || lengthError < best.lengthError) best = { run, line, lengthError }
    }
  }
  return best
}

/** Profiles of skiable lines (parks are the park layouts' business; glades have no line). */
const lines = profiles.filter((p) => p.lengthM && p.officialDifficulty !== 'park')

describe.skipIf(!hasData || !profiles.length)('runs against the LiDAR run profiles', () => {
  it('finds every profiled run in the game, on a line of the same length', () => {
    const { resort } = loadApexWorld()
    expect(lines.length).toBeGreaterThan(70)
    for (const profile of lines) {
      const found = match(profile, resort.runs)
      expect(found, profile.name).not.toBeNull()
      // Same OSM line or trace: lengths agree to the metre bar resampling.
      expect(found!.lengthError, profile.name).toBeLessThan(0.02)
    }
  }, 120000)

  it('matches the measured pitch of every run', () => {
    const { grid, resort } = loadApexWorld()
    for (const profile of lines) {
      const { line } = match(profile, resort.runs)!
      const drop = grid.heightAt(...line[0]) - grid.heightAt(...line[line.length - 1])
      const pitch = (Math.atan2(drop, polylineLength(line)) * 180) / Math.PI
      // Both come from LidarBC 2025 along the same line: the profile from the 1 m DTM,
      // the game from its 2 m grid. Endpoint heights differ by under a metre or two, which
      // on the shortest runs (about 130 m) is a few tenths of a degree, so 0.5° is the
      // whole budget. A run drawn the wrong way round, cut at the wrong place or moved
      // onto a different gully is off by degrees.
      expect(Math.abs(pitch - profile.avgPitchDeg!), `${profile.name}: ${pitch.toFixed(1)}° vs ${profile.avgPitchDeg}°`).toBeLessThan(0.5)
      expect(Math.abs(drop - profile.verticalM!), profile.name).toBeLessThan(4)
    }
  })

  it('keeps run corridors inside the measured clearings, and tree-lined runs close to them', () => {
    const { resort, surface } = loadApexWorld()
    let walled = 0
    for (const profile of lines) {
      if (profile.medianOpenWidthM == null) continue
      const { run, line } = match(profile, resort.runs)!
      // Gladed runs keep their trees: there is no corridor to measure.
      if (run.wooded) continue
      const width = medianClearWidth(line, (x, z) => isClear(surface, x, z))
      const lidar = profile.medianOpenWidthM
      const label = `${profile.name}: ${width} m in the game vs ${lidar} m open in the LiDAR`
      // Ceiling: a run cannot be wider than the gap in the trees. The game's edge is on a
      // 2.5 m raster (up to 2.5 m each side) and wanders with noise, and the profile's
      // width is a median over 30 m smoothed sections, so allow 15% plus three texels.
      expect(width, label).toBeLessThanOrEqual(lidar * 1.15 + 7.5)
      // Floor, only where trees wall the run (edge tree density 0.4 or more), so the
      // clearing is the run. Elsewhere the LiDAR gap includes open alpine either side
      // that the game leaves as off-piste powder, which is still skiable. The LiDAR was
      // flown in July: summer brush, run-outs and cut margins read as open, and winter
      // snow narrows the edges, so the groomed width is expected to be smaller. Half is
      // the least a tree-lined run should keep.
      if ((profile.edgeTreeDensity ?? 0) >= 0.4) {
        walled++
        expect(width, label).toBeGreaterThanOrEqual(lidar * 0.5)
      }
    }
    expect(walled).toBeGreaterThan(30)
  })

  it('puts moguls where the footage saw them and takes grooming off the ungroomed runs', () => {
    const { resort } = loadApexWorld()
    for (const profile of lines) {
      const runs = resort.runs.filter((run) => run.kind === 'line' && key(run.name) === key(profile.name))
      if (profile.mogulsObserved) for (const run of runs) expect(run.moguls, profile.name).toBe(true)
    }
    for (const name of ['Crusher', 'Hanks']) {
      const profile = profiles.find((p) => p.name === name)!
      expect(profile.surfaceObserved).toContain('ungroomed')
      for (const run of resort.runs.filter((r) => r.name === name)) expect(run.groomed, name).toBe(false)
    }
  })
})

/** Median width of the clear corridor across a line, every 20 m, in 1.25 m steps out to 80 m a side. */
function medianClearWidth(line: Point2[], clear: (x: number, z: number) => boolean): number {
  const length = polylineLength(line)
  const widths: number[] = []
  for (let d = 20; d < length - 20; d += 20) {
    const [x, z] = pointAlong(line, d)
    const [nx, nz] = pointAlong(line, d + 1)
    const span = Math.hypot(nx - x, nz - z) || 1
    const sx = (nz - z) / span, sz = -(nx - x) / span
    let width = 0
    for (const side of [-1, 1]) {
      for (let s = 0; s < 80; s += 1.25) {
        if (!clear(x + sx * side * s, z + sz * side * s)) break
        width += 1.25
      }
    }
    widths.push(width)
  }
  if (!widths.length) return 0
  widths.sort((a, b) => a - b)
  return widths[Math.floor(widths.length / 2)]
}
