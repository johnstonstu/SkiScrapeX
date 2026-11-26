import { SURFACES, blendSurface, type SampleSurface, type SurfaceParams } from '../sim'
import type { TerrainGrid } from './terrainGrid'
import { exposureAt, scourShares } from './exposure'
import type { SnowDeform } from './snowDeform'
import { surfaceAt, SurfaceId, type Canopy, type SurfaceField } from './surface'

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const MAX_LOOSE_SNOW_DEPTH = 0.65

const shelterFromCover = (cover: number) => clamp01((cover - 0.12) / 0.64)

/** Broad wind-loaded pockets with smaller drifts crossing them. */
function driftAt(x: number, z: number) {
  return clamp01(0.5
    + 0.26 * Math.sin(x / 39 + Math.cos(z / 68) * 0.8)
    + 0.16 * Math.cos(z / 27 - x / 53)
    + 0.08 * Math.sin(x / 11 + z / 15))
}

function depthFromDrift(drift: number, shelter: number) {
  return mix(0.1 + (MAX_LOOSE_SNOW_DEPTH - 0.1) * drift ** 1.35, 0.08 + 0.23 * drift, shelter)
}

/** Undisturbed powder depth for the snow material at each canopy sample. */
export function looseSnowDepth(x: number, z: number, cover: number) {
  return depthFromDrift(driftAt(x, z), shelterFromCover(cover))
}

function canopyCover(grid: TerrainGrid, canopy: Canopy, x: number, z: number): number {
  const gx = Math.max(0, Math.min(grid.columns - 1, x / grid.step))
  const gz = Math.max(0, Math.min(grid.rows - 1, z / grid.step))
  const col = Math.min(grid.columns - 2, Math.floor(gx))
  const row = Math.min(grid.rows - 2, Math.floor(gz))
  const i = row * grid.columns + col
  const cover = canopy.cover
  return mix(mix(cover[i], cover[i + 1], gx - col), mix(cover[i + grid.columns], cover[i + grid.columns + 1], gx - col), gz - row)
}

/**
 * What the skis are on, for the sim: groomed runs, terrain parks, open
 * powder off-piste and shallower, heavier snow in the trees. `freshSnow`
 * scales loose-snow depth (1 is a normal powder day, 0 is packed out).
 */
export function createSurfaceSampler(
  grid: TerrainGrid,
  field: SurfaceField,
  canopy: Canopy | null,
  options: {
    freshSnow?: number
    inPark?: (x: number, z: number) => boolean
    onMogul?: (x: number, z: number) => boolean
    deform?: SnowDeform
    /** A race track while its event runs: groomed underfoot whatever the mask says. */
    groomedAt?: (x: number, z: number) => boolean
  } = {},
): SampleSurface {
  const fresh = Math.max(0, options.freshSnow ?? 1)
  return (x, z) => {
    if (options.inPark?.(x, z)) return SURFACES.park
    if (options.groomedAt?.(x, z)) return SURFACES.groomed
    switch (surfaceAt(field, x, z)) {
      case SurfaceId.groomed:
        return SURFACES.groomed
      case SurfaceId.park:
        return SURFACES.park
      case SurfaceId.ice:
        return SURFACES.ice
      case SurfaceId.rock:
        return SURFACES.rock
      default: {
        const shelter = canopy ? shelterFromCover(canopyCover(grid, canopy, x, z)) : 0
        const drift = driftAt(x, z)
        const base = blendSurface(SURFACES.powder, SURFACES.forest, shelter)
        const depth = depthFromDrift(drift, shelter)
        const packedBump = options.onMogul?.(x, z)
        let snow: SurfaceParams = {
          ...base,
          kind: shelter >= 0.5 ? 'forest' : 'powder',
          depth: depth * fresh * (packedBump ? 0.48 : 1),
          vPlane: mix(6.2 + 2.2 * drift, 6.1, shelter),
        }
        // Tracks already skied: the snow in them is packed, so less to sink into and it runs faster.
        const trench = options.deform ? Math.max(0, -options.deform.at(x, z)) : 0
        if (trench > 0.01) {
          const packed = Math.min(1, trench / 0.25)
          snow = { ...blendSurface(snow, SURFACES.groomed, packed * 0.45), kind: snow.kind, depth: Math.max(0, snow.depth - trench * 1.3) }
        }
        if (!field.exposure) return snow
        // Summit wind-scour: powder thins to crust, then rock shows through.
        const { crust, rock } = scourShares(exposureAt(field.exposure, x, z))
        if (crust <= 0) return snow
        const crusted = { ...blendSurface(snow, SURFACES.ice, crust), kind: crust >= 0.5 ? 'ice' as const : snow.kind }
        return rock > 0 ? { ...blendSurface(crusted, SURFACES.rock, rock), kind: rock >= 0.5 ? 'rock' as const : crusted.kind } : crusted
      }
    }
  }
}
