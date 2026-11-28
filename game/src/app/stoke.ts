/**
 * Stoke: the one number everything on the mountain pays into (vertical,
 * tricks, new runs, medals, nuggets, ticket goals), and the ranks it climbs.
 * No rendering and no storage: progress.ts keeps the number.
 */
import { MEDAL_RANK, type Medal } from '../world/challenges'

export const STOKE = {
  /** Per metre of vertical skied. */
  vertical: 0.1,
  /** Per trick point banked. */
  trickPoint: 0.01,
  /** A named run skied for the first time. */
  newRun: 50,
  nugget: 150,
  medal: { bronze: 100, silver: 250, gold: 500 } as Record<Medal, number>,
}

export interface Rank {
  name: string
  /** Stoke needed to reach it. */
  at: number
}

/** Greenhorn to Apex Legend: about a session for the first step, a few weeks of casual play for the last. */
export const RANKS: Rank[] = [
  { name: 'Greenhorn', at: 0 },
  { name: 'Weekender', at: 500 },
  { name: 'Local', at: 1500 },
  { name: 'Ripper', at: 3500 },
  { name: 'Ski Club', at: 7000 },
  { name: 'Powder Hound', at: 12000 },
  { name: 'Patroller', at: 20000 },
  { name: 'Chute Shooter', at: 30000 },
  { name: 'Mountain Legend', at: 45000 },
  { name: 'Apex Legend', at: 65000 },
]

export interface RankState {
  /** 0 for Greenhorn. */
  index: number
  rank: Rank
  /** The next rank, or null at the top. */
  next: Rank | null
  /** 0..1 of the way from this rank to the next (1 at the top). */
  share: number
}

export function rankOf(stoke: number): RankState {
  let index = 0
  for (let i = 0; i < RANKS.length; i++) if (stoke >= RANKS[i].at) index = i
  const rank = RANKS[index]
  const next = RANKS[index + 1] ?? null
  return { index, rank, next, share: next ? Math.min(1, Math.max(0, (stoke - rank.at) / (next.at - rank.at))) : 1 }
}

/** Stoke for moving a challenge's medal from `before` to `after` (a medal pays its value once, the difference on an upgrade). */
export function medalStoke(before: Medal | null | undefined, after: Medal | null | undefined): number {
  if (!after) return 0
  if (before && MEDAL_RANK[before] >= MEDAL_RANK[after]) return 0
  return STOKE.medal[after] - (before ? STOKE.medal[before] : 0)
}

/**
 * Stoke for a save from before Stoke existed: what its medals, runs skied,
 * nuggets and lifetime vertical would have paid.
 */
export function backfillStoke(save: { medals: Record<string, Medal>; nuggets: string[]; totals: { vertical: number } }, skied: number): number {
  const medals = Object.values(save.medals).reduce((sum, medal) => sum + STOKE.medal[medal], 0)
  return Math.round(medals + skied * STOKE.newRun + save.nuggets.length * STOKE.nugget + save.totals.vertical * STOKE.vertical)
}

/** "1,240 Stoke" style number. */
export const formatStoke = (stoke: number) => Math.floor(stoke).toLocaleString()
