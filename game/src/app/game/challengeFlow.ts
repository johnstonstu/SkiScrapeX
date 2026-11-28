import { beginCrash } from '../../sim'
import { featureAhead } from '../../world/park'
import { liftAtBottom, pointAlong, type Lift } from '../../world/resort'
import { pushOutOfRing } from '../../world/buildings'
import { GATE_PENALTY, progressAlong } from '../../world/challenges'
import { renderResults } from '../../ui/goalsPanels'
import type { createStylePanel } from '../../ui/riderPanel'
import type { Controls } from '../../player/input'
import type { getUi } from '../dom'
import { escapeHtml, formatTime } from '../format'
import { KEYS, writeJson } from '../storage'
import { MAX_MULTIPLIER, parkAdvice, type createTrickFeed } from '../tricks'
import type { createRaceDirector } from '../raceDirector'
import type { createCompDirector } from '../compDirector'
import type { createRunout } from '../runout'
import type { createCoach } from '../tutorial'
import { createSession, type Challenge, type SessionEvent } from '../session'
import type { GameState } from './state'

/** Key in the free-ski bests for the best trick score of one lap (not a run name). */
export const LAP_POINTS = '#lap-points'

export interface ChallengeFlowDeps {
  ui: ReturnType<typeof getUi>
  controls: Controls
  tricks: ReturnType<typeof createTrickFeed>
  race: ReturnType<typeof createRaceDirector>
  comp: ReturnType<typeof createCompDirector>
  runout: ReturnType<typeof createRunout>
  coach: ReturnType<typeof createCoach>
  stylePanel: ReturnType<typeof createStylePanel>
  /** Free-ski bests by run name, saved as they improve. */
  bests: Record<string, number>
  hideOverlays: () => void
  leaveDemoPark: () => void
  openChallenges: () => void
  spawn: (keepCamera?: boolean) => void
  startRide: (lift: Lift) => void
}

/**
 * What happens around a run: challenge start and finish, session events
 * (gates, splits, the finish line), results, free-ski run cards, fades, and
 * the world checks each frame (off the map, buildings, trail signs, the
 * tutorial's end, a lift at the bottom).
 */
