import type { TerrainGrid } from './terrainGrid'
import { nearestOnPolyline, type Resort } from './resort'
import { isClear, type Canopy, type SurfaceField } from './surface'

export interface Tree {
  x: number
  y: number
  z: number
  height: number
  rotation: number
  /** 0.75..1 colour variation. */
  tone: number
  species: Species
}

/**
 * Okanagan subalpine forest: Engelmann spruce and subalpine fir, lodgepole
 * pine lower down, standing dead snags (beetle kill and the burn), stunted
 * krummholz and rime-plastered snow ghosts near the summit.
 */
export const enum Species {
  Spruce = 0,
  Fir = 1,
  Pine = 2,
  Snag = 3,
  Krummholz = 4,
  Ghost = 5,
}
export const SPECIES_COUNT = 6

/** Species for a tree at `elevation` metres above sea level with a `height` m crown. */
export function pickSpecies(elevation: number, height: number, roll: number): Species {
  if (roll < 0.06) return Species.Snag
  const r = (roll - 0.06) / 0.94
  if (elevation > 2080) {
    // Summit reads as rime pillars in the footage: push short trees toward ghosts.
    if (height < 7) return r < 0.4 ? Species.Krummholz : r < 0.9 ? Species.Ghost : Species.Fir
    return r < 0.6 ? Species.Ghost : r < 0.9 ? Species.Fir : Species.Spruce
  }
  if (elevation > 1900) {
    if (height < 4.5 && r < 0.3) return Species.Krummholz
    return r < 0.42 ? Species.Fir : r < 0.78 ? Species.Spruce : r < 0.95 ? Species.Pine : Species.Ghost
  }
  // Tall, straight stands lower down are mostly lodgepole.
  const pine = height > 20 ? 0.55 : 0.4
  return r < pine ? Species.Pine : r < pine + 0.38 ? Species.Spruce : Species.Fir
}

export interface ForestChunk {
  /** Chunk centre, for distance-based detail. */
  cx: number
  cz: number
  /** Shuffled, so any prefix is an even thinning of the chunk. */
  trees: Tree[]
}

export interface Forest {
  chunkSize: number
  chunks: ForestChunk[]
  count: number
  source: 'canopy' | 'procedural'
}

/** Half-width of a lift-line clearing (the Quickdraw cut is 20 to 30 m wide); the edge is ragged by up to 25%. */
const LIFT_CLEARANCE = 14
/** Clear ground round each lift terminal: the maze, ramps and the operator hut. */
const TERMINAL_CLEARANCE = 20
/** Trees above this are LiDAR artefacts (towers, terminals, hut roofs), and summit trees stay stunted. */
const MAX_TREE_HEIGHT = 35
const SUMMIT_ELEVATION = 2060
const SUMMIT_TREE_HEIGHT = 11
const MAX_SLOPE_COS = Math.cos((40 * Math.PI) / 180)
const TRUNK_SPACING = 2.7

/** Smooth 0 to 1 wobble along the ground (about 15 m wavelength), for ragged clearing edges. */
function edgeWobble(x: number, z: number): number {
  return 0.5 + 0.25 * Math.sin(x * 0.41 + z * 0.13) + 0.25 * Math.sin(z * 0.37 - x * 0.19 + 1.7)
}

/** Deterministic LCG so a reload plants the same forest. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/**
 * Plant trees. With LidarBC canopy, every 5 m cell gets trees in proportion to
 * its measured cover, scaled to its measured height. Without canopy, a noise
 * scatter fills the slopes away from runs and lifts.
 */
