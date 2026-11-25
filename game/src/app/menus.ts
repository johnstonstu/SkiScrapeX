import { LAYOUTS, type ParkSite } from '../world/park'
import type { Run } from '../world/resort'
import { escapeHtml } from './format'
import type { TrailSelection } from '../ui/trailMap'

const DIFFICULTY_LABEL: Record<string, string> = {
  novice: 'Green',
  easy: 'Green',
  intermediate: 'Blue',
  advanced: 'Black',
  expert: 'Double black',
  freeride: 'Freeride',
}

/** One button per run, coloured by difficulty. */
export function buildRunMenu(list: HTMLElement, runs: Run[], onPick: (run: Run) => void, onHighlight?: (run: Run) => void): void {
  list.querySelector('.runs-group')?.remove()
  const group = document.createElement('div')
  group.className = 'runs-group'
  group.innerHTML = '<h3>Runs</h3>'
  for (const run of runs) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `run ${run.difficulty ?? 'unknown'}`
    button.dataset.runName = run.name
    button.innerHTML = `<span class="symbol"></span><span class="run-copy"><strong>${escapeHtml(run.name)}</strong><small>${DIFFICULTY_LABEL[run.difficulty ?? ''] ?? 'Ungraded'}</small></span>`
    button.addEventListener('click', () => {
      onHighlight?.(run)
      onPick(run)
    })
    button.addEventListener('pointerenter', () => onHighlight?.(run))
    group.append(button)
  }
  list.append(group)
}

/** Park list above the runs: go to a park, or swap its layout. */
export function buildParkMenu(
  list: HTMLElement,
  sites: ParkSite[],
  onPark: (site: ParkSite) => void,
  setLayout: (site: ParkSite, layout: string) => void,
  onDemo?: () => void,
  onHighlight?: (site: ParkSite) => void,
): void {
  list.querySelector('.parks')?.remove()
  const section = document.createElement('div')
  section.className = 'parks'
  const layoutInfo: Record<string, string> = {
    jumps: 'Small to large jumps in a clean line',
    big: 'Bigger jumps with longer landings and side choices',
    jib: 'Boxes and rails for slides and presses',
    mixed: 'Rollers, jumps, boxes, and rails',
    rollers: 'Rollers and a step-down',
    progression: 'Small jumps and a wide box before a rail',
    lanes: 'Each station offers a left, centre or right feature',
    claimJumper: 'The XL line: a straight shot through bigger and bigger tables, up to the Pro gap',
    prospector: 'Rails, boxes, a quarter-pipe step-over and jump lines, two or three choices at every station',
    aerial: 'Rollers into a row of tables for big, clean air',
    okanagan: 'Rollers, rails and a row of jump choices beside the T-Bar',
    nuggets: 'Small rollers, boxes and a rail by the Magic Carpet',
  }
  const render = () => {
    section.innerHTML = '<h3>Terrain parks</h3><p class="park-intro">Pick a park to ski it, or choose a layout to change its features.</p>'
    if (onDemo) {
      const demo = document.createElement('button')
      demo.type = 'button'
      demo.className = 'run park-go'
      demo.innerHTML = '<span class="symbol park-symbol"></span><span class="run-copy"><strong>Demo park</strong><small>Every feature · 2.6 km · off the map</small></span>'
      demo.addEventListener('click', onDemo)
      section.append(demo)
    }
    for (const site of sites) {
      const row = document.createElement('div')
      row.className = 'park'
      row.dataset.parkId = site.id
      const go = document.createElement('button')
      go.type = 'button'
      go.className = 'run park-go'
      go.innerHTML = `<span class="symbol park-symbol"></span><span class="run-copy"><strong>${escapeHtml(site.name)}</strong><small>Ski this park</small></span>`
      go.addEventListener('click', () => {
        onHighlight?.(site)
        onPark(site)
      })
      go.addEventListener('pointerenter', () => onHighlight?.(site))
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

/** Fill the trail detail card for the current map or list selection. */
export function renderTrailDetail(
  detail: HTMLElement,
  selection: TrailSelection,
  actions: {
    skiRun?: (run: Run) => void
    skiPark?: (site: ParkSite) => void
    lengthOf?: (run: Run) => number
  },
): void {
  if (!selection) {
    detail.hidden = true
    detail.innerHTML = ''
    return
  }
  detail.hidden = false
  if (selection.kind === 'run') {
    const run = selection.run
    const metres = actions.lengthOf?.(run)
    detail.innerHTML =
      `<div class="trail-detail-copy"><span class="symbol ${escapeHtml(run.difficulty ?? '')}"></span>` +
      `<div><strong>${escapeHtml(run.name)}</strong>` +
      `<p>${DIFFICULTY_LABEL[run.difficulty ?? ''] ?? 'Ungraded'}${metres ? ` · ${Math.round(metres)} m` : ''}</p></div></div>` +
      `<button type="button" class="trail-go">Ski this run</button>`
    detail.querySelector('button')!.addEventListener('click', () => actions.skiRun?.(run))
    return
  }
  const site = selection.site
  detail.innerHTML =
    `<div class="trail-detail-copy"><span class="symbol park-symbol"></span>` +
    `<div><strong>${escapeHtml(site.name)}</strong><p>Terrain park</p></div></div>` +
    `<button type="button" class="trail-go">Ski this park</button>`
  detail.querySelector('button')!.addEventListener('click', () => actions.skiPark?.(site))
}

export function syncTrailListSelection(list: HTMLElement, selection: TrailSelection): void {
  for (const button of list.querySelectorAll<HTMLElement>('.run')) {
    const runName = button.dataset.runName
    const park = button.closest<HTMLElement>('.park')
    const pressed =
      (selection?.kind === 'run' && runName === selection.run.name) ||
      (selection?.kind === 'park' && park?.dataset.parkId === selection.site.id && button.classList.contains('park-go'))
    button.setAttribute('aria-pressed', String(Boolean(pressed)))
    if (pressed) button.scrollIntoView({ block: 'nearest' })
  }
}
