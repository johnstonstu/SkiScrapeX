import type { TrickEvent } from '../sim'
import { escapeHtml } from './format'

/** A trick must score this much, and be new to the combo, to raise the multiplier. */
export const COMBO_MIN_POINTS = 100
/** Seconds on the snow before an open combo banks. */
export const COMBO_GROUND_TIME = 3
/**
 * Riding on toward the next park feature, the combo stays open this much
 * longer (the ground clock runs at a quarter speed), so a whole line links.
 */
export const COMBO_LINE_SLOWDOWN = 0.25
/** Points for a jump landed in the sweet spot, as a share of the trick. */
export const SWEET_SPOT_BONUS = 0.25

/** Where a park jump came down, for the trick card. */
export type LandingSpot = 'sweet' | 'cased' | 'overshot'
const SPOT_NOTE: Record<LandingSpot, string> = { sweet: 'sweet spot', cased: 'cased', overshot: 'overshot' }

/** The highest combo multiplier. */
export const MAX_MULTIPLIER = 5

/**
 * One line of advice for a park results card, from how the run scored: the
 * scoring rules a first run does not show (repeats halve, new tricks build
 * the multiplier). Null when there is nothing to teach.
 */
export function parkAdvice(stats: { repeats: number; repeatLoss: number; bestMultiplier: number }, tricksLanded: number): string | null {
  if (tricksLanded === 0) return 'Hold jump on the run-in and let go at the lip. Hold grab in the air.'
  if (stats.repeats >= 2 && stats.repeatLoss > 0)
    return `Repeats cost you ${stats.repeatLoss.toLocaleString()} points: the same trick again scores half. Change the grab, add a spin or take a rail.`
  if (stats.bestMultiplier < 3) return `Your combo reached ×${stats.bestMultiplier} of ×${MAX_MULTIPLIER}. Each different trick in a line adds one.`
  return null
}

export interface ComboState {
  tricks: string[]
  /** Tricks that raised the multiplier. */
  counted: number
  multiplier: number
  points: number
}

/**
 * Add a trick to the open combo and return the points it scored. Repeats
 * halve each time. Only new tricks worth `COMBO_MIN_POINTS` raise the
 * multiplier, so a string of small ollies or the same trick again adds
 * its points but not another ×1.
 */
export function addToCombo(combo: ComboState, name: string, basePoints: number): number {
  const repeats = combo.tricks.filter((n) => n === name).length
  const points = Math.round(basePoints * Math.pow(0.5, repeats))
  combo.tricks.push(name)
  combo.points += points
  if (repeats === 0 && points >= COMBO_MIN_POINTS) combo.counted++
  combo.multiplier = Math.min(MAX_MULTIPLIER, Math.max(1, combo.counted))
  return points
}

/**
 * Trick pop-ups and combos: each new trick shows with its points, tricks
 * chain into a combo, and the combo banks after 3 s on the ground. A bail
 * loses the combo.
 */
