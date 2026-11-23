/**
 * The local player profile: medals, bests per challenge, runs skied, nuggets
 * found, lifetime totals and what they unlock. Kept in localStorage.
 */
import { MEDAL_RANK, type Medal } from '../world/challenges'
import { KEYS, readJson, writeJson } from './storage'
import { RUN_NAMES } from '../world/corrections'

export interface Progress {
  /** Best medal per challenge id (`time:<run>`, `slalom:<run>`, `park:<site>:<layout>`). */
  medals: Record<string, Medal>
  /** Best time (seconds) or score (points) per challenge id. */
  bests: Record<string, number>
  /** Metres covered on each named run, for the "ski every run" list. */
  covered: Record<string, number>
  /** Nugget ids found. */
  nuggets: string[]
  totals: { runs: number; distance: number; vertical: number; topSpeed: number }
}

export function emptyProgress(): Progress {
  return { medals: {}, bests: {}, covered: {}, nuggets: [], totals: { runs: 0, distance: 0, vertical: 0, topSpeed: 0 } }
}

export function readProgress(): Progress {
  const stored = readJson<Progress>(KEYS.progress, emptyProgress())
  // Older or partial saves: fill any missing parts.
  const empty = emptyProgress()
  return renameRuns({ ...empty, ...stored, totals: { ...empty.totals, ...stored.totals } })
}

/** Carry medals, bests and run coverage across run renames (old OSM spellings). */
export function renameRuns(progress: Progress): Progress {
  const rename = (key: string) => {
    for (const [from, to] of Object.entries(RUN_NAMES)) {
      if (key === from) return to
      for (const prefix of ['time:', 'slalom:']) if (key === prefix + from) return prefix + to
    }
    return key
  }
  const remap = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).map(([k, v]) => [rename(k), v]))
  progress.medals = remap(progress.medals)
  progress.bests = remap(progress.bests)
  progress.covered = remap(progress.covered)
  return progress
}

export function writeProgress(progress: Progress): void {
  writeJson(KEYS.progress, progress)
}

/** Keep the better medal. Returns true when it improved. */
export function awardMedal(progress: Progress, id: string, medal: Medal | null): boolean {
  if (!medal) return false
  const current = progress.medals[id]
  if (current && MEDAL_RANK[current] >= MEDAL_RANK[medal]) return false
  progress.medals[id] = medal
  return true
}

/** Keep the better value. Returns the previous best (undefined if none) and whether this one beat it. */
export function recordBest(progress: Progress, id: string, value: number, lowerIsBetter: boolean): { previous?: number; improved: boolean } {
  const previous = progress.bests[id]
  const improved = previous === undefined || (lowerIsBetter ? value < previous : value > previous)
  if (improved) progress.bests[id] = value
  return { previous, improved }
}

export function medalCounts(progress: Progress): Record<Medal, number> & { total: number } {
  const counts = { gold: 0, silver: 0, bronze: 0, total: 0 }
  for (const medal of Object.values(progress.medals)) {
    counts[medal]++
    counts.total++
  }
  return counts
}

export function skiedRuns(progress: Progress, lengths: Map<string, number>, share: number): string[] {
  return [...lengths].filter(([name, length]) => (progress.covered[name] ?? 0) >= length * share).map(([name]) => name)
}

/** Rewards for the rider panel. Each adds an option; nothing that was free gets locked. */
export interface Unlock {
  id: string
  label: string
  hint: string
  test: (progress: Progress, skied: number) => boolean
}

export const UNLOCKS: Unlock[] = [
  { id: 'colour:gold', label: 'Gold colour', hint: 'Win 3 gold medals', test: (p) => medalCounts(p).gold >= 3 },
  { id: 'colour:chrome', label: 'Chrome colour', hint: 'Win 10 medals', test: (p) => medalCounts(p).total >= 10 },
  { id: 'graphic:topo', label: 'Topo ski graphic', hint: 'Ski 20 different runs', test: (_p, skied) => skied >= 20 },
  { id: 'graphic:nugget', label: 'Nugget ski graphic', hint: 'Find 6 gold nuggets', test: (p) => p.nuggets.length >= 6 },
]

export function unlockedIds(progress: Progress, skied: number): Set<string> {
  return new Set(UNLOCKS.filter((unlock) => unlock.test(progress, skied)).map((unlock) => unlock.id))
}
