/**
 * Apex race events as pure data: courses stitched from the real run lines,
 * race gates, speed traps, split clocks and where the crowd and props stand.
 * Nothing here draws or imports Three.js; `render/scenery/eventView.ts` builds
 * the props and only while the event is being raced, never in free ski.
 *
 * History and sources: docs/review/apex-events/game-event-ideas.md.
 */
import { headingFor, pointAlong, polylineLength, type Point2, type Resort, type Run } from './resort'
import { mainLine, trimLine, type Gate, type MedalTargets } from './challenges'
import { buildMogulCourse, type MogulCourse } from './mogulCourse'
import { parkSitesFromLines } from './park'

export type EventFormat =
  /** Fastest clock wins; missed gates (if any) disqualify. */
  | 'race'
  /** Two runs, fastest combined time wins (slalom). */
  | 'twoRun'
  /** Two runs: the first sets a time, the second tries to match it. */
  | 'match'
  /** Mogul comp: tap to turn, judged on turns, air and speed. */
  | 'moguls'
  /** Aerials: the best two jumps, difficulty times form. */
  | 'aerials'

export interface EventDef {
  id: string
  name: string
  /** Where it runs, for the list. */
  where: string
  /** One or two lines of real Apex history. */
  story: string
  /** The rules, shown in the list and the start banner. */
  rules: string
  format: EventFormat
  /** Course legs, top to bottom: a run and where on it to start and stop. */
  legs: Leg[]
  /** Metres to drop off the top of the stitched line (to start clear of a lift terminal). */
  startTrim?: number
  /** Replace the course with a straight lane this long from its start (the mogul comp). */
  straight?: number
  gates:
    | { kind: 'none' }
    | {
        kind: 'downhill' | 'gs' | 'slalom'
        /** First gate, metres along the course; then one every `spacing` until `endGap` before the finish. */
        start: number
        spacing: number
        /** Gate centre this far left and right of the line in turn (0: on it). */
        offset: number
        /** Pole spacing either side of the gate centre. */
        halfWidth: number
        endGap: number
        /** Skip a gate where the course turns more than this many degrees over 60 m: racers swing wide there. */
        maxBend: number
      }
  /** Share of the course length where the radar gun sits. */
  trap: [number, number] | null
  /** Shares of the course length with a split clock. */
  splits: number[]
  /** A crash between start and finish ends the attempt. */
  bailIsDnf: boolean
  /** How far off the line (m) before the off-course clock starts. */
  corridor: number
  /** Pace bot speed cap for the medal times, m/s. */
  paceCap: number
  /** Fixed medal targets instead of the pace bot's (seconds; lower is better). */
  fixedTargets?: MedalTargets
  /** What stands at the finish. */
  finish: { crowd: number; cars: number; hut: boolean; banner: string }
  /** A real benchmark to show in the results, e.g. a record speed. */
  benchmark?: { label: string; kmh?: number; seconds?: number }
}

/** A run, cut from the vertex nearest `from` to the vertex nearest `to` (either may be omitted). */
export interface Leg {
  /** A run name, or with `park: true` a terrain park name (Aerial Site). */
  run: string
  park?: boolean
  from?: Point2
  to?: Point2
}

const SUMMIT: Point2 = [1554, 1551]

