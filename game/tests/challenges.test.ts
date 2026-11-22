import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSteadySlope } from '../src/sim'
import {
  GATE_HALF_WIDTH,
  betterMedal,
  buildSlalom,
  courseLine,
  trimLine,
  gateCrossing,
  mainLine,
  medalForScore,
  medalForTime,
  paceBotSync,
  parkTargets,
  placeNuggets,
  progressAlong,
  timeTargets,
} from '../src/world/challenges'
import { awardMedal, emptyProgress, medalCounts, recordBest, skiedRuns, unlockedIds } from '../src/app/progress'
import { pickableRuns, resortFromFeatures, type Point2, type Run } from '../src/world/resort'
import { loadDiskGrid } from './diskGrid'

const straight: Point2[] = [
  [100, 0],
  [100, 400],
]

describe('medals', () => {
  it('times: gold from the bot, silver and bronze slower, rounded up to 0.5 s', () => {
    const t = timeTargets(41.2)
    expect(t).toEqual({ gold: 41.5, silver: 49.5, bronze: 62 })
    expect(medalForTime(41, t)).toBe('gold')
    expect(medalForTime(49.5, t)).toBe('silver')
    expect(medalForTime(60, t)).toBe('bronze')
    expect(medalForTime(70, t)).toBeNull()
  })

  it('scores: higher is better, and every layout has ordered targets', () => {
    for (const id of ['jumps', 'big', 'jib', 'mixed', 'rollers', 'progression']) {
      const t = parkTargets(id)
      expect(t.gold).toBeGreaterThan(t.silver)
      expect(t.silver).toBeGreaterThan(t.bronze)
      expect(medalForScore(t.gold, t)).toBe('gold')
      expect(medalForScore(t.bronze - 1, t)).toBeNull()
    }
  })

  it('keeps the better medal', () => {
    expect(betterMedal('silver', 'gold')).toBe('gold')
    expect(betterMedal('bronze', null)).toBe('bronze')
    const p = emptyProgress()
    expect(awardMedal(p, 'time:A', 'silver')).toBe(true)
    expect(awardMedal(p, 'time:A', 'bronze')).toBe(false)
    expect(awardMedal(p, 'time:A', 'gold')).toBe(true)
    expect(medalCounts(p)).toEqual({ gold: 1, silver: 0, bronze: 0, total: 1 })
  })

  it('records bests in the right direction', () => {
    const p = emptyProgress()
    expect(recordBest(p, 'time:A', 50, true).improved).toBe(true)
    expect(recordBest(p, 'time:A', 55, true)).toEqual({ previous: 50, improved: false })
    expect(recordBest(p, 'park:x', 900, false).improved).toBe(true)
    expect(recordBest(p, 'park:x', 1200, false).improved).toBe(true)
    expect(p.bests).toEqual({ 'time:A': 50, 'park:x': 1200 })
  })
})

describe('course start', () => {
  it('trims the line and starts clear of obstacles', () => {
    expect(trimLine(straight, 30)).toEqual([[100, 30], [100, 400]])
    // A hut covers the first 40 m: the course starts at 45 m.
    const line = courseLine(straight, (_x, z) => z < 41)
    expect(line[0]).toEqual([100, 45])
    expect(courseLine(straight, () => false)[0]).toEqual([100, 15])
  })
})

describe('slalom', () => {
  const gates = buildSlalom(straight)
  it('sets alternating gates along the line', () => {
    expect(gates.length).toBeGreaterThan(10)
    expect(gates[0].s).toBe(25)
    expect(gates[0].side).toBe(-gates[1].side)
    expect(Math.abs(gates[0].x - 100)).toBeCloseTo(5)
    expect(gates[1].x - 100).toBeCloseTo(-(gates[0].x - 100))
  })

  it('passes between the poles, misses outside them, ignores no crossing', () => {
    const g = gates[0]
    expect(gateCrossing(g.x, g.z - 1, g.x + 1, g.z + 1, g)).toBe('pass')
    expect(gateCrossing(g.x + GATE_HALF_WIDTH + 1, g.z - 1, g.x + GATE_HALF_WIDTH + 1, g.z + 1, g)).toBe('miss')
    expect(gateCrossing(g.x, g.z - 3, g.x, g.z - 1, g)).toBeNull()
    // Going back up through it does not count.
    expect(gateCrossing(g.x, g.z + 1, g.x, g.z - 1, g)).toBeNull()
  })
})

describe('progress along a run', () => {
  it('measures distance along and off the line', () => {
    const p = progressAlong(104, 150, straight)
    expect(p.s).toBeCloseTo(150)
    expect(p.off).toBeCloseTo(4)
  })

  it('counts a run as skied past the share', () => {
    const p = emptyProgress()
    p.covered = { A: 260, B: 100 }
    expect(skiedRuns(p, new Map([['A', 500], ['B', 500]]), 0.5)).toEqual(['A'])
  })

  it('unlocks from progress', () => {
    const p = emptyProgress()
    expect(unlockedIds(p, 0).size).toBe(0)
    p.nuggets = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6']
    p.medals = { a: 'gold', b: 'gold', c: 'gold' }
    expect([...unlockedIds(p, 25)].sort()).toEqual(['colour:gold', 'graphic:nugget', 'graphic:topo'])
  })
})

