/**
 * First-run coaching: a short tutorial on the bunny hill and one-time tips
 * the first time something happens (powder, a park, a crash, a steep pitch).
 * Steps finish on what the skier actually does; a Next button appears if
 * one takes too long, and the whole thing can be skipped.
 */
import type { SkiInput, SkiState } from '../sim'
import { escapeHtml } from './format'
import { KEYS, readJson, writeJson } from './storage'

export type InputMode = 'keys' | 'touch' | 'pad'

interface Step {
  title: string
  /** Instruction text per input mode. */
  text: Record<InputMode, string>
  /** Start this lesson from the top of the bunny hill, facing down (it needs speed). */
  fromTop?: boolean
  /** Called every frame while the step is current; return true when done. */
  check: (skier: SkiState, input: SkiInput, dt: number, memo: Record<string, number>) => boolean
}

const deg = (rad: number) => (rad * 180) / Math.PI

export const STEPS: Step[] = [
  {
    title: 'Get moving',
    text: {
      keys: 'Hold <kbd>W</kbd> or <kbd>↑</kbd> to push off and tuck.',
      touch: 'Push the stick up to push off and tuck.',
      pad: 'Push the left stick up to push off and tuck.',
    },
    check: (s) => s.speed > 4,
  },
  {
    title: 'Turn both ways',
    text: {
      keys: 'Hold <kbd>A</kbd> or <kbd>D</kbd> to turn. Hold longer for a sharper turn. Turn left and right.',
      touch: 'Move the stick left and right to turn. Further means a sharper turn.',
      pad: 'Left stick left and right to turn. Further means a sharper turn.',
    },
    check: (s, input, dt, memo) => {
      if (input.steer < -0.3) memo.left = (memo.left ?? 0) + dt
      if (input.steer > 0.3) memo.right = (memo.right ?? 0) + dt
      return (memo.left ?? 0) > 0.8 && (memo.right ?? 0) > 0.8 && s.speed > 1
    },
  },
  {
    title: 'Stop',
    text: {
      keys: 'Hold <kbd>S</kbd> or <kbd>↓</kbd> to snowplough to a stop, or turn hard across the hill.',
      touch: 'Pull the stick down to snowplough to a stop, or turn hard across the hill.',
      pad: 'Pull the stick down or squeeze <kbd>LT</kbd> to stop, or turn hard across the hill.',
    },
    check: (s, _input, _dt, memo) => {
      if (s.speed > 3.5) memo.fast = 1
      return memo.fast === 1 && s.speed < 0.6
    },
  },
  {
    title: 'Carve',
    fromTop: true,
    text: {
      keys: 'Pick up a little speed, then steer smoothly and hold the turn. Clean edges leave thin lines and lose no speed. Skidding sprays snow.',
      touch: 'Pick up a little speed, then steer smoothly and hold the turn. Clean edges leave thin lines. Skidding sprays snow.',
      pad: 'Pick up a little speed, then ease the stick over and hold it. Clean edges leave thin lines. Skidding sprays snow.',
    },
    check: (s, _input, dt, memo) => {
      const clean = s.grounded && s.speed > 3 && s.skid < 0.3 && deg(Math.abs(s.edgeAngle)) > 12
      memo.carve = clean ? (memo.carve ?? 0) + dt : Math.max(0, (memo.carve ?? 0) - dt * 0.5)
      return memo.carve > 1.2
    },
  },
  {
    title: 'Jump',
    text: {
      keys: 'Hold <kbd>Space</kbd> to crouch, then let go to pop into the air.',
      touch: 'Hold <b>Jump</b> to crouch, then let go to pop.',
      pad: 'Hold <kbd>A</kbd> to crouch, then let go to pop.',
    },
    check: (s) => Boolean(s.air && s.air.time > 0.2),
  },
  {
    title: 'Grab',
    text: {
      keys: 'Jump again, and while you are in the air hold <kbd>J</kbd> (or <kbd>Shift</kbd>) to grab.',
      touch: 'Jump again, and in the air hold <b>Grab</b>.',
      pad: 'Jump again, and in the air hold <kbd>X</kbd> or <kbd>RB</kbd> to grab.',
    },
    check: (s) => Boolean(s.air?.grab),
  },
]

