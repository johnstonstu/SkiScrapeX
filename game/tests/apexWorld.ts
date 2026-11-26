import { readFileSync } from 'node:fs'
import { loadDiskGrid } from './diskGrid'
import { downhill, resortFromFeatures, type Resort } from '../src/world/resort'
import { overlayRuns } from '../src/world/runOverlay'
import { applyCorrections } from '../src/world/corrections'
import { gladeRuns } from '../src/world/glades'
import { buildSurface, type Canopy, type SurfaceField } from '../src/world/surface'
import type { TerrainGrid } from '../src/world/terrainGrid'

/**
 * The Apex world as the game builds it (world/loadWorld.ts and
 * app/apexStage.ts), read from the data on disk: grid, canopy, the resort
 * with LiDAR traces, corrections and glades, and the surface raster fitted
 * to the canopy. Parks are left out (they only repaint their own corridors).
 */
export interface ApexWorld {
  grid: TerrainGrid
  canopy: Canopy
  resort: Resort
  surface: SurfaceField
}

let cached: ApexWorld | null = null

export function loadApexWorld(dir = 'public/data/'): ApexWorld {
  if (cached) return cached
  const grid = loadDiskGrid(dir)
  const manifest = JSON.parse(readFileSync(`${dir}terrain.json`, 'utf8'))
  const cover = readFileSync(`${dir}${manifest.canopy.coverFile}`)
  const height = readFileSync(`${dir}${manifest.canopy.heightFile}`)
  const canopy: Canopy = { cover: new Float32Array(cover.length), height: new Float32Array(height.length) }
  for (let i = 0; i < cover.length; i++) {
    canopy.cover[i] = cover[i] / 255
    canopy.height[i] = height[i] / manifest.canopy.heightScale
  }
  const resort = resortFromFeatures(JSON.parse(readFileSync(`${dir}features.json`, 'utf8')), grid.heightAt)
  resort.runs.push(...overlayRuns((part) => downhill(part, grid.heightAt)))
  applyCorrections(resort)
  resort.runs.push(...gladeRuns())
  resort.runs = resort.runs.filter((run) => run.parts.some((part) => part.some(([x, z]) => Number.isFinite(grid.heightAt(x, z)))))
  const surface = buildSurface(grid, resort, 2.5, [], { canopyCover: canopy.cover })
  cached = { grid, canopy, resort, surface }
  return cached
}
