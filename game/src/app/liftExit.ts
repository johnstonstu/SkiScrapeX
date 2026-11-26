/**
 * Where to put the rider after getting off at the top of a lift, with no
 * rendering. A good spot is clear of the station, the lift line, buildings and
 * trees; has open snow both ways across the hill, so the rider can head off
 * to either side; and is gentle enough to stand on. On a gentle spot the
 * rider ends facing down the fall line; on a steeper one, across it on their
 * edges (standing still, as a skier stops at the top), so one turn takes them
 * down either way.
 *
 * Yaws here are travel directions: (sin yaw, cos yaw) in x and z.
 */
import type { SampleTerrain } from '../sim'

export interface ExitOptions {
  /** Chairs unload straight ahead down a ramp; surface lifts step aside. */
  aerial: boolean
  sample: SampleTerrain
  /** Buildings, trees and anything else the rider cannot stand in. */
  blocked: (x: number, z: number) => boolean
  /** Squared distance from (x, z) to the lift line, metres². */
  lineDistanceSq: (x: number, z: number) => number
}

export interface ExitSpot {
  /** Direction of the glide off the lift. */
  yaw: number
  /** Where the glide ends. */
  x: number
  z: number
  /** Which way the rider faces at the end: down a gentle fall line, across a steeper one. */
  face: number
}

/** Metres past the top of the lift line the glide ends: chairs come down a ramp, surface lifts step aside. */
export const EXIT_REACH = { aerial: [11, 14], surface: [7, 9.5] } as const
/** A surface lift's exit stays this far from the line, so the next bar swings past. */
export const LINE_CLEARANCE = 4.5
/** How far either way across the hill counts as room to go, metres. */
const ROOM = 16
/** Pitches (degrees) that feel ready to go: steeper is a standing start on a wall, flatter needs poling. */
const PITCH = { min: 2, max: 12 }
/** Steeper than this, the rider stops across the fall line instead of facing down it. */
export const FACE_DOWN_MAX_PITCH = 7

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** Clear metres along `yaw` from (x, z), up to `max`. */
function clearance(x: number, z: number, yaw: number, max: number, options: ExitOptions, avoidLine: boolean): number {
  let clear = 0
  for (let d = 1.5; d <= max; d += 1.5) {
    const px = x + Math.sin(yaw) * d
    const pz = z + Math.cos(yaw) * d
    if (!options.sample(px, pz) || options.blocked(px, pz)) break
    // Leaving the line itself, the first few metres are on it by definition.
    if (avoidLine && d > 4 && options.lineDistanceSq(px, pz) < 2.5 * 2.5) break
    clear = d
  }
  return clear
}

/** The fall line's yaw at (x, z) and the pitch in degrees, or null off the terrain. */
function fallLine(x: number, z: number, sample: SampleTerrain): { yaw: number; pitch: number } | null {
  const s = sample(x, z)
  if (!s) return null
  const { x: nx, y: ny, z: nz } = s.normal
  const pitch = (Math.acos(Math.min(1, Math.max(-1, ny))) * 180) / Math.PI
  return { yaw: Math.atan2(nx, nz), pitch }
}

/**
 * Choose the exit from the top of the line at (x, z), where the lift was
 * heading `lineYaw`.
 */
export function chooseExit(x: number, z: number, lineYaw: number, options: ExitOptions): ExitSpot {
  const reaches = options.aerial ? EXIT_REACH.aerial : EXIT_REACH.surface
  // Chairs come off ahead; a surface lift's rider lets go and turns off to a side.
  const turns: number[] = []
  const widest = options.aerial ? 1.3 : 2.1
  for (let t = 0; t <= widest + 1e-9; t += 0.15) turns.push(t, -t)
  let best: (ExitSpot & { score: number }) | null = null
  for (const turn of turns) {
    if (!options.aerial && Math.abs(turn) < 0.6) continue
    const yaw = lineYaw + turn
    for (const reach of reaches) {
      if (clearance(x, z, yaw, reach, options, !options.aerial) < reach - 1.5) continue
      const ex = x + Math.sin(yaw) * reach
      const ez = z + Math.cos(yaw) * reach
      if (!options.aerial && options.lineDistanceSq(ex, ez) < LINE_CLEARANCE * LINE_CLEARANCE) continue
      const fall = fallLine(ex, ez, options.sample)
      if (!fall) continue
      const down = fall.pitch < 1.5 ? yaw : fall.yaw
      // Room both ways across the hill, and down it.
      const left = clearance(ex, ez, down - Math.PI / 2, ROOM, options, true)
      const right = clearance(ex, ez, down + Math.PI / 2, ROOM, options, true)
      const ahead = clearance(ex, ez, down, ROOM, options, true)
      // Gentle: face down. Steeper: across the hill, the way nearer the glide.
      const across = Math.abs(wrap(down + Math.PI / 2 - yaw)) < Math.abs(wrap(down - Math.PI / 2 - yaw)) ? down + Math.PI / 2 : down - Math.PI / 2
      const face = fall.pitch <= FACE_DOWN_MAX_PITCH ? down : across
      const pitchCost = fall.pitch < PITCH.min ? (PITCH.min - fall.pitch) * 0.8 : fall.pitch > PITCH.max ? (fall.pitch - PITCH.max) * 0.8 : 0
      // Turning to face the fall line after the glide: a small swing reads well, a reversal does not.
      const swing = Math.abs(wrap(face - yaw))
      const score = Math.min(left, right) * 1.2 + (left + right) * 0.3 + ahead * 0.5 - pitchCost - Math.abs(turn) * (options.aerial ? 4 : 1.5) - Math.max(0, swing - 1.2) * 4
      if (!best || score > best.score) best = { yaw, x: ex, z: ez, face, score }
    }
  }
  if (best) return { yaw: best.yaw, x: best.x, z: best.z, face: best.face }
  // Nowhere good: straight on (chairs) or a plain step aside, as before.
  const yaw = lineYaw + (options.aerial ? 0 : 1.25)
  const reach = reaches[0]
  return { yaw, x: x + Math.sin(yaw) * reach, z: z + Math.cos(yaw) * reach, face: yaw }
}
