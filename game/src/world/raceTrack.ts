/**
 * A race track as a quick inside test: the course line widened to a half
 * width and rasterised once, so the physics can ask "on the track?" for every
 * terrain and surface sample without walking the polyline.
 */
import { nearestOnPolyline, type Point2 } from './resort'

export interface TrackMask {
  inside(x: number, z: number): boolean
}

/** Rasterise the band within `halfWidth` of `line` at `cell` metres. */
export function trackMask(line: readonly Point2[], halfWidth: number, cell = 1): TrackMask {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
  for (const [x, z] of line) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  minX -= halfWidth
  minZ -= halfWidth
  const columns = Math.max(1, Math.ceil((maxX + halfWidth - minX) / cell))
  const rows = Math.max(1, Math.ceil((maxZ + halfWidth - minZ) / cell))
  const bits = new Uint8Array(columns * rows)
  const limit = halfWidth * halfWidth
  for (let k = 1; k < line.length; k++) {
    const segment: [number, number][] = [[line[k - 1][0], line[k - 1][1]], [line[k][0], line[k][1]]]
    const c0 = Math.floor((Math.min(segment[0][0], segment[1][0]) - halfWidth - minX) / cell)
    const c1 = Math.floor((Math.max(segment[0][0], segment[1][0]) + halfWidth - minX) / cell)
    const r0 = Math.floor((Math.min(segment[0][1], segment[1][1]) - halfWidth - minZ) / cell)
    const r1 = Math.floor((Math.max(segment[0][1], segment[1][1]) + halfWidth - minZ) / cell)
    for (let row = Math.max(0, r0); row <= Math.min(rows - 1, r1); row++) {
      for (let column = Math.max(0, c0); column <= Math.min(columns - 1, c1); column++) {
        const index = row * columns + column
        if (bits[index]) continue
        const x = minX + (column + 0.5) * cell
        const z = minZ + (row + 0.5) * cell
        if (nearestOnPolyline(x, z, segment).distanceSq <= limit) bits[index] = 1
      }
    }
  }
  return {
    inside(x, z) {
      const column = Math.floor((x - minX) / cell)
      const row = Math.floor((z - minZ) / cell)
      if (column < 0 || row < 0 || column >= columns || row >= rows) return false
      return bits[row * columns + column] === 1
    },
  }
}
