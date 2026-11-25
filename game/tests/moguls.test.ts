import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, stepSkier, type SampleTerrain, type TrickEvent } from '../src/sim'
import { EARLIEST, GOOD, MISS_DROP, OUT_AFTER, PERFECT, START_SPEED, TOP_SPEED, createMogulRun, createTapReader } from '../src/app/moguls'
import { bestTwo, degreeOfDifficulty, formScore, judgeJump } from '../src/app/judging'
import { bumpField } from '../src/world/moguls'
import { buildMogulCourse, laneCoords, laneHeading, lanePoint, TURN_PITCH } from '../src/world/mogulCourse'
import { EVENTS, buildEventCourse } from '../src/world/events'
import { buildParkOverlay, parkSitesFromLines, placeFeatures } from '../src/world/park'
import { headingFor, resortFromFeatures } from '../src/world/resort'
import { progressAlong } from '../src/world/challenges'
import { steerToward } from '../src/app/race'
import { loadDiskGrid } from './diskGrid'
import { applyCorrections } from '../src/world/corrections'

const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`)

/** A 200 m lane due south. */
const lane = buildMogulCourse([0, 0], [0, 200])
const trick = (over: Partial<TrickEvent>): TrickEvent => ({
  seq: 1, kind: 'air', name: 'Air', points: 100, grade: 'clean', efh: 1, airTime: 1, spinDeg: 0, flips: 0, grab: null, grabTime: 0, switchLanding: false, railMetres: 0, ...over,
})

describe('mogul course', () => {
  it('alternates turns one bump apart, with none through the two airs', () => {
    expect(lane.airs).toHaveLength(2)
    lane.turns.forEach((turn, i) => {
      if (i) expect(turn.dir).toBe(-lane.turns[i - 1].dir)
      for (const air of lane.airs) expect(turn.s < air.s - 9 || turn.s > air.s + 15).toBe(true)
    })
    const gaps = lane.turns.slice(1).map((t, i) => t.s - lane.turns[i].s)
    expect(Math.min(...gaps)).toBeCloseTo(TURN_PITCH)
  })

  it('lane coordinates round-trip', () => {
    const [x, z] = lanePoint(lane, 50, 1.2)
    const back = laneCoords(lane, x, z)
    expect(back.s).toBeCloseTo(50)
    expect(back.lateral).toBeCloseTo(1.2)
  })
})

describe('mogul rhythm', () => {
  /** Ride straight down at `speed`, tapping each turn `early` seconds before its beat (or never). */
  function ride(speed: number, tapAt: (index: number) => number | null, wrongWay = false) {
    const run = createMogulRun(lane)
    const events: string[] = []
    let index = 0
    for (let s = 0; s < 200 && !run.out; s += speed * 0.01) {
      const turn = lane.turns[index]
      const early = turn ? tapAt(index) : null
      let tap: -1 | 0 | 1 = 0
      if (turn && early !== null && (turn.s - s) / speed <= early) tap = (wrongWay ? -turn.dir : turn.dir) as -1 | 1
      for (const e of run.step(s, speed, tap)) {
        events.push(e.type === 'turn' ? e.grade : e.type)
        if (e.type === 'turn') index++
      }
    }
    return { run, events }
  }

  it('taps on the beat are perfect, a little off are good, further off are off beat', () => {
    expect(ride(8, () => PERFECT / 2).events.every((e) => e === 'perfect')).toBe(true)
    expect(ride(8, () => (PERFECT + GOOD) / 2).events.every((e) => e === 'good')).toBe(true)
    expect(ride(8, () => (GOOD + EARLIEST) / 2).events.every((e) => e === 'off')).toBe(true)
  })

  it('good turns raise the speed to the top; a miss drops it', () => {
    const { run } = ride(8, () => 0)
    expect(run.targetSpeed).toBe(TOP_SPEED)
    expect(run.bestStreak).toBe(lane.turns.length)
    const missy = createMogulRun(lane)
    // Ten good turns, then let one go by.
    let s = 0
    for (let i = 0; i < 10; i++) {
      s = lane.turns[i].s
      missy.step(s, 8, lane.turns[i].dir)
    }
    const before = missy.targetSpeed
    expect(before).toBeGreaterThan(START_SPEED)
    const after = missy.step(lane.turns[10].s + 8 * (GOOD + 0.05), 8, 0)
    expect(after[0]).toMatchObject({ type: 'turn', grade: 'miss' })
    expect(missy.targetSpeed).toBeCloseTo(before - MISS_DROP)
    expect(missy.streak).toBe(0)
  })

  it(`${OUT_AFTER} misses in a row (or the wrong way) put you out of the line`, () => {
    const never = ride(8, () => null)
    expect(never.events).toEqual([...Array(OUT_AFTER).fill('miss'), 'out'])
    expect(never.run.out).toBe(true)
    expect(ride(8, () => 0, true).events.slice(0, OUT_AFTER + 1)).toEqual([...Array(OUT_AFTER).fill('miss'), 'out'])
  })

  it('a tap long before the beat is not taken for that turn', () => {
    const run = createMogulRun(lane)
    const first = lane.turns[0]
    expect(run.step(first.s - 8 * (EARLIEST + 0.2), 8, first.dir)).toEqual([])
  })

  it('scores turns 60, air 20, speed 20', () => {
    const { run } = ride(9, () => 0)
    run.addAir(trick({ grade: 'perfect', flips: 1 }))
    run.addAir(trick({ grade: 'perfect', flips: 1, spinDeg: 360 }))
    const full = run.score(200 / 9.5)
    expect(full.turns).toBe(60)
    expect(full.air).toBeGreaterThan(15)
    expect(full.air).toBeLessThanOrEqual(20)
    expect(full.speed).toBe(20)
    expect(full.total).toBeCloseTo(full.turns + full.air + full.speed, 1)
    const slow = run.score(200 / 4)
    expect(slow.speed).toBe(0)
  })

  it('reads a tap once per press of a direction', () => {
    const tap = createTapReader()
    expect([0, 0.5, 0.9, 1, 0.2, -0.6, -1, 0, 0.4].map(tap)).toEqual([0, 1, 0, 0, 0, -1, 0, 0, 1])
  })
})

describe('judging jumps', () => {
  it('degree of difficulty from flips, spins and a grab; form from the landing', () => {
    expect(degreeOfDifficulty(trick({}))).toBe(1)
    expect(degreeOfDifficulty(trick({ flips: 1 }))).toBe(1.6)
    expect(degreeOfDifficulty(trick({ flips: 2, spinDeg: 720, grab: 'mute' }))).toBe(2.9)
    expect(formScore(trick({ grade: 'perfect' }))).toBe(9.5)
    expect(formScore(trick({ grade: 'perfect', grab: 'mute', grabTime: 0.5 }))).toBe(10)
    expect(formScore(trick({ grade: 'crash', grab: 'mute', grabTime: 0.5 }))).toBe(0)
  })
  it('the two best jumps count', () => {
    const jumps = [trick({ grade: 'clean' }), trick({ grade: 'perfect', flips: 1 }), trick({ grade: 'sketchy', flips: 1 })].map(judgeJump)
    expect(bestTwo(jumps).map((j) => j.score)).toEqual([15.2, 8])
  })
})

describe.skipIf(!hasData)('mogul comp and aerials on the real map', () => {
  const grid = loadDiskGrid(DATA)
  const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
  // The game renames, merges and splits runs on load; events must find them by those names.
  applyCorrections(resort)

  it("the comp lane lies along Kristi's steady pitch", () => {
    const course = buildEventCourse(resort, EVENTS.find((e) => e.format === 'moguls')!)
    const mc = course.moguls!
    const kristis = resort.runs.find((r) => r.name === "Kristi's Run")!.parts[0]
    for (let s = 0; s <= mc.length; s += 10) {
      const [x, z] = lanePoint(mc, s, 0)
      expect(progressAlong(x, z, kristis).off).toBeLessThan(8)
    }
    const [x0, z0] = mc.line[0]
    const [x1, z1] = mc.line[1]
    const pitch = (Math.atan((grid.heightAt(x0, z0) - grid.heightAt(x1, z1)) / mc.length) * 180) / Math.PI
    expect(pitch).toBeGreaterThan(17)
    expect(pitch).toBeLessThan(28)
  })

  it('perfect taps carry the autopilot down the whole comp: no crash, top speed, air off both ramps', () => {
    const mc = buildEventCourse(resort, EVENTS.find((e) => e.format === 'moguls')!).moguls!
    const field = bumpField(mc.bumps)
    const terrain: SampleTerrain = (x, z) => {
      const base = grid.sampleTerrain(x, z)
      return base ? field.apply(base, x, z) : base
    }
    const run = createMogulRun(mc)
    const sk = createSkiState({ x: mc.line[0][0], z: mc.line[0][1], heading: laneHeading(mc) })
    sk.y = terrain(sk.x, sk.z)!.height
    const airs: number[] = []
    let worstLateral = 0
    let seen = 0
    for (let t = 0; t < 90; t += FIXED_DT) {
      const { s, lateral } = laneCoords(mc, sk.x, sk.z)
      if (s >= mc.length - 2) break
      const next = mc.turns[run.grades.length]
      const tap = next && !run.inAirZone(s) && (next.s - s) / Math.max(sk.speed, 1) <= 0.02 ? next.dir : 0
      run.step(s, sk.speed, tap)
      // Pop at the lip, as a player holds jump on the run-in and lets go there.
      const popping = mc.airs.some((a) => s > a.s - 8 && s < a.s - 0.6)
      stepSkier(sk, { ...run.drive(sk, s), jump: popping }, terrain, FIXED_DT)
      if (sk.trick && sk.trick.seq !== seen) {
        seen = sk.trick.seq
        if (sk.trick.kind === 'air') airs.push(sk.trick.airTime)
      }
      expect(sk.mode, `s ${s.toFixed(0)}`).not.toBe('crashed')
      worstLateral = Math.max(worstLateral, Math.abs(lateral))
    }
    expect(run.grades.every((g) => g === 'perfect')).toBe(true)
    expect(run.grades.length).toBe(mc.turns.length)
    expect(run.targetSpeed).toBe(TOP_SPEED)
    expect(worstLateral).toBeLessThan(2)
    expect(airs.filter((a) => a > 0.7)).toHaveLength(2)
  }, 60000)

  it('the Aerial Site in its aerial layout launches a skier into judged airs', () => {
    const site = parkSitesFromLines(resort.parks).find((p) => p.name === 'Aerial Site')!
    const features = placeFeatures(site, 'aerial')
    const overlay = buildParkOverlay(features, grid.sampleTerrain, grid.heightAt)
    // Ski the biggest kicker of each row (rows are a few metres apart along the park), at its comfortable lip speed.
    const along = (f: (typeof features)[number]) => progressAlong(f.x, f.z, site.line).s
    const kickers = features.filter((f) => f.spec.kind === 'kicker').sort((a, b) => along(a) - along(b))
    const rows: (typeof kickers)[] = []
    for (const k of kickers) {
      const row = rows.find((r) => Math.abs(along(r[0]) - along(k)) < 8)
      if (row) row.push(k)
      else rows.push([k])
    }
    const picks = rows.map((r) => r.reduce((a, b) => ((b.spec.height ?? 0) > (a.spec.height ?? 0) ? b : a)))
    const route = picks.flatMap((f) => {
      const speed = f.spec.speed ? (f.spec.speed[0] + f.spec.speed[1]) / 2 / 3.6 : 12
      return [
        { x: f.x - f.dirX * 14, z: f.z - f.dirZ * 14, speed },
        { x: f.x + f.dirX * (f.footprint + 4), z: f.z + f.dirZ * (f.footprint + 4), speed },
      ]
    })
    const [sx, sz] = site.line[0]
    const sk = createSkiState({ x: sx, z: sz, heading: headingFor(route[0].x - sx, route[0].z - sz) })
    sk.y = overlay.sampleTerrain(sx, sz)!.height
    const jumps: number[] = []
    let seen = 0
    let target = 0
    for (let t = 0; t < 60 && target < route.length; t += FIXED_DT) {
      const { x: tx, z: tz, speed } = route[target]
      if (Math.hypot(tx - sk.x, tz - sk.z) < 5 || progressAlong(sk.x, sk.z, site.line).s > progressAlong(tx, tz, site.line).s + 2) target++
      stepSkier(sk, { steer: sk.grounded ? steerToward(sk, tx, tz) : 0, brake: sk.speed > speed + 0.5 ? 0.6 : 0, tuck: sk.speed < speed - 0.5 }, overlay.sampleTerrain, FIXED_DT, { rails: overlay.rails })
      if (sk.trick && sk.trick.seq !== seen) {
        seen = sk.trick.seq
        if (sk.trick.kind === 'air') jumps.push(judgeJump(sk.trick).score)
      }
    }
    expect(picks.length).toBeGreaterThanOrEqual(3)
    expect(jumps.length).toBeGreaterThanOrEqual(2)
    expect(bestTwo(jumps.map((score) => ({ name: '', dd: 1, form: score, score })))[1].score).toBeGreaterThan(0)
  }, 60000)
})
