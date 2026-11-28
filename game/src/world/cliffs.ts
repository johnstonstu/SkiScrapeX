import { pointAlong, polylineLength, type Run } from './resort'
import type { TerrainGrid } from './terrainGrid'
import type { SampleTerrain } from '../sim'

/**
 * Rock drops you can ski off: West Bank's cliff beside a Quickdraw tower, The
 * Pit's big cliff at the top and the rock band through its middle (Stu,
 * 2026-11-24: "a big nice cliff at the top with a nice rock band in the middle
 * that you can do some jumps off"). Each outcrop is a block of rock whose top
 * starts flush with the snow at its uphill edge and stands `height` metres
 * proud at its downhill lip, so you ski onto it and drop off the face onto
 * the real slope below. Physics and rendering read the same shape.
 */
export interface Outcrop {
  /** Centre of the lip (the top edge of the drop). */
  x: number
  z: number
  /** Downhill unit direction (fall line at the lip). */
  dirX: number
  dirZ: number
  /** Across the fall line, metres. */
  width: number
  /** From the lip back uphill to where the top meets the snow, metres. */
  depth: number
  /** Height of the face at the lip, metres. */
  height: number
  /** Ground height at the lip and at the back edge (on the centreline). */
  lipGround: number
  backGround: number
  seed: number
}

/** Where to put a drop on a run: metres along its line, metres across (right of downhill), size. */
export interface DropSpec {
  at: number
  offset: number
  width: number
  depth: number
  height: number
}

/** Drops per run name. Positions come from the LiDAR pitch profile of each run (steepest steps). */
export const RUN_DROPS: Record<string, DropSpec[]> = {
  // The Pit: a big cliff where it rolls over from about 12° to 28°, then a rock band
  // with chutes between the rocks through the 35-44° middle.
  'The Pit': [
    { at: 58, offset: 3, width: 16, depth: 9, height: 5.5 },
    { at: 236, offset: -10, width: 7, depth: 6, height: 3.4 },
    { at: 240, offset: 0, width: 6, depth: 6, height: 4.2 },
    { at: 233, offset: 10, width: 8, depth: 6, height: 3 },
  ],
}

/**
 * West Bank's drop sits beside the Quickdraw tower closest to the run, on its downhill side,
 * at least `minAlong` metres down the run: since West Bank starts at the unload (0.9.50) the
 * closest tower of all is the one at the top station, which put the rock on the unload.
 */
export const TOWER_DROP = { run: 'West Bank', lift: /quickdraw/i, beside: 6, width: 6, depth: 6, height: 2.8, minAlong: 200 }

/** Across-the-lip wobble, metres, so the edge is not ruled. */
function lipWobble(o: Outcrop, u: number): number {
  return 0.9 * Math.sin(u * 0.55 + o.seed) + 0.45 * Math.sin(u * 1.7 + o.seed * 1.7)
}

/** Face height across the lip: tallest in the middle, tapering and broken toward the ends. */
export function faceHeight(o: Outcrop, across: number): number {
  const t = across / (o.width / 2)
  const broken = 0.85 + 0.15 * Math.sin(across * 1.3 + o.seed * 2.1) + 0.1 * Math.sin(across * 3.1 + o.seed)
  return o.height * Math.max(0.15, 1 - 0.6 * t * t) * broken
}

/** Local coordinates: `across` right of downhill, `back` uphill from the lip. */
function local(o: Outcrop, x: number, z: number) {
  const ex = x - o.x
  const ez = z - o.z
  return { across: ex * -o.dirZ + ez * o.dirX, back: -(ex * o.dirX + ez * o.dirZ) }
}

/** Height of the rock top at a point (no footprint test). Falls from the back edge to the lip. */
export function topHeight(o: Outcrop, back: number, across = 0): number {
  const lipTop = o.lipGround + faceHeight(o, across)
  return lipTop + (o.backGround - lipTop) * (back / o.depth)
}

/** Rock top height at (x, z), or null when the point is off the outcrop. */
export function outcropTop(o: Outcrop, x: number, z: number): number | null {
  const { across, back } = local(o, x, z)
  const half = o.width / 2
  if (Math.abs(across) > half) return null
  // Rounded corners: the footprint narrows toward the back edge.
  const lip = lipWobble(o, across)
  if (back < lip || back > o.depth * (1 - 0.35 * (across / half) ** 4)) return null
  return topHeight(o, back, across)
}

/**
 * True near a drop: on the rock, beside it, or in its landing below the lip.
 * Trees stay out of these so every drop has a clean run-in and run-out.
 */
