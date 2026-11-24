import type { SkiState } from '../sim'
import { featureAhead, type PlacedFeature } from '../world/park'

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function parkSpeedCue(kmh: number, low: number, high: number) {
  return kmh < low ? 'Build speed' : kmh > high ? 'Scrub speed' : 'On pace'
}

export function railCue(balance: number) {
  const lean = Math.abs(balance)
  return {
    position: (clamp(balance, -1, 1) + 1) * 50,
    label: lean < 0.2 ? 'Centred' : balance < 0 ? 'Steer right' : 'Steer left',
    tone: lean > 0.72 ? 'danger' : lean > 0.38 ? 'caution' : 'ready',
  }
}

export function createParkHud(panel: HTMLElement) {
  const context = panel.querySelector<HTMLElement>('.park-cue-context')!
  const title = panel.querySelector<HTMLElement>('.park-cue-title')!
  const status = panel.querySelector<HTMLElement>('.park-cue-status')!
  const range = panel.querySelector<HTMLElement>('.park-cue-range')!
  const gauge = panel.querySelector<HTMLElement>('.park-cue-gauge')!
  const setText = (node: HTMLElement, value: string) => {
    if (node.textContent !== value) node.textContent = value
  }
  const show = (kind: 'rail' | 'jump', tone: string, top: string, name: string, cue: string, detail: string) => {
    panel.hidden = false
    if (panel.dataset.kind !== kind) panel.dataset.kind = kind
    if (panel.dataset.tone !== tone) panel.dataset.tone = tone
    setText(context, top)
    setText(title, name)
    setText(status, cue)
    setText(range, detail)
  }
  return {
    update(state: SkiState, features: PlacedFeature[], skiing: boolean) {
      if (!skiing || state.crashed > 0 || !state.grounded) {
        panel.hidden = true
        return
      }
      if (state.rail) {
        const rail = state.rail
        const cue = railCue(rail.balance)
        const stance = rail.press === 'nose' ? 'Nose press' : rail.press === 'tail' ? 'Tail press' : rail.style === '5050' ? '50/50' : 'Slide'
        show('rail', cue.tone, 'Balance', rail.rail.kind === 'box' ? 'On the box' : 'On the rail', cue.label, stance)
        gauge.style.setProperty('--cursor', `${cue.position.toFixed(1)}%`)
        return
      }
      const travel = Math.hypot(state.vx, state.vz)
      const next = travel > 2 && features.length ? featureAhead(features, state.x, state.z, state.vx / travel, state.vz / travel) : null
      const speedRange = next?.feature.spec.speed
      if (!next || !speedRange) {
        panel.hidden = true
        return
      }
      const [low, high] = speedRange
      const speed = state.speed * 3.6
      const cue = parkSpeedCue(speed, low, high)
      const distance = Math.ceil(next.distance)
      const max = high + (high - low)
      show('jump', cue === 'On pace' ? 'ready' : cue === 'Scrub speed' ? 'danger' : 'caution', `${distance} m to lip`,
        next.feature.spec.label.split(' · ')[0], cue, `${low}–${high} km/h target`)
      gauge.style.setProperty('--band-start', `${(low / max * 100).toFixed(1)}%`)
      gauge.style.setProperty('--band-width', `${((high - low) / max * 100).toFixed(1)}%`)
      gauge.style.setProperty('--cursor', `${(clamp(speed / max, 0, 1) * 100).toFixed(1)}%`)
    },
  }
}