export function createChallengeFlow(game: GameState, deps: ChallengeFlowDeps) {
  const { ui, controls, tricks, race, comp, runout, coach, stylePanel, bests, hideOverlays, leaveDemoPark, openChallenges, spawn, startRide } = deps
  let resultsNext: (() => void) | null = null
  let runCardTimer = 0

  /** HUD title during an event: its name, then the next gate or which run of two. */
  function eventTitle(event: Extract<Challenge, { kind: 'event' }>, passed: number): string {
    const { def } = event.course
    if (def.format === 'match') return event.firstRun === undefined ? `${def.name} · run 1 sets the time` : `${def.name} · run 2 · match ${formatTime(event.firstRun)}`
    const run = def.format === 'twoRun' ? ` · run ${event.firstRun === undefined ? 1 : 2}` : ''
    if (!event.gates.length) return `${def.name}${run}`
    return `${def.name}${run} · ${passed < event.gates.length ? `gate ${passed + 1}/${event.gates.length}` : 'to the finish'}`
  }

  function onSessionEvent(event: SessionEvent) {
    if (game.challenge.kind === 'event') {
      const current = game.challenge
      if (event.type === 'gate') {
        game.goals?.markGate(event.index, event.result)
        race.onGate(event, game.skier)
        ui.title.textContent = eventTitle(current, event.index + 1)
        return
      }
      if (event.type === 'split') {
        const best = game.goals?.progress.bests[`${current.id}:split${event.index + 1}`]
        const delta = best === undefined ? '' : ` · ${event.time <= best ? '-' : '+'}${Math.abs(event.time - best).toFixed(2)}`
        tricks.show(`Split ${event.index + 1}`, `${formatTime(event.time)}${delta}`, 'bank')
        return
      }
      if (event.type === 'trap') {
        tricks.show('Radar', `${Math.round(event.speed * 3.6)} km/h`, 'bank')
        return
      }
      if (event.type === 'disqualified') {
        endChallenge(`Disqualified: missed gate ${event.gate + 1}`)
        return
      }
      const twoRuns = current.course.def.format === 'match' || current.course.def.format === 'twoRun'
      if (event.type === 'finish' && twoRuns && current.firstRun === undefined && game.goals) {
        // Run one: back to the start for run two (to match it, or to add to it).
        const first = game.session.total
        const next = game.goals.event(current.course, first)
        crossLine(() =>
          transition(`Run 1: ${formatTime(first)}
  ${current.course.def.format === 'match' ? 'Now match it' : 'Run 2'}`, 2, () => startChallenge(next)),
        )
        return
      }
      if (event.type === 'finish') {
        game.goals?.recordSplits(current.id, game.session.stats.splits)
        crossLine(() => endChallenge(null))
      } else if (event.type === 'offCourse') endChallenge('Left the course')
      else if (event.type === 'stalled') endChallenge('No progress: DNF')
      return
    }
    if (event.type === 'gate') {
      game.goals?.markGate(event.index, event.result)
      if (event.result === 'miss') tricks.show('Missed gate', `+${GATE_PENALTY} s`, 'crash')
      if (game.challenge.kind === 'slalom') {
        const next = Math.min(event.index + 2, event.total)
        ui.title.textContent = `${game.challenge.run.name} · slalom · ${event.index + 1 < event.total ? `gate ${next}/${event.total}` : 'to the finish'}${game.session.stats.gatesMissed ? ` · ${game.session.stats.gatesMissed} missed` : ''}`
      }
    } else if (event.type === 'finish') {
      if (game.challenge.kind === 'park') endChallenge(null)
      else crossLine(() => endChallenge(null))
    } else if (event.type === 'stalled') endChallenge('No progress: DNF')
    else endChallenge('Left the course')
  }

  /** Over the line: the clock has stopped. Brake to a stop, then `then` shows the result. */
  function crossLine(then: () => void) {
    tricks.show('Finish', formatTime(game.session.total), 'bank')
    runout.start(then)
  }

  /** One-time tips the first time something happens. Each shows once ever. */
  function coachTips() {
    if (!game.stage.world || coach.active) return
    const kind = game.skier.surface.kind
    const pitchDeg = (game.skier.pitch * 180) / Math.PI
    if (game.skier.mode === 'crashed') coach.tip('crash', 'Wipeout', `You get back up by yourself. ${game.mobile ? 'Pause' : '<kbd>R</kbd>'} restarts the run.`)
    else if (game.skier.missingSkis || game.skier.missingPoles) {
      coach.tip('gear', 'Yard sale', 'Ski over your scattered gear to pick it up.')
    }
    else if (kind === 'powder' && game.skier.sink > 0.12)
      coach.tip('powder', 'Deep snow', 'Powder is slower and turns take longer. Keep some speed and make round turns. Powder skis (Rider) float better.')
    else if (kind === 'forest') coach.tip('trees', 'Tree skiing', 'Look for the gap between trunks. Glancing hits slide past. A hard hit can still cause a wipeout.')
    else if (kind === 'ice') coach.tip('ice', 'Wind crust', 'The wind has scoured this snow hard. Edges hold less, so keep turns gentle until you are back on soft snow.')
    else if (kind === 'rock') coach.tip('rock', 'Thin cover', 'Rocks are poking through. It is slow and grabby; pick a line back onto the snow.')
    else if (game.skier.grounded && Math.abs(pitchDeg) > 28 && game.skier.speed > 7)
      coach.tip('steep', 'Steep pitch', 'Finish each turn across the hill to control your speed. A skidded turn brakes; a carved one keeps your speed.')
    else if (game.skier.rail)
      coach.tip(
        'rail',
        'On a rail',
        `Steer gently to stay on. ${game.mobile || controls.gamepad ? 'Push the stick up or down' : 'Hold <kbd>W</kbd> or <kbd>S</kbd>'} for a nose or tail press: more points, harder to balance. Come onto it sideways for a slide.`,
      )
    else if (game.stage.features().length && game.skier.grounded) {
      const travel = Math.hypot(game.skier.vx, game.skier.vz)
      const next = travel > 2 ? featureAhead(game.stage.features(), game.skier.x, game.skier.z, game.skier.vx / travel, game.skier.vz / travel, 35) : null
      if (next)
        coach.tip('park', 'Terrain park', `The speed window for the next jump shows on screen. Hold ${game.mobile ? 'Jump' : controls.gamepad ? '<kbd>A</kbd>' : '<kbd>Space</kbd>'} on the run-in and let go at the lip.`)
    }
  }

  function endChallenge(failed: string | null) {
    if (!game.goals || game.challenge.kind === 'free') return
    game.session.abandon()
    // An open combo counts: bank it so its points pay out with the run.
    tricks.bankNow()
    const finished = game.challenge
    const judged = comp.score(game.session.stats.time)
    const result = game.goals.finish(game.session, judged ? judged.total : tricks.total, failed)
    if (judged && !failed) result.lines.unshift(...judged.lines)
    comp.end()
    race.finished(result.improved && !failed)
    if (finished.kind === 'event' && finished.gates.length && !failed) {
      const g = race.grades
      result.lines.push(['Tight / clean / skidded gates', `${g.tight} / ${g.clean} / ${g.skid}`])
    }
    race.end()
    if (finished.kind === 'park') {
      const { perfect, clean, railMetres, bestName } = tricks.stats
      result.lines.push(['Perfect / clean landings', `${perfect} / ${clean}`], ['Rail and box distance', `${railMetres.toFixed(1)} m`])
      if (bestName) result.lines.push(['Best trick', bestName])
      result.lines.push(['Best combo', `×${tricks.stats.bestMultiplier} of ×${MAX_MULTIPLIER}`])
      // Short of gold, say what the scoring rewards.
      if (!failed && result.medal !== 'gold') result.advice = parkAdvice(tricks.stats, tricks.stats.landed) ?? undefined
    }
    if (result.unlockedNow.length) stylePanel.refresh()
    resultsNext = () => {
      ui.results.hidden = true
      resultsNext = null
      setFreeSki()
    }
    renderResults(ui.results, result, {
      retry: () => startChallenge(finished.kind === 'event' && game.goals ? game.goals.event(finished.course) : finished),
      next: resultsNext,
      nextLabel: 'Keep skiing',
      challenges: () => {
        ui.results.hidden = true
        setFreeSki()
        openChallenges()
      },
    })
    ui.results.hidden = false
  }

  function showRunCard(name: string, time: number, record: boolean, pointsRecord = false, stoke = 0) {
    const { stats } = game.session
    const points = tricks.total
    ui.runCard.innerHTML =
      `<strong>${escapeHtml(name)}</strong>` +
      `<span class="run-card-time">${formatTime(time)}${record ? '<em>Best</em>' : ''}</span>` +
      '<span class="run-card-stats">' +
      `<span><b>${Math.round(stats.topSpeed * 3.6)}</b>km/h top</span>` +
      `<span><b>${Math.round(stats.distance)}</b>m skied</span>` +
      `<span><b>${Math.round(stats.vertical)}</b>m vertical</span>` +
      (points ? `<span><b>${points.toLocaleString()}</b>points${pointsRecord ? ' · best lap' : ''}</span>` : '') +
      (stoke > 0 ? `<span><b>+${stoke.toLocaleString()}</b>Stoke</span>` : '') +
      '</span>'
    // Replay the entry animation when a new card replaces one still showing.
    ui.runCard.hidden = true
    void ui.runCard.offsetWidth
    ui.runCard.hidden = false
    window.clearTimeout(runCardTimer)
    runCardTimer = window.setTimeout(() => (ui.runCard.hidden = true), 8000)
  }

  /** Short fade with a message, then `then`. Physics pauses meanwhile. */
  function transition(message: string, seconds: number, then: () => void) {
    if (game.pause) return
    ui.fadeText.textContent = message
    ui.fade.classList.add('on')
    game.pause = {
      until: game.elapsed + seconds,
      then: () => {
        then()
        ui.fade.classList.remove('on')
      },
    }
  }

  function checkEvents() {
    if (game.skier.offMap) {
      transition('Off the map', 1.2, spawn)
      return
    }
    const world = game.stage.world
    if (!world) return
    const wipe = (what: string, into: number) => {
      const kmh = Math.round(Math.max(into, game.skier.speed) * 3.6)
      beginCrash(game.skier, Math.max(into, Math.hypot(game.skier.vx, game.skier.vz)))
      game.skier.vx *= -0.15
      game.skier.vz *= -0.15
      tricks.show(what, `${kmh} km/h`, 'crash')
    }
    if (game.skier.crashed > 0) return
    const building = game.stage.buildings?.hit(game.skier.x, game.skier.z)
    if (building) {
      // Step back outside the wall so getting up (or a slow nudge) is not another hit.
      const out = pushOutOfRing(game.skier.x, game.skier.z, building.ring)
      const into = game.skier.vx * -out.nx + game.skier.vz * -out.nz
      game.skier.x = out.x
      game.skier.z = out.z
      const ground = game.stage.slope.sampleTerrain(game.skier.x, game.skier.z)
      if (ground && game.skier.grounded) game.skier.y = ground.height
      if (into * 3.6 > 15) {
        wipe('Ran into a building', into)
        return
      }
      // Slow: lose the speed into the wall and slide along it.
      if (into > 0) {
        game.skier.vx += out.nx * into
        game.skier.vz += out.nz * into
      }
    }
    // Trail-head posts: same placement as signView (skier's right, ~6 m down the line).
    if (game.skier.grounded && game.skier.speed > 6) {
      for (const run of world.resort.runs) {
        if (run.kind !== 'line' || !run.name || run.name === 'Unnamed run' || !run.parts[0]) continue
        const line = run.parts[0]
        const [x0, z0] = pointAlong(line, 6)
        const [x1, z1] = pointAlong(line, 14)
        const length = Math.hypot(x1 - x0, z1 - z0) || 1
        const sx = x0 - ((z1 - z0) / length) * 9
        const sz = z0 + ((x1 - x0) / length) * 9
        if (Math.hypot(game.skier.x - sx, game.skier.z - sz) > 0.9) continue
        const nx = (game.skier.x - sx) / Math.max(0.05, Math.hypot(game.skier.x - sx, game.skier.z - sz))
        const nz = (game.skier.z - sz) / Math.max(0.05, Math.hypot(game.skier.x - sx, game.skier.z - sz))
        const into = Math.max(0, -(game.skier.vx * nx + game.skier.vz * nz))
        if (into < 4) {
          game.skier.x = sx + nx * 1.05
          game.skier.z = sz + nz * 1.05
          game.skier.vx += nx * into
          game.skier.vz += nz * into
          break
        }
        game.skier.x = sx + nx * 1.1
        game.skier.z = sz + nz * 1.1
        wipe('Hit a trail sign', into)
        return
      }
    }
    // Tutorial: the bottom of the bunny hill sends you back to the top.
    if (game.tutorialLine && coach.active) {
      const { off } = progressAlong(game.skier.x, game.skier.z, game.tutorialLine)
      const end = game.tutorialLine[game.tutorialLine.length - 1]
      if (Math.hypot(end[0] - game.skier.x, end[1] - game.skier.z) < 18 || off > 70) {
        transition('Back to the top', 0.9, spawn)
        return
      }
      return
    }
    if (game.challenge.kind === 'free' && game.session.stats.time > 10) {
      const lift = liftAtBottom(world.resort, game.skier.x, game.skier.z, 24)
      if (lift) {
        tricks.bankNow()
        const time = game.session.total
        // The lap is filed under the run it was mostly skied on, not the one the chair pointed at.
        const name = game.goals?.lapRun() ?? game.course?.startRun?.name ?? 'Apex'
        const record = !bests[name] || time < bests[name]
        if (record) bests[name] = time
        // Free-ski trick points count too: the best lap score is kept.
        const points = tricks.total
        const pointsRecord = points > 0 && points > (bests[LAP_POINTS] ?? 0)
        if (pointsRecord) bests[LAP_POINTS] = points
        if (record || pointsRecord) writeJson(KEYS.bests, bests)
        game.goals?.freeRun(game.session)
        showRunCard(name, time, record, pointsRecord, game.goals?.lapStoke() ?? 0)
        transition(`${name}\n${formatTime(time)}${record ? ' · best!' : ''}`, 1.8, () => startRide(lift))
      }
    }
  }

  /** Back to free skiing from wherever the skier is. */
  function setFreeSki() {
    if (game.challenge.kind === 'free') return
    game.challenge = { kind: 'free' }
    game.goals?.activate(game.challenge)
    game.session = createSession(game.challenge)
    runout.cancel()
    tricks.setMuted(false)
    race.end()
    comp.end()
  }

  /** Start (or retry) a challenge from its start line. */
  function startChallenge(next: Challenge) {
    leaveDemoPark()
    coach.stop()
    game.tutorialLine = null
    game.challenge = next
    game.goals?.activate(next)
    const start = game.goals?.courseFor(next)
    if (start) game.course = start
    hideOverlays()
    game.pause = null
    ui.fade.classList.remove('on')
    spawn()
  }

  return {
    eventTitle,
    onSessionEvent,
    coachTips,
    endChallenge,
    transition,
    checkEvents,
    setFreeSki,
    startChallenge,
    /** The results card's "Keep skiing", from the pause key. */
    dismissResults: () => resultsNext?.(),
  }
}

export type ChallengeFlow = ReturnType<typeof createChallengeFlow>
