import { SURFACES, type SampleSurface, type SurfaceParams } from '../sim'
import type { TerrainGrid } from './terrainGrid'
import { nearestSample, surfaceAt, SurfaceId, type Canopy, type SurfaceField } from './surface'

/**
 * What the skis are on, for the sim: groomed runs, terrain parks, open
 * powder off-piste and shallower, heavier snow in the trees. `freshSnow`
 * scales loose-snow depth (1 is a normal powder day, 0 is packed out).
 */
export function createSurfaceSampler(
  grid: TerrainGrid,
  field: SurfaceField,
  canopy: Canopy | null,
  options: { freshSnow?: number; inPark?: (x: number, z: number) => boolean } = {},
): SampleSurface {
  const fresh = options.freshSnow ?? 1
  const scaled = (p: SurfaceParams): SurfaceParams => (fresh === 1 ? p : { ...p, depth: p.depth * fresh })
  const powder = scaled(SURFACES.powder)
  const forest = scaled(SURFACES.forest)
  return (x, z) => {
    if (options.inPark?.(x, z)) return SURFACES.park
    switch (surfaceAt(field, x, z)) {
      case SurfaceId.groomed:
        return SURFACES.groomed
      case SurfaceId.park:
        return SURFACES.park
      case SurfaceId.ice:
        return SURFACES.ice
      default: {
        if (canopy && canopy.cover[nearestSample(grid, x, z)] > 0.4) return forest
        const drift = Math.max(0, (Math.sin(x / 40 + 0.4 * Math.sin(z / 61)) + Math.cos(z / 32) - 0.25) / 1.75)
        return { ...powder, depth: powder.depth * (1 + drift), vPlane: 7 + 2 * drift }
      }
    }
  }
}
