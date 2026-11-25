import { nearestOnPolyline, type Point2, type Run } from './resort'
import type { TerrainGrid } from './terrainGrid'

/**
 * Summit landmarks from the Rise & Alpine video (docs/review/apex-video):
 * orange slat fencing round the top of Quickdraw where the plateau rolls over
 * into steep ground, and the wooden signpost at the Tooth/Tusk entry that
 * points left to "Tooth" and right to "Tusk".
 */
export const SUMMIT_FENCE = {
  /** Look this far out from the lift top for the rollover, metres. */
  from: 30,
  to: 130,
  /** A rollover is where the ground first reaches this slope and holds it for `hold` metres. */
  steep: 24,
  hold: 10,
  /** The fence stands this far back up the slope from the rollover. */
  setBack: 5,
  /** One fence point every `step` degrees around the top. */
  step: 3,
  /** Keep the fence this far from run centrelines (plus their half width) and lift lines. */
  runMargin: 4,
  liftMargin: 16,
  /** Fence pieces shorter than this many points are dropped. */
  minPoints: 3,
} as const

/** One fence line, top-of-slope order, in local metres. */
export type FenceLine = Point2[]

/**
 * Orange fencing round the summit: points on the plateau edge, a few metres
 * above where it rolls over into steep ground, in unbroken pieces that stop
 * short of every run, lift line and `avoid` area (the jumpable Pit cliff).
 */
export function summitFence(
  grid: Pick<TerrainGrid, 'sampleTerrain'>,
  top: Point2,
  runs: readonly Run[],
  liftLines: readonly Point2[][],
  halfWidth: (run: Run) => number,
  avoid: (x: number, z: number) => boolean = () => false,
): FenceLine[] {
  const { from, to, steep, hold, setBack, step, runMargin, liftMargin, minPoints } = SUMMIT_FENCE
  const slopeAt = (x: number, z: number) => {
    const ground = grid.sampleTerrain(x, z)
    return ground ? (Math.acos(Math.min(1, ground.normal.y)) * 180) / Math.PI : NaN
  }
  const lineRuns = runs.filter((run) => run.kind === 'line')
  const blocked = (x: number, z: number) =>
    avoid(x, z) ||
    liftLines.some((line) => nearestOnPolyline(x, z, line).distanceSq < liftMargin * liftMargin) ||
    lineRuns.some((run) => {
      const reach = halfWidth(run) + runMargin
      return run.parts.some((part) => nearestOnPolyline(x, z, part).distanceSq < reach * reach)
    })
  const lines: FenceLine[] = []
  let current: FenceLine = []
  const flush = () => {
    if (current.length >= minPoints) lines.push(current)
    current = []
  }
  for (let angle = 0; angle < 360; angle += step) {
    const sx = Math.sin((angle * Math.PI) / 180), sz = -Math.cos((angle * Math.PI) / 180)
    let edge: number | null = null
    for (let r = from; r <= to && edge === null; r += 1) {
      if (!(slopeAt(top[0] + sx * r, top[1] + sz * r) >= steep)) continue
      let held = true
      for (let k = 2; k <= hold; k += 2) if (!(slopeAt(top[0] + sx * (r + k), top[1] + sz * (r + k)) >= steep - 4)) held = false
      if (held) edge = r
    }
    if (edge === null) {
      flush()
      continue
    }
    const x = top[0] + sx * (edge - setBack), z = top[1] + sz * (edge - setBack)
    const previous = current[current.length - 1]
    // A jump in radius means a different rollover: start a new piece.
    if (blocked(x, z) || (previous && Math.hypot(previous[0] - x, previous[1] - z) > 14)) flush()
    if (!blocked(x, z)) current.push([x, z])
  }
  flush()
  return lines
}

/** Posts along a fence line about `spacing` metres apart (both ends included). */
export function fencePosts(line: FenceLine, spacing = 2.4): Point2[] {
  const posts: Point2[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i]
    const count = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / spacing))
    for (let k = 1; k <= count; k++) posts.push([ax + ((bx - ax) * k) / count, az + ((bz - az) * k) / count])
  }
  return posts
}

export interface Signpost {
  x: number
  z: number
  /** Direction the boards face (toward skiers arriving from above), radians: atan2(dx, dz). */
  yaw: number
  /** Left and right as a skier facing down the run sees them. */
  left: string
  right: string
}

/**
 * The Tooth/Tusk signpost: on the ridge a few metres above where the run drops
 * in, facing back up the slope at skiers arriving from the cat track.
 */
export function toothTuskSignpost(run: Run | undefined, grid: Pick<TerrainGrid, 'sampleTerrain'>): Signpost | null {
  const line = run?.kind === 'line' ? run.parts[0] : null
  if (!line || line.length < 2) return null
  const [x0, z0] = line[0]
  const ground = grid.sampleTerrain(x0, z0)
  if (!ground) return null
  // Uphill is against the normal's lean; step back 5 m onto the ridge.
  const lean = Math.hypot(ground.normal.x, ground.normal.z) || 1
  const ux = -ground.normal.x / lean, uz = -ground.normal.z / lean
  const x = x0 + ux * 5, z = z0 + uz * 5
  if (!grid.sampleTerrain(x, z)) return null
  return { x, z, yaw: Math.atan2(ux, uz), left: 'TOOTH', right: 'TUSK' }
}
