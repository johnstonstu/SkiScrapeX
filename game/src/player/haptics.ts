import type { SkiState, TrickEvent } from '../sim'

/** Gamepad rumble driven by edge chatter, landings, rails and crashes. */
export function createHaptics(rumble: (weak: number, strong: number, durationMs?: number) => void) {
  let enabled = true
  let nextPulse = 0
  let airborne = false
  let onRail = false
  let crashed = false
  let descent = 0
  const motion = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

  return {
    setEnabled(value: boolean) {
      enabled = value
    },
    reset() {
      airborne = onRail = crashed = false
      descent = 0
      nextPulse = 0
    },
    landing(trick: TrickEvent) {
      if (!enabled || motion?.matches) return
      const hard = trick.grade === 'crash' || trick.grade === 'sketchy'
      const impact = Math.min(1, 0.2 + Math.sqrt(Math.max(0, trick.efh) * 19.6) * 0.05)
      rumble(hard ? 0.35 : 0.2 * impact, hard ? 0.85 : 0.35 + impact * 0.45, hard ? 140 : 70)
    },
    update(s: SkiState, now: number) {
      if (!enabled || motion?.matches) {
        airborne = !s.grounded
        onRail = Boolean(s.rail)
        crashed = s.crashed > 0
        descent = Math.max(0, -s.vy)
        return
      }
      if (s.crashed > 0 && !crashed) rumble(0.55, 1, 180)
      else if (s.rail && !onRail) rumble(0.2, 0.45, 60)
      else if (airborne && s.grounded && !s.rail && s.crashed <= 0) {
        const impact = Math.min(1, descent / 7)
        if (impact > 0.12) rumble(0.15 * impact, 0.25 + impact * 0.5, 50 + impact * 60)
      }
      if (s.chatter > 0.08 && now >= nextPulse) {
        rumble(0.12 + s.chatter * 0.5, s.chatter * 0.22, 85)
        nextPulse = now + 70
      }
      airborne = !s.grounded
      onRail = Boolean(s.rail)
      crashed = s.crashed > 0
      descent = Math.max(0, -s.vy)
    },
  }
}
