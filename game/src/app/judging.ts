/**
 * Judging a jump the way aerials and mogul airs are judged: degree of
 * difficulty from the rotations, form from the landing and the grab, and the
 * jump score as their product.
 */
import type { TrickEvent } from '../sim'

/** 1.0 for a straight jump, +0.6 per flip, +0.3 per full spin, +0.1 for a grab. */
export function degreeOfDifficulty(trick: Pick<TrickEvent, 'flips' | 'spinDeg' | 'grab'>): number {
  const spins = Math.floor((Math.abs(trick.spinDeg) + 45) / 360)
  return Math.round((1 + 0.6 * Math.abs(trick.flips) + 0.3 * spins + (trick.grab ? 0.1 : 0)) * 100) / 100
}

const FORM = { perfect: 9.5, clean: 8, sketchy: 5, crash: 0 } as const

/** Out of 10: the landing, plus half a point for a grab held at least 0.3 s (not on a crash). */
export function formScore(trick: Pick<TrickEvent, 'grade' | 'grab' | 'grabTime'>): number {
  const base = FORM[trick.grade]
  return base > 0 && trick.grab && trick.grabTime >= 0.3 ? Math.min(10, base + 0.5) : base
}

export interface JudgedJump {
  name: string
  dd: number
  form: number
  score: number
}

export function judgeJump(trick: TrickEvent): JudgedJump {
  const dd = degreeOfDifficulty(trick)
  const form = formScore(trick)
  return { name: trick.name, dd, form, score: Math.round(dd * form * 100) / 100 }
}

/** The two best jumps (the aerials format), best first. */
export function bestTwo(jumps: readonly JudgedJump[]): JudgedJump[] {
  return [...jumps].sort((a, b) => b.score - a.score).slice(0, 2)
}
