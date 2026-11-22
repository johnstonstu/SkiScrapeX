import type { TrickEvent } from '../sim'
import { escapeHtml } from './format'

/**
 * Trick pop-ups and combos: each new trick shows with its points, tricks
 * chain into a combo, and the combo banks after 3 s on the ground. A bail
 * loses the combo.
 */
export function createTrickFeed(element: HTMLElement) {
  let lastSeq = 0
  let timer = 0
  const combo = { tricks: [] as string[], multiplier: 1, points: 0, groundTime: 0, total: 0 }
  const show = (title: string, detail: string, kind: string) => {
    element.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`
    element.className = `on ${kind}`
    window.clearTimeout(timer)
    timer = window.setTimeout(() => (element.className = ''), 2200)
  }
  const drop = () => {
    combo.tricks = []
    combo.points = 0
    combo.multiplier = 1
  }
  return {
    show,
    /** Points banked since the last `resetTotal`, plus any combo still open. */
    get total() {
      return combo.total + combo.points * combo.multiplier
    },
    resetTotal() {
      combo.total = 0
      drop()
    },
    /** Lose the combo without banking it (a crash or a restart). */
    drop,
    onTrick(trick: TrickEvent | null) {
      if (!trick || trick.seq === lastSeq) return
      lastSeq = trick.seq
      navigator.vibrate?.(trick.grade === 'crash' ? 120 : trick.grade === 'perfect' ? [20, 40, 20] : 25)
      if (trick.grade === 'crash') {
        show('Bail!', trick.name, 'crash')
        drop()
        return
      }
      const repeats = combo.tricks.filter((name) => name === trick.name).length
      const points = Math.round(trick.points * Math.pow(0.5, repeats))
      combo.tricks.push(trick.name)
      combo.points += points
      combo.multiplier = Math.min(5, combo.tricks.length)
      combo.groundTime = 0
      const grade = trick.grade === 'perfect' ? 'Perfect' : trick.grade === 'sketchy' ? 'Sketchy' : ''
      show(trick.name, `${grade ? grade + ' · ' : ''}+${points}${combo.multiplier > 1 ? ` · combo ×${combo.multiplier}` : ''}`, trick.grade)
    },
    /** Call every step with whether the skier is on the snow (not air, not rail). */
    update(dt: number, onSnow: boolean) {
      if (!combo.tricks.length) return
      if (onSnow) combo.groundTime += dt
      if (combo.groundTime > 3) {
        const banked = combo.points * combo.multiplier
        combo.total += banked
        show(combo.tricks.length > 1 ? `Combo ×${combo.multiplier}` : 'Landed', `+${banked} · ${combo.total.toLocaleString()} total`, 'bank')
        drop()
      }
    },
  }
}
