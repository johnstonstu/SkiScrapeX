import type { Rail, SkiState } from '../sim'
import { approachAim, LANE_NAMES, type PlacedFeature } from '../world/park'
import type { JumpLanding, PaceCue } from './parkPace'

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** The cue for a lip speed against a jump's window (all km/h). */
export function parkSpeedCue(kmh: number, low: number, high: number) {
  return kmh < low ? 'Build speed' : kmh > high ? 'Scrub speed' : 'On pace'
}

/** What a landing outcome says on the cue, and its tone. */
export const LANDING_CUE: Record<JumpLanding['outcome'], { title: string; tone: string; detail: string }> = {
  sweet: { title: 'Sweet spot', tone: 'ready', detail: 'Landed on the slope' },
  cased: { title: 'Cased the deck', tone: 'caution', detail: 'More speed next time' },
  overshot: { title: 'Overshot', tone: 'danger', detail: 'Scrub before the lip' },
}

/** Seconds a landing result stays on the cue. */
const RESULT_TIME = 1.6

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
  /** The gauge spans 0 to the window's top plus its width; the band is the landing window. */
  const placeGauge = (kmh: number, low: number, high: number) => {
    const max = high + (high - low)
    gauge.style.setProperty('--band-start', `${((low / max) * 100).toFixed(1)}%`)
    gauge.style.setProperty('--band-width', `${(((high - low) / max) * 100).toFixed(1)}%`)
    gauge.style.setProperty('--cursor', `${(clamp(kmh / max, 0, 1) * 100).toFixed(1)}%`)
  }
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
  let result: { landing: JumpLanding; until: number } | null = null
  return {
    /** A jump came down: show where (the "out" half of the cue). */
    landed(landing: JumpLanding, now: number) {
      result = { landing, until: now + RESULT_TIME * 1000 }
    },
    /**
     * `cue` is the park assist's view of the next jump: its predicted lip
     * speed against the jump's landing window (the "in" half).
     */
    update(state: SkiState, features: PlacedFeature[], skiing: boolean, rails: readonly Rail[] = [], cue: PaceCue | null = null, now = performance.now()) {
      if (!skiing || state.crashed > 0) {
        panel.hidden = true
        result = null
        return
      }
      if (result && now < result.until && !state.rail) {
        const { landing } = result
        const text = LANDING_CUE[landing.outcome]
        const [low, high] = landing.feature.window!.map((v) => Math.round(v * 3.6))
        const lip = Math.round(landing.lipSpeed * 3.6)
        show('jump', text.tone, landing.feature.spec.label, text.title, `${lip} km/h`, `${text.detail} · ${low}–${high}`)
        placeGauge(lip, low, high)
        return
      }
      result = null
      if (!state.grounded && !state.rail) {
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
      const dirX = travel > 0.2 ? state.vx / travel : -Math.sin(state.heading)
      const dirZ = travel > 0.2 ? state.vz / travel : Math.cos(state.heading)
      if (cue && cue.distance < 60) {
        const [low, high] = cue.feature.window!.map((v) => Math.round(v * 3.6))
        const lip = Math.round(cue.predicted * 3.6)
        const call = lip < low ? 'Too slow · tuck' : lip > high ? 'Too fast · scrub' : 'Sweet spot'
        const lane = LANE_NAMES[cue.feature.lane ?? 0] ?? ''
        show('jump', call === 'Sweet spot' ? 'ready' : lip > high ? 'danger' : 'caution', `${Math.ceil(cue.distance)} m to lip · ${lane}`,
          cue.feature.spec.label, call, `Lip ${lip} km/h · land ${low}–${high}`)
        placeGauge(lip, low, high)
        return
      }
      const aim = travel > 2 ? approachAim(features, rails, state.x, state.z, dirX, dirZ, 36) : null
      if (aim?.kind === 'rail') {
        show('rail', 'ready', `${Math.ceil(aim.distance)} m ahead`, aim.label, 'Line up', 'Hop on · press for points')
        gauge.style.setProperty('--band-start', '35%')
        gauge.style.setProperty('--band-width', '30%')
        gauge.style.setProperty('--cursor', '50%')
        return
      }
      panel.hidden = true
    },
  }
}
