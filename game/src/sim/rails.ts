import type { Vec3 } from './vec'

/** A rail or box: a polyline along its sliding top surface, in world metres. */
export interface Rail {
  id: string
  kind: 'rail' | 'box'
  /** Top centreline, at least two points. */
  points: Vec3[]
  /** Slide surface width, metres (rail about 0.08, box about 0.5). */
  width: number
}

export interface RailHit {
  rail: Rail
  /** Distance along the rail from points[0], metres. */
  s: number
  /** Unit tangent at the hit, pointing from points[0] toward the end. */
  tangent: Vec3
  /** Height of the top at the hit. */
  top: number
  /** Horizontal distance from the centreline. */
  offset: number
}

export function railLength(rail: Rail): number {
  let total = 0
  for (let i = 1; i < rail.points.length; i++) total += distance(rail.points[i - 1], rail.points[i])
  return total
}

/** Point and tangent at `s` metres along the rail (clamped). */
export function railAt(rail: Rail, s: number): { point: Vec3; tangent: Vec3 } {
  let remaining = Math.max(0, s)
  for (let i = 1; i < rail.points.length; i++) {
    const a = rail.points[i - 1]
    const b = rail.points[i]
    const length = distance(a, b)
    if (remaining <= length || i === rail.points.length - 1) {
      const t = Math.min(1, remaining / Math.max(length, 1e-6))
      const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length, z: (b.z - a.z) / length }
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, tangent }
    }
    remaining -= length
  }
  const a = rail.points[0]
  return { point: a, tangent: { x: 0, y: 0, z: 1 } }
}

/** Nearest point on any rail within `reach` metres horizontally of (x, z). */
export function nearestRail(rails: readonly Rail[], x: number, z: number, reach: number): RailHit | null {
  let best: RailHit | null = null
  for (const rail of rails) {
    let along = 0
    for (let i = 1; i < rail.points.length; i++) {
      const a = rail.points[i - 1]
      const b = rail.points[i]
      const dx = b.x - a.x
      const dz = b.z - a.z
      const lengthSq = dx * dx + dz * dz
      const length3 = distance(a, b)
      if (lengthSq > 1e-8) {
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq))
        const px = a.x + dx * t
        const pz = a.z + dz * t
        const offset = Math.hypot(x - px, z - pz)
        const limit = reach + rail.width / 2
        if (offset <= limit && (!best || offset < best.offset)) {
          best = {
            rail,
            s: along + length3 * t,
            tangent: { x: (b.x - a.x) / length3, y: (b.y - a.y) / length3, z: (b.z - a.z) / length3 },
            top: a.y + (b.y - a.y) * t,
            offset,
          }
        }
      }
      along += length3
    }
  }
  return best
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
}
