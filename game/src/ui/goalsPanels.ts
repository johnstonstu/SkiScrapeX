/** Title screen, challenge list and results card. Plain DOM; main.ts supplies the data and callbacks. */
import { escapeHtml, formatTime } from '../app/format'
import { UNLOCKS, medalCounts, type Progress } from '../app/progress'
import { MEDALS, type Medal, type MedalTargets } from '../world/challenges'
import { formatStoke, rankOf } from '../app/stoke'
import { goalShare, goalTarget, type Goal } from '../app/ticket'

/** Run difficulty symbol, coloured by the existing `.easy .symbol` style rules. */
const symbol = (kind: string) =>
  kind === 'event' ? '<span class="dif event"><span class="event-symbol">🏁</span></span>' : `<span class="dif ${kind}"><span class="symbol${kind === 'park' ? ' park-symbol' : ''}"></span></span>`

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
  const tile = (value: string, label: string) => `<span class="stat"><b>${value}</b><small>${label}</small></span>`
  const stoke = progress.stoke ?? 0
  const rank = rankOf(stoke)
  const bar = `<span class="rank-bar" role="progressbar" aria-label="Progress to the next rank" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(rank.share * 100)}"><span style="width:${Math.round(rank.share * 100)}%"></span></span>`
  return (
    `<span class="stat rank"><b>${escapeHtml(rank.rank.name)}</b>${bar}<small>${formatStoke(stoke)} Stoke${rank.next ? ` · ${formatStoke(rank.next.at - stoke)} to ${escapeHtml(rank.next.name)}` : ''}</small></span>` +
    tile(`${medalBadge('gold')}${counts.gold} ${medalBadge('silver')}${counts.silver} ${medalBadge('bronze')}${counts.bronze}`, 'Medals') +
    tile(`${skied}<em>/${runCount}</em>`, 'Runs skied') +
    tile(`${progress.nuggets.length}<em>/${nuggetCount}</em>`, 'Gold nuggets')
  )
}

/** How far along a goal is, in its own words: "312/600 m", "74/90 km/h". Empty for one-shot goals. */
function goalAmount(goal: Goal): string {
  const target = goalTarget(goal.spec)
  if (target <= 1) return ''
  const unit = goal.spec.kind === 'speed' ? ' km/h' : goal.spec.kind === 'combo' ? ' pts' : ' m'
  return `${Math.floor(goal.amount).toLocaleString()}/${target.toLocaleString()}${unit}`
}

/** The day ticket: the three goals with their progress, then the Run of the Day. */
export function ticketHtml(ticket: { goals: readonly Goal[]; daily: Goal | null }, stoke: number): string {
  const row = (goal: Goal, daily = false) =>
    `<li class="${daily ? 'daily' : ''}"><span class="goal-text">${escapeHtml(goal.text)}</span>` +
    `<span class="goal-amount">${goalAmount(goal)}</span><span class="goal-stoke">+${goal.stoke}</span>` +
    `<span class="goal-bar"><span style="width:${Math.round(goalShare(goal) * 100)}%"></span></span></li>`
  const rank = rankOf(stoke)
  return (
    `<h3>Day ticket <small>${escapeHtml(rank.rank.name)} · ${formatStoke(stoke)} Stoke</small></h3>` +
    `<ul class="goals">${ticket.goals.map((goal) => row(goal)).join('')}${ticket.daily ? row(ticket.daily, true) : '<li class="daily done"><span class="goal-text">Run of the Day done. A new one tomorrow.</span></li>'}</ul>`
  )
}

/** A title menu entry: a big label with a short line under it. */
const menuItem = (label: string, detail: string) => `<span><span class="mi-label">${label}</span><small>${detail}</small></span>`