export function nearOutcrop(outcrops: Outcrop[], x: number, z: number): boolean {
  for (const o of outcrops) {
    const { across, back } = local(o, x, z)
    if (Math.abs(across) < o.width / 2 + 3 && back < o.depth + 3 && back > -(6 + o.height * 3)) return true
  }
  return false
}

export function makeOutcrop(grid: TerrainGrid, x: number, z: number, width: number, depth: number, height: number, seed: number): Outcrop | null {
  const ground = grid.sampleTerrain(x, z)
  if (!ground) return null
  const fall = Math.hypot(ground.normal.x, ground.normal.z)
  if (fall < 0.15) return null
  const dirX = ground.normal.x / fall
  const dirZ = ground.normal.z / fall
  const backGround = grid.heightAt(x - dirX * depth, z - dirZ * depth)
  if (!Number.isFinite(backGround)) return null
  return { x, z, dirX, dirZ, width, depth, height, lipGround: ground.height, backGround, seed }
}

export function placeRunDrops(grid: TerrainGrid, runs: Run[], drops = RUN_DROPS): Outcrop[] {
  const outcrops: Outcrop[] = []
  for (const [name, specs] of Object.entries(drops)) {
    const run = runs.find((r) => r.name === name && r.kind === 'line')
    if (!run) continue
    const line = run.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
    specs.forEach((spec, i) => {
      const [x, z] = pointAlong(line, spec.at)
      const [nx, nz] = pointAlong(line, spec.at + 1)
      const span = Math.hypot(nx - x, nz - z) || 1
      // Right of downhill along the run line.
      const rx = -(nz - z) / span
      const rz = (nx - x) / span
      const o = makeOutcrop(grid, x + rx * spec.offset, z + rz * spec.offset, spec.width, spec.depth, spec.height, i * 2.17 + name.length)
      if (o) outcrops.push(o)
    })
  }
  return outcrops
}

/** The tower drop: beside the lift tower nearest the run, toward the run and a little downhill of the tower. */
export function placeTowerDrop(grid: TerrainGrid, runs: Run[], towers: [number, number][], spec = TOWER_DROP): Outcrop | null {
  const run = runs.find((r) => r.name === spec.run && r.kind === 'line')
  if (!run || !towers.length) return null
  let best: { tx: number; tz: number; d: number; px: number; pz: number } | null = null
  for (const [tx, tz] of towers) {
    for (const line of run.parts) {
      const length = polylineLength(line)
      for (let s = length > (spec.minAlong ?? 0) * 2 ? (spec.minAlong ?? 0) : 0; s < length; s += 4) {
        const [px, pz] = pointAlong(line, s)
        const d = Math.hypot(px - tx, pz - tz)
        if (!best || d < best.d) best = { tx, tz, d, px, pz }
      }
    }
  }
  if (!best) return null
  // Step from the tower toward the run, far enough to clear the tower base.
  const ux = (best.px - best.tx) / (best.d || 1)
  const uz = (best.pz - best.tz) / (best.d || 1)
  const reach = Math.min(best.d, spec.beside + spec.width / 2)
  return makeOutcrop(grid, best.tx + ux * reach, best.tz + uz * reach, spec.width, spec.depth, spec.height, 3.1)
}

/** Wrap a terrain sampler so the skis ride on the outcrops. */
export function buildCliffs(outcrops: Outcrop[], base: SampleTerrain) {
  const sampleTerrain: SampleTerrain = (x, z) => {
    const ground = base(x, z)
    if (!ground) return ground
    let top = -Infinity
    let best: Outcrop | null = null
    for (const o of outcrops) {
      if ((x - o.x) ** 2 + (z - o.z) ** 2 > (o.width + o.depth) ** 2) continue
      const h = outcropTop(o, x, z)
      if (h !== null && h > top) ((top = h), (best = o))
    }
    if (!best || top <= ground.height) return ground
    // The top is a plane falling from the back edge to the lip along the fall line.
    // Height rises uphill (against dir) by `slope` per metre, so the normal leans downhill.
    const slope = (best.backGround - (best.lipGround + faceHeight(best, local(best, x, z).across))) / best.depth
    const length = Math.hypot(slope, 1)
    return { ...ground, height: top, normal: { x: (slope * best.dirX) / length, y: 1 / length, z: (slope * best.dirZ) / length } }
  }
  const inside = (x: number, z: number) => outcrops.some((o) => outcropTop(o, x, z) !== null)
  return { outcrops, sampleTerrain, inside }
}
