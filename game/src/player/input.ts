import type { GrabKind, SkiInput } from '../sim'
import { createGamepadInput, type MenuCommand } from './gamepad'
import { rampKeySteer, type KeyChange } from './keySteer'
import { touchModeAfter } from './touchMode'

export interface ControlOptions {
  /** 0.5 to 1.5: how quickly keys and sticks reach full edge. */
  steering: number
  invertPitch: boolean
}

export interface Controls {
  read(): SkiInput
  pollGamepad(inMenu: boolean): MenuCommand[]
  setOptions(options: ControlOptions): void
  /** A gamepad is the most recently used input. */
  readonly gamepad: boolean
  /** Dual-rumble on the active pad when supported. */
  rumble(weak: number, strong: number, durationMs?: number): void
  /** Edge-triggered actions, cleared on read. */
  takeActions(): Set<Action>
  push(action: Action): void
  /** On-screen stick and buttons showing; follows the input last used (`touchMode.ts`). */
  readonly touch: boolean
  /** Called when `touch` changes. */
  onTouchChange(listener: (touch: boolean) => void): void
  clear(): void
  dispose(): void
}

export type Action = 'reset' | 'camera' | 'debug' | 'map' | 'runs' | 'skip' | 'style' | 'settings' | 'challenges' | 'title' | 'pause' | 'player' | 'prevTrack' | 'nextTrack' | `slope${number}`

/** Full stick deflection, CSS pixels (position control: offset maps straight to edge). */
const STICK_RANGE_PX = 60
/** Vertical offset past which the stick means tuck (up) or brake (down). */
const STICK_VERTICAL_PX = 28
/** Keyboard steering ramps like an analog stick: a tap is a light edge, a hold commits. */
const KEY_RISE = 11
const KEY_RELEASE = 10

/**
 * Keyboard everywhere. On touch screens: a floating stick on the left
 * (left/right edge, up tuck, down brake; in the air it spins and flips) and
 * Jump / Grab on the right. Mapping follows the research notes in
 * game/research/ski-physics-and-freestyle.md (position control beats rate
 * control on touch).
 */