export function createTrickFeed(element: HTMLElement, hooks: { onBank?: (points: number) => void } = {}) {
  let lastSeq = 0
  let timer = 0
  // Race formats are timed, not judged: tricks still happen but score nothing and pop nothing.
  let muted = false
  const combo = { tricks: [] as string[], counted: 0, multiplier: 1, points: 0, groundTime: 0, total: 0 }
  const stats = { landed: 0, perfect: 0, clean: 0, railMetres: 0, bestName: '', bestPoints: 0, repeats: 0, repeatLoss: 0, bestMultiplier: 1 }
  /** Pop a card: title, a small grade line, then points and the combo multiplier. */
  const show = (title: string, detail: string, kind: string, points = '', multiplier = 1) => {
    element.innerHTML =
      `<strong>${escapeHtml(title)}</strong><span class="trick-detail">${escapeHtml(detail)}</span>` +
      (points ? `<span class="trick-points">${escapeHtml(points)}${multiplier > 1 ? `<span class="trick-combo">×${multiplier}</span>` : ''}</span>` : '')
    // Restart the entry animation for every new card.
    element.className = ''
    void element.offsetWidth
    element.className = `on ${kind}`
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (element.className = `out ${kind}`), 2200)
  }
  const drop = () => {
    combo.tricks = []
    combo.counted = 0
    combo.points = 0
    combo.multiplier = 1
  }
  return {
    show,
    stats,
    /** Points banked since the last `resetTotal`, plus any combo still open. */
    get total() {
      return combo.total + combo.points * combo.multiplier
    },
    resetTotal() {
      combo.total = 0
      drop()
      lastSeq = 0
      Object.assign(stats, { landed: 0, perfect: 0, clean: 0, railMetres: 0, bestName: '', bestPoints: 0, repeats: 0, repeatLoss: 0, bestMultiplier: 1 })
      window.clearTimeout(timer)
      element.className = ''
    },
    /** Lose the combo without banking it (a crash or a restart). */
    drop,
    /** Bank the open combo now, without a card: the end of a park run or a lap. */
    bankNow() {
      if (!combo.tricks.length) return
      const banked = combo.points * combo.multiplier
      combo.total += banked
      hooks.onBank?.(banked)
      drop()
    },
    /** Mute trick cards and combos (race formats). Tricks are still reported as new. */
    setMuted(on: boolean) {
      muted = on
      if (on) drop()
    },
    /** `spot`: where a park jump came down; the sweet spot scores a bonus. */
    onTrick(trick: TrickEvent | null, spot: LandingSpot | null = null) {
      if (!trick || trick.seq === lastSeq) return false
      lastSeq = trick.seq
      if (muted) return true
      navigator.vibrate?.(trick.grade === 'crash' ? 120 : trick.grade === 'perfect' ? [20, 40, 20] : 25)
      if (trick.grade === 'crash') {
        show('Bail!', trick.name, 'crash')
        drop()
        return true
      }
      const sweet = trick.kind === 'air' && spot === 'sweet'
      const full = Math.round(trick.points * (sweet ? 1 + SWEET_SPOT_BONUS : 1))
      const points = addToCombo(combo, trick.name, full)
      // A trick already in this combo scores half each time: say so, and count what it cost.
      const repeat = points < full
      stats.landed++
      if (repeat) {
        stats.repeats++
        stats.repeatLoss += full - points
      }
      stats.bestMultiplier = Math.max(stats.bestMultiplier, combo.multiplier)
      combo.groundTime = 0
      if (trick.kind === 'rail') stats.railMetres += trick.railMetres
      else if (trick.grade === 'perfect') stats.perfect++
      else if (trick.grade === 'clean') stats.clean++
      if (points > stats.bestPoints) {
        stats.bestName = trick.name
        stats.bestPoints = points
      }
      const grade = trick.kind === 'rail'
        ? (trick.grade === 'sketchy' ? 'Slipped off' : 'Clean exit')
        : trick.grade === 'perfect' ? 'Perfect landing' : trick.grade === 'sketchy' ? 'Sketchy landing' : 'Clean landing'
      const note = trick.kind === 'air' && spot ? ` · ${SPOT_NOTE[spot]}${sweet ? ` +${Math.round(SWEET_SPOT_BONUS * 100)}%` : ''}` : ''
      show(trick.name, grade + note + (repeat ? ' · repeat, half points' : ''), trick.grade, `+${points.toLocaleString()}`, combo.multiplier)
      return true
    },
    /**
     * Call every step with whether the skier is on the snow (not air, not
     * rail), and whether a park feature is coming up on the line (the combo
     * then holds open much longer, so a run of features links).
     */
    update(dt: number, onSnow: boolean, lineAhead = false) {
      if (!combo.tricks.length) return
      if (onSnow) combo.groundTime += dt * (lineAhead ? COMBO_LINE_SLOWDOWN : 1)
      if (combo.groundTime > COMBO_GROUND_TIME) {
        const banked = combo.points * combo.multiplier
        combo.total += banked
        hooks.onBank?.(banked)
        show(combo.multiplier > 1 ? `Combo ×${combo.multiplier}` : 'Banked', `${combo.total.toLocaleString()} total`, 'bank', `+${banked.toLocaleString()}`)
        drop()
      }
    },
  }
}
