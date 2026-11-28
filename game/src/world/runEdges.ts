import type { TerrainGrid } from './terrainGrid'

/**
 * Fit run corridors to the real clearings in the LiDAR canopy. OSM gives a
 * centreline and the game guesses a width from the difficulty, so a run can
 * stop short of its cleared edge (a strip of open snow that reads as
 * off-piste) or cut into standing forest (trees the run then hides). This
 * widens each run into adjoining open ground and gives standing forest at
 * its outer edge back to the trees.
 */
export interface RunRaster {
  width: number
  height: number
  texel: number
  /** Run name index per texel, 0 = none. */
  locations: Uint16Array
  surface: Uint8Array
  heading: Float32Array
  clear: Uint8Array
  /** Squared distance to the run centreline, Infinity off runs, 0 for area runs. */
  runDistance: Float32Array
  /** Half width per location index (0 for area runs and off-piste). */
  halfWidth: Float32Array
  /** 1 where the location is a gladed (wooded) run, which keeps its trees. */
  wooded: Uint8Array
}

export const RUN_EDGES = {
  /** Cover below this is open snow a run can grow into. */
  openCover: 0.12,
  /** Cover and canopy height above these at a run's outer edge count as standing forest. */
  forestCover: 0.55,
  forestHeight: 4,
  /** The run keeps its core (this share of the half width, at most `coreMax` metres) whatever the canopy says. */
  core: 0.6,
  /** Wide runs (half width over 20 m) keep no more core than a default blue, so their width never mows standing forest. */
  coreMax: 12,
  /** Furthest a run grows past its guessed edge, metres. */
  maxGrowth: 16,
  /** Only grow where there is forest within this many metres (open alpine has no corridor to find). */
  forestNear: 20,
} as const

export function fitRunsToCanopy(raster: RunRaster, grid: TerrainGrid, cover: Float32Array): { grown: number; trimmed: number } {
  const { width, height, texel, locations, surface, heading, clear, runDistance, halfWidth, wooded } = raster
  const base = grid.coarse ?? grid
  const coverAt = (x: number, z: number) => {
    const c = Math.max(0, Math.min(base.columns - 1, Math.round(x / base.step)))
    const r = Math.max(0, Math.min(base.rows - 1, Math.round(z / base.step)))
    return cover[r * base.columns + c] ?? 0
  }
  const reach = Math.ceil(RUN_EDGES.forestNear / base.step)
  const forestNearby = (x: number, z: number) => {
    const c0 = Math.round(x / base.step)
    const r0 = Math.round(z / base.step)
    for (let dr = -reach; dr <= reach; dr += 2) {
      for (let dc = -reach; dc <= reach; dc += 2) {
        const c = c0 + dc
        const r = r0 + dr
        if (c < 0 || r < 0 || c >= base.columns || r >= base.rows) continue
        if (cover[r * base.columns + c] > 0.3) return true
      }
    }
    return false
  }

  // Trim: standing forest in the outer part of a line run goes back to the trees.
  let trimmed = 0
  for (let i = 0; i < locations.length; i++) {
    const location = locations[i]
    if (!location || wooded[location] || !Number.isFinite(runDistance[i]) || runDistance[i] === 0) continue
    const half = halfWidth[location]
    if (runDistance[i] < Math.min(half * RUN_EDGES.core, RUN_EDGES.coreMax) ** 2) continue
    const x = ((i % width) + 0.5) * texel
    const z = (Math.floor(i / width) + 0.5) * texel
    if (coverAt(x, z) < RUN_EDGES.forestCover) continue
    locations[i] = 0
    surface[i] = 1 // powder
    clear[i] = 0
    runDistance[i] = Infinity
    trimmed++
  }

  // Grow: breadth-first into open ground next to a run, a texel ring at a time.
  let frontier: number[] = []
  for (let i = 0; i < locations.length; i++) if (locations[i] && !wooded[locations[i]]) frontier.push(i)
  const steps = Math.floor(RUN_EDGES.maxGrowth / texel)
  let grown = 0
  for (let step = 0; step < steps && frontier.length; step++) {
    const next: number[] = []
    for (const i of frontier) {
      const col = i % width
      const row = Math.floor(i / width)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const c = col + dc
        const r = row + dr
        if (c < 0 || r < 0 || c >= width || r >= height) continue
        const j = r * width + c
        if (locations[j]) continue
        const x = (c + 0.5) * texel
        const z = (r + 0.5) * texel
        if (coverAt(x, z) >= RUN_EDGES.openCover || !forestNearby(x, z)) continue
        locations[j] = locations[i]
        surface[j] = surface[i]
        heading[j] = heading[i]
        clear[j] = clear[i]
        runDistance[j] = Infinity
        next.push(j)
        grown++
      }
    }
    frontier = next
  }
  return { grown, trimmed }
}
