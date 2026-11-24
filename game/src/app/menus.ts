import { LAYOUTS, type ParkSite } from '../world/park'
import type { Run } from '../world/resort'
import { escapeHtml } from './format'

/** One button per run, coloured by difficulty. */
export function buildRunMenu(list: HTMLElement, runs: Run[], onPick: (run: Run) => void): void {
  list.innerHTML = ''
  for (const run of runs) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `run ${run.difficulty ?? 'unknown'}`
    button.innerHTML = `<span class="symbol"></span>${escapeHtml(run.name)}`
    button.addEventListener('click', () => onPick(run))
    list.append(button)
  }
}

/** Park list above the runs: go to a park, or swap its layout. */
export function buildParkMenu(
  list: HTMLElement,
  sites: ParkSite[],
  onPark: (site: ParkSite) => void,
  setLayout: (site: ParkSite, layout: string) => void,
  onDemo?: () => void,
): void {
  const section = document.createElement('div')
  section.className = 'parks'
  const layoutInfo: Record<string, string> = {
    jumps: 'Small to large jumps',
    big: 'Bigger jumps with longer landings',
    jib: 'Boxes and rails for slides and presses',
    mixed: 'Rollers, jumps, boxes, and rails',
    rollers: 'Rollers and a step-down',
    progression: 'Small jumps and a wide box before a rail',
  }
  const render = () => {
    section.innerHTML = '<h3>Terrain parks</h3><p class="park-intro">Pick a park to ski it, or choose a layout to change its features. Open Pause for the terrain park controls.</p>'
    if (onDemo) {
      const demo = document.createElement('button')
      demo.type = 'button'
      demo.className = 'run park-go'
      demo.innerHTML = '<span class="symbol park-symbol"></span>Demo park <small>· every feature, 2.6 km, off the map</small>'
      demo.addEventListener('click', onDemo)
      section.append(demo)
    }
    for (const site of sites) {
      const row = document.createElement('div')
      row.className = 'park'
      const go = document.createElement('button')
      go.type = 'button'
      go.className = 'run park-go'
      go.innerHTML = `<span class="symbol park-symbol"></span>${escapeHtml(site.name)}`
      go.addEventListener('click', () => onPark(site))
      const layouts = document.createElement('div')
      layouts.className = 'layouts'
      const description = document.createElement('p')
      description.className = 'layout-description'
      description.textContent = layoutInfo[site.layout] ?? ''
      for (const layout of LAYOUTS) {
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.textContent = layout.label
        chip.title = layoutInfo[layout.id] ?? ''
        chip.setAttribute('aria-pressed', String(site.layout === layout.id))
        chip.addEventListener('click', () => {
          if (site.layout === layout.id) return
          setLayout(site, layout.id)
          for (const button of layouts.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === chip))
          description.textContent = layoutInfo[layout.id] ?? ''
        })
        layouts.append(chip)
      }
      row.append(go, layouts, description)
      section.append(row)
    }
  }
  render()
  list.prepend(section)
}