export const EVENTS: EventDef[] = [
  {
    id: 'shoot-the-chute',
    name: 'Shoot the Chute',
    where: 'Summit to the old upper lot, down the Chute',
    story:
      'Apex locals raced straight down the Chute and stopped in front of the upper parking lot where the crowd stood. Eric Pehota was clocked at 151 km/h on 225 cm skis.',
    rules: 'No gates: point them and hold on. Radar on the lower pitch. A crash is a DNF.',
    format: 'race',
    legs: [
      { run: "Grandfather's Trail", from: SUMMIT, to: [1360, 1362] },
      { run: 'Chute', from: [1360, 1362] },
    ],
    // Clear of the Quickdraw top terminal.
    startTrim: 35,
    gates: { kind: 'none' },
    trap: [0.66, 0.76],
    splits: [],
    bailIsDnf: true,
    corridor: 42,
    paceCap: 40,
    finish: { crowd: 70, cars: 14, hut: false, banner: 'SHOOT THE CHUTE' },
    benchmark: { label: 'Eric Pehota', kmh: 151 },
  },
  {
    id: 'apex-downhill',
    name: 'Apex Downhill',
    where: 'Summit start house, down Gunbarrel to the old upper lot',
    story:
      'The FIS Gunbarrel downhill hosted Nor-Am and Canada Cup speed races from 1998 to 2013, the Mars Canadian Junior Championships in 2004 and the Mars BC Cup in 2005: 532 m of drop, winners near 1:20.',
    rules: 'Pass every gate or you are disqualified. Two split clocks and a speed trap at the bottom of Gunbarrel. A crash is a DNF.',
    format: 'race',
    legs: [
      { run: "Grandfather's Trail", from: SUMMIT, to: [1069, 1234] },
      { run: 'Gunbarrel' },
      // The old Gunbarrel ended at the upper parking lot (Stu's local knowledge), so the finish is there.
      { run: "Grandfather's Trail", from: [1161, 681], to: [1479, 506] },
    ],
    startTrim: 35,
    // Gates cover the Gunbarrel pitch only: above it the summit traverse is a side-hill cat track, below it a hard bend onto the
    // cat track to the finish, and a gate on either would only punish drifting.
    gates: { kind: 'downhill', start: 660, spacing: 45, offset: 0, halfWidth: 6, endGap: 400, maxBend: 40 },
    // Split 1 at the top of Gunbarrel, split 2 and the radar at the bottom of its steep pitch (shares measured on the stitched line).
    trap: [0.7, 0.76],
    splits: [0.42, 0.76],
    bailIsDnf: true,
    corridor: 36,
    paceCap: 33,
    finish: { crowd: 90, cars: 0, hut: true, banner: 'GUNBARREL DOWNHILL' },
    benchmark: { label: 'Conrad Pridy (FIS, 2,002 m course)', seconds: 79.52 },
  },
  {
    id: 'apex-slalom',
    name: 'Apex Slalom',
    where: 'Okanagan Run, off the T-Bar',
    story:
      'The Teck Okanagan Zone races run a "slalom factory" off the T-Bar: six lanes and about 800 race runs a weekend on Okanagan Run.',
    rules: 'Two runs, combined time. Tight gates: carve close to each turning pole for speed. A missed gate is a disqualification.',
    format: 'twoRun',
    legs: [{ run: 'Okanagan Run' }],
    // Clear of the T-Bar top.
    startTrim: 30,
    gates: { kind: 'slalom', start: 30, spacing: 14, offset: 2.5, halfWidth: 4, endGap: 30, maxBend: 25 },
    // A key-tapping racer with the line assist clears every gate from 9 to 13 m/s, with any lead from 3 to 5 m (tests/events.test.ts).
    trap: null,
    splits: [0.5],
    bailIsDnf: false,
    corridor: 25,
    paceCap: 12,
    finish: { crowd: 45, cars: 0, hut: true, banner: 'APEX SLALOM' },
  },
  {
    id: 'teck-gs',
    name: 'Teck Open GS',
    where: 'Old Mill, finishing at the Ski Club timing hut',
    story: 'The Teck Open and Can-Am giant slaloms run on Old Mill, timed from the Apex Ski Club hut built in 2015.',
    rules: 'Round the gates on the correct side. A missed gate is a disqualification.',
    format: 'race',
    legs: [{ run: 'Old Mill' }],
    // Clear of the T-Bar top.
    startTrim: 30,
    gates: { kind: 'gs', start: 40, spacing: 34, offset: 3, halfWidth: 6, endGap: 35, maxBend: 20 },
    trap: null,
    splits: [0.5],
    bailIsDnf: false,
    corridor: 30,
    // A key-tapping racer with the line assist clears every gate up to 18 m/s; the pace bot sets times at 16.
    paceCap: 16,
    finish: { crowd: 35, cars: 0, hut: true, banner: 'APEX SKI CLUB GS' },
  },
  {
    id: 'kristis-moguls',
    name: "Kristi's Moguls",
    where: "Kristi's Run, the Nor-Am mogul course",
    story:
      "Kristi's has hosted FIS Nor-Am and Canada Cup moguls since 2008: a steady pitch, a top air and a bottom air, seven judges.",
    rules: 'Tap left or right on each bump and your skier holds the line. Hit the beat to speed up. Trick off both airs. Three misses in a row and you are out.',
    format: 'moguls',
    legs: [{ run: "Kristi's" }],
    // The straight, steady lower pitch (about 21 degrees), 220 m like the real comp course.
    startTrim: 150,
    straight: 220,
    gates: { kind: 'none' },
    trap: null,
    splits: [],
    bailIsDnf: false,
    corridor: 18,
    paceCap: 11,
    // Points out of 100 (higher is better).
    fixedTargets: { gold: 80, silver: 65, bronze: 45 },
    finish: { crowd: 60, cars: 0, hut: false, banner: 'APEX MOGUL CLASSIC' },
  },
  {
    id: 'apex-aerials',
    name: 'Aerials',
    where: "The Aerial Site beside Kristi's",
    story:
      'Apex hosted FIS Freestyle World Cup aerials in 2006 and 2007 at the Aerial Site, the same kicker that launches the Dummy Downhill on closing day.',
    rules: 'Hit the kickers and throw your best. Your two best jumps count: degree of difficulty (flips, spins, a grab) times form (the landing).',
    format: 'aerials',
    legs: [{ run: 'Aerial Site', park: true }],
    gates: { kind: 'none' },
    trap: null,
    splits: [],
    bailIsDnf: false,
    corridor: 45,
    paceCap: 11,
    // Points (higher is better): two clean backflips are about 25, a perfect backflip and a cork about 33.
    fixedTargets: { gold: 30, silver: 22, bronze: 14 },
    finish: { crowd: 70, cars: 0, hut: false, banner: 'APEX AERIALS' },
  },
  {
    id: 'match-your-time',
    name: 'Match Your Time',
    where: 'Maverick',
    story: 'For the 50th anniversary in December 2011, Apex raced Match Your Time: ski a run, then ski it again as close to the same time as you can.',
    rules: 'Run one sets your time. Run two scores the difference: closest wins.',
    format: 'match',
    legs: [{ run: 'Maverick' }],
    // Clear of the Stock's Chair top.
    startTrim: 30,
    gates: { kind: 'none' },
    trap: null,
    splits: [],
    bailIsDnf: false,
    corridor: 60,
    paceCap: 20,
    fixedTargets: { gold: 0.3, silver: 1, bronze: 2.5 },
    finish: { crowd: 25, cars: 0, hut: false, banner: 'APEX 50' },
  },
]

