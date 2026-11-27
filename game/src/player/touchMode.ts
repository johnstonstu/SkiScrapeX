/**
 * Whether the touch controls are on, following the input actually used: a
 * finger on the screen turns them on (touch laptops, a phone that started
 * without them), skiing with the keyboard turns them off (an iPad with a
 * keyboard). Mouse clicks and menu keys leave them as they are.
 */
export type InputEvent = { kind: 'pointer'; pointerType: string } | { kind: 'key'; code: string }

const SKI_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])

export function touchModeAfter(current: boolean, event: InputEvent): boolean {
  if (event.kind === 'pointer') return event.pointerType === 'touch' ? true : current
  return SKI_KEYS.has(event.code) ? false : current
}