export function plantForest(
  grid: TerrainGrid,
  resort: Resort,
  surface: SurfaceField,
  canopy: Canopy | null,
  options: { density?: number; chunkSize?: number; seed?: number; originElevation?: number } = {},
): Forest {
  const density = options.density ?? 1
  const origin = options.originElevation ?? 1600
  const chunkSize = options.chunkSize ?? 192
  const random = makeRandom(options.seed ?? 48021)
  const chunks = new Map<number, ForestChunk>()
  const spacing = new Map<number, Tree[]>()
  const spacingKey = (x: number, z: number) => x * 65536 + z
  const liftLines = resort.lifts.map((lift) => lift.line)
  // Coarse 16 m cells near a lift line; only trees in them get the exact clearance test.
  const LIFT_CELL = 16
  const liftCols = Math.ceil(grid.width / LIFT_CELL) + 1
  const nearLift = new Uint8Array(liftCols * (Math.ceil(grid.depth / LIFT_CELL) + 1))
  const reach = Math.max(LIFT_CLEARANCE * 1.25, TERMINAL_CLEARANCE) + LIFT_CELL * Math.SQRT2
  const terminals = liftLines.flatMap((line) => [line[0], line[line.length - 1]])
  for (const line of liftLines) {
    for (let k = 1; k < line.length; k++) {
      const [ax, az] = line[k - 1]
      const [bx, bz] = line[k]
      for (let cz = Math.max(0, Math.floor((Math.min(az, bz) - reach) / LIFT_CELL)); cz <= Math.floor((Math.max(az, bz) + reach) / LIFT_CELL); cz++)
        for (let cx = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / LIFT_CELL)); cx <= Math.floor((Math.max(ax, bx) + reach) / LIFT_CELL); cx++)
          if (cx < liftCols && nearestOnPolyline((cx + 0.5) * LIFT_CELL, (cz + 0.5) * LIFT_CELL, [line[k - 1], line[k]]).distanceSq < reach * reach)
            nearLift[cz * liftCols + cx] = 1
    }
  }

  const plant = (x: number, z: number, height: number) => {
    if (isClear(surface, x, z)) return
    const ground = grid.sampleTerrain(x, z)
    if (!ground || (!canopy && ground.normal.y < MAX_SLOPE_COS)) return
    if (nearLift[Math.floor(z / LIFT_CELL) * liftCols + Math.floor(x / LIFT_CELL)]) {
      const clearance = LIFT_CLEARANCE * (0.85 + 0.4 * edgeWobble(x, z))
      for (const line of liftLines) {
        if (nearestOnPolyline(x, z, line).distanceSq < clearance * clearance) return
      }
      for (const [tx, tz] of terminals) {
        if ((x - tx) ** 2 + (z - tz) ** 2 < TERMINAL_CLEARANCE * TERMINAL_CLEARANCE) return
      }
    }
    height = Math.min(height, MAX_TREE_HEIGHT, ground.height + origin > SUMMIT_ELEVATION ? SUMMIT_TREE_HEIGHT : Infinity)
    const tree = {
      x,
      y: ground.height,
      z,
      height,
      rotation: random() * Math.PI * 2,
      tone: 0.75 + 0.25 * random(),
      species: pickSpecies(ground.height + origin, height, random()),
    }
    const ix = Math.floor(x / TRUNK_SPACING), iz = Math.floor(z / TRUNK_SPACING)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const neighbours = spacing.get(spacingKey(ix + dx, iz + dz))
        if (neighbours?.some((neighbour) => (neighbour.x - x) ** 2 + (neighbour.z - z) ** 2 < TRUNK_SPACING ** 2)) return
      }
    }
    const local = spacing.get(spacingKey(ix, iz))
    if (local) local.push(tree)
    else spacing.set(spacingKey(ix, iz), [tree])
    const key = Math.floor(x / chunkSize) * 65536 + Math.floor(z / chunkSize)
    let chunk = chunks.get(key)
    if (!chunk) {
      chunk = {
        cx: (Math.floor(x / chunkSize) + 0.5) * chunkSize,
        cz: (Math.floor(z / chunkSize) + 0.5) * chunkSize,
        trees: [],
      }
      chunks.set(key, chunk)
    }
    chunk.trees.push(tree)
  }

  if (canopy) {
    const step = grid.step
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const index = row * grid.columns + column
        const cover = canopy.cover[index]
        const top = canopy.height[index]
        if (cover < 0.08 || top < 2.5) continue
        // About one conifer per 25 m² at full cover.
        let expected = cover * 0.95 * density
        while (expected > 0) {
          if (random() < expected) {
            const x = (column + random() - 0.5) * step
            const z = (row + random() - 0.5) * step
            plant(x, z, Math.max(2.5, top * (0.65 + 0.35 * random())))
          }
          expected -= 1
        }
      }
    }
  } else {
    const cell = 7
    for (let z = 0; z < grid.depth; z += cell) {
      for (let x = 0; x < grid.width; x += cell) {
        const px = x + cell * random()
        const pz = z + cell * random()
        const stand = 0.5 + 0.5 * Math.sin(px / 91 + Math.sin(pz / 160)) * Math.cos(pz / 109)
        if (random() > stand * 0.75 * density) continue
        plant(px, pz, 7 + 13 * random())
      }
    }
  }

  let count = 0
  const list = [...chunks.values()]
  for (const chunk of list) {
    shuffle(chunk.trees, random)
    count += chunk.trees.length
  }
  return { chunkSize, chunks: list, count, source: canopy ? 'canopy' : 'procedural' }
}

function shuffle<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
}

/** Trunk lookup for collisions. Buckets are `cell` metres square. */
export interface TrunkIndex {
  hit: (x: number, z: number, radius: number) => Tree | null
  sweep: (fromX: number, fromZ: number, x: number, z: number, radius: number) => TrunkContact | null
}

export interface TrunkContact {
  x: number
  z: number
  nx: number
  nz: number
}

const trunkRadius = (tree: Tree) => 0.18 + tree.height * 0.012