/** Index of the vertex nearest a point. */
function nearestIndex(line: Point2[], [x, z]: Point2): number {
  let best = 0
  let bestSq = Infinity
  line.forEach(([px, pz], i) => {
    const d = (px - x) ** 2 + (pz - z) ** 2
    if (d < bestSq) ((bestSq = d), (best = i))
  })
  return best
}

/** Join legs into one line, dropping points closer than 1 m to the previous one. */
export function stitch(resort: Resort, legs: Leg[]): Point2[] {
  const out: Point2[] = []
  for (const leg of legs) {
    let line: Point2[]
    if (leg.park) {
      const site = parkSitesFromLines(resort.parks).find((p) => p.name === leg.run)
      if (!site) throw new Error(`Event park ${leg.run} is not in the resort`)
      line = site.line
    } else {
      const run: Run | undefined = resort.runs.find((r) => r.name === leg.run)
      if (!run) throw new Error(`Event leg ${leg.run} is not in the resort`)
      line = mainLine(run)
    }
    const a = leg.from ? nearestIndex(line, leg.from) : 0
    const b = leg.to ? nearestIndex(line, leg.to) : line.length - 1
    if (b <= a) throw new Error(`Event leg ${leg.run} runs backwards (${a} to ${b})`)
    for (const point of line.slice(a, b + 1)) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1) out.push(point)
    }
  }
  return out
}

