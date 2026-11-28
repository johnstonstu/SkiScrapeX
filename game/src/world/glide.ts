/**
 * Glide tracks: the flat stretches of the mapped runs (cat tracks, ridge
 * traverses, run-outs) where the skier is carried at a cruising speed instead
 * of skating, and the booster zones laid along the long ones. No rendering.
 *
 * Stu (2026-11-28): off the top of Quickdraw toward Grandfather's Trail "takes
 * a while to push"; the track should "keep you moving fast along the track
 * while you're moving forward", with "some zones with boosters that make you go
 * faster along the way". Measured before this: 70 s of skating to cover the
 * first 550 m of Grandfather's Trail (docs/mountain-accuracy.md).
 */
import type { Point2, Run } from './resort'

export const GLIDE = {
  /** A stretch glides where the line falls less than this over `window` metres, degrees. */
  maxPitchDeg: 7,
  /** ...and does not climb more than this (short rises on a ridge still carry), degrees. */
  maxClimbDeg: 2.5,
  /** Metres of line either side of a point the grade is measured over. */
  window: 30,
  /** Spacing of the points along each line, metres. */
  step: 10,
  /** How far from the line the track reaches, metres. */
  reach: 16,
  /** Shorter flat stretches are left alone (a roll on a steep run is not a traverse), metres. */
  minLength: 40,
  /** Cruising speed the track carries you to, m/s (56 km/h). */
  cruise: 15.5,
  /** Stretches at least this long get boosters, metres. */
  boosterMinLength: 180,
  /** First booster this far into the stretch, then one every `boosterSpacing`, metres. */
  boosterLead: 35,
  boosterSpacing: 320,
  /** A booster zone's length along the track and half width across it, metres. */
  boosterLength: 26,
  boosterHalfWidth: 9,
} as const

export interface GlideTrack {
  /** Unit direction of travel along the track (downhill, or the way the run is mapped on the level). */
  dirX: number
  dirZ: number
  /** Speed the track carries the skier to, m/s. */
  cruise: number
  /** Inside a booster zone. */
  boost: boolean
}

export interface Booster {
  x: number
  z: number
  dirX: number
  dirZ: number
  length: number
  halfWidth: number
  run: string
}

export interface GlideField {
  /** The glide track at a point, if any. */
  at(x: number, z: number): GlideTrack | null
  boosters: readonly Booster[]
  /** The flat stretches found, for tests and maps. */
  stretches: readonly { run: string; length: number; line: Point2[] }[]
}

interface Segment {
  ax: number
  az: number
  bx: number
  bz: number
  dirX: number
  dirZ: number
}

const CELL = 32

function resample(line: Point2[], step: number): Point2[] {
  const out: Point2[] = [line[0]]
  let carry = 0
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const length = Math.hypot(bx - ax, bz - az)
    if (!length) continue
    let d = step - carry
    for (; d <= length; d += step) out.push([ax + ((bx - ax) * d) / length, az + ((bz - az) * d) / length])
    carry = length - (d - step)
  }
  return out
}

/**
 * Find the flat stretches of the line runs and lay boosters along the long
 * ones. Park lines and glade areas are left out: a park keeps its own speed.
 */
