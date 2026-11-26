import { headingFor, pointInRing, type Course, type Point2, type Run } from './resort'
import type { TerrainGrid } from './terrainGrid'

/**
 * The four glades on the 2025/26 trail map, as polygons snapped to gaps in the
 * LiDAR canopy (Apex research handoff, docs/review/apex-terrain,
 * proposed-unmapped-runs.geojson). All four are marked approximate there: the
 * extent along the slope is the weakest part. `cover` is the measured canopy
 * share inside each polygon.
 */
export interface GladeArea {
  name: string
  difficulty: string
  cover: number
  ring: Point2[]
}

export const GLADES: GladeArea[] = [
  {
    // Top-west of the Wildside, between Grandmother's Trail and Jackpot: the hull of OSM's "Glades" way and traces W1 and W2.
    name: 'Any Which Way Glades', difficulty: 'advanced', cover: 0.16,
    ring: [[1591.5, 2087.3], [1594.1, 2122.1], [1723.9, 2291.6], [1765, 2317.4], [1757.9, 2302.6], [1779.5, 2290], [1785.5, 2296.2], [1780, 2320], [1880, 2320], [1880, 2248.9], [1831.3, 2148.5], [1757.4, 2060], [1683.3, 2060], [1604.2, 2075.9]],
  },
  {
    // Far-west edge of the Wildside, beside upper Grandmother's Trail.
    name: "Granny's Glades", difficulty: 'advanced', cover: 0.4,
    ring: [[1380, 1960], [1399.3, 1984.6], [1404.1, 2012.8], [1398.3, 2022.4], [1380, 2028], [1380, 2054], [1392.1, 2042.3], [1414.1, 2038.2], [1424, 2068.6], [1412.8, 2080.2], [1380, 2091], [1380, 2180], [1389.1, 2186.3], [1407, 2227.3], [1404.8, 2238.6], [1380, 2250], [1380, 2300], [1434, 2300], [1440.2, 2291.4], [1457, 2300], [1476, 2300], [1482.2, 2293.5], [1516, 2300], [1514.6, 2290.2], [1528, 2283], [1531, 2274], [1537, 2209], [1526, 2178], [1507.8, 2174.2], [1503.5, 2154.6], [1515, 2132], [1512, 2118.6], [1520.2, 2101.8], [1532, 2104], [1530, 2124], [1538, 2135], [1556.4, 2136], [1559.8, 2124.3], [1560, 2104], [1534.2, 2094.2], [1535.4, 2081.1], [1548, 2067], [1545.6, 2051.2], [1560, 2046.5], [1560, 1960], [1480, 1960], [1498.1, 1971.6], [1501, 1980], [1523.2, 1972.8], [1526.1, 1986.3], [1512.4, 1994.5], [1483, 1994], [1475.8, 2002.6], [1460.2, 1995], [1458, 1982], [1439, 1960]],
  },
  {
    // Right of Stock's Chair on its lower half, between the chair and Gambit.
    name: 'Fools Gold', difficulty: 'intermediate', cover: 0.48,
    ring: [[2613.4, 1449.1], [2624.2, 1449.9], [2663.5, 1422.1], [2685.2, 1420.9], [2735.2, 1397.9], [2754.6, 1373], [2789.2, 1362.9], [2799.3, 1349.1], [2817.2, 1343.9], [2845.2, 1323.9], [2851.5, 1312.5], [2873.2, 1313.9], [2911.5, 1282.8], [2942.2, 1273.9], [2952.6, 1260.2], [2970.2, 1258.9], [3023, 1217.3], [3044.2, 1216.9], [3069.8, 1188.5], [3099.6, 1172], [3147.5, 1159.4], [3133.4, 1135.5], [3074.1, 1129.2], [2934.3, 1164.9], [2859.3, 1209.3], [2859.2, 1226.2], [2845.3, 1228.9], [2833.3, 1246.8], [2816.5, 1234.7], [2634.2, 1342.7], [2624.2, 1359.2], [2595, 1376.3], [2583.1, 1398.1]],
  },
  {
    // Uphill side of Whipsaw's first 380 m, just left of the Stock's top.
    name: 'Hidden Gold', difficulty: 'advanced', cover: 0.51,
    ring: [[1937.2, 1920.4], [1940.9, 1951.3], [1968.1, 1943.9], [1979.8, 1967.4], [1999.8, 1969.5], [2006.8, 1989.4], [2020, 1992.7], [2016.6, 2003.4], [1983.3, 2021.4], [2013.4, 2063.9], [2053.2, 2088.8], [2053.7, 2064.4], [2029.3, 2020.8], [2035.7, 1991.8], [2002.9, 1952.6], [1996.8, 1923.9], [2014.4, 1859.4], [2046.2, 1808.3], [2010, 1780.1], [2001.3, 1782.4], [1996.6, 1774.3], [1976.2, 1802.3], [1952.7, 1856.8], [1963.1, 1858.1], [1963.4, 1876.8], [1946.3, 1879.4]],
  },
]

/** Glades as area runs: named on the map and HUD, ungroomed, and they keep (thinned) trees. */
export function gladeRuns(): Run[] {
  return GLADES.map((glade) => ({
    id: `glade/${glade.name}`,
    name: glade.name,
    difficulty: glade.difficulty,
    groomed: false,
    wooded: true,
    glade: true,
    moguls: false,
    kind: 'area' as const,
    parts: [glade.ring],
  }))
}