export function indexTrunks(forest: Forest, cell = 8): TrunkIndex {
  const buckets = new Map<number, Tree[]>()
  const key = (cx: number, cz: number) => cx * 100003 + cz
  for (const chunk of forest.chunks) {
    for (const tree of chunk.trees) {
      if (tree.height < 4) continue
      const k = key(Math.floor(tree.x / cell), Math.floor(tree.z / cell))
      const bucket = buckets.get(k)
      if (bucket) bucket.push(tree)
      else buckets.set(k, [tree])
    }
  }
  return {
    hit(x, z, radius) {
      const cx = Math.floor(x / cell)
      const cz = Math.floor(z / cell)
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const tree of buckets.get(key(cx + dx, cz + dz)) ?? []) {
            // Trunk radius grows a little with height.
            const reach = radius + trunkRadius(tree)
            if ((tree.x - x) ** 2 + (tree.z - z) ** 2 < reach * reach) return tree
          }
        }
      }
      return null
    },
    sweep(fromX, fromZ, x, z, radius) {
      const dx = x - fromX, dz = z - fromZ
      const lengthSq = dx * dx + dz * dz
      const padding = radius + 0.18 + MAX_TREE_HEIGHT * 0.012
      const minX = Math.floor((Math.min(fromX, x) - padding) / cell)
      const maxX = Math.floor((Math.max(fromX, x) + padding) / cell)
      const minZ = Math.floor((Math.min(fromZ, z) - padding) / cell)
      const maxZ = Math.floor((Math.max(fromZ, z) + padding) / cell)
      let first = Infinity
      let result: TrunkContact | null = null
      for (let iz = minZ; iz <= maxZ; iz++) {
        for (let ix = minX; ix <= maxX; ix++) {
          const bucket = buckets.get(key(ix, iz))
          if (!bucket) continue
          for (const tree of bucket) {
            const reach = radius + trunkRadius(tree)
            const px = fromX - tree.x, pz = fromZ - tree.z
            const offset = px * px + pz * pz - reach * reach
            const approach = px * dx + pz * dz
            const discriminant = approach * approach - lengthSq * offset
            if (offset >= 0 && (approach >= 0 || discriminant < 0)) continue
            if (offset < 0 && approach >= 0 && (x - tree.x) ** 2 + (z - tree.z) ** 2 >= reach * reach) continue
            const t = offset < 0 ? 0 : (-approach - Math.sqrt(discriminant)) / lengthSq
            if (t > 1 || t >= first) continue
            const nx = px + t * dx, nz = pz + t * dz
            const length = Math.hypot(nx, nz)
            const motion = Math.sqrt(lengthSq)
            const normalX = length > 1e-6 ? nx / length : motion ? -dx / motion : 0
            const normalZ = length > 1e-6 ? nz / length : motion ? -dz / motion : -1
            result = { x: tree.x + normalX * reach, z: tree.z + normalZ * reach, nx: normalX, nz: normalZ }
            first = t
          }
        }
      }
      return result
    },
  }
}

/** Sparser procedural trees on the apron around the crop, out to `reach` metres. */
export function plantApronForest(
  apron: { heightAt: (x: number, z: number) => number; coverAt: (x: number, z: number, h: number) => number; outside: (x: number, z: number) => number },
  bounds: { width: number; depth: number },
  options: { reach?: number; cell?: number; chunkSize?: number; density?: number; seed?: number } = {},
): Forest {
  const reach = options.reach ?? 1800
  const cell = options.cell ?? 14
  const chunkSize = options.chunkSize ?? 384
  const density = options.density ?? 1
  const random = makeRandom(options.seed ?? 9127)
  const chunks = new Map<number, ForestChunk>()
  for (let z = -reach; z < bounds.depth + reach; z += cell) {
    for (let x = -reach; x < bounds.width + reach; x += cell) {
      const px = x + cell * random()
      const pz = z + cell * random()
      const d = apron.outside(px, pz)
      if (d < 8 || d > reach) continue
      const y = apron.heightAt(px, pz)
      if (!Number.isFinite(y)) continue
      if (random() > apron.coverAt(px, pz, y) * 0.8 * density) continue
      const key = Math.floor(px / chunkSize) * 65536 + Math.floor(pz / chunkSize)
      let chunk = chunks.get(key)
      if (!chunk) {
        chunk = { cx: (Math.floor(px / chunkSize) + 0.5) * chunkSize, cz: (Math.floor(pz / chunkSize) + 0.5) * chunkSize, trees: [] }
        chunks.set(key, chunk)
      }
      chunk.trees.push({
        x: px,
        y,
        z: pz,
        height: 9 + 12 * random(),
        rotation: random() * Math.PI * 2,
        tone: 0.75 + 0.25 * random(),
        species: pickSpecies(y + 1600, 12, random()),
      })
    }
  }
  const list = [...chunks.values()]
  let count = 0
  for (const chunk of list) {
    shuffle(chunk.trees, random)
    count += chunk.trees.length
  }
  return { chunkSize, chunks: list, count, source: 'procedural' }
}