/** Race gates along the line: alternating sides by `offset` (0 keeps them on the line). */
export function raceGates(line: Point2[], spec: Exclude<EventDef['gates'], { kind: 'none' }>): Gate[] {
  const total = polylineLength(line)
  const gates: Gate[] = []
  let side: -1 | 1 = 1
  const heading = (a: number, b: number) => {
    const [ax, az] = pointAlong(line, a)
    const [bx, bz] = pointAlong(line, b)
    return Math.atan2(bx - ax, bz - az)
  }
  for (let s = spec.start; s <= total - spec.endGap; s += spec.spacing) {
    // No gate on a sharp bend: racers swing wide there, and a gate would only punish that.
    const turn = heading(s, s + 30) - heading(s - 30, s)
    const bend = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
    if (bend > (spec.maxBend * Math.PI) / 180) continue
    const [ax, az] = pointAlong(line, s - 3)
    const [bx, bz] = pointAlong(line, s + 3)
    const length = Math.hypot(bx - ax, bz - az) || 1
    const dirX = (bx - ax) / length
    const dirZ = (bz - az) / length
    const [cx, cz] = pointAlong(line, s)
    gates.push({ x: cx + side * spec.offset * dirZ, z: cz - side * spec.offset * dirX, dirX, dirZ, side, s, halfWidth: spec.halfWidth })
    side = side === 1 ? -1 : 1
  }
  return gates
}

/** A spot beside the course: `s` metres along, `side` metres right (+) or left (-) of the direction of travel. */
export function besideLine(line: Point2[], s: number, side: number): { x: number; z: number; heading: number; yaw: number } {
  const total = polylineLength(line)
  // Past either end, carry straight on along the end segment (for run-out fencing and the start house).
  const a = Math.min(Math.max(s - 3, 0), total - 6)
  const [ax, az] = pointAlong(line, a)
  const [bx, bz] = pointAlong(line, a + 6)
  const length = Math.hypot(bx - ax, bz - az) || 1
  const dirX = (bx - ax) / length
  const dirZ = (bz - az) / length
  const clamped = Math.min(Math.max(s, 0), total)
  const [px, pz] = pointAlong(line, clamped)
  const cx = px + dirX * (s - clamped)
  const cz = pz + dirZ * (s - clamped)
  // Right of travel is (-dirZ, dirX) with +X east and +Z south.
  // heading is the skier convention; yaw turns an object's +Z to face the direction of travel.
  return { x: cx - dirZ * side, z: cz + dirX * side, heading: headingFor(dirX, dirZ), yaw: Math.atan2(dirX, dirZ) }
}

export interface EventCourse {
  def: EventDef
  line: Point2[]
  length: number
  gates: Gate[]
  /** Speed trap, metres along the line. */
  trap: [number, number] | null
  /** Split clocks, metres along the line. */
  splits: number[]
  /** The mogul comp's lane, bumps, turns and airs. */
  moguls?: MogulCourse
}

export function buildEventCourse(resort: Resort, def: EventDef): EventCourse {
  const stitched = trimLine(stitch(resort, def.legs), def.startTrim ?? 0)
  const line: Point2[] = def.straight ? [stitched[0], pointAlong(stitched, def.straight)] : stitched
  const length = polylineLength(line)
  const moguls = def.format === 'moguls' ? buildMogulCourse(line[0], line[line.length - 1]) : undefined
  return {
    def,
    line,
    length,
    gates: def.gates.kind === 'none' ? [] : raceGates(line, def.gates),
    trap: def.trap ? [def.trap[0] * length, def.trap[1] * length] : null,
    splits: def.splits.map((share) => share * length),
    moguls,
  }
}

/**
 * The line a racer (and the pace bot) follows: the course itself when the
 * gates sit on it, or the start, each gate centre and the finish when they
 * are set off to the sides.
 */
export function paceRoute(course: EventCourse): Point2[] {
  if (course.def.gates.kind === 'none' || course.def.gates.offset === 0) return course.line
  return [course.line[0], ...course.gates.map((gate) => [gate.x, gate.z] as Point2), course.line[course.line.length - 1]]
}

/** Score for Match Your Time: seconds between the two runs. */
export function matchDelta(first: number, second: number): number {
  return Math.abs(second - first)
}
