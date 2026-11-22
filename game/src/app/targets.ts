/**
 * Medal times for timed runs and slaloms, set by the pace bot on the real
 * terrain. Worked out a few milliseconds per frame in the background and
 * cached per game version (physics changes ship as a new version).
 */
import type { SampleTerrain, SkiEnv } from '../sim'
import { BOT_SPEED_CAP, paceBot, paceBotSync, timeTargets, type MedalTargets } from '../world/challenges'
import { polylineLength, type Point2 } from '../world/resort'
import { KEYS, readJson, writeJson } from './storage'

interface Cache {
  version: string
  /** Bot seconds per course id, or null when the bot could not finish. */
  seconds: Record<string, number | null>
}

export interface Course {
  id: string
  line: Point2[]
}

/** Cache key: the course id plus its shape, so a moved gate or retraced run is worked out again. */
const keyOf = (course: Course) => `${course.id}|${course.line.length}|${Math.round(polylineLength(course.line))}`

export function createTargetBook(courses: Course[], terrain: SampleTerrain, env: SkiEnv, version: string) {
  const stored = readJson<Cache>(KEYS.targets, { version, seconds: {} })
  const cache: Cache = stored.version === version ? stored : { version, seconds: {} }
  const keys = new Map(courses.map((course) => [course.id, keyOf(course)]))
  const queue = courses.filter((course) => !(keyOf(course) in cache.seconds))
  let current: { course: Course; bot: Generator<void, number | null> } | null = null
  const save = () => writeJson(KEYS.targets, cache)
  const targets = (id: string): MedalTargets | null | undefined => {
    const key = keys.get(id) ?? id
    if (!(key in cache.seconds)) return undefined
    const seconds = cache.seconds[key]
    return seconds === null ? null : timeTargets(seconds)
  }
  return {
    /** Targets if known, null if the course has none, undefined if not worked out yet. */
    get: targets,
    /** Work it out now if needed (a few hundred ms at most for the longest run). */
    ensure(course: Course): MedalTargets | null {
      const key = keyOf(course)
      keys.set(course.id, key)
      if (!(key in cache.seconds)) {
        if (current?.course.id === course.id) current = null
        cache.seconds[key] = paceBotSync(course.line, terrain, env)
        save()
      }
      return targets(course.id) ?? null
    },
    /** Spend up to `budgetMs` on the queue. Call once per frame. */
    work(budgetMs: number) {
      const start = performance.now()
      while (performance.now() - start < budgetMs) {
        if (!current) {
          let next = queue.shift()
          while (next && keyOf(next) in cache.seconds) next = queue.shift()
          if (!next) return
          current = { course: next, bot: paceBot(next.line, terrain, env, BOT_SPEED_CAP, 420, 60) }
        }
        const step = current.bot.next()
        if (step.done) {
          cache.seconds[keyOf(current.course)] = step.value
          current = null
          save()
        }
      }
    },
    get pending() {
      return queue.length + (current ? 1 : 0)
    },
  }
}

export type TargetBook = ReturnType<typeof createTargetBook>