export function buildGlide(runs: readonly Run[], heightAt: (x: number, z: number) => number, skip: (run: Run) => boolean = () => false): GlideField {
  const maxFall = Math.tan((GLIDE.maxPitchDeg * Math.PI) / 180)
  const maxClimb = Math.tan((GLIDE.maxClimbDeg * Math.PI) / 180)
  const span = Math.round(GLIDE.window / GLIDE.step)
  const cells = new Map<number, Segment[]>()
  const key = (cx: number, cz: number) => cx + cz * 65536
  const boosters: Booster[] = []
  const stretches: { run: string; length: number; line: Point2[] }[] = []

  for (const run of runs) {
    if (run.kind !== 'line' || run.glade || skip(run)) continue
    for (const part of run.parts) {
      if (part.length < 2) continue
      let points = resample(part, GLIDE.step)
      if (points.length < 4) continue
      const heights = points.map(([x, z]) => heightAt(x, z))
      if (heights.some((h) => !Number.isFinite(h))) continue
      // Lines run downhill; a level one that was mapped the other way is turned round.
      if (heights[0] < heights[heights.length - 1]) {
        points = points.reverse()
        heights.reverse()
      }
      const flat = points.map((_, i) => {
        const a = Math.max(0, i - span)
        const b = Math.min(points.length - 1, i + span)
        const grade = (heights[a] - heights[b]) / ((b - a) * GLIDE.step)
        return grade < maxFall && grade > -maxClimb
      })
      for (let i = 0; i < points.length; ) {
        if (!flat[i]) {
          i++
          continue
        }
        let j = i
        while (j + 1 < points.length && flat[j + 1]) j++
        const length = (j - i) * GLIDE.step
        if (length >= GLIDE.minLength) {
          const line = points.slice(i, j + 1)
          stretches.push({ run: run.name, length, line })
          for (let k = 1; k < line.length; k++) {
            const [ax, az] = line[k - 1]
            const [bx, bz] = line[k]
            const d = Math.hypot(bx - ax, bz - az) || 1
            const segment: Segment = { ax, az, bx, bz, dirX: (bx - ax) / d, dirZ: (bz - az) / d }
            const reach = GLIDE.reach
            for (let cz = Math.floor((Math.min(az, bz) - reach) / CELL); cz <= Math.floor((Math.max(az, bz) + reach) / CELL); cz++) {
              for (let cx = Math.floor((Math.min(ax, bx) - reach) / CELL); cx <= Math.floor((Math.max(ax, bx) + reach) / CELL); cx++) {
                const k2 = key(cx, cz)
                if (!cells.has(k2)) cells.set(k2, [])
                cells.get(k2)!.push(segment)
              }
            }
          }
          if (length >= GLIDE.boosterMinLength) {
            for (let d = GLIDE.boosterLead; d < length - GLIDE.boosterLength - 20; d += GLIDE.boosterSpacing) {
              const at = Math.round(d / GLIDE.step)
              const ahead = Math.min(line.length - 1, at + Math.round(GLIDE.boosterLength / GLIDE.step))
              const [x, z] = line[at]
              const [fx, fz] = line[ahead]
              const run2 = Math.hypot(fx - x, fz - z) || 1
              const candidate: Booster = { x, z, dirX: (fx - x) / run2, dirZ: (fz - z) / run2, length: GLIDE.boosterLength, halfWidth: GLIDE.boosterHalfWidth, run: run.name }
              // Runs that share a track (a merge, a common run-out) share its boosters.
              if (!boosters.some((b) => Math.hypot(b.x - x, b.z - z) < GLIDE.boosterSpacing * 0.5)) boosters.push(candidate)
            }
          }
        }
        i = j + 1
      }
    }
  }

  const inBooster = (x: number, z: number) => {
    for (const b of boosters) {
      const ex = x - b.x
      const ez = z - b.z
      const along = ex * b.dirX + ez * b.dirZ
      if (along < 0 || along > b.length) continue
      if (Math.abs(ex * b.dirZ - ez * b.dirX) <= b.halfWidth) return true
    }
    return false
  }

  return {
    boosters,
    stretches,
    at(x, z) {
      const nearby = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)))
      if (!nearby) return null
      let best: Segment | null = null
      let bestSq = GLIDE.reach * GLIDE.reach
      for (const s of nearby) {
        const dx = s.bx - s.ax
        const dz = s.bz - s.az
        const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)))
        const d = (x - s.ax - t * dx) ** 2 + (z - s.az - t * dz) ** 2
        if (d < bestSq) ((bestSq = d), (best = s))
      }
      if (!best) return null
      return { dirX: best.dirX, dirZ: best.dirZ, cruise: GLIDE.cruise, boost: inBooster(x, z) }
    },
  }
}