const FINISH: Record<InputMode, string> = {
  keys: 'Ride the Magic Carpet or press <kbd>T</kbd> to pick a run. <kbd>H</kbd> opens challenges.',
  touch: 'Ride the Magic Carpet, or open Pause for runs and challenges.',
  pad: 'Ride the Magic Carpet, or press <kbd>Start</kbd> for runs and challenges.',
}

/** Seconds on one step before Next appears. */
const NEXT_AFTER = 20

interface Saved {
  done: boolean
  tips: string[]
}

export function readCoach(): Saved {
  return readJson<Saved>(KEYS.coach, { done: false, tips: [] })
}

export function createCoach(card: HTMLElement, mode: () => InputMode, actions: { onExit: () => void; toTop: (message: string) => void }) {
  const saved = readCoach()
  let index = -1
  let stepTime = 0
  let memo: Record<string, number> = {}
  let tipTimer = 0
  const save = () => writeJson(KEYS.coach, saved)

  const renderStep = () => {
    const step = STEPS[index]
    card.className = 'coach lesson'
    card.innerHTML =
      `<p class="coach-count">Lesson ${index + 1} of ${STEPS.length}</p>` +
      `<h3>${escapeHtml(step.title)}</h3><p>${step.text[mode()]}</p>` +
      '<div class="coach-buttons"><button type="button" class="skip">Skip tutorial</button></div>'
    card.querySelector('.skip')!.addEventListener('click', () => finish(true))
    card.hidden = false
  }
  const showNext = () => {
    if (card.querySelector('.next')) return
    const next = document.createElement('button')
    next.type = 'button'
    next.className = 'next'
    next.textContent = 'Next ▸'
    next.addEventListener('click', advance)
    card.querySelector('.coach-buttons')!.prepend(next)
  }
  const advance = () => {
    index++
    stepTime = 0
    memo = {}
    if (index >= STEPS.length) finish(false)
    else {
      renderStep()
      if (STEPS[index].fromTop) actions.toTop(`Lesson ${index + 1}: ${STEPS[index].title}`)
    }
  }
  const finish = (skipped: boolean) => {
    index = -1
    saved.done = true
    save()
    if (skipped) {
      card.hidden = true
      actions.onExit()
      return
    }
    card.className = 'coach lesson done'
    card.innerHTML = `<h3>Nice skiing!</h3><p>${FINISH[mode()]}</p><div class="coach-buttons"><button type="button" class="next">Done</button></div>`
    card.querySelector('.next')!.addEventListener('click', () => {
      card.hidden = true
      actions.onExit()
    })
    window.clearTimeout(tipTimer)
    tipTimer = window.setTimeout(() => {
      if (card.classList.contains('done')) {
        card.hidden = true
        actions.onExit()
      }
    }, 9000)
  }

  return {
    get active() {
      return index >= 0
    },
    get done() {
      return saved.done
    },
    start() {
      window.clearTimeout(tipTimer)
      index = -1
      advance()
    },
    stop() {
      if (index >= 0) {
        index = -1
        card.hidden = true
      }
    },
    /** Per frame while skiing. */
    update(skier: SkiState, input: SkiInput, dt: number) {
      if (index < 0) return
      stepTime += dt
      if (STEPS[index].check(skier, input, dt, memo)) {
        card.classList.add('passed')
        window.setTimeout(() => card.classList.remove('passed'), 400)
        advance()
        return
      }
      if (stepTime > NEXT_AFTER) showNext()
    },
    /** A one-time tip, shown once ever per id (not during the tutorial). */
    tip(id: string, title: string, text: string) {
      if (index >= 0 || saved.tips.includes(id)) return
      saved.tips.push(id)
      save()
      card.className = 'coach tip'
      card.innerHTML = `<h3>${escapeHtml(title)}</h3><p>${text}</p>`
      card.hidden = false
      window.clearTimeout(tipTimer)
      tipTimer = window.setTimeout(() => {
        if (card.classList.contains('tip')) card.hidden = true
      }, 7000)
    },
  }
}

export type Coach = ReturnType<typeof createCoach>
