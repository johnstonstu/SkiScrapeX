/**
 * Everything to play for on the Apex map: the challenge list, medal targets,
 * slalom gates, gold nuggets, run coverage and the saved profile. main.ts
 * owns the frame loop and the session; this owns the data around it.
 */
import type * as THREE from 'three'
import type { SkiState, Spawn } from '../sim'
import type { World } from '../world/loadWorld'
import { LAYOUTS, type ParkSite } from '../world/park'
import { headingFor, pickableRuns, pointAlong, polylineLength, type Course, type Lift, type Point2, type Run } from '../world/resort'
import {
  MIN_TIMED_LENGTH,
  SKIED_SHARE,
  buildSlalom,
  courseLine,
  mainLine,
  medalForScore,
  medalForTime,
  parkTargets,
  placeNuggets,
  runLengths,
  type Gate,
  type Medal,
} from '../world/challenges'
import { createGatesView, createNuggetsView } from '../render/scenery/goalsView'
import { UNLOCKS, awardMedal, readProgress, recordBest, skiedRuns, unlockedIds, writeProgress } from './progress'
import { createTargetBook } from './targets'
import type { Challenge, Session } from './session'
import type { Stage } from './stage'
import { formatTime } from './format'
import type { ChallengeData, ChallengeRow, ResultData, Summary } from '../ui/goalsPanels'

/** Groomed greens and blues of a slalom-friendly length make the slalom courses. */
function pickSlalomRuns(runs: Run[]): Run[] {
  const fit = runs.filter((run) => {
    const length = polylineLength(mainLine(run))
    // The provisional LiDAR traces wait for real names before they get a course.
    return !run.name.startsWith('Unmapped') && run.groomed && ['easy', 'intermediate'].includes(run.difficulty ?? '') && length > 420 && length < 1100
  })
  const easy = fit.filter((run) => run.difficulty === 'easy').slice(0, 1)
  const blue = fit.filter((run) => run.difficulty === 'intermediate').sort((a, b) => polylineLength(mainLine(a)) - polylineLength(mainLine(b)))
  return [...easy, ...blue.slice(0, 2)]
}

/** The bot follows the gate centres so its time reflects the turns. */
function slalomLine(line: Point2[], gates: Gate[]): Point2[] {
  return [line[0], ...gates.map((gate) => [gate.x, gate.z] as Point2), line[line.length - 1]]
}

const NUGGET_RADIUS = 2.6

