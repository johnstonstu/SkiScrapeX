import type { GrabKind, SkiInput } from '../sim'
import { createGamepadInput, type MenuCommand } from './gamepad'

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
  touch: boolean
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
  const actions = new Set<Action>()
  const touch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')
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
    if (event.code === 'Space' && event.target instanceof HTMLButtonElement) return
    if (event.code === 'Enter' && event.target instanceof HTMLButtonElement) return
    keys.add(event.code)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault()
    if (event.repeat) return
    const action = keyActions[event.code]
    if (action) actions.add(action)
    if (/^Digit[1-9]$/.test(event.code)) actions.add(`slope${Number(event.code.slice(5))}`)
  }
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code)
  const onPointer = () => { usingPad = false }
  const onBlur = () => {
    keys.clear()
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
    touch,
    pollGamepad(inMenu) {
      const { commands, used } = gamepad.poll(performance.now(), inMenu, actions)
      if (used) usingPad = true
      return commands
    },
    read() {
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastRead) / 1000)
      lastRead = now
      const rise = KEY_RISE * options.steering
      let want = 0
      if (keys.has('ArrowLeft') || keys.has('KeyA')) want -= 1
      if (keys.has('ArrowRight') || keys.has('KeyD')) want += 1
      if (want === 0) keySteer = Math.sign(keySteer) * Math.max(0, Math.abs(keySteer) - KEY_RELEASE * dt)
      else if (Math.sign(want) !== Math.sign(keySteer)) keySteer = want * Math.min(1, rise * dt * 2)
      else keySteer = want * Math.min(1, Math.abs(keySteer) + rise * dt)
      // Analog sticks (touch or gamepad): sensitivity scales the deflection needed for full edge.
      const analog = (v: number) => Math.max(-1, Math.min(1, v * options.steering))
      const stickX = stick.pointer !== null ? analog(stick.x) : analog(pad.x)
      const stickY = stick.pointer !== null ? stick.y : pad.y

      const up = keys.has('ArrowUp') || keys.has('KeyW') || stickY * STICK_RANGE_PX < -STICK_VERTICAL_PX
      const down = keys.has('ArrowDown') || keys.has('KeyS') || stickY * STICK_RANGE_PX > STICK_VERTICAL_PX || pad.brake > 0.3
      const stickPitch = Math.abs(stickY) > 0.45 ? -stickY : 0
      const keyPitch = (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0)
      const second = keys.has('KeyK') || pad.second
      const grab = keys.has('KeyJ') || second || keys.has('ShiftLeft') || keys.has('ShiftRight') || held.has('grab') || pad.grab
      // The grab is chosen when it starts, from the direction held.
      if (grab && !grabWasHeld) {
        const steerNow = keySteer || stickX
        // K is the second grab button: alone a critical, with up a nose grab, with down a truck driver.
        grabKind = second
          ? up ? 'nose' : down ? 'truck' : 'critical'
          : up ? 'japan' : down ? 'tail' : Math.abs(steerNow) > 0.3 ? 'safety' : 'mute'
      }
      grabWasHeld = grab
      return {
        steer: keySteer !== 0 ? keySteer : stickX,
        directionalSteering: keySteer !== 0,
        brake: down ? Math.max(pad.brake > 0.3 ? pad.brake : 0, keys.has('ArrowDown') || keys.has('KeyS') || stickY * STICK_RANGE_PX > STICK_VERTICAL_PX ? 1 : 0) : 0,
        tuck: up && !down,
        jump: keys.has('Space') || held.has('jump') || pad.jump,
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