/**
 * How glades are thinned. Real glades are cut as lanes down the fall line
 * between clumps of trees, so inside a glade the trees in each lane go and the
 * clumps between lanes keep most of theirs. Lanes wander a few metres from
 * side to side so they do not read as ruled stripes.
 */
export const GLADE_THINNING = {
  /** Metres from one lane centre to the next, across the slope. */
  spacing: 17,
  /** Share of that spacing that is open lane: about 7.5 m of open snow. */
  lane: 0.44,
  /** Share of trees kept in the clumps between lanes. */
  clump: 0.72,
  /** Sideways wander of a lane, metres, and its wavelength down the slope. */
  wander: 4,
  wanderLength: 70,
} as const

interface GladeShape {
  ring: Point2[]
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  /** Mean fall line (unit, XZ) over the glade. */
  fallX: number
  fallZ: number
}

export interface GladeField {
  /** The glade a point lies in, if any. */
  at(x: number, z: number): string | null
  /** True when a tree at this spot stands in an open lane (and should not be planted). */
  inLane(x: number, z: number): boolean
  /** Whether to keep a tree here: false in a lane, `clump` of the time between lanes. */
  keep(x: number, z: number): boolean
}

/** Glade lookup over the area runs flagged `glade`, with each glade's mean fall line from the grid. */
export function buildGladeField(runs: readonly Run[], grid: Pick<TerrainGrid, 'sampleTerrain'>): GladeField {
  const shapes: (GladeShape & { name: string })[] = []
  for (const run of runs) {
    if (!run.glade || run.kind !== 'area') continue
    for (const ring of run.parts) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
      for (const [x, z] of ring) ((minX = Math.min(minX, x)), (minZ = Math.min(minZ, z)), (maxX = Math.max(maxX, x)), (maxZ = Math.max(maxZ, z)))
      let fx = 0, fz = 0
      for (let z = minZ; z <= maxZ; z += 10) {
        for (let x = minX; x <= maxX; x += 10) {
          if (!pointInRing(x, z, ring)) continue
          const ground = grid.sampleTerrain(x, z)
          if (!ground) continue
          // The normal leans downhill, so its XZ part points down the fall line.
          fx += ground.normal.x
          fz += ground.normal.z
        }
      }
      const length = Math.hypot(fx, fz) || 1
      shapes.push({ name: run.name, ring, minX, minZ, maxX, maxZ, fallX: length > 1e-6 ? fx / length : 0, fallZ: length > 1e-6 ? fz / length : 1 })
    }
  }
  const find = (x: number, z: number) =>
    shapes.find((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && pointInRing(x, z, s.ring)) ?? null
  const inLane = (shape: GladeShape, x: number, z: number) => {
    const { spacing, lane, wander, wanderLength } = GLADE_THINNING
    const along = x * shape.fallX + z * shape.fallZ
    const across = -x * shape.fallZ + z * shape.fallX + wander * Math.sin((along / wanderLength) * Math.PI * 2 + across0(shape))
    const phase = (((across / spacing) % 1) + 1) % 1
    return Math.abs(phase - 0.5) < lane / 2
  }
  return {
    at: (x, z) => find(x, z)?.name ?? null,
    inLane(x, z) {
      const shape = find(x, z)
      return shape ? inLane(shape, x, z) : false
    },
    keep(x, z) {
      const shape = find(x, z)
      if (!shape) return true
      if (inLane(shape, x, z)) return false
      // A hash of the position, not the forest's random stream, so the rest of the forest is unchanged.
      return hash2(x, z) < GLADE_THINNING.clump
    },
  }
}

/** A per-glade phase so neighbouring glades do not line their lanes up. */
function across0(shape: GladeShape): number {
  return (shape.minX * 0.013 + shape.minZ * 0.007) % (Math.PI * 2)
}

/** 0..1 hash of a position (centimetre resolution). */
export function hash2(x: number, z: number): number {
  let h = Math.imul(Math.round(x * 100) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 100) | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32
}

/**
 * Where a glade sign stands: a few metres inside the highest corner of the
 * polygon, turned to face back up the slope (the board faces skiers coming down).
 */
export function gladeEntry(ring: [number, number][], heightAt: (x: number, z: number) => number) {
  let top: [number, number] | null = null
  let best = -Infinity
  for (const point of ring) {
    const h = heightAt(point[0], point[1])
    if (Number.isFinite(h) && h > best) ((best = h), (top = point))
  }
  if (!top) return null
  let cx = 0, cz = 0
  for (const [x, z] of ring) ((cx += x), (cz += z))
  cx /= ring.length
  cz /= ring.length
  const length = Math.hypot(cx - top[0], cz - top[1]) || 1
  const dx = (cx - top[0]) / length, dz = (cz - top[1]) / length
  const x = top[0] + dx * 8, z = top[1] + dz * 8
  const ground = heightAt(x, z)
  if (!Number.isFinite(ground)) return null
  return { x, z, ground, yaw: Math.atan2(-dx, -dz) }
}

/** Start at the top of a glade, facing down into it (a map trip to a glade). */
export function courseForGlade(run: Run, heightAt: (x: number, z: number) => number): Course | null {
  const entry = run.kind === 'area' ? gladeEntry(run.parts[0], heightAt) : null
  if (!entry) return null
  // The sign faces uphill; the skier faces the other way, into the glade.
  const dx = -Math.sin(entry.yaw), dz = -Math.cos(entry.yaw)
  return { spawn: { x: entry.x + dx * 4, z: entry.z + dz * 4, heading: headingFor(dx, dz) }, startLift: null, startRun: run }
}
