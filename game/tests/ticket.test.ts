import { describe, expect, it } from 'vitest'
import { RANKS, STOKE, backfillStoke, medalStoke, rankOf } from '../src/app/stoke'
import { TICKET_SIZE, applyEvent, dayIndex, dayOf, dealDaily, emptyTicket, fillTicket, goalShare, makeGoal, ticketEvent, type DealContext, type Goal } from '../src/app/ticket'
import { UNLOCKS, emptyProgress, unlockedIds } from '../src/app/progress'
import { KITS, REWARD_COLOURS } from '../src/ui/riderPanel'

/** A repeatable random stream. */
function seeded(seed = 7) {
  let state = (seed * 48271 + 11) % 2147483647
  return () => ((state = (state * 16807) % 2147483647) / 2147483647)
}

const ctx = (over: Partial<DealContext> = {}): DealContext => ({
  rank: 0,
  runs: [
    { name: 'Juniper', length: 923, difficulty: 'intermediate', skied: false },
    { name: 'Gunbarrel', length: 499, difficulty: 'expert', skied: false },
    { name: 'Unnamed cut L6', length: 388, difficulty: 'easy', skied: false },
    { name: 'Easy Out', length: 298, difficulty: 'easy', skied: true },
  ],
  challenges: [
    { id: 'event:apex-slalom', name: 'Apex Slalom', medal: null },
    { id: 'time:Juniper', name: 'Juniper timed run', medal: 'bronze' },
  ],
  nuggets: [{ id: 'n3', near: 'Juniper' }],
  parks: true,
  ...over,
})

const goal = (spec: Goal['spec']): Goal => ({ key: 'g', spec, text: '', stoke: 100, amount: 0 })

describe('Stoke and ranks', () => {
  it('ranks climb with Stoke and the bar fills toward the next', () => {
    expect(rankOf(0)).toMatchObject({ index: 0, share: 0 })
    expect(rankOf(RANKS[1].at).index).toBe(1)
    expect(rankOf((RANKS[1].at + RANKS[2].at) / 2).share).toBeCloseTo(0.5)
    expect(rankOf(1e9)).toMatchObject({ index: RANKS.length - 1, next: null, share: 1 })
    for (let i = 1; i < RANKS.length; i++) expect(RANKS[i].at).toBeGreaterThan(RANKS[i - 1].at)
  })

  it('a medal pays once, and only the difference on an upgrade', () => {
    expect(medalStoke(null, 'bronze')).toBe(STOKE.medal.bronze)
    expect(medalStoke('bronze', 'gold')).toBe(STOKE.medal.gold - STOKE.medal.bronze)
    expect(medalStoke('gold', 'silver')).toBe(0)
    expect(medalStoke('silver', null)).toBe(0)
  })

  it('an older save is paid for what it already holds', () => {
    const save = { ...emptyProgress(), medals: { a: 'gold', b: 'bronze' } as const, nuggets: ['n1'], totals: { runs: 9, distance: 0, vertical: 4000, topSpeed: 0 } }
    expect(backfillStoke(save, 10)).toBe(500 + 100 + 10 * STOKE.newRun + STOKE.nugget + 400)
  })

  it('every rank above Greenhorn unlocks one reward, and each reward has something to show for it', () => {
    for (let index = 1; index < RANKS.length; index++) {
      const below = unlockedIds({ ...emptyProgress(), stoke: RANKS[index].at - 1 }, 0)
      const at = unlockedIds({ ...emptyProgress(), stoke: RANKS[index].at }, 0)
      expect(at.size - below.size, RANKS[index].name).toBe(1)
    }
    const shown = new Set([...KITS.map((kit) => kit.unlock), ...REWARD_COLOURS.map((c) => c.unlock), 'model:straight', 'graphic:topo', 'graphic:nugget'])
    for (const unlock of UNLOCKS) expect(shown.has(unlock.id), unlock.id).toBe(true)
  })
})

describe('ticket goals', () => {
  it('a run goal counts metres on that run only', () => {
    const g = goal({ kind: 'run', run: 'Juniper', metres: 400 })
    expect(applyEvent(g, { type: 'metres', run: 'Gunbarrel', metres: 500 })).toBe(false)
    expect(applyEvent(g, { type: 'metres', run: 'Juniper', metres: 399 })).toBe(false)
    expect(goalShare(g)).toBeCloseTo(399 / 400)
    expect(applyEvent(g, { type: 'metres', run: 'Juniper', metres: 5 })).toBe(true)
    // Done is done: nothing completes it twice.
    expect(applyEvent(g, { type: 'metres', run: 'Juniper', metres: 5 })).toBe(false)
  })

  it('speed and combo goals keep the best so far', () => {
    const speed = goal({ kind: 'speed', kmh: 90 })
    applyEvent(speed, { type: 'speed', kmh: 70 })
    applyEvent(speed, { type: 'speed', kmh: 40 })
    expect(speed.amount).toBe(70)
    expect(applyEvent(speed, { type: 'speed', kmh: 96 })).toBe(true)
    const combo = goal({ kind: 'combo', points: 3000 })
    expect(applyEvent(combo, { type: 'bank', points: 2999 })).toBe(false)
    expect(applyEvent(combo, { type: 'bank', points: 3200 })).toBe(true)
  })

  it('a wipeout restarts the vertical count', () => {
    const g = goal({ kind: 'vertical', metres: 500 })
    applyEvent(g, { type: 'drop', metres: 450 })
    applyEvent(g, { type: 'crash' })
    expect(g.amount).toBe(0)
    applyEvent(g, { type: 'drop', metres: 450 })
    expect(applyEvent(g, { type: 'drop', metres: 60 })).toBe(true)
  })

  it('trick goals read the landed trick', () => {
    const air = { type: 'trick', kind: 'air', spinDeg: 0, flips: 0, grade: 'clean' } as const
    expect(applyEvent(goal({ kind: 'trick', what: 'spin' }), { ...air, spinDeg: 180 })).toBe(false)
    expect(applyEvent(goal({ kind: 'trick', what: 'spin' }), { ...air, spinDeg: -360 })).toBe(true)
    expect(applyEvent(goal({ kind: 'trick', what: 'spin' }), { ...air, spinDeg: 360, grade: 'crash' })).toBe(false)
    expect(applyEvent(goal({ kind: 'trick', what: 'flip' }), { ...air, flips: -1 })).toBe(true)
    expect(applyEvent(goal({ kind: 'trick', what: 'perfect' }), { ...air, grade: 'perfect' })).toBe(true)
    expect(applyEvent(goal({ kind: 'trick', what: 'rail' }), air)).toBe(false)
    expect(applyEvent(goal({ kind: 'trick', what: 'rail' }), { ...air, kind: 'rail' })).toBe(true)
  })

  it('a medal goal takes that medal or better on its challenge', () => {
    const g = goal({ kind: 'medal', id: 'time:Juniper', medal: 'silver' })
    expect(applyEvent(g, { type: 'medal', id: 'time:Juniper', medal: 'bronze' })).toBe(false)
    expect(applyEvent(g, { type: 'medal', id: 'time:Maverick', medal: 'gold' })).toBe(false)
    expect(applyEvent(g, { type: 'medal', id: 'time:Juniper', medal: 'gold' })).toBe(true)
  })
})

