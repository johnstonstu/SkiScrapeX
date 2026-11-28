/**
 * The frame around the opening film: thin bars top and bottom, a place card,
 * a quiet Skip, and no HUD until the rider is off the chair. Plain DOM and
 * CSS (ui/hud.css, "Opening film").
 */
export function createCinematic(host: HTMLElement, onSkip: () => void) {
  const eyebrow = host.querySelector<HTMLElement>('.eyebrow')!
  const title = host.querySelector<HTMLElement>('h2')!
  const sub = host.querySelector<HTMLElement>('.cine-sub')!
  const skip = host.querySelector<HTMLButtonElement>('button')!
  let enterTimer = 0
  skip.addEventListener('click', onSkip)
  return {
    get on() {
      return host.classList.contains('on')
    },
    start(card: { eyebrow: string; title: string; sub: string }, skipLabel: string) {
      eyebrow.textContent = card.eyebrow
      title.textContent = card.title
      sub.textContent = card.sub
      skip.innerHTML = skipLabel
      window.clearTimeout(enterTimer)
      document.body.classList.remove('hud-enter')
      document.body.classList.add('cinematic')
      // Restart the card and wash animations when one film follows another.
      host.classList.remove('on')
      void host.offsetWidth
      host.classList.add('on')
    },
    /** The bars slide away and the HUD fades in. */
    end() {
      if (!document.body.classList.contains('cinematic')) return
      host.classList.remove('on')
      document.body.classList.remove('cinematic')
      document.body.classList.add('hud-enter')
      enterTimer = window.setTimeout(() => document.body.classList.remove('hud-enter'), 1400)
    },
  }
}
