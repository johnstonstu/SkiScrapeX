/** Title screen, challenge list and results card. Plain DOM; main.ts supplies the data and callbacks. */
import { escapeHtml, formatTime } from '../app/format'
import { UNLOCKS, medalCounts, type Progress } from '../app/progress'
import { MEDALS, type Medal, type MedalTargets } from '../world/challenges'

/** Run difficulty symbol, coloured by the existing `.easy .symbol` style rules. */
const symbol = (kind: string) => `<span class="dif ${kind}"><span class="symbol${kind === 'park' ? ' park-symbol' : ''}"></span></span>`

const MEDAL_LABEL: Record<Medal, string> = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' }

export const medalBadge = (medal: Medal | null | undefined) =>
  medal ? `<span class="medal ${medal}" title="${MEDAL_LABEL[medal]}"></span>` : '<span class="medal none"></span>'

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.innerHTML = label
  element.addEventListener('click', onClick)
  return element
}

export interface Summary {
  progress: Progress
  skied: number
  runCount: number
  nuggetCount: number
}

function summaryHtml({ progress, skied, runCount, nuggetCount }: Summary): string {
  const counts = medalCounts(progress)
  return (
    `<span>${medalBadge('gold')}${counts.gold} ${medalBadge('silver')}${counts.silver} ${medalBadge('bronze')}${counts.bronze}</span>` +
    `<span>Runs skied ${skied}/${runCount}</span><span>Nuggets ${progress.nuggets.length}/${nuggetCount}</span>`
  )
}

export function renderTitle(
  panel: HTMLElement,
  summary: Summary | null,
  ready: boolean,
  actions: { play: () => void; learn: () => void; challenges: () => void; rider: () => void; settings: () => void },
  learnFirst = false,
): void {
  panel.innerHTML =
    '<div class="title-card"><h1>SkiScrapex</h1><p class="sub">Apex Mountain Resort, Penticton BC</p>' +
    `<p class="title-status">${ready ? '' : 'Loading the mountain…'}</p><div class="title-buttons"></div>` +
    `<p class="title-summary">${summary ? summaryHtml(summary) : ''}</p></div>`
  const buttons = panel.querySelector('.title-buttons')!
  // First visit: the tutorial leads. Afterwards it is a small link under the buttons.
  const play = button(summary && summary.progress.totals.runs > 0 ? 'Continue' : 'Free ski', actions.play, learnFirst ? '' : 'primary')
  const learn = button(learnFirst ? 'Learn to ski' : 'Tutorial', actions.learn, learnFirst ? 'primary' : 'link')
  const challenges = button('Challenges', actions.challenges)
  play.disabled = challenges.disabled = learn.disabled = !ready
  if (learnFirst) buttons.append(learn, play, challenges, button('Rider', actions.rider), button('Settings', actions.settings))
  else buttons.append(play, challenges, button('Rider', actions.rider), button('Settings', actions.settings), learn)
  if (ready) (learnFirst ? learn : play).focus()
}

export function setTitleStatus(panel: HTMLElement, text: string): void {
  const status = panel.querySelector('.title-status')
  if (status) status.textContent = text
}

export interface ChallengeRow {
  id: string
  name: string
  /** Difficulty class for the run symbol, or 'park'. */
  symbol: string
  detail?: string
  /** undefined while the pace bot is still working. */
  targets: MedalTargets | null | undefined
  score: boolean
  start: () => void
}

export interface ChallengeData {
  summary: Summary
  timed: ChallengeRow[]
  slalom: ChallengeRow[]
  park: ChallengeRow[]
  runs: { name: string; symbol: string; skied: boolean }[]
  unlocked: Set<string>
}

function targetText(row: ChallengeRow): string {
  if (row.targets === undefined) return 'setting times…'
  if (row.targets === null) return ''
  const value = (v: number) => (row.score ? `${v.toLocaleString()} pts` : formatTime(v))
  return `Gold ${value(row.targets.gold)}`
}

