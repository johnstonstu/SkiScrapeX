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
    if (height < 7) return r < 0.55 ? Species.Krummholz : r < 0.85 ? Species.Ghost : Species.Fir
    return r < 0.4 ? Species.Ghost : r < 0.85 ? Species.Fir : Species.Spruce
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

const LIFT_CLEARANCE = 9
const MAX_SLOPE_COS = Math.cos((40 * Math.PI) / 180)

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
  const chunks = new Map<string, ForestChunk>()
  const liftLines = resort.lifts.map((lift) => lift.line)

  const plant = (x: number, z: number, height: number) => {
    if (isClear(surface, x, z)) return
    const ground = grid.sampleTerrain(x, z)
    if (!ground || (!canopy && ground.normal.y < MAX_SLOPE_COS)) return
    for (const line of liftLines) {
      if (nearestOnPolyline(x, z, line).distanceSq < LIFT_CLEARANCE * LIFT_CLEARANCE) return
    }
    const key = `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`
    let chunk = chunks.get(key)
    if (!chunk) {
      chunk = {
        cx: (Math.floor(x / chunkSize) + 0.5) * chunkSize,
        cz: (Math.floor(z / chunkSize) + 0.5) * chunkSize,
        trees: [],
      }
      chunks.set(key, chunk)
    }
    chunk.trees.push({
      x,
      y: ground.height,
      z,
      height,
      rotation: random() * Math.PI * 2,
      tone: 0.75 + 0.25 * random(),
      species: pickSpecies(ground.height + origin, height, random()),
    })
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
}

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
            const reach = radius + 0.18 + tree.height * 0.012
            if ((tree.x - x) ** 2 + (tree.z - z) ** 2 < reach * reach) return tree
          }
        }
      }
      return null
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
  const chunks = new Map<string, ForestChunk>()
  for (let z = -reach; z < bounds.depth + reach; z += cell) {
    for (let x = -reach; x < bounds.width + reach; x += cell) {
      const px = x + cell * random()
      const pz = z + cell * random()
      const d = apron.outside(px, pz)
      if (d < 8 || d > reach) continue
      const y = apron.heightAt(px, pz)
      if (!Number.isFinite(y)) continue
      if (random() > apron.coverAt(px, pz, y) * 0.8 * density) continue
      const key = `${Math.floor(px / chunkSize)},${Math.floor(pz / chunkSize)}`
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
