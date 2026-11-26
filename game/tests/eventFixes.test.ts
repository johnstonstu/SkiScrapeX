/**
 * Event fixes from the 2026-11-25 playtest: the finish run-out, the
 * no-progress DNF, the auto-push out of the gate and
 * the groomed race track that flattens mapped moguls only while a race runs.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SkiInput, SkiState } from '../src/sim'
import { RUNOUT_MAX_SECONDS, RUNOUT_MIN_SECONDS, RUNOUT_STOP_SPEED, createRunout } from '../src/app/runout'
import { STALL_METRES, STALL_SECONDS, createSession } from '../src/app/session'
import { EVENTS, RACE_TRACK_MARGIN, RACE_TRACK_OPEN, buildEventCourse, raceTrack, type EventCourse } from '../src/world/events'
import { trackMask } from '../src/world/raceTrack'
import { buildMoguls } from '../src/world/moguls'
import { resortFromFeatures, type Point2, type Run } from '../src/world/resort'
import { buildSurface } from '../src/world/surface'
import { createSurfaceSampler } from '../src/world/snow'
import { createTerrainGrid } from '../src/world/terrainGrid'
import { loadApexWorld } from './apexWorld'

const DT = 1 / 60

describe('finish run-out', () => {
  it('brakes after the line and shows the result once below 10 km/h', () => {
    const runout = createRunout()
    let shown = 0
    runout.start(() => shown++)
    const input: SkiInput = { steer: 0.4, brake: 0, tuck: true, jump: true }
    runout.input(input)
    expect(input).toMatchObject({ brake: 1, tuck: false, jump: false })
    // Still fast: no result yet.
    for (let t = 0; t < 2; t += DT) expect(runout.step({ speed: 25 }, DT)).toBe(false)
    expect(shown).toBe(0)
    expect(runout.step({ speed: RUNOUT_STOP_SPEED - 0.1 }, DT)).toBe(true)
    expect(shown).toBe(1)
    expect(runout.active).toBe(false)
    // Over: the input is left alone again.
    const after: SkiInput = { steer: 0, brake: 0, tuck: true }
    runout.input(after)
    expect(after.tuck).toBe(true)
  })

  it('a slow finish still waits a moment, and a skier who cannot stop gets the result anyway', () => {
    const slow = createRunout()
    let done = false
    slow.start(() => (done = true))
    expect(slow.step({ speed: 0 }, RUNOUT_MIN_SECONDS / 2)).toBe(false)
    expect(slow.step({ speed: 0 }, RUNOUT_MIN_SECONDS)).toBe(true)
    expect(done).toBe(true)

    const fast = createRunout()
    let elapsed = 0
    let ended = false
    fast.start(() => (ended = true))
    while (!ended && elapsed < 20) {
      fast.step({ speed: 30 }, DT)
      elapsed += DT
    }
    expect(ended).toBe(true)
    expect(elapsed).toBeCloseTo(RUNOUT_MAX_SECONDS, 1)
  })

  it('a restart cancels the pending result', () => {
    const runout = createRunout()
    let shown = false
    runout.start(() => (shown = true))
    runout.cancel()
    expect(runout.step({ speed: 0 }, 10)).toBe(false)
    expect(shown).toBe(false)
  })
})

describe('no-progress DNF', () => {
  const line: Point2[] = [[100, 0], [100, 400]]
  const run: Run = { id: 'r', name: 'Straight', difficulty: 'intermediate', groomed: true, kind: 'line', parts: [line] }
  const skier = (z: number, speed: number) => ({ x: 100, y: 400 - z * 0.3, z, speed }) as unknown as SkiState

  it('ends a timed run that stops moving down the course', () => {
    const session = createSession({ kind: 'time', id: 'time:Straight', run, line, targets: null })
    // Move off the line to start the clock, then sit still (shuffling under STALL_METRES).
    session.step(skier(0, 2), DT)
    let stalledAt = -1
    for (let t = 0; t < STALL_SECONDS + 2 && stalledAt < 0; t += DT) {
      const events = session.step(skier(10 + Math.sin(t) * (STALL_METRES / 3), 2), DT)
      if (events.some((e) => e.type === 'stalled')) stalledAt = t
    }
    expect(stalledAt).toBeGreaterThan(STALL_SECONDS - 0.5)
    expect(stalledAt).toBeLessThan(STALL_SECONDS + 0.5)
    expect(session.finished).toBe(true)
  })

  it('never stalls a slow skier who keeps going down the course', () => {
    const session = createSession({ kind: 'time', id: 'time:Straight', run, line, targets: null })
    const events = []
    // 0.5 m/s for 2 minutes: 60 m in all, but always progressing.
    for (let i = 0; i < 120 * 60; i++) events.push(...session.step(skier(i * DT * 0.5, 2), DT))
    expect(events.some((e) => e.type === 'stalled')).toBe(false)
    expect(session.finished).toBe(false)
  })

  it('does not run before the clock starts (an event waits for GO)', () => {
    const def = EVENTS.find((d) => d.id === 'apex-slalom')!
    const course = { def, line, length: 400, gates: [], trap: null, splits: [] } as EventCourse
    const session = createSession({ kind: 'event', id: 'event:x', course, run, line, gates: [], targets: null })
    for (let t = 0; t < STALL_SECONDS * 2; t += DT) expect(session.step(skier(0, 0), DT)).toEqual([])
  })
})

describe('race tracks', () => {
  it('grooms the race formats, wide enough for the gates, and leaves the judged ones', () => {
    const course = (id: string) => ({ def: EVENTS.find((d) => d.id === id)!, line: [[0, 0], [0, 100]] }) as unknown as EventCourse
    const width = (id: string) => raceTrack(course(id))?.halfWidth ?? null
    expect(width('shoot-the-chute')).toBe(RACE_TRACK_OPEN)
    expect(width('apex-downhill')).toBe(6 + RACE_TRACK_MARGIN)
    expect(width('apex-slalom')).toBe(2.5 + 4 + RACE_TRACK_MARGIN)
    expect(width('teck-gs')).toBe(3 + 6 + RACE_TRACK_MARGIN)
    expect(raceTrack(course('kristis-moguls'))).toBeNull()
    for (const def of EVENTS.filter((d) => d.format === 'aerials')) expect(raceTrack(course(def.id))).toBeNull()
  })

  it('masks the band around the line and nothing past it', () => {
    const mask = trackMask([[0, 0], [0, 100], [50, 150]], 8)
    expect(mask.inside(0, 50)).toBe(true)
    expect(mask.inside(7, 50)).toBe(true)
    expect(mask.inside(10, 50)).toBe(false)
    expect(mask.inside(25, 125)).toBe(true)
    expect(mask.inside(0, -12)).toBe(false)
    expect(mask.inside(500, 500)).toBe(false)
  })

  // A 300 m slope with a mogul run down x = 150.
  const size = 61
  const heights = Float32Array.from({ length: size * size }, (_, i) => 100 - Math.floor(i / size) * 1.2)
  const grid = createTerrainGrid({ columns: size, rows: size, stepMetres: 5 }, heights)
  const resort = resortFromFeatures({ version: 1, runs: [] }, grid.heightAt)
  const surface = buildSurface(grid, resort)
  const runs: Run[] = [{ id: 'bumps', name: 'Bumps', difficulty: 'expert', groomed: false, moguls: true, kind: 'line', parts: [[[150, 25], [150, 250]]] }]

  it('flattens the moguls on the track while it is on and puts them back after', () => {
    const field = buildMoguls(grid, runs, surface)
    const all = field.bumps.length
    const bump = field.bumps.find((b) => b.z > 100 && b.z < 150)!
    const bumped = field.sampleTerrain(bump.x, bump.z)!.height
    const flat = grid.sampleTerrain(bump.x, bump.z)!.height
    expect(bumped - flat).toBeGreaterThan(0.4)
    // A track over the lower half of the run only.
    const mask = trackMask([[150, 100], [150, 260]], 12)
    const kept = field.clear((x, z) => mask.inside(x, z))
    expect(kept.length).toBeLessThan(all)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.every((b) => !mask.inside(b.x, b.z))).toBe(true)
    expect(field.sampleTerrain(bump.x, bump.z)!.height).toBeCloseTo(flat, 5)
    expect(field.onMogul(bump.x, bump.z)).toBe(false)
    // Free skiing again: every bump is back.
    expect(field.clear(null).length).toBe(all)
    expect(field.sampleTerrain(bump.x, bump.z)!.height).toBeCloseTo(bumped, 5)
  })

  it('rides the track as groomed snow while it is on', () => {
    let on = false
    const mask = trackMask([[150, 100], [150, 260]], 12)
    const sample = createSurfaceSampler(grid, surface, null, { groomedAt: (x, z) => on && mask.inside(x, z) })
    expect(sample(150, 150).kind).toBe('powder')
    on = true
    expect(sample(150, 150).kind).toBe('groomed')
    expect(sample(150, 40).kind).toBe('powder')
  })
})

const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

describe.skipIf(!hasData)('race tracks on the real map', () => {
  const world = hasData ? loadApexWorld() : null!
  const field = hasData ? buildMoguls(world.grid, world.resort.runs, world.surface) : null!
  const course = (id: string) => buildEventCourse(world.resort, EVENTS.find((d) => d.id === id)!)

  it('the Downhill track clears the Gunbarrel moguls off the race line, and free skiing gets them back', () => {
    const downhill = course('apex-downhill')
    const track = raceTrack(downhill)!
    const mask = trackMask(track.line, track.halfWidth)
    const onLine = field.bumps.filter((b) => mask.inside(b.x, b.z))
    // The playtest hit 20 takeoffs on this line.
    expect(onLine.length).toBeGreaterThan(50)
    const kept = field.clear((x, z) => mask.inside(x, z))
    expect(kept.length).toBe(field.bumps.length - onLine.length)
    // Walk the line: no bump rises under the racer anywhere along it.
    for (let i = 1; i < track.line.length; i++) {
      const [x, z] = track.line[i]
      expect(field.sampleTerrain(x, z)?.mogulHeight ?? 0).toBe(0)
    }
    expect(field.clear(null).length).toBe(field.bumps.length)
  })
})
