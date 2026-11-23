/** Small JSON values in localStorage. Storage can be unavailable (private mode); then nothing persists. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* not persisted */
  }
}

export const KEYS = {
  bests: 'skiscrapex.bests',
  parkLayouts: 'skiscrapex.parkLayouts',
  outfit: 'skiscrapex.outfit',
  settings: 'skiscrapex.settings',
  progress: 'skiscrapex.progress',
  targets: 'skiscrapex.targets',
  coach: 'skiscrapex.coach',
  muted: 'apex.soundMuted',
  /** Highest graphics level Auto may use on this machine, learned from GPU resets and slow frames. */
  autoCap: 'skiscrapex.autoCap',
} as const
