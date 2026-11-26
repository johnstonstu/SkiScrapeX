/**
 * Competition overlays: the start countdown (3, 2, 1, GO) and the mogul beat
 * strip (the next turns as arrows with a ring closing on the beat). Plain DOM.
 */
import { escapeHtml } from '../app/format'

export interface BeatCue {
  /** -1 left, 1 right. */
  dir: -1 | 1
  /** Seconds until this turn's beat. */
  inSeconds: number
}

export function createRaceHud(parent: HTMLElement = document.body) {
  const count = document.createElement('div')
  count.id = 'race-count'
  count.hidden = true
  const strip = document.createElement('div')
  strip.id = 'beat-strip'
  strip.hidden = true
  strip.innerHTML = '<div class="beat-ring"></div><div class="beat-cues"></div><div class="beat-meta"></div>'
  parent.append(count, strip)
  const ring = strip.querySelector<HTMLElement>('.beat-ring')!
  const cues = strip.querySelector<HTMLElement>('.beat-cues')!
  const meta = strip.querySelector<HTMLElement>('.beat-meta')!
  let countTimer = 0
  let lastCount = ''
  let lastCues = ''

  return {
    /** Show the count (3, 2, 1), GO, a short message, or nothing. */
    setCount(text: string | null, tone: 'count' | 'go' | 'warn' = 'count') {
      window.clearTimeout(countTimer)
      if (!text) {
        count.hidden = true
        lastCount = ''
        return
      }
      if (text === lastCount && !count.hidden) return
      lastCount = text
      count.textContent = text
      count.className = tone
      count.hidden = false
      // Restart the pop animation on every new number.
      count.style.animation = 'none'
      void count.offsetWidth
      count.style.animation = ''
      if (tone !== 'count') countTimer = window.setTimeout(() => (count.hidden = true), 900)
    },
    /** The mogul beat strip: the next turns, how close the first is to its beat, streak and speed. */
    setBeats(next: BeatCue[] | null, streak = 0, speedKmh = 0, window = 0.18) {
      if (!next) {
        strip.hidden = true
        lastCues = ''
        return
      }
      strip.hidden = false
      const html = next
        .slice(0, 4)
        .map((cue, i) => `<span class="cue ${cue.dir < 0 ? 'left' : 'right'}${i === 0 ? ' now' : ''}">${cue.dir < 0 ? '◀' : '▶'}</span>`)
        .join('')
      if (html !== lastCues) {
        cues.innerHTML = html
        lastCues = html
      }
      // The ring closes onto the first arrow as its beat arrives; it glows inside the timing window.
      const t = next[0] ? Math.max(0, Math.min(1, next[0].inSeconds / 0.8)) : 1
      ring.style.transform = `translate(-50%, -50%) scale(${1 + t * 1.6})`
      ring.classList.toggle('hot', Boolean(next[0]) && next[0].inSeconds <= window)
      meta.innerHTML = escapeHtml(`Streak ${streak} · ${Math.round(speedKmh)} km/h`)
    },
    hideAll() {
      this.setCount(null)
      this.setBeats(null)
    },
  }
}

export type RaceHud = ReturnType<typeof createRaceHud>
