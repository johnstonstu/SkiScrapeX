/**
 * The pick before dropping in: skis or snowboard, and who is riding. It sits
 * on the title screen between Free ski and the chair, with the rider standing
 * over the mountain. One press of Drop in (it has the focus) keeps last
 * time's choice. Plain DOM; styles in ui/menus.css ("Drop-in pick").
 */
import { RIDERS, rideOf, riderOf, setRide, wearRider, type Ride, type RiderLook } from '../app/riders'
import { escapeHtml } from '../app/format'
import type { Outfit, SkiModel } from './riderPanel'
import { createRiderPreview } from './riderPreview'

export interface DropInActions {
  /** The outfit changed: redraw the rider, save it. */
  onChange: (outfit: Outfit) => void
  /** Drop in pressed. */
  go: () => void
  /** Back to the title menu. */
  back: () => void
  /** Open the full Rider & gear panel. */
  customise: () => void
}

const RIDES: { id: Ride; label: string; note: string }[] = [
  { id: 'skis', label: 'Skis', note: 'Two edges and a pair of poles' },
  { id: 'snowboard', label: 'Snowboard', note: 'One board, standing sideways' },
]

export function createDropIn(host: HTMLElement, outfit: Outfit, actions: DropInActions) {
  const root = document.createElement('div')
  root.className = 'dropin'
  root.innerHTML =
    '<div class="dropin-stage" aria-hidden="true"></div>' +
    '<div class="dropin-card">' +
    '<p class="eyebrow">Free ski · Top of Quickdraw</p>' +
    '<h2>Who is riding?</h2>' +
    '<div class="dropin-rides" role="group" aria-label="Skis or snowboard"></div>' +
    '<div class="dropin-riders" role="group" aria-label="Rider"></div>' +
    '<p class="dropin-line" aria-live="polite"></p>' +
    '<div class="dropin-actions"><button type="button" class="primary go"><span>Drop in</span></button>' +
    '<button type="button" class="link custom">Rider &amp; gear</button><button type="button" class="link back">Back</button></div>' +
    '</div>'
  const stage = root.querySelector<HTMLElement>('.dropin-stage')!
  const rides = root.querySelector<HTMLElement>('.dropin-rides')!
  const riders = root.querySelector<HTMLElement>('.dropin-riders')!
  const line = root.querySelector<HTMLElement>('.dropin-line')!
  const go = root.querySelector<HTMLButtonElement>('.go')!
  go.addEventListener('click', actions.go)
  root.querySelector('.custom')!.addEventListener('click', actions.customise)
  root.querySelector('.back')!.addEventListener('click', actions.back)

  let preview: ReturnType<typeof createRiderPreview> | null = null
  /** The ski model to return to after trying the snowboard. */
  let lastSkis: SkiModel = outfit.model === 'snowboard' ? 'allMountain' : outfit.model
  /** The player's own look (made in Rider & gear), kept so picking a starter rider does not lose it. */
  let own: RiderLook | null = null

  const changed = () => {
    actions.onChange(outfit)
    preview?.setOutfit(outfit)
    render()
  }

  const render = () => {
    const focused = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) ? document.activeElement.dataset.pick : undefined
    if (outfit.model !== 'snowboard') lastSkis = outfit.model
    const current = riderOf(outfit)
    if (!current) {
      const { model: _model, ...look } = outfit
      own = look
    }
    rides.innerHTML = ''
    for (const ride of RIDES) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dropin-ride'
      button.dataset.pick = `ride:${ride.id}`
      button.setAttribute('aria-pressed', String(rideOf(outfit) === ride.id))
      button.innerHTML = `<strong>${ride.label}</strong><small>${ride.note}</small>`
      button.addEventListener('click', () => {
        setRide(outfit, ride.id, lastSkis)
        changed()
      })
      rides.append(button)
    }
    riders.innerHTML = ''
    const chip = (id: string, name: string, look: RiderLook, pressed: boolean, pick: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dropin-rider'
      button.dataset.pick = `rider:${id}`
      button.setAttribute('aria-pressed', String(pressed))
      button.innerHTML =
        `<span class="dropin-swatch" style="--jacket:${look.jacket};--pants:${look.pants};--helmet:${look.helmet}"></span>` + `<span>${escapeHtml(name)}</span>`
      button.addEventListener('click', pick)
      riders.append(button)
    }
    for (const rider of RIDERS) {
      chip(rider.id, rider.name, rider.look, current === rider, () => {
        wearRider(outfit, rider.look)
        changed()
      })
    }
    if (own) {
      const mine = own
      chip('own', 'Your own', mine, !current, () => {
        wearRider(outfit, mine)
        changed()
      })
    }
    line.textContent = current ? current.line : 'Your own look, from Rider & gear'
    if (focused) root.querySelector<HTMLElement>(`[data-pick="${focused}"]`)?.focus()
  }

  return {
    get open() {
      return root.isConnected && host.classList.contains('picking')
    },
    show() {
      host.append(root)
      host.classList.add('picking')
      render()
      preview ??= createRiderPreview(stage, { full: true })
      preview.setOutfit(outfit)
      preview.start()
      go.focus()
    },
    hide() {
      host.classList.remove('picking')
      preview?.stop()
      root.remove()
    },
    /** The outfit was changed somewhere else (Rider & gear). */
    refresh() {
      if (!root.isConnected) return
      preview?.setOutfit(outfit)
      preview?.resize()
      render()
    },
  }
}

export type DropIn = ReturnType<typeof createDropIn>