describe('nuggets', () => {
  const run: Run = { id: 'r', name: 'Long', difficulty: 'intermediate', groomed: true, kind: 'line', parts: [[[500, 50], [520, 900], [480, 1900]]] }
  it('places the same spread-out nuggets every time, off the run and clear of obstacles', () => {
    const blocked = (x: number) => x > 540
    const a = placeNuggets([run], { width: 1000, depth: 2000 }, blocked, 8)
    const b = placeNuggets([run], { width: 1000, depth: 2000 }, blocked, 8)
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(3)
    for (const n of a) {
      expect(n.x).toBeLessThanOrEqual(540)
      expect(progressAlong(n.x, n.z, mainLine(run)).off).toBeGreaterThan(14)
      for (const m of a) if (m !== n) expect(Math.hypot(m.x - n.x, m.z - n.z)).toBeGreaterThanOrEqual(150)
    }
  })
})

describe('pace bot', () => {
  it('finishes a straight run on a steady slope', () => {
    const slope = createSteadySlope(15, { width: 200, depth: 500 })
    const line: Point2[] = [
      [100, 20],
      [100, 420],
    ]
    const time = paceBotSync(line, slope.sampleTerrain, {})
    expect(time).not.toBeNull()
    // 400 m at no more than 22 m/s (with braking) and from a standstill.
    expect(time!).toBeGreaterThan(400 / 22)
    expect(time!).toBeLessThan(60)
  })

  const DATA = 'public/data/'
  it.skipIf(!existsSync(`${DATA}features.json`))('sets a time on a real Apex run', () => {
    const grid = loadDiskGrid(DATA)
    const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
    const run = pickableRuns(resort).find((r) => r.name === 'Okanagan Run')!
    const time = paceBotSync(mainLine(run), grid.sampleTerrain, {})
    expect(time).not.toBeNull()
    expect(time!).toBeGreaterThan(20)
    expect(time!).toBeLessThan(60)
  }, 30000)
})

describe('session', async () => {
  const { createSession } = await import('../src/app/session')
  const run: Run = { id: 'r', name: 'Straight', difficulty: 'intermediate', groomed: true, kind: 'line', parts: [straight] }
  /** Ski down x = `x(z)` at 15 m/s, one frame per 1/60 s, until the session finishes. */
  const ski = (session: ReturnType<typeof createSession>, x: (z: number) => number = () => 100) => {
    const skier = { x: 100, y: 400, z: 0, speed: 15 } as unknown as import('../src/sim').SkiState
    const events = []
    for (let i = 0; i < 4000 && !session.finished; i++) {
      skier.z = Math.min(399, i * 0.25)
      skier.x = x(skier.z)
      skier.y = 400 - skier.z * 0.3
      events.push(...session.step(skier, 1 / 60))
    }
    return events
  }

  it('times a run and records distance, drop and top speed', () => {
    const session = createSession({ kind: 'time', id: 'time:Straight', run, line: straight, targets: null })
    const events = ski(session)
    expect(events.at(-1)).toEqual({ type: 'finish' })
    expect(session.stats.distance).toBeGreaterThan(380)
    expect(session.stats.vertical).toBeGreaterThan(110)
    expect(session.stats.topSpeed).toBe(15)
    expect(session.total).toBeCloseTo(session.stats.time)
  })

  it('slalom: straight down the middle misses every other gate and pays for it', () => {
    const gates = buildSlalom(straight)
    const session = createSession({ kind: 'slalom', id: 'slalom:Straight', run, line: straight, gates, targets: null })
    ski(session)
    expect(session.stats.gatesPassed + session.stats.gatesMissed).toBe(gates.length)
    expect(session.stats.gatesMissed).toBe(gates.length)
    // Weaving through the gate centres passes them all.
    const weave = createSession({ kind: 'slalom', id: 'slalom:Straight', run, line: straight, gates, targets: null })
    ski(weave, (z) => {
      const g = gates.find((gate) => Math.abs(gate.z - z) < 14)
      return g ? g.x : 100
    })
    expect(weave.stats.gatesPassed).toBe(gates.length)
    expect(weave.stats.penalty).toBe(0)
  })

  it('ends the attempt when far off course', () => {
    const session = createSession({ kind: 'time', id: 'time:Straight', run, line: straight, targets: null })
    const events = ski(session, (z) => (z > 100 ? 300 : 100))
    expect(events.at(-1)).toEqual({ type: 'offCourse' })
  })
})
