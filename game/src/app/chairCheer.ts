import type { TrickEvent } from '../sim'
import type { CheerSize } from '../player/sfx/crowd'

/**
 * When riders on a chairlift cheer the player, and how much. Pure rules, so
 * they can be unit tested; `game/chairCrowd.ts` finds the chairs and plays it.
 */

/** Riders this far away (metres, in a straight line to the chair) can see a landing well enough to care. */
export const CHEER_RANGE = 75
/** Seconds before the same lift cheers again, so a park line gets a few cheers and not a wall of them. */
export const CHEER_GAP = 2.5

/**
 * What a landing is worth to someone watching from a chair, or null for
 * nothing: a hop is ignored, a plain jump gets a whoop, a spin or a grab gets
 * a couple of people and some clapping, a big trick the whole chair. A crash
 * out of real air gets a wince.
 */
export function cheerSize(trick: Pick<TrickEvent, 'kind' | 'grade' | 'points' | 'airTime' | 'railMetres'>): CheerSize | null {
  if (trick.grade === 'crash') return trick.kind === 'air' && trick.airTime >= 0.7 ? 'ooh' : null
  if (trick.kind === 'rail') return trick.grade === 'clean' && trick.railMetres >= 5 ? 'small' : null
  if (trick.points < 70 && trick.airTime < 0.75) return null
  // A sketchy landing is still a landing, but nobody claps.
  if (trick.grade === 'sketchy' || trick.points < 280) return 'small'
  return trick.points < 850 ? 'medium' : 'big'
}

export interface ChairInView {
  /** From the chair to the skier, on the map. */
  dx: number
  dz: number
  /** Unit direction the riders face (up the line). */
  facingX: number
  facingZ: number
}

/**
 * Riders face up the hill: they watch a skier who is ahead of them or about
 * level, and miss one who is already well behind their chair.
 */
export function canSee(chair: ChairInView): boolean {
  return chair.dx * chair.facingX + chair.dz * chair.facingZ > -12
}

/** How many chairs join in. */
export function chairsCheering(size: CheerSize): number {
  return size === 'big' ? 2 : 1
}
