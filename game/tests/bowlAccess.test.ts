import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { buildMoguls } from '../src/world/moguls'
import { createSurfaceSampler } from '../src/world/snow'
import { polylineLength, type Point2, type Run } from '../src/world/resort'
import { OVERLAY_RUNS } from '../src/world/runOverlay'
import { FIXED_DT, createSkiState, stepSkier, type SkiEnv } from '../src/sim'

/**
 * The Quickdraw bowl (Chaser, Toilet Bowl, Essendale Ward 1 and 2) has to be
 * reachable from the top of the chair without poling. A bot skis from the
 * Quickdraw top down Grandmother's Trail to each run's top and on down the run;
 * no pushing, so stalling anywhere fails. (Stu, 2026-11-27: the bowl runs were
 * "hard to get to from the top of the chair".)
 */
const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

const BOWL = ['Chaser', 'Toilet Bowl', 'Essendale Ward 1', 'Essendale Ward 2']

/** The drawn way in to a run: its entry traverse, after the entry of the run that traverse leaves from. */
function approach(name: string): Point2[] {
  const run = OVERLAY_RUNS.find((r) => r.name === name)!
  if (!run.entry) return []
  const from = OVERLAY_RUNS.find((r) => r !== run && r.points[0][0] === run.entry![0][0] && r.points[0][1] === run.entry![0][1])
  return [...(from ? approach(from.name) : []), ...run.entry]
}

/** Grandmother's from the top to the point nearest the run's way in, then the way in and the run. */
function route(ridge: Point2[], run: Point2[]): Point2[] {
  let cut = 0
  let best = Infinity
  ridge.forEach(([x, z], i) => {
    const d = Math.hypot(x - run[0][0], z - run[0][1])
    if (d < best) ((best = d), (cut = i))
  })
  return [...ridge.slice(0, cut + 1), ...run]
}

describe.skipIf(!hasData)('Quickdraw bowl access', () => {
  const world = hasData ? loadApexWorld() : null

  it('starts every bowl run close to the chair', () => {
    const { resort } = world!
    const top = resort.lifts.find((l) => l.name === 'Quickdraw')!.top
    for (const name of BOWL) {
      const run = resort.runs.find((r) => r.name === name)!
      // Where you leave the ridge for the run (its top, or the start of its way in).
      const [x, z] = [...approach(name), ...run.parts[0]][0]
      // Within 420 m of the chair: the old drafts started 530 to 620 m away, past the ridge flat.
      expect(Math.hypot(x - top[0], z - top[1]), name).toBeLessThan(420)
    }
  })

  it('reaches the bottom of every bowl run from the chair without pushing', () => {
    const { grid, resort, surface, canopy } = world!
    const { sampleTerrain, onMogul } = buildMoguls(grid, resort.runs, surface)
    const env: SkiEnv = { sampleSurface: createSurfaceSampler(grid, surface, canopy, { onMogul }) }
    const ridge = resort.runs.find((r) => r.name === "Grandmother's Trail")!.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
    for (const name of BOWL) {
      const run = resort.runs.find((r: Run) => r.name === name)!
      const line = route(ridge, [...approach(name), ...run.parts[0]])
      const end = line[line.length - 1]
      const s = createSkiState({ x: line[0][0], z: line[0][1], heading: Math.atan2(-(line[3][0] - line[0][0]), line[3][1] - line[0][1]) })
      s.y = sampleTerrain(line[0][0], line[0][1])!.height
      let reached = false
      let slowest = Infinity
      let topSpeed = 0
      let passedTop = false
      for (let t = 0; t < 240 && !reached; t += FIXED_DT) {
        let k = 0
        let near = Infinity
        line.forEach(([x, z], i) => {
          const d = (x - s.x) ** 2 + (z - s.z) ** 2
          if (d < near) ((near = d), (k = i))
        })
        for (let ahead = 0; k < line.length - 1 && ahead < 25; k++) ahead += Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])
        const want = Math.atan2(-(line[k][0] - s.x), line[k][1] - s.z)
        const error = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading))
        const steer = s.grounded ? Math.max(-1, Math.min(1, error * 2.5)) : 0
        stepSkier(s, { steer, brake: s.speed > 16 ? 0.7 : 0, tuck: s.speed < 11 }, sampleTerrain, FIXED_DT, env)
        if (t > 5) slowest = Math.min(slowest, s.speed)
        if (!passedTop && Math.hypot(s.x - run.parts[0][0][0], s.z - run.parts[0][0][1]) < 25) ((passedTop = true), (topSpeed = s.speed))
        reached = Math.hypot(end[0] - s.x, end[1] - s.z) < 15
      }
      console.log(`${name.padEnd(18)} top ${(topSpeed * 3.6).toFixed(0)} km/h, slowest ${(slowest * 3.6).toFixed(0)} km/h, ${reached ? 'reached the bottom' : 'stalled'}`)
      expect(passedTop, name).toBe(true)
      expect(reached, name).toBe(true)
      // Still moving at a walking pace or better all the way (no poling needed).
      expect(slowest, name).toBeGreaterThan(1.5)
    }
  }, 120000)
})
