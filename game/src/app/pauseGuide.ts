type InputMode = 'keys' | 'pad' | 'touch'
type Binding = Record<InputMode, string>

interface ControlRow {
  name: string
  binding: Binding
  detail: string | Binding
}

const movement: ControlRow[] = [
  { name: 'Steer', binding: { keys: 'A / D · ← / →', pad: 'Left stick ← / →', touch: 'Stick ← / →' }, detail: 'Tap for a small edge change. Hold to commit to a turn.' },
  { name: 'Push or tuck', binding: { keys: 'W · ↑', pad: 'Left stick ↑', touch: 'Stick ↑' }, detail: 'Push off at low speed, tuck to carry speed, or speed up a lift ride.' },
  { name: 'Brake', binding: { keys: 'S · ↓', pad: 'LT / L2', touch: 'Stick ↓' }, detail: 'Snowplough slowly. At speed, scrub speed with a hockey stop.' },
  { name: 'Crouch and pop', binding: { keys: 'Space', pad: 'A / ×', touch: 'Jump' }, detail: 'Hold to crouch and absorb moguls. Release to pop. A short tap unweights the skis in deep snow.' },
]

const park: ControlRow[] = [
  { name: 'Rollers and jumps', binding: { keys: 'Space', pad: 'A / ×', touch: 'Jump' }, detail: 'Ride rollers with soft knees. For a jump, line up straight, use the speed hint, and release crouch at the lip. A step-down lands below takeoff.' },
  { name: 'Spins and flips', binding: { keys: 'A / D · W / S', pad: 'Left stick ← / → · ↑ / ↓', touch: 'Stick ← / → · ↑ / ↓ in air' }, detail: 'Left and right spin. Up and down flip or cork a spin. Ease off before touchdown and line up with the landing.' },
  { name: 'Grabs', binding: { keys: 'J / Shift · K', pad: 'X / □ or RB / R1 · Y / △', touch: 'Grab + stick' }, detail: 'First grab: mute, up Japan, down tail, sideways safety. Second grab: critical, up nose, down truck driver. Release before landing.' },
  { name: 'Boxes and rails', binding: { keys: 'Space · A / D · W / S', pad: 'A / × · Left stick', touch: 'Jump · stick' }, detail: 'Start on a wide box. Pop onto the surface, steer against the lean, and use up or down for a nose or tail press. Crouch and release to pop off.' },
]

const shortcuts: ControlRow[] = [
  { name: 'Pause / menus', binding: { keys: 'Esc · T · O · G · H', pad: 'Start / Options · View / Share', touch: 'Pause' }, detail: {
    keys: 'Esc pauses. T opens runs and parks, O opens rider and gear, G opens settings, and H opens challenges.',
    pad: 'Start pauses. View opens runs and parks. D-pad up opens rider and gear.',
    touch: 'Tap Pause to open runs and parks, rider and gear, settings, or challenges.',
  } },
  { name: 'Camera and map', binding: { keys: 'C · M', pad: 'LB / L1 · D-pad ↓', touch: 'Pause → Camera or Map' }, detail: 'Cycle follow, first-person, and orbit cameras. Toggle the resort map.' },
  { name: 'Restart or skip lift', binding: { keys: 'R · Enter', pad: 'Pause → Restart · B / ○', touch: 'Pause → Restart · Skip' }, detail: 'Restart the current run. Skip takes you to the top during a lift ride.' },
  { name: 'Music player', binding: { keys: 'P · [ ]', pad: 'R3 · D-pad ← →', touch: '♪ button' }, detail: 'Open the pocket player. Skip back or forward a song, with the player open or closed.' },
]

const menuHint: Record<InputMode, string> = {
  keys: 'Use Tab to move between controls and Enter to select.',
  pad: 'Use the D-pad or left stick to move, A / × to select, and B / ○ to go back.',
  touch: 'Tap a menu option. The floating stick starts wherever you press on the left.',
}

export function createPauseGuide(menu: HTMLElement) {
  const tabs = [...menu.querySelectorAll<HTMLButtonElement>('button[data-guide]')]
  const guide = menu.querySelector<HTMLElement>('#control-guide')!
  const groups = [['On the snow', movement], ['Terrain park', park], ['Shortcuts', shortcuts]] as const
  const select = (mode: InputMode) => {
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.guide === mode))
    guide.innerHTML = groups.map(([title, rows]) => `
      <section class="guide-group" aria-label="${title}">
        <h4>${title}</h4>
        <dl>${rows.map(({ name, binding, detail }) => `
          <div class="control-row">
            <dt>${name}<kbd>${binding[mode]}</kbd></dt>
            <dd>${mode === 'touch' && name === 'Grabs' ? 'Hold Grab in the air. Add a direction on the stick to change the grab.' : typeof detail === 'string' ? detail : detail[mode]}</dd>
          </div>`).join('')}</dl>
      </section>`).join('') + `<p class="guide-hint">${menuHint[mode]}</p>`
  }
  for (const tab of tabs) tab.addEventListener('click', () => select(tab.dataset.guide as InputMode))
  select('keys')
  return { select }
}