export function createControls(root: HTMLElement): Controls {
  const keys = new Set<string>()
  // Keys pressed since the last read. A tap that goes down and up between two
  // frames still counts as held for one read, so a slow frame cannot drop it.
  const tapped = new Set<string>()
  const has = (code: string) => keys.has(code) || tapped.has(code)
  // Steer key changes with their times since the last read, for the time-based ramp.
  const steerKeyCodes = new Set(['ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'])
  const keyWant = () => (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0)
  let steerChanges: KeyChange[] = []
  let readWant = 0
  const noteSteerKey = (code: string) => {
    if (steerKeyCodes.has(code)) steerChanges.push({ t: performance.now(), want: keyWant() })
  }
  const actions = new Set<Action>()
  let touch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')
  const touchListeners: ((touch: boolean) => void)[] = []
  const setTouch = (next: boolean) => {
    if (next === touch) return
    touch = next
    layer.hidden = !touch
    if (!touch) onBlur()
    for (const listener of touchListeners) listener(touch)
  }
  const keyActions: Record<string, Action> = {
    KeyR: 'reset',
    KeyC: 'camera',
    Backquote: 'debug',
    KeyI: 'debug',
    KeyM: 'map',
    KeyT: 'runs',
    KeyO: 'style',
    KeyG: 'settings',
    KeyH: 'challenges',
    KeyP: 'player',
    BracketLeft: 'prevTrack',
    BracketRight: 'nextTrack',
    Enter: 'skip',
    Escape: 'pause',
  }
  let keySteer = 0
  let lastRead = performance.now()
  const options: ControlOptions = { steering: 1, invertPitch: false }
  const gamepad = createGamepadInput()
  const pad = gamepad.state
  let usingPad = false
  let grabKind: GrabKind = 'mute'
  let grabWasHeld = false

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement && event.code !== 'Escape') return
    usingPad = false
    setTouch(touchModeAfter(touch, { kind: 'key', code: event.code }))
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if (event.code === 'Enter' && event.target instanceof HTMLButtonElement) return
    if (!keys.has(event.code)) {
      keys.add(event.code)
      noteSteerKey(event.code)
    }
    tapped.add(event.code)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
    if (event.repeat) return
    const action = keyActions[event.code]
    if (action) actions.add(action)
    if (/^Digit[1-9]$/.test(event.code)) actions.add(`slope${Number(event.code.slice(5))}`)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    keys.delete(event.code)
    noteSteerKey(event.code)
  }
  const onPointer = (event: PointerEvent) => {
    usingPad = false
    setTouch(touchModeAfter(touch, { kind: 'pointer', pointerType: event.pointerType }))
  }
  const onBlur = () => {
    keys.clear()
    tapped.clear()
    steerChanges = []
    readWant = 0
    keySteer = 0
    grabWasHeld = false
    stick.pointer = null
    stick.x = stick.y = 0
    base.classList.remove('on')
    thumb.classList.remove('on')
    held.clear()
    for (const button of layer.querySelectorAll('.hold.on')) button.classList.remove('on')
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('pointerdown', onPointer)

  // Touch layer: floating stick + two action buttons.
  const stick = { pointer: null as number | null, ox: 0, oy: 0, x: 0, y: 0 }
  const held = new Set<'jump' | 'grab'>()
  const layer = document.createElement('div')
  layer.id = 'touch'
  layer.hidden = !touch
  layer.innerHTML = `
    <div class="steer-zone" aria-label="Drag to steer; up to tuck, down to brake"><span class="base"></span><span class="thumb"></span></div>
    <button type="button" class="hold jump" data-hold="jump">Jump</button>
    <button type="button" class="hold grab" data-hold="grab">Grab</button>
  `
  root.append(layer)
  const zone = layer.querySelector<HTMLElement>('.steer-zone')!
  const base = layer.querySelector<HTMLElement>('.base')!
  const thumb = layer.querySelector<HTMLElement>('.thumb')!

  zone.addEventListener('pointerdown', (event) => {
    if (stick.pointer !== null) return
    stick.pointer = event.pointerId
    stick.ox = event.clientX
    stick.oy = event.clientY
    zone.setPointerCapture(event.pointerId)
    for (const el of [base, thumb]) {
      el.style.left = `${event.clientX}px`
      el.style.top = `${event.clientY}px`
      el.classList.add('on')
    }
    thumb.style.transform = 'translate(-50%, -50%)'
  })
  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stick.pointer) return
    const dx = event.clientX - stick.ox
    const dy = event.clientY - stick.oy
    stick.x = Math.max(-1, Math.min(1, dx / STICK_RANGE_PX))
    stick.y = Math.max(-1, Math.min(1, dy / STICK_RANGE_PX))
    const length = Math.hypot(dx, dy)
    const clampTo = Math.min(1, STICK_RANGE_PX / Math.max(length, 1))
    thumb.style.transform = `translate(-50%, -50%) translate(${dx * clampTo}px, ${dy * clampTo}px)`
  })
  const endStick = (event: PointerEvent) => {
    if (event.pointerId !== stick.pointer) return
    stick.pointer = null
    stick.x = stick.y = 0
    base.classList.remove('on')
    thumb.classList.remove('on')
  }
  zone.addEventListener('pointerup', endStick)
  zone.addEventListener('pointercancel', endStick)

  for (const button of layer.querySelectorAll<HTMLButtonElement>('[data-hold]')) {
    const kind = button.dataset.hold as 'jump' | 'grab'
    const release = () => {
      held.delete(kind)
      button.classList.remove('on')
    }
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId)
      held.add(kind)
      button.classList.add('on')
    })
    button.addEventListener('pointerup', release)
    button.addEventListener('pointercancel', release)
    button.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  return {
    get touch() {
      return touch
    },
    onTouchChange(listener) {
      touchListeners.push(listener)
    },
    pollGamepad(inMenu) {
      const { commands, used } = gamepad.poll(performance.now(), inMenu, actions)
      if (used) usingPad = true
      return commands
    },
    read() {
      const now = performance.now()
      // Ramp over the real key times since the last read (at most 0.1 s back) and steer with the mean.
      const from = Math.max(lastRead, now - 100)
      lastRead = now
      const ramp = rampKeySteer(keySteer, readWant, steerChanges, from, now, KEY_RISE * options.steering, KEY_RELEASE)
      keySteer = ramp.value
      const keyMean = ramp.mean
      readWant = keyWant()
      steerChanges = []
      // Analog sticks (touch or gamepad): sensitivity scales the deflection needed for full edge.
      const analog = (v: number) => Math.max(-1, Math.min(1, v * options.steering))
      const stickX = stick.pointer !== null ? analog(stick.x) : analog(pad.x)
      const stickY = stick.pointer !== null ? stick.y : pad.y

      const up = has('ArrowUp') || has('KeyW') || stickY * STICK_RANGE_PX < -STICK_VERTICAL_PX
      const down = has('ArrowDown') || has('KeyS') || stickY * STICK_RANGE_PX > STICK_VERTICAL_PX || pad.brake > 0.3
      const stickPitch = Math.abs(stickY) > 0.45 ? -stickY : 0
      const keyPitch = (has('ArrowUp') || has('KeyW') ? 1 : 0) - (has('ArrowDown') || has('KeyS') ? 1 : 0)
      const second = has('KeyK') || pad.second
      const grab = has('KeyJ') || second || has('ShiftLeft') || has('ShiftRight') || held.has('grab') || pad.grab
      // The grab is chosen when it starts, from the direction held.
      if (grab && !grabWasHeld) {
        const steerNow = keySteer || stickX
        // K is the second grab button: alone a critical, with up a nose grab, with down a truck driver.
        grabKind = second
          ? up ? 'nose' : down ? 'truck' : 'critical'
          : up ? 'japan' : down ? 'tail' : Math.abs(steerNow) > 0.3 ? 'safety' : 'mute'
      }
      grabWasHeld = grab
      const brakeKey = has('ArrowDown') || has('KeyS')
      const jump = has('Space') || held.has('jump') || pad.jump
      tapped.clear()
      return {
        steer: keyMean !== 0 ? keyMean : stickX,
        directionalSteering: keyMean !== 0,
        brake: down ? Math.max(pad.brake > 0.3 ? pad.brake : 0, brakeKey || stickY * STICK_RANGE_PX > STICK_VERTICAL_PX ? 1 : 0) : 0,
        tuck: up && !down,
        jump,
        grab,
        grabKind,
        pitch: (keyPitch !== 0 ? keyPitch : stickPitch) * (options.invertPitch ? -1 : 1),
      }
    },
    setOptions(next) {
      Object.assign(options, next)
    },
    get gamepad() {
      return usingPad
    },
    rumble(weak, strong, durationMs) {
      gamepad.rumble(weak, strong, durationMs)
    },
    push(action) {
      actions.add(action)
    },
    takeActions() {
      const taken = new Set(actions)
      actions.clear()
      return taken
    },
    clear: onBlur,
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pointerdown', onPointer)
      layer.remove()
    },
  }
}