export function createGoals(options: {
  world: World
  stage: Stage
  scene: THREE.Object3D
  parkSites: ParkSite[]
  runNameAt: (x: number, z: number) => string
  version: string
}) {
  const { world, stage, scene, parkSites } = options
  const { resort, grid } = world
  const progress = readProgress()
  const runs = pickableRuns(resort)
  const pickable = new Set(runs.map((run) => run.name))
  const lengths = new Map([...runLengths(resort)].filter(([name]) => pickable.has(name)))
  const blocked = (x: number, z: number) => Boolean(stage.trunks?.hit(x, z, 2) || stage.buildings?.hit(x, z))
  const lines = new Map<string, Point2[]>()
  /** The run's challenge course, cached: its main line from the first clear start. */
  const lineOf = (run: Run) => {
    let line = lines.get(run.name)
    if (!line) lines.set(run.name, (line = courseLine(mainLine(run), blocked)))
    return line
  }
  const timedRuns = runs.filter((run) => polylineLength(mainLine(run)) >= MIN_TIMED_LENGTH)
  const slalomRuns = pickSlalomRuns(runs)
  const gatesFor = new Map(slalomRuns.map((run) => [run.name, buildSlalom(lineOf(run))]))
  const book = createTargetBook(
    [
      // Slaloms first: there are only a few and they show at the top of the list.
      ...slalomRuns.map((run) => ({ id: `slalom:${run.name}`, line: slalomLine(lineOf(run), gatesFor.get(run.name)!) })),
      ...timedRuns.map((run) => ({ id: `time:${run.name}`, line: lineOf(run) })),
    ],
    stage.slope.sampleTerrain,
    // No ski model or assist: targets must not depend on the rider's kit.
    { sampleSurface: stage.env.sampleSurface },
    options.version,
  )
  /** Height of the surface the skier actually rides (2 m detail where loaded), so props sit on it. */
  const surfaceHeight = (x: number, z: number) => stage.slope.sampleTerrain(x, z)?.height ?? grid.heightAt(x, z)
  const nuggets = placeNuggets(runs, { width: grid.width, depth: grid.depth }, blocked)
  const found = new Set(progress.nuggets)
  const nuggetsView = createNuggetsView(nuggets, surfaceHeight, found)
  scene.add(nuggetsView.object)
  let gatesView: ReturnType<typeof createGatesView> | null = null
  let lastX = NaN
  let lastZ = NaN
  let unsaved = 0

  const skiedCount = () => skiedRuns(progress, lengths, SKIED_SHARE).length
  const unlocked = () => unlockedIds(progress, skiedCount())
  const symbolOf = (run: Run) => run.difficulty ?? 'unknown'
  const nearestLiftTop = (x: number, z: number): Lift | null =>
    [...resort.lifts].sort((a, b) => Math.hypot(a.top[0] - x, a.top[1] - z) - Math.hypot(b.top[0] - x, b.top[1] - z))[0] ?? null

  /** Save, and report rewards that this change unlocked. */
  const commit = (before: Set<string>): string[] => {
    writeProgress(progress)
    unsaved = 0
    const after = unlocked()
    return UNLOCKS.filter((unlock) => after.has(unlock.id) && !before.has(unlock.id)).map((unlock) => unlock.label)
  }

  return {
    progress,
    nuggets: nuggets as readonly { id: string; x: number; z: number }[],
    unlocked,
    hint: (id: string) => UNLOCKS.find((unlock) => unlock.id === id)?.hint ?? '',

    summary(): Summary {
      return { progress, skied: skiedCount(), runCount: lengths.size, nuggetCount: nuggets.length }
    },

    timed(run: Run): Challenge {
      const line = lineOf(run)
      return { kind: 'time', id: `time:${run.name}`, run, line, targets: book.ensure({ id: `time:${run.name}`, line }) }
    },
    slalom(run: Run): Challenge {
      const line = lineOf(run)
      const gates = gatesFor.get(run.name) ?? buildSlalom(line)
      const id = `slalom:${run.name}`
      return { kind: 'slalom', id, run, line, gates, targets: book.ensure({ id, line: slalomLine(line, gates) }) }
    },
    park(site: ParkSite): Challenge {
      return { kind: 'park', id: `park:${site.name}:${site.layout}`, site, layout: site.layout, line: site.line, targets: parkTargets(site.layout) }
    },

    /** Where a challenge starts: the first point of its line, facing down it. */
    courseFor(challenge: Challenge): Course | null {
      if (challenge.kind === 'free') return null
      const line = challenge.line
      const startAt = challenge.kind === 'park' ? 4 : 0
      const [x, z] = pointAlong(line, startAt)
      const [ax, az] = pointAlong(line, startAt + 12)
      const spawn: Spawn = { x, z, heading: headingFor(ax - x, az - z) }
      if (challenge.kind === 'park') {
        const site = challenge.site
        return { spawn, startLift: null, startRun: { id: site.id, name: site.name, difficulty: 'park', groomed: true, kind: 'line', parts: [site.line] } }
      }
      return { spawn, startLift: nearestLiftTop(x, z), startRun: challenge.run }
    },

    /** Run lines for other skiers to follow. */
    routes(): { name: string; line: Point2[]; difficulty: string | null }[] {
      return runs.filter((run) => lengths.has(run.name)).map((run) => ({ name: run.name, line: lineOf(run), difficulty: run.difficulty }))
    },

    /** The bunny hill for the tutorial: Easy Rider by the Magic Carpet, or the nearest gentle run. */
    tutorial(): { course: Course; line: Point2[] } | null {
      const carpet = resort.lifts.find((lift) => /magic carpet/i.test(lift.name)) ?? null
      const gentle = runs.filter((run) => ['novice', 'easy'].includes(run.difficulty ?? ''))
      const byCarpet = (run: Run) => (carpet ? Math.hypot(mainLine(run)[0][0] - carpet.top[0], mainLine(run)[0][1] - carpet.top[1]) : 0)
      const run = gentle.find((r) => r.name === 'Easy Rider') ?? [...gentle].sort((a, b) => byCarpet(a) - byCarpet(b))[0]
      if (!run) return null
      const line = lineOf(run)
      const [x, z] = line[0]
      const [ax, az] = pointAlong(line, 12)
      return { course: { spawn: { x, z, heading: headingFor(ax - x, az - z) }, startLift: carpet, startRun: run }, line }
    },

    /** Show this challenge's gates (or none). */
    activate(challenge: Challenge) {
      if (gatesView) {
        scene.remove(gatesView.object)
        gatesView.dispose()
        gatesView = null
      }
      if (challenge.kind === 'slalom') {
        gatesView = createGatesView(challenge.gates, surfaceHeight)
        scene.add(gatesView.object)
      }
    },
    resetGates() {
      gatesView?.reset()
    },
    markGate(index: number, result: 'pass' | 'miss') {
      gatesView?.mark(index, result)
    },

    /**
     * Per frame: background medal-time work, nugget animation, run coverage
     * and nugget pickups. Returns a message to show, if any.
     */
    frame(skier: SkiState, dt: number, riding: boolean, camera: THREE.Vector3): { title: string; detail: string } | null {
      book.work(2)
      gatesView?.update(camera)
      nuggetsView.update(dt)
      if (riding) {
        lastX = NaN
        return null
      }
      let message: { title: string; detail: string } | null = null
      if (Number.isFinite(lastX)) {
        const step = Math.hypot(skier.x - lastX, skier.z - lastZ)
        // Teleports (respawns) are not skiing.
        if (step < 5) {
          const name = options.runNameAt(skier.x, skier.z)
          if (lengths.has(name)) {
            const length = lengths.get(name)!
            const before = progress.covered[name] ?? 0
            progress.covered[name] = before + step
            if (before < length * SKIED_SHARE && before + step >= length * SKIED_SHARE) {
              const newly = commit(unlocked())
              message = { title: `Skied ${name}`, detail: `${skiedCount()}/${lengths.size} runs${newly.length ? ` · unlocked ${newly.join(', ')}` : ''}` }
            }
          }
          progress.totals.distance += step
          unsaved += step
        }
      }
      lastX = skier.x
      lastZ = skier.z
      for (const nugget of nuggets) {
        if (found.has(nugget.id)) continue
        if (Math.abs(nugget.x - skier.x) > NUGGET_RADIUS || Math.abs(nugget.z - skier.z) > NUGGET_RADIUS) continue
        if (Math.hypot(nugget.x - skier.x, nugget.z - skier.z) > NUGGET_RADIUS) continue
        if (Math.abs(surfaceHeight(nugget.x, nugget.z) + 0.9 - skier.y) > 3) continue
        const before = unlocked()
        found.add(nugget.id)
        progress.nuggets.push(nugget.id)
        nuggetsView.remove(nugget.id)
        const newly = commit(before)
        message = { title: 'Gold nugget!', detail: `${found.size}/${nuggets.length} found${newly.length ? ` · unlocked ${newly.join(', ')}` : ''}` }
      }
      // Coverage saves every 200 m skied, so a closed tab loses little.
      if (unsaved > 200) commit(unlocked())
      return message
    },

    /** Score a finished (or abandoned) challenge, save it and build the results card. */
    finish(session: Session, points: number, failed: string | null): ResultData & { unlockedNow: string[] } {
      const challenge = session.challenge
      if (challenge.kind === 'free') throw new Error('free skiing has no result')
      const before = unlocked()
      const score = challenge.kind === 'park'
      const value = score ? points : session.total
      const { stats } = session
      progress.totals.runs++
      progress.totals.vertical += stats.vertical
      progress.totals.topSpeed = Math.max(progress.totals.topSpeed, stats.topSpeed)
      let medal: Medal | null = null
      let best: { previous?: number; improved: boolean } = { previous: progress.bests[challenge.id], improved: false }
      if (!failed) {
        medal = challenge.targets ? (score ? medalForScore(value, challenge.targets) : medalForTime(value, challenge.targets)) : null
        awardMedal(progress, challenge.id, medal)
        best = recordBest(progress, challenge.id, value, !score)
      }
      const unlockedNow = commit(before)
      const lines: [string, string][] = [
        ['Top speed', `${Math.round(stats.topSpeed * 3.6)} km/h`],
        ['Distance', `${Math.round(stats.distance)} m`],
        ['Vertical', `${Math.round(stats.vertical)} m`],
      ]
      if (challenge.kind === 'slalom') {
        lines.unshift(['Gates', `${stats.gatesPassed}/${challenge.gates.length}${stats.penalty ? ` · +${stats.penalty} s` : ''}`])
        if (stats.penalty) lines.unshift(['Clock', formatTime(stats.time)])
      }
      if (challenge.kind === 'park') lines.unshift(['Time', formatTime(stats.time)])
      else if (points > 0) lines.push(['Trick points', points.toLocaleString()])
      const title =
        challenge.kind === 'park' ? `${challenge.site.name} · score attack` : challenge.kind === 'slalom' ? `${challenge.run.name} slalom` : challenge.run.name
      return {
        title,
        value,
        score,
        medal,
        targets: challenge.targets,
        previous: best.previous,
        improved: best.improved,
        failed: failed ?? undefined,
        lines: unlockedNow.length ? [...lines, ['Unlocked', unlockedNow.join(', ')]] : lines,
        unlockedNow,
      }
    },

    /** Free-ski run to a lift: totals only. */
    freeRun(session: Session) {
      progress.totals.runs++
      progress.totals.vertical += session.stats.vertical
      progress.totals.topSpeed = Math.max(progress.totals.topSpeed, session.stats.topSpeed)
      commit(unlocked())
    },

    challengeData(start: (challenge: Challenge) => void): ChallengeData {
      const row = (challenge: Exclude<Challenge, { kind: 'free' }>, name: string, symbol: string, detail?: string): ChallengeRow => ({
        id: challenge.id,
        name,
        symbol,
        detail,
        targets: challenge.kind === 'park' ? challenge.targets : book.get(challenge.id),
        score: challenge.kind === 'park',
        start: () => start(challenge),
      })
      // Rows hold lazy challenges: book.ensure only runs when one is started.
      const lazy = (kind: 'time' | 'slalom', run: Run): ChallengeRow => {
        const id = `${kind}:${run.name}`
        return {
          id,
          name: run.name,
          symbol: symbolOf(run),
          detail: kind === 'slalom' ? `${gatesFor.get(run.name)?.length ?? 0} gates` : `${Math.round(polylineLength(lineOf(run)))} m`,
          targets: book.get(id),
          score: false,
          start: () => start(kind === 'time' ? this.timed(run) : this.slalom(run)),
        }
      }
      const skied = new Set(skiedRuns(progress, lengths, SKIED_SHARE))
      const runRows = runs.filter((run) => lengths.has(run.name)).map((run) => ({ name: run.name, symbol: symbolOf(run), skied: skied.has(run.name) }))
      return {
        summary: this.summary(),
        slalom: slalomRuns.map((run) => lazy('slalom', run)),
        park: parkSites.map((site) => row(this.park(site) as Exclude<Challenge, { kind: 'free' }>, site.name, 'park', LAYOUTS.find((l) => l.id === site.layout)?.label ?? site.layout)),
        timed: timedRuns.map((run) => lazy('time', run)),
        runs: runRows,
        unlocked: unlocked(),
      }
    },
  }
}

export type Goals = ReturnType<typeof createGoals>
