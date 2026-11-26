import type { TrickEvent } from '../sim'
import { escapeHtml } from './format'

/** A trick must score this much, and be new to the combo, to raise the multiplier. */
export const COMBO_MIN_POINTS = 100

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
  combo.multiplier = Math.min(5, Math.max(1, combo.counted))
  return points
}

/**
 * Trick pop-ups and combos: each new trick shows with its points, tricks
 * chain into a combo, and the combo banks after 3 s on the ground. A bail
 * loses the combo.
 */
export function createTrickFeed(element: HTMLElement) {
  let lastSeq = 0
  let timer = 0
  const combo = { tricks: [] as string[], counted: 0, multiplier: 1, points: 0, groundTime: 0, total: 0 }
  const stats = { perfect: 0, clean: 0, railMetres: 0, bestName: '', bestPoints: 0 }
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
      Object.assign(stats, { perfect: 0, clean: 0, railMetres: 0, bestName: '', bestPoints: 0 })
      window.clearTimeout(timer)
      element.className = ''
    },
    /** Lose the combo without banking it (a crash or a restart). */
    drop,
    onTrick(trick: TrickEvent | null) {
      if (!trick || trick.seq === lastSeq) return false
      lastSeq = trick.seq
      navigator.vibrate?.(trick.grade === 'crash' ? 120 : trick.grade === 'perfect' ? [20, 40, 20] : 25)
      if (trick.grade === 'crash') {
        show('Bail!', trick.name, 'crash')
        drop()
        return true
      }
      const points = addToCombo(combo, trick.name, trick.points)
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
      show(trick.name, grade, trick.grade, `+${points.toLocaleString()}`, combo.multiplier)
      return true
    },
    /** Call every step with whether the skier is on the snow (not air, not rail). */
    update(dt: number, onSnow: boolean) {
      if (!combo.tricks.length) return
      if (onSnow) combo.groundTime += dt
      if (combo.groundTime > 3) {
        const banked = combo.points * combo.multiplier
        combo.total += banked
        show(combo.multiplier > 1 ? `Combo ×${combo.multiplier}` : 'Banked', `${combo.total.toLocaleString()} total`, 'bank', `+${banked.toLocaleString()}`)
        drop()
      }
    },
  }
}
