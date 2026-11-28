/**
 * The day ticket: three short goals that are always on in free ski, plus the
 * Run of the Day. Each goal is one thing to go and do on the mountain, sized
 * to the rider's rank. Finishing one pays Stoke and deals another. Pure
 * rules: goals.ts feeds the events and keeps the state in the saved profile.
 */
import { MEDAL_RANK, type Medal } from '../world/challenges'

export type GoalSpec =
  | { kind: 'run'; run: string; metres: number }
  | { kind: 'speed'; kmh: number }
  | { kind: 'combo'; points: number }
  | { kind: 'trick'; what: TrickGoal }
  | { kind: 'vertical'; metres: number }
  | { kind: 'medal'; id: string; medal: Medal }
  | { kind: 'nugget'; id: string }
  | { kind: 'finish'; id: string }

export type TrickGoal = 'spin' | 'flip' | 'perfect' | 'rail'

export interface Goal {
  /** Unique within the ticket. */
  key: string
  spec: GoalSpec
  text: string
  stoke: number
  /** Amount so far, in the goal's own unit (metres, km/h, points); 0 or 1 for one-shot goals. */
  amount: number
}

export interface TicketState {
  goals: Goal[]
  /** Local date (YYYY-MM-DD) the Run of the Day was dealt for. */
  day: string
  /** The Run of the Day, or null once finished (until tomorrow) or when the map has no timed runs. */
  daily: Goal | null
  /** Goals dealt so far: makes keys unique. */
  dealt: number
}

export const TICKET_SIZE = 3

export type GoalEvent =
  | { type: 'metres'; run: string; metres: number }
  | { type: 'speed'; kmh: number }
  | { type: 'drop'; metres: number }
  | { type: 'crash' }
  | { type: 'trick'; kind: 'air' | 'rail'; spinDeg: number; flips: number; grade: string }
  | { type: 'bank'; points: number }
  | { type: 'medal'; id: string; medal: Medal | null }
  | { type: 'finish'; id: string }
  | { type: 'nugget'; id: string }

/** What a goal needs to be done, in its own unit. */
export function goalTarget(spec: GoalSpec): number {
  if (spec.kind === 'run' || spec.kind === 'vertical') return spec.metres
  if (spec.kind === 'speed') return spec.kmh
  if (spec.kind === 'combo') return spec.points
  return 1
}

/** Feed one event to a goal. Returns true when this event completed it. */
export function applyEvent(goal: Goal, event: GoalEvent): boolean {
  const { spec } = goal
  const target = goalTarget(spec)
  if (goal.amount >= target) return false
  const before = goal.amount
  if (spec.kind === 'run' && event.type === 'metres' && event.run === spec.run) goal.amount += event.metres
  else if (spec.kind === 'speed' && event.type === 'speed') goal.amount = Math.max(goal.amount, Math.min(target, event.kmh))
  else if (spec.kind === 'combo' && event.type === 'bank') goal.amount = Math.max(goal.amount, Math.min(target, event.points))
  else if (spec.kind === 'vertical' && event.type === 'drop') goal.amount += event.metres
  // A wipeout starts the count again.
  else if (spec.kind === 'vertical' && event.type === 'crash') goal.amount = 0
  else if (spec.kind === 'trick' && event.type === 'trick' && event.grade !== 'crash') {
    const hit =
      spec.what === 'rail'
        ? event.kind === 'rail'
        : event.kind === 'air' &&
          (spec.what === 'spin' ? Math.abs(event.spinDeg) >= 315 : spec.what === 'flip' ? Math.abs(event.flips) >= 1 : event.grade === 'perfect')
    if (hit) goal.amount = 1
  } else if (spec.kind === 'medal' && event.type === 'medal' && event.id === spec.id && event.medal && MEDAL_RANK[event.medal] >= MEDAL_RANK[spec.medal]) goal.amount = 1
  else if (spec.kind === 'finish' && event.type === 'finish' && event.id === spec.id) goal.amount = 1
  else if (spec.kind === 'nugget' && event.type === 'nugget' && event.id === spec.id) goal.amount = 1
  goal.amount = Math.min(goal.amount, target)
  return before < target && goal.amount >= target
}

/** 0..1 for the progress bar. */
export const goalShare = (goal: Goal) => Math.min(1, goal.amount / goalTarget(goal.spec))

/** What the mountain and the save offer when a goal is dealt. */
export interface DealContext {
  /** 0 for Greenhorn. */
  rank: number
  /** Named runs with their length; `skied` ones are picked last. */
  runs: { name: string; length: number; difficulty: string | null; skied: boolean }[]
  /** Challenges a medal goal can ask for, with the medal already held. */
  challenges: { id: string; name: string; medal: Medal | null }[]
  /** Nuggets not found yet, with the run each is beside. */
  nuggets: { id: string; near: string }[]
  /** True when the map has park features to trick on. */
  parks: boolean
}

const TRICK_TEXT: Record<TrickGoal, string> = {
  spin: 'Land a 360 or bigger',
  flip: 'Land a flip',
  perfect: 'Stick a perfect landing off a jump',
  rail: 'Slide a rail or a box',
}

/** Run difficulties a rank is sent to: greens and blues first, everything from Ripper up. */
function fits(difficulty: string | null, rank: number): boolean {
  if (rank >= 3) return true
  if (rank >= 1) return ['novice', 'easy', 'intermediate', 'advanced'].includes(difficulty ?? '')
  return ['novice', 'easy', 'intermediate'].includes(difficulty ?? '')
}

const pick = <T>(list: T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]
const NEXT_MEDAL: Record<string, Medal> = { none: 'bronze', bronze: 'silver', silver: 'gold' }