export function renderTitle(
  panel: HTMLElement,
  summary: Summary | null,
  ready: boolean,
  actions: { play: () => void; learn: () => void; challenges: () => void; rider: () => void; settings: () => void },
  learnFirst = false,
): void {
  panel.innerHTML =
    '<div class="title-card"><p class="title-eyebrow eyebrow">Apex Mountain Resort · Penticton, BC</p>' +
    '<h1>Ski<b>Scrape</b>x</h1>' +
    `<p class="title-status">${ready ? '' : 'Loading the mountain…'}</p>` +
    (ready ? '' : '<div class="title-progress" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>') +
    `<nav class="title-buttons" aria-label="Main menu"></nav>` +
    `<div class="title-summary">${summary ? summaryHtml(summary) : ''}</div></div>` +
    '<p class="title-hint" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>Tab</kbd> choose</span><span><kbd>Enter</kbd> select</span></p>'
  const buttons = panel.querySelector('.title-buttons')!
  const returning = Boolean(summary && summary.progress.totals.runs > 0)
  // Free ski always leads: the first run off the chair teaches the controls as you go (app/hints.ts).
  // Until the tutorial has been done it sits second with a line of its own; afterwards it is a small entry at the end.
  const play = button(menuItem(returning ? 'Continue' : 'Free ski', 'Ride the Quickdraw chair up and ski anywhere on the mountain'), actions.play, 'primary')
  const learn = button(
    learnFirst ? menuItem('Learn to ski', 'A short lesson by the Magic Carpet') : '<span><span class="mi-label">Tutorial</span></span>',
    actions.learn,
    learnFirst ? '' : 'link',
  )
  const challenges = button(menuItem('Challenges', 'Apex events, slalom, park scores and nuggets'), actions.challenges)
  const rider = button(menuItem('Rider', 'Outfit, skis or snowboard'), actions.rider)
  const settings = button(menuItem('Settings', 'Graphics, camera, sound and assists'), actions.settings)
  play.disabled = challenges.disabled = learn.disabled = !ready
  if (learnFirst) buttons.append(play, learn, challenges, rider, settings)
  else buttons.append(play, challenges, rider, settings, learn)
  if (ready) play.focus()
}

/** Loading message and, when `done` (0 to 1) is given, the progress bar under it. */
export function setTitleStatus(panel: HTMLElement, text: string, done?: number): void {
  const status = panel.querySelector('.title-status')
  if (status) status.textContent = text
  const bar = panel.querySelector<HTMLElement>('.title-progress')
  if (bar && done !== undefined) {
    const percent = Math.round(Math.min(1, Math.max(0, done)) * 100)
    bar.setAttribute('aria-valuenow', String(percent))
    bar.querySelector<HTMLElement>('span')!.style.width = `${percent}%`
  }
}

export interface ChallengeRow {
  id: string
  name: string
  /** Difficulty class for the run symbol, or 'park'. */
  symbol: string
  detail?: string
  /** Events: a line of history and the rules. */
  story?: string
  rules?: string
  /** undefined while the pace bot is still working. */
  targets: MedalTargets | null | undefined
  score: boolean
  start: () => void
}

export interface ChallengeData {
  summary: Summary
  ticket: { goals: readonly Goal[]; daily: Goal | null }
  events: ChallengeRow[]
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

/** Phones in either orientation: the same breakpoints as menus.css. */
const SMALL_SCREEN = '(max-width: 760px), (max-height: 520px)'

export function renderChallenges(panel: HTMLElement, data: ChallengeData, progress: Progress, close: () => void): void {
  panel.innerHTML =
    '<header><div><h2>Challenges</h2><p class="menu-lead">Timed runs, parks, slalom and the mountain checklist.</p></div>' +
    '<button type="button" class="close" aria-label="Close"><kbd>Esc</kbd><span>Back</span></button></header>' +
    `<div class="title-summary">${summaryHtml(data.summary)}</div>`
  panel.querySelector('.close')!.addEventListener('click', close)
  const ticket = document.createElement('section')
  ticket.className = 'challenge-group ticket'
  ticket.innerHTML = ticketHtml(data.ticket, progress.stoke ?? 0) + '<p class="note">Goals count anywhere on the mountain, in free ski and in challenges. Finish one and another is dealt.</p>'
  panel.append(ticket)
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
      if (row.story || row.rules) {
        // Collapsed on small screens so the list of events fits; open elsewhere.
        const about = document.createElement('details')
        about.className = 'event-about'
        about.open = !matchMedia(SMALL_SCREEN).matches
        about.innerHTML = `<summary>About this event</summary><p>${row.story ? escapeHtml(row.story) : ''}${row.rules ? ` <strong>${escapeHtml(row.rules)}</strong>` : ''}</p>`
        block.append(about)
      }
    }
    panel.append(block)
  }
  if (data.events.length) section('Apex events', 'Races from Apex history. The course, gates and crowd appear only while you race it.', data.events)
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
  /** One line on how to score more next time. */
  advice?: string
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
    (result.advice ? `<p class="result-advice">${escapeHtml(result.advice)}</p>` : '') +
    `<dl>${result.lines.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` +
    '<div class="result-buttons"></div>'
  const row = panel.querySelector('.result-buttons')!
  if (actions.retry) row.append(button('Retry <kbd>R</kbd>', actions.retry))
  row.append(button(actions.nextLabel, actions.next, 'primary'))
  if (actions.challenges) row.append(button('Challenges', actions.challenges))
  ;(row.querySelector('.primary') as HTMLButtonElement | null)?.focus()
}
