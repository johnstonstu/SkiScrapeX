/**
 * The mogul comp course as pure data: a straight lane down the fall line, a
 * zipper of bumps the racer weaves through (one turn, one beat, per bump),
 * outer columns of bumps for the look of a comp field, and two air ramps (the
 * top air and the bottom air). Laid on the terrain only while the comp runs.
 */
import type { Mogul } from './moguls'
import { headingFor, type Point2 } from './resort'

/** Metres down the lane between turns (one bump per turn). */
export const TURN_PITCH = 3.6
/** How far either side of the lane centre the racer's line swings, metres. */
export const LINE_SWING = 0.8
/** No turns from this far above an air ramp to this far below it (the run-in, flight and landing). */
const AIR_BEFORE = 10
const AIR_AFTER = 16
/** Height of an air ramp's lip above the slope, metres. */
export const AIR_HEIGHT = 1.6

export interface Turn {
  /** Metres down the lane where the turn's beat falls. */
  s: number
  /** -1 a turn to the left side of the lane, 1 to the right. */
  dir: -1 | 1
}

export interface Air {
  name: string
  /** Metres down the lane of the ramp's lip. */
  s: number
}

export interface MogulCourse {
  /** The lane: start and finish, straight. */
  line: [Point2, Point2]
  length: number
  dirX: number
  dirZ: number
  turns: Turn[]
  airs: Air[]
  bumps: Mogul[]
}

/** A point `s` metres down the lane and `lateral` metres to the right (+) of its centre. */
export function lanePoint(course: Pick<MogulCourse, 'line' | 'dirX' | 'dirZ'>, s: number, lateral: number): Point2 {
  const [x0, z0] = course.line[0]
  // Right of travel is (-dirZ, dirX) with +X east and +Z south.
  return [x0 + course.dirX * s - course.dirZ * lateral, z0 + course.dirZ * s + course.dirX * lateral]
}

/** Down-lane distance and right-of-centre offset of a point. */
export function laneCoords(course: Pick<MogulCourse, 'line' | 'dirX' | 'dirZ'>, x: number, z: number): { s: number; lateral: number } {
  const ex = x - course.line[0][0]
  const ez = z - course.line[0][1]
  return { s: ex * course.dirX + ez * course.dirZ, lateral: -ex * course.dirZ + ez * course.dirX }
}

export function buildMogulCourse(start: Point2, end: Point2, airShares: [number, number] = [0.2, 0.8]): MogulCourse {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const dirX = (end[0] - start[0]) / length
  const dirZ = (end[1] - start[1]) / length
  const base = { line: [start, end] as [Point2, Point2], dirX, dirZ }
  const airs: Air[] = [
    { name: 'Top air', s: Math.round(length * airShares[0]) },
    { name: 'Bottom air', s: Math.round(length * airShares[1]) },
  ]
  const inAirZone = (s: number) => airs.some((air) => s > air.s - AIR_BEFORE && s < air.s + AIR_AFTER)
  const turns: Turn[] = []
  const bumps: Mogul[] = []
  const bump = (s: number, lateral: number, shape: number, height: number): Mogul => {
    const [x, z] = lanePoint(base, s, lateral)
    // `dirZ/dirX` here are the downhill axis of the bump; its width runs across it.
    return { x, z, dirX, dirZ, height, width: 1.9 + 0.12 * Math.cos(shape), uphill: 2.3 + 0.15 * Math.sin(shape), downhill: 1.7 + 0.1 * Math.cos(shape * 0.7) }
  }
  let dir: -1 | 1 = 1
  for (let s = 12, row = 0; s < length - 10; s += TURN_PITCH, row++) {
    const shape = row * 1.37
    // Outer columns on both sides every row, for the look of a comp field.
    for (const side of [-1, 1]) bumps.push(bump(s, side * (4.3 + 0.2 * Math.sin(shape)), shape + side, 0.62))
    if (inAirZone(s)) continue
    turns.push({ s, dir })
    // The zipper bump sits on the far side of the turn: the racer swings past its shoulder.
    bumps.push(bump(s, -dir * 1.75, shape, 0.5 + 0.06 * Math.sin(shape * 1.3)))
    dir = dir === 1 ? -1 : 1
  }
  // Air ramps: a long run-in and a short, steep lip, on the lane centre.
  for (const air of airs) {
    const [x, z] = lanePoint(base, air.s, 0)
    bumps.push({ x, z, dirX, dirZ, height: AIR_HEIGHT, width: 2.8, uphill: 6, downhill: 0.8 })
  }
  return { ...base, length, turns, airs, bumps }
}

/** Heading (skier convention) down the lane. */
export function laneHeading(course: Pick<MogulCourse, 'dirX' | 'dirZ'>): number {
  return headingFor(course.dirX, course.dirZ)
}
