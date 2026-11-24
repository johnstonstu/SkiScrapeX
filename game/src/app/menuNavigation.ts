import type { MenuCommand } from '../player/gamepad'

const focusable = (panel: HTMLElement) => [...panel.querySelectorAll<HTMLElement>(
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]',
)].filter((node) => node.tabIndex >= 0 && node.getClientRects().length > 0)

export function createMenuNavigation() {
  let panel: HTMLElement | null = null
  window.addEventListener('keydown', (event) => {
    if (!panel || event.key !== 'Tab') return
    const choices = focusable(panel)
    const first = choices[0], last = choices.at(-1)
    if (!first || !last) return
    const active = document.activeElement
    if (!panel.contains(active) || active === (event.shiftKey ? first : last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  })

  return {
    sync(next: HTMLElement | null) {
      if (next === panel) return
      panel = next
      if (!panel || panel.contains(document.activeElement)) return
      const choices = focusable(panel)
      ;(choices.find((choice) => choice.matches('#btn-resume, .primary')) ?? choices[0])?.focus()
    },
    move(command: Exclude<MenuCommand, 'back'>) {
      if (!panel) return
      const choices = focusable(panel)
      const current = choices.find((item) => item === document.activeElement)
      if (!current) {
        choices[0]?.focus()
        return
      }
      if (command === 'accept') {
        if (current instanceof HTMLInputElement && current.type === 'range') return
        current.click()
        if (!panel.hidden && !current.isConnected && !panel.contains(document.activeElement)) {
          const updated = focusable(panel)
          updated[Math.min(choices.indexOf(current), updated.length - 1)]?.focus()
        }
        return
      }
      const horizontal = command === 'left' || command === 'right'
      const sign = command === 'left' || command === 'up' ? -1 : 1
      if (horizontal && current instanceof HTMLInputElement && current.type === 'range') {
        if (sign > 0) current.stepUp()
        else current.stepDown()
        current.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      const rect = current.getBoundingClientRect()
      let next: HTMLElement | null = null
      let best = Infinity
      for (const item of choices) {
        if (item === current) continue
        const other = item.getBoundingClientRect()
        const x = other.left + other.width / 2 - rect.left - rect.width / 2
        const y = other.top + other.height / 2 - rect.top - rect.height / 2
        const forward = (horizontal ? x : y) * sign
        if (forward < 3) continue
        const across = Math.abs(horizontal ? y : x)
        const score = forward + across * 3 + (across > forward ? 50 : 0)
        if (score >= best) continue
        next = item
        best = score
      }
      next?.focus()
    },
  }
}