describe('dealing the ticket', () => {
  it('holds three goals of different kinds, and the first one of a new save is a run', () => {
    for (let seed = 1; seed < 40; seed++) {
      const state = emptyTicket()
      fillTicket(state, ctx(), seeded(seed))
      expect(state.goals).toHaveLength(TICKET_SIZE)
      expect(new Set(state.goals.map((g) => g.spec.kind)).size).toBe(TICKET_SIZE)
      expect(new Set(state.goals.map((g) => g.key)).size).toBe(TICKET_SIZE)
      expect(state.goals[0].spec.kind).toBe('run')
    }
  })

  it('sends a new rider to named greens and blues not skied yet', () => {
    for (let seed = 1; seed < 30; seed++) {
      const run = makeGoal('run', ctx(), seeded(seed))!
      expect(run.text).toBe('Ski Juniper')
      expect(run.spec).toMatchObject({ metres: 462 })
    }
    // From Ripper up the whole mountain is fair game.
    const names = new Set(Array.from({ length: 30 }, (_, i) => makeGoal('run', ctx({ rank: 3 }), seeded(i + 1))!.text))
    expect(names).toContain('Ski Gunbarrel')
  })

  it('asks for the next medal up and scales targets with rank', () => {
    const medal = makeGoal('medal', ctx({ challenges: [{ id: 'time:Juniper', name: 'Juniper timed run', medal: 'bronze' }] }), seeded())!
    expect(medal.text).toBe('Win silver or better: Juniper timed run')
    expect(makeGoal('medal', ctx({ challenges: [{ id: 'x', name: 'X', medal: 'gold' }] }), seeded())).toBeNull()
    expect((makeGoal('speed', ctx({ rank: 5 }), seeded())!.spec as { kmh: number }).kmh).toBeGreaterThan((makeGoal('speed', ctx(), seeded())!.spec as { kmh: number }).kmh)
    expect(makeGoal('combo', ctx({ parks: false }), seeded())).toBeNull()
    expect(makeGoal('nugget', ctx(), seeded())).toBeNull()
    expect(makeGoal('nugget', ctx({ rank: 1 }), seeded())!.text).toBe('Find the gold nugget beside Juniper')
  })

  it('a finished goal leaves the ticket and the next fill replaces it', () => {
    const state = emptyTicket()
    const random = seeded(3)
    fillTicket(state, ctx(), random)
    const done = ticketEvent(state, { type: 'metres', run: 'Juniper', metres: 2000 })
    expect(done.map((g) => g.spec.kind)).toEqual(['run'])
    expect(state.goals).toHaveLength(TICKET_SIZE - 1)
    fillTicket(state, ctx(), random)
    expect(state.goals).toHaveLength(TICKET_SIZE)
  })

  it('deals one Run of the Day per date, the same run all day', () => {
    const timed = [{ id: 'time:Juniper', name: 'Juniper' }, { id: 'time:Maverick', name: 'Maverick' }, { id: 'time:Old Mill', name: 'Old Mill' }]
    const state = emptyTicket()
    dealDaily(state, '2026-11-28', timed)
    const first = state.daily!
    expect(first.text).toMatch(/^Run of the Day: /)
    // Finished: gone until tomorrow.
    expect(ticketEvent(state, { type: 'finish', id: (first.spec as { id: string }).id })).toEqual([first])
    dealDaily(state, '2026-11-28', timed)
    expect(state.daily).toBeNull()
    dealDaily(state, '2026-11-29', timed)
    expect(state.daily).not.toBeNull()
    expect(dayIndex('2026-11-28', 3)).toBe(dayIndex('2026-11-28', 3))
    expect(dayOf(new Date(2026, 10, 28, 23, 59))).toBe('2026-11-28')
    // The days of a month do not all land on one run.
    expect(new Set(Array.from({ length: 30 }, (_, d) => dayIndex(`2026-11-${d + 1}`, 3))).size).toBe(3)
  })
})