/** Build one goal of `kind`, or null when the mountain or the save has nothing for it. */
export function makeGoal(kind: GoalSpec['kind'], ctx: DealContext, random: () => number): Omit<Goal, 'key'> | null {
  const { rank } = ctx
  if (kind === 'run') {
    // Short hops are not a trip, and the long traverses wait until the rider knows the hill.
    const named = ctx.runs.filter((run) => !/^(Unnamed|Unmapped)/.test(run.name) && run.length >= 250 && (rank >= 2 || run.length <= 1300) && fits(run.difficulty, rank))
    const fresh = named.filter((run) => !run.skied)
    const pool = fresh.length ? fresh : named
    if (!pool.length) return null
    const run = pick(pool, random)
    return { spec: { kind, run: run.name, metres: Math.round(Math.min(run.length * 0.5, 600)) }, text: `Ski ${run.name}`, stoke: fresh.length ? 150 : 100, amount: 0 }
  }
  if (kind === 'speed') {
    const kmh = Math.min(120, 60 + rank * 8)
    return { spec: { kind, kmh }, text: `Hit ${kmh} km/h`, stoke: 100 + rank * 10, amount: 0 }
  }
  if (kind === 'combo') {
    if (!ctx.parks) return null
    const points = 1000 * (1 + rank)
    return { spec: { kind, points }, text: `Bank a ${points.toLocaleString()} point combo`, stoke: 150 + rank * 20, amount: 0 }
  }
  if (kind === 'trick') {
    if (!ctx.parks) return null
    const what = pick<TrickGoal>(rank >= 2 ? ['spin', 'flip', 'perfect', 'rail'] : ['spin', 'perfect', 'rail'], random)
    return { spec: { kind, what }, text: TRICK_TEXT[what], stoke: what === 'flip' ? 200 : 120, amount: 0 }
  }
  if (kind === 'vertical') {
    const metres = 500 + rank * 250
    return { spec: { kind, metres }, text: `Ski ${metres.toLocaleString()} m of vertical without a wipeout`, stoke: 120 + rank * 20, amount: 0 }
  }
  if (kind === 'medal') {
    const open = ctx.challenges.filter((c) => c.medal !== 'gold')
    if (!open.length) return null
    // Mostly a first medal somewhere new; sometimes a better one where there is a medal already.
    const none = open.filter((c) => !c.medal)
    const challenge = pick(none.length && random() < 0.7 ? none : open, random)
    const medal = NEXT_MEDAL[challenge.medal ?? 'none']
    return { spec: { kind, id: challenge.id, medal }, text: `Win ${medal} or better: ${challenge.name}`, stoke: 150 + MEDAL_RANK[medal] * 50, amount: 0 }
  }
  if (kind === 'nugget') {
    // Nuggets hide off the edges of runs of every colour: not a first-day errand.
    if (!ctx.nuggets.length || rank < 1) return null
    const nugget = pick(ctx.nuggets, random)
    return { spec: { kind, id: nugget.id }, text: `Find the gold nugget beside ${nugget.near}`, stoke: 150, amount: 0 }
  }
  return null
}

const KINDS: GoalSpec['kind'][] = ['run', 'speed', 'combo', 'trick', 'vertical', 'medal', 'nugget']

/** Deal a goal of a kind the ticket does not already hold. */
export function dealGoal(state: TicketState, ctx: DealContext, random: () => number = Math.random): Goal | null {
  const held = new Set(state.goals.map((goal) => goal.spec.kind))
  const kinds = KINDS.filter((kind) => !held.has(kind))
  // Shuffle, then take the first kind that has something to offer.
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
  }
  // The first ticket of a new save always sends the rider down a run.
  if (state.dealt === 0 && kinds.includes('run')) kinds.unshift('run')
  for (const kind of kinds) {
    const goal = makeGoal(kind, ctx, random)
    if (goal) return { ...goal, key: `g${++state.dealt}` }
  }
  return null
}

/** Top the ticket up to three goals. */
export function fillTicket(state: TicketState, ctx: DealContext, random: () => number = Math.random): void {
  while (state.goals.length < TICKET_SIZE) {
    const goal = dealGoal(state, ctx, random)
    if (!goal) break
    state.goals.push(goal)
  }
}

export function emptyTicket(): TicketState {
  return { goals: [], day: '', daily: null, dealt: 0 }
}

/** Local calendar day, YYYY-MM-DD. */
export function dayOf(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** A stable pick from `count` options for a day: the same for everyone on that date. */
export function dayIndex(day: string, count: number): number {
  let hash = 2166136261
  for (let i = 0; i < day.length; i++) hash = Math.imul(hash ^ day.charCodeAt(i), 16777619)
  return count > 0 ? (hash >>> 0) % count : 0
}

export const DAILY_STOKE = 300

/** On a new day, deal the Run of the Day from the timed runs worth a trip. */
export function dealDaily(state: TicketState, day: string, timed: { id: string; name: string }[]): void {
  if (state.day === day) return
  state.day = day
  if (!timed.length) {
    state.daily = null
    return
  }
  const run = timed[dayIndex(day, timed.length)]
  state.daily = { key: `d${day}`, spec: { kind: 'finish', id: run.id }, text: `Run of the Day: ${run.name}`, stoke: DAILY_STOKE, amount: 0 }
}

/**
 * Feed an event to the whole ticket. Returns the goals it completed; they are
 * removed from the ticket (the caller pays them and tops the ticket up).
 */
export function ticketEvent(state: TicketState, event: GoalEvent): Goal[] {
  const done: Goal[] = []
  for (const goal of state.goals) if (applyEvent(goal, event)) done.push(goal)
  if (done.length) state.goals = state.goals.filter((goal) => !done.includes(goal))
  if (state.daily && applyEvent(state.daily, event)) {
    done.push(state.daily)
    state.daily = null
  }
  return done
}
