import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, stepSkier, type SampleTerrain } from '../src/sim'
import { createSession, type Challenge } from '../src/app/session'
import { aimGate, assistSteer, gateAim, steerToward } from '../src/app/race'
import { progressAlong } from '../src/world/challenges'
import { EVENTS, buildEventCourse, matchDelta, paceRoute, raceGates, stitch, type EventCourse, type EventDef } from '../src/world/events'
import { headingFor, pointAlong, polylineLength, resortFromFeatures, type Point2, type Resort } from '../src/world/resort'
import { loadDiskGrid } from './diskGrid'

const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`)

function eventChallenge(course: EventCourse, firstRun?: number): Extract<Challenge, { kind: 'event' }> {
  const run = { id: course.def.id, name: course.def.name, difficulty: null, groomed: true, kind: 'line' as const, parts: [course.line] }
  return { kind: 'event', id: `event:${course.def.id}`, course, run, line: course.line, gates: course.gates, targets: null, firstRun }
}

/**
 * Race the course with a keyboard-style racer: before each gate it presses
 * full left or right toward the gate (no fine steering), and the racing line
 * assist does the rest, as for a player. Without gates it steers at the
 * point 12 m along the line. Returns every session event and the session.
 */
function race(course: EventCourse, terrain: SampleTerrain, cap: number, assisted = true) {
  const session = createSession(eventChallenge(course))
  session.startClock() // GO from the start gate
  const route = paceRoute(course)
  const offset = course.def.gates.kind === 'none' ? 0 : course.def.gates.offset
  const [x0, z0] = route[0]
  const s = createSkiState({ x: x0, z: z0, heading: headingFor(route[1][0] - x0, route[1][1] - z0) })
  s.y = terrain(x0, z0)!.height
  const events: ReturnType<typeof session.step> = []
  for (let t = 0; t < 400 && !session.finished; t += FIXED_DT) {
    const ahead = progressAlong(s.x, s.z, course.line).s
    const gate = aimGate(course.gates, session.nextGate, ahead)
    let steer: number
    if (gate) {
      const [ax, az] = gateAim(gate, offset)
      const ideal = steerToward(s, ax, az)
      const tap = Math.abs(ideal) > 0.08 ? Math.sign(ideal) : 0
      steer = assisted ? assistSteer(tap, ideal) : tap
    } else {
      const [tx, tz] = pointAlong(course.line, ahead + 12)
      steer = steerToward(s, tx, tz)
    }
    stepSkier(s, { steer: s.grounded ? steer : 0, brake: s.speed > cap ? 0.7 : 0, tuck: s.speed < cap * 0.7 }, terrain, FIXED_DT)
    events.push(...session.step(s, FIXED_DT))
  }
  return { session, events }
}

describe('event rules on a straight test course', () => {
  // A 600 m line due south on a steady 20 degree slope.
  const line: Point2[] = [
    [0, 0],
    [0, 600],
  ]
  const def: EventDef = {
    ...EVENTS[0],
    legs: [],
    gates: { kind: 'downhill', start: 100, spacing: 100, offset: 0, halfWidth: 6, endGap: 50, maxBend: 40 },
    trap: [0.5, 0.6],
    splits: [0.25, 0.75],
  }
  const course: EventCourse = {
    def,
    line,
    length: 600,
    gates: raceGates(line, def.gates as Exclude<EventDef['gates'], { kind: 'none' }>),
    trap: [300, 360],
    splits: [150, 450],
  }
  const at = (z: number, speed: number, x = 0) => ({ ...createSkiState({ x, z, heading: 0 }), x, z, speed })

  it('fires splits in order, clocks the radar once on the way out, then finishes', () => {
    const session = createSession(eventChallenge(course))
    session.startClock() // GO from the start gate
    const seen: string[] = []
    let trapSpeed = 0
    for (let z = 0; z <= 600; z += 0.5) {
      const speed = z > 300 && z < 360 ? 30 + (z - 300) / 10 : 20
      for (const e of session.step(at(z, speed), 0.02)) {
        seen.push(e.type === 'split' ? `split${e.index}` : e.type)
        if (e.type === 'trap') trapSpeed = e.speed
      }
    }
    expect(seen.filter((t) => t !== 'gate')).toEqual(['split0', 'trap', 'split1', 'finish'])
    expect(trapSpeed).toBeCloseTo(36, 0)
    expect(session.stats.trapSpeed).toBeCloseTo(36, 0)
    expect(session.stats.splits).toHaveLength(2)
    expect(session.stats.splits[0]).toBeLessThan(session.stats.splits[1])
    expect(session.stats.gatesPassed).toBe(course.gates.length)
    expect(session.stats.penalty).toBe(0)
  })

  it('a missed race gate disqualifies at once instead of adding time', () => {
    const session = createSession(eventChallenge(course))
    session.startClock() // GO from the start gate
    const types: string[] = []
    // On the line until 80 m, then 9 m to the side: outside the first gate's 6 m half width.
    for (let z = 0; z <= 600 && !session.finished; z += 0.5) for (const e of session.step(at(z, 20, z > 80 ? 9 : 0), 0.02)) types.push(e.type)
    expect(types).toContain('disqualified')
    expect(types).not.toContain('finish')
    expect(session.finished).toBe(true)
    expect(session.stats.penalty).toBe(0)
  })

  it('abandon stops the clock and the rules (a crash in a speed event)', () => {
    const session = createSession(eventChallenge(course))
    session.startClock() // GO from the start gate
    for (let z = 0; z < 100; z += 0.5) session.step(at(z, 20), 0.02)
    session.abandon()
    const time = session.stats.time
    expect(session.step(at(500, 20), 0.02)).toEqual([])
    expect(session.stats.time).toBe(time)
  })

  it('Match Your Time scores the gap between the two runs', () => {
    expect(matchDelta(61.2, 61.45)).toBeCloseTo(0.25)
    expect(matchDelta(61.2, 60.9)).toBeCloseTo(0.3)
    const match = EVENTS.find((e) => e.format === 'match')!
    const t = match.fixedTargets!
    expect(t.gold).toBeLessThan(t.silver)
    expect(t.silver).toBeLessThan(t.bronze)
  })
})

describe.skipIf(!hasData)('Apex events on the real map', () => {
  const grid = loadDiskGrid(DATA)
  const resort: Resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
  const courses = new Map(EVENTS.map((def) => [def.id, buildEventCourse(resort, def)]))
  const SUMMIT: Point2 = [1554, 1551]
  const OLD_UPPER_LOT: Point2 = [1479, 506]
  const near = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1])

  it('every course runs downhill from start to finish with no jumps between points', () => {
    for (const course of courses.values()) {
      const [sx, sz] = course.line[0]
      const [ex, ez] = course.line[course.line.length - 1]
      expect(grid.heightAt(sx, sz) - grid.heightAt(ex, ez), course.def.id).toBeGreaterThan(150)
      for (let i = 1; i < course.line.length; i++) expect(near(course.line[i], course.line[i - 1]), course.def.id).toBeLessThan(200)
    }
  })

  it('Shoot the Chute: from the summit, down the Chute, finishing at the old upper lot', () => {
    const chute = courses.get('shoot-the-chute')!
    expect(near(chute.line[0], SUMMIT)).toBeLessThan(45)
    expect(near(chute.line[chute.line.length - 1], OLD_UPPER_LOT)).toBeLessThan(10)
    expect(chute.gates).toHaveLength(0)
    // The radar sits on the steep lower pitch: steeper than the course as a whole.
    const [a, b] = chute.trap!
    const h = (s: number) => {
      const [x, z] = pointAlong(chute.line, s)
      return grid.heightAt(x, z)
    }
    const trapGrade = (h(a) - h(b)) / (b - a)
    const courseGrade = (h(0) - h(chute.length)) / chute.length
    expect(trapGrade).toBeGreaterThan(courseGrade * 1.3)
  })

  it('Apex Downhill: summit start, splits at the top and bottom of Gunbarrel, finish at the old upper lot', () => {
    const mars = courses.get('apex-downhill')!
    expect(near(mars.line[0], SUMMIT)).toBeLessThan(45)
    expect(near(mars.line[mars.line.length - 1], OLD_UPPER_LOT)).toBeLessThan(10)
    const top = progressAlong(1076, 1182, mars.line).s
    const bottom = progressAlong(1161, 681, mars.line).s
    expect(Math.abs(mars.splits[0] - top)).toBeLessThan(40)
    expect(Math.abs(mars.splits[1] - bottom)).toBeLessThan(40)
    // Downhill panels on Gunbarrel itself, between the two splits.
    expect(mars.gates.length).toBeGreaterThanOrEqual(8)
    for (const gate of mars.gates) {
      expect(progressAlong(gate.x, gate.z, mars.line).off).toBeLessThan(1)
      expect(gate.s).toBeGreaterThan(mars.splits[0])
      expect(gate.s).toBeLessThan(mars.splits[1])
    }
  })

  it('the GS sets gates alternately either side of Old Mill, every one inside the corridor', () => {
    const gs = courses.get('teck-gs')!
    expect(gs.gates.length).toBeGreaterThanOrEqual(20)
    gs.gates.forEach((gate, i) => {
      const { off } = progressAlong(gate.x, gate.z, gs.line)
      expect(off).toBeGreaterThan(2.5)
      expect(off).toBeLessThan(gs.def.corridor)
      if (i) expect(gate.side).toBe(-gs.gates[i - 1].side)
    })
  })

  it('stitched legs fail loudly when a run is missing or backwards', () => {
    expect(() => stitch(resort, [{ run: 'No Such Run' }])).toThrow(/not in the resort/)
    expect(() => stitch(resort, [{ run: 'Chute', from: [1479, 506], to: [1360, 1362] }])).toThrow(/backwards/)
  })

  it('a racer on the pace line finishes every race event clean: all gates, all splits, the radar', () => {
    for (const course of courses.values()) {
      if (course.def.format !== 'race' && course.def.format !== 'twoRun') continue
      const { session, events } = race(course, grid.sampleTerrain, course.def.paceCap)
      const types = events.map((e) => e.type)
      expect(types, course.def.id).toContain('finish')
      expect(types, course.def.id).not.toContain('disqualified')
      expect(types, course.def.id).not.toContain('offCourse')
      expect(session.stats.gatesPassed, course.def.id).toBe(course.gates.length)
      expect(session.stats.splits, course.def.id).toHaveLength(course.splits.length)
      if (course.trap) expect(session.stats.trapSpeed * 3.6, course.def.id).toBeGreaterThan(60)
    }
  }, 60000)

  it('the pace line is about the length of the course (gates do not add detours)', () => {
    for (const course of courses.values()) {
      if (!course.gates.length) continue
      const route = paceRoute(course)
      expect(polylineLength(route) / course.length, course.def.id).toBeLessThan(1.08)
    }
  })
})
