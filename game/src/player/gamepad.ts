import type { Action } from './input'

export type MenuCommand = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back'

const shortcuts: Record<number, Action> = { 9: 'pause', 8: 'runs', 4: 'camera', 1: 'skip', 13: 'map', 12: 'style', 15: 'reset' }

export function createGamepadInput() {
  const before = new Set<number>()
  const menuButtons = new Set<number>()
  let direction: MenuCommand | null = null
  let repeatAt = 0
  let axisBlocked = false
  let index: number | undefined
  const state = { x: 0, y: 0, jump: false, grab: false, second: false, brake: 0 }
  return {
    state,
    poll(now: number, inMenu: boolean, actions: Set<Action>) {
      const commands: MenuCommand[] = []
      Object.assign(state, { x: 0, y: 0, jump: false, grab: false, second: false, brake: 0 })
      const pads = Array.from(navigator.getGamepads?.() ?? [])
      const current = index === undefined ? null : pads[index]
      const pad = current?.connected ? current : pads.find((p) => p?.connected && p.axes.length >= 2 && p.buttons.length >= 10)
      if (!pad || index !== pad.index) {
        before.clear()
        menuButtons.clear()
        direction = null
        axisBlocked = false
        index = pad?.index
      }
      if (!pad) return { commands, used: false }
      const down = (i: number) => Boolean(pad.buttons[i]?.pressed)
      const pressed = (i: number) => down(i) && !before.has(i)
      const axis = (i: number) => {
        const v = pad.axes[i] ?? 0
        return Math.sign(v) * Math.max(0, (Math.abs(v) - 0.12) / 0.88)
      }
      const x = axis(0), y = axis(1)
      const engaged = Math.max(Math.abs(x), Math.abs(y)) > 0.5
      if (!x && !y) axisBlocked = false
      if (inMenu) {
        axisBlocked ||= engaged
        const nav = down(12) ? 'up' : down(13) ? 'down' : down(14) ? 'left' : down(15) ? 'right'
          : !engaged ? null : Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down')
        if (nav && (nav !== direction || now >= repeatAt)) {
          commands.push(nav)
          repeatAt = now + (nav === direction ? 125 : 330)
        }
        direction = nav
        if (pressed(0)) commands.push('accept')
        if (pressed(1)) commands.push('back')
        if (pressed(9)) actions.add('pause')
      } else {
        direction = null
        const available = (i: number) => down(i) && !menuButtons.has(i)
        state.x = axisBlocked ? 0 : x
        state.y = axisBlocked ? 0 : y
        state.jump = available(0)
        state.grab = available(2) || available(5) || available(7)
        state.second = available(3)
        state.brake = menuButtons.has(6) ? 0 : pad.buttons[6]?.value ?? 0
        for (const [button, action] of Object.entries(shortcuts)) {
          const i = Number(button)
          if (pressed(i) && available(i)) actions.add(action)
        }
      }
      let used = x !== 0 || y !== 0
      for (let i = 0; i < pad.buttons.length; i++) {
        if (down(i)) {
          used = true
          before.add(i)
          if (inMenu) menuButtons.add(i)
        } else {
          before.delete(i)
          menuButtons.delete(i)
        }
      }
      return { commands, used }
    },
  }
}