export function renderChallenges(panel: HTMLElement, data: ChallengeData, progress: Progress, close: () => void): void {
  panel.innerHTML =
    '<header><h2>Challenges</h2><button type="button" class="close" aria-label="Close">✕</button></header>' +
    `<p class="title-summary">${summaryHtml(data.summary)}</p>`
  panel.querySelector('.close')!.addEventListener('click', close)
  const section = (title: string, note: string, rows: ChallengeRow[]) => {
    const block = document.createElement('section')
    block.className = 'challenge-group'
    block.innerHTML = `<h3>${title}</h3><p class="note">${note}</p>`
    for (const row of rows) {
      const best = progress.bests[row.id]
      const bestText = best === undefined ? '' : row.score ? `${best.toLocaleString()} pts` : formatTime(best)
      const item = button(
        `${medalBadge(progress.medals[row.id])}${symbol(row.symbol)}` +
          `<span class="name">${escapeHtml(row.name)}${row.detail ? ` <small>${escapeHtml(row.detail)}</small>` : ''}</span>` +
          `<span class="best">${bestText}</span><span class="target">${targetText(row)}</span>`,
        row.start,
        'challenge',
      )
      item.disabled = row.targets === null
      block.append(item)
    }
    panel.append(block)
  }
  section('Slalom', 'Ski between each pair of poles. A missed gate costs 3 s.', data.slalom)
  section('Park score attack', 'Bank as many points as you can before the bottom of the park.', data.park)
  section('Timed runs', 'Start at the top of the run and race to the bottom.', data.timed)

  const explorer = document.createElement('section')
  explorer.className = 'challenge-group'
  const skied = data.runs.filter((run) => run.skied).length
  explorer.innerHTML =
    `<h3>Ski every run <small>${skied}/${data.runs.length}</small></h3><p class="note">A run counts once you have skied half of it.</p>` +
    `<ul class="checklist">${data.runs
      .map((run) => `<li class="${run.skied ? 'done' : ''}">${symbol(run.symbol)}${escapeHtml(run.name)}</li>`)
      .join('')}</ul>` +
    `<h3>Gold nuggets <small>${progress.nuggets.length}/${data.summary.nuggetCount}</small></h3><p class="note">Hidden just off the edges of the runs, in the trees and margins. Ski into one to pick it up.</p>` +
    `<h3>Rewards</h3><ul class="rewards">${UNLOCKS.map(
      (unlock) => `<li class="${data.unlocked.has(unlock.id) ? 'done' : ''}"><strong>${unlock.label}</strong> ${data.unlocked.has(unlock.id) ? 'unlocked in Rider' : unlock.hint}</li>`,
    ).join('')}</ul>`
  panel.append(explorer)
}

export interface ResultData {
  title: string
  /** Seconds (timed) or points (score). */
  value: number
  score: boolean
  medal: Medal | null
  targets: MedalTargets | null
  previous?: number
  improved: boolean
  /** Attempt ended early (off course). */
  failed?: string
  lines: [string, string][]
}

export function renderResults(
  panel: HTMLElement,
  result: ResultData,
  actions: { retry?: () => void; next: () => void; nextLabel: string; challenges?: () => void },
): void {
  const value = (v: number) => (result.score ? `${Math.round(v).toLocaleString()} pts` : formatTime(v))
  let compare = ''
  if (result.failed) compare = result.failed
  else if (result.improved && result.previous !== undefined) compare = `New best! (was ${value(result.previous)})`
  else if (result.improved) compare = 'First finish'
  else if (result.previous !== undefined) compare = `Best ${value(result.previous)}`
  let next = ''
  if (!result.failed && result.targets) {
    // The next medal up: bronze from nothing, then silver, then gold.
    const target: Medal | undefined = result.medal ? MEDALS[MEDALS.indexOf(result.medal) - 1] : 'bronze'
    if (target) next = `${MEDAL_LABEL[target]} needs ${value(result.targets[target])}`
  }
  panel.innerHTML =
    `<h2>${escapeHtml(result.title)}</h2>` +
    `<p class="result-main">${!result.failed && result.medal ? medalBadge(result.medal) : ''}<strong>${result.failed ? 'Did not finish' : value(result.value)}</strong></p>` +
    `<p class="result-compare ${result.improved ? 'improved' : ''}">${escapeHtml(compare)}</p>` +
    (next ? `<p class="result-next">${escapeHtml(next)}</p>` : '') +
    `<dl>${result.lines.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` +
    '<div class="result-buttons"></div>'
  const row = panel.querySelector('.result-buttons')!
  if (actions.retry) row.append(button('Retry <kbd>R</kbd>', actions.retry))
  row.append(button(actions.nextLabel, actions.next, 'primary'))
  if (actions.challenges) row.append(button('Challenges', actions.challenges))
  ;(row.querySelector('.primary') as HTMLButtonElement | null)?.focus()
}
