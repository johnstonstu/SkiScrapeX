import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { buildMoguls } from '../src/world/moguls'
import { createSurfaceSampler } from '../src/world/snow'
import { nearestOnPolyline, pointInRing, type Point2, type Run } from '../src/world/resort'
import { FIXED_DT, createSkiState, stepSkier, type SkiEnv } from '../src/sim'

/**
 * The whole mountain is skiable (Stu, 2026-11-28: "make sure that there is a
 * full skiable mountain"). Every run's line starts on a lift top or another run
 * and ends on a lift bottom or another run, and a bot skis the lift-line and
 * bowl runs off the top of Quickdraw to their bottoms without poling.
 */
const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

/** Gaps where a line meets the network, metres. */
const JOIN = 30
/** Unnamed LiDAR cuts in side valleys that nothing maps a way into yet (docs/run-names.md). */
const LOOSE_TOPS = new Set(['Unnamed cut L3', 'Unnamed cut L7', 'Unnamed cut L13'])
/** Village roads that end at a car park, not a lift. */
const LOOSE_ENDS = new Set(['Strayhorse Trail'])

function distanceTo(p: Point2, line: Point2[]): number {
  return Math.sqrt(nearestOnPolyline(p[0], p[1], line).distanceSq)
}

describe.skipIf(!hasData)('whole mountain', () => {
  const world = hasData ? loadApexWorld() : null

  it('every run joins the network at both ends', () => {
    const { resort, grid } = world!
    const lines = resort.runs.filter((run) => run.kind === 'line' && !run.glade)
    const tops = resort.lifts.map((lift) => lift.top)
    const bottoms = resort.lifts.map((lift) => lift.bottom)
    const others = (run: Run) => lines.filter((other) => other !== run).flatMap((other) => other.parts)
    const loose: string[] = []
    for (const run of lines) {
      const line = run.parts[0]
      const [start, end] = [line[0], line[line.length - 1]]
      const startJoined = tops.some((t) => Math.hypot(t[0] - start[0], t[1] - start[1]) < 60) || others(run).some((part) => distanceTo(start, part) < JOIN) || run.parts.slice(1).some((part) => distanceTo(start, part) < JOIN)
      const endJoined = bottoms.some((b) => Math.hypot(b[0] - end[0], b[1] - end[1]) < 80) || others(run).some((part) => distanceTo(end, part) < JOIN) || run.parts.slice(1).some((part) => distanceTo(end, part) < 1)
      if (!startJoined && !LOOSE_TOPS.has(run.name)) loose.push(`${run.name} top ${start.map(Math.round)}`)
      if (!endJoined && !LOOSE_ENDS.has(run.name)) loose.push(`${run.name} bottom ${end.map(Math.round)} (${Math.round(grid.heightAt(end[0], end[1]))} m)`)
    }
    expect(loose).toEqual([])
  })

  it('puts Hidden Gold below the Stock\'s top, with its run inside the glade (2023 trail map)', () => {
    const { resort } = world!
    const line = resort.runs.find((run) => run.name === 'Hidden Gold' && run.kind === 'line')
    const glade = resort.runs.find((run) => run.name === 'Hidden Gold' && run.kind === 'area')
    expect(line && glade).toBeTruthy()
    expect(line!.wooded).toBe(true)
    expect(line!.groomed).toBe(false)
    const top = resort.lifts.find((lift) => lift.name.startsWith('Stock'))!.top
    const start = line!.parts[0][0]
    expect(Math.hypot(start[0] - top[0], start[1] - top[1])).toBeLessThan(60)
    // The glade lies downhill (east) of the top station, not in the bowl run-out west of it.
    for (const [x] of glade!.parts[0]) expect(x).toBeGreaterThan(top[0])
    const inside = line!.parts[0].filter(([x, z]) => pointInRing(x, z, glade!.parts[0])).length
    expect(inside).toBeGreaterThanOrEqual(line!.parts[0].length - 2)
  })

  /** Ski `line` with a steering bot (no poling); how it went. */
  function ski(line: Point2[]) {
    const { grid, resort, surface, canopy } = world!
    const { sampleTerrain, onMogul } = (mogulCache ??= buildMoguls(grid, resort.runs, surface))
    const env: SkiEnv = { sampleSurface: createSurfaceSampler(grid, surface, canopy, { onMogul }) }
    const end = line[line.length - 1]
    const s = createSkiState({ x: line[0][0], z: line[0][1], heading: Math.atan2(-(line[2][0] - line[0][0]), line[2][1] - line[0][1]) })
    s.y = sampleTerrain(line[0][0], line[0][1])!.height
    let reached = false
    let stalled = 0
    let crashes = 0
    let wasCrashed = false
    let topSpeed = 0
    let k = 0
    for (let t = 0; t < 500 && !reached; t += FIXED_DT) {
      // Nearest route point at or after the last one (routes can cross themselves).
      let near = Infinity
      for (let i = k; i < Math.min(line.length, k + 30); i++) {
        const d = (line[i][0] - s.x) ** 2 + (line[i][1] - s.z) ** 2
        if (d < near) ((near = d), (k = i))
      }
      let j = k
      for (let ahead = 0; j < line.length - 1 && ahead < 25; j++) ahead += Math.hypot(line[j + 1][0] - line[j][0], line[j + 1][1] - line[j][1])
      const want = Math.atan2(-(line[j][0] - s.x), line[j][1] - s.z)
      const error = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading))
      const steer = s.grounded ? Math.max(-1, Math.min(1, error * 2.5)) : 0
      stepSkier(s, { steer, brake: s.speed > 15 ? 0.8 : 0, tuck: s.speed < 8 }, sampleTerrain, FIXED_DT, env)
      if (t > 5 && s.speed < 1) stalled += FIXED_DT
      if (s.crashed > 0 && !wasCrashed) crashes++
      wasCrashed = s.crashed > 0
      topSpeed = Math.max(topSpeed, s.speed)
      reached = k >= line.length - 3 && Math.hypot(end[0] - s.x, end[1] - s.z) < 20
    }
    return { reached, stalled, crashes, topSpeed, at: [Math.round(s.x), Math.round(s.z)] }
  }
  let mogulCache: ReturnType<typeof buildMoguls> | null = null

  /** A way down from the Quickdraw top: each run in turn, left where it comes nearest the next one's top. */
  function chain(names: string[]): Point2[] {
    const { resort } = world!
    const lines = names.map((name) => {
      const run = resort.runs.find((r) => r.name === name)
      if (!run) throw new Error(name)
      return run.parts[0]
    })
    // Densify so the bot's look-ahead walks along each line.
    const dense = (line: Point2[]) => line.flatMap((p, i) => {
      if (i === 0) return [p]
      const [a, b] = [line[i - 1], p]
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 5))
      return Array.from({ length: n }, (_, u) => [a[0] + ((b[0] - a[0]) * (u + 1)) / n, a[1] + ((b[1] - a[1]) * (u + 1)) / n] as Point2)
    })
    let route = dense(lines[0])
    for (const next of lines.slice(1).map(dense)) {
      let cut = 0
      route.forEach(([x, z], i) => {
        if (Math.hypot(x - next[0][0], z - next[0][1]) < Math.hypot(route[cut][0] - next[0][0], route[cut][1] - next[0][1])) cut = i
      })
      route = [...route.slice(0, cut + 1), ...next]
    }
    return route
  }

  const ROUTES: string[][] = [
    // Off the unload: the lift line, its neighbours and Ridge Run's drops.
    ['West Bank'],
    ['Grouse Gulch'],
    ['Ridge Run'],
    ['Ridge Run', 'The Pit'],
    ['Ridge Run', 'Mini-Colorado'],
    ['Ridge Run', 'Sunbowl'],
    // The bowl, down to the top of Stock's.
    ['Golden Eagle'],
    ['The Great Wall'],
    ["Grandmother's Trail", 'Crusher'],
    ["Grandmother's Trail", 'Toilet Bowl'],
    // The Wild Side: Grandmother's to the Hang 'em High ridge, then down a run.
    ["Grandmother's Trail", "Upper Hang 'em High", 'Tooth Tusk'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'Sweet Sue'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'Jackpot'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'Wildly Easy'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'Gun Slinger'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'ShootOut'],
    ["Grandmother's Trail", "Upper Hang 'em High", 'Showdown'],
    ["Grandmother's Trail", "Upper Hang 'em High", "Bob's Run"],
    ["Grandmother's Trail", "Upper Hang 'em High", "Lower Hang 'em High"],
  ]

  it('skis every way down from the top of Quickdraw without poling', () => {
    const results: string[] = []
    const failed: string[] = []
    for (const names of ROUTES) {
      const r = ski(chain(names))
      const label = names.join(' > ')
      results.push(`${r.reached && r.stalled < 3 ? 'ok     ' : 'STOPPED'} ${label}: top ${(r.topSpeed * 3.6).toFixed(0)} km/h, stalled ${r.stalled.toFixed(1)} s, crashes ${r.crashes}, ended ${r.at}`)
      if (!r.reached || r.stalled >= 3) failed.push(results.at(-1)!)
    }
    console.log(results.join('\n'))
    expect(failed).toEqual([])
  }, 600000)
})
