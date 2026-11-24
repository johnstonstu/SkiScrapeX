import { KEYS } from './storage'
import type { QualityLevel } from './settings'

/** Highest level Auto may use here, learned from GPU resets and slow frames. */
export function readAutoCap(): QualityLevel | null {
  try {
    const level = localStorage.getItem(KEYS.autoCap)
    return level === 'low' || level === 'medium' || level === 'high' ? level : null
  } catch {
    return null
  }
}

export function lowerAutoCap(level: QualityLevel) {
  const order: QualityLevel[] = ['low', 'medium', 'high']
  const current = readAutoCap()
  if (current && order.indexOf(current) <= order.indexOf(level)) return
  try {
    localStorage.setItem(KEYS.autoCap, level)
  } catch {
    /* not persisted */
  }
}
