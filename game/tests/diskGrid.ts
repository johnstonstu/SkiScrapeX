import { existsSync, readFileSync } from 'node:fs'
import { createTerrainGrid, decodeDetailHeights, withDetail, type TerrainGrid } from '../src/world/terrainGrid'

const bytes = (path: string) => {
  const buffer = readFileSync(path)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

/**
 * The terrain the game skis on, read from the generated data on disk: the
 * 5 m grid, with the 2 m detail on top when the data has it. Set
 * `SKI_TERRAIN=coarse` to compare against the 5 m grid alone.
 */
export function loadDiskGrid(dir: string): TerrainGrid {
  const manifest = JSON.parse(readFileSync(`${dir}terrain.json`, 'utf8'))
  const grid = createTerrainGrid(manifest, new Float32Array(bytes(`${dir}heights.f32`)))
  const info = manifest.detail
  if (!info || process.env.SKI_TERRAIN === 'coarse' || !existsSync(`${dir}${info.file}`)) return grid
  const heights = decodeDetailHeights(bytes(`${dir}${info.file}`), info, manifest.originElevation)
  return withDetail(grid, createTerrainGrid({ columns: info.columns, rows: info.rows, stepMetres: info.stepMetres }, heights))
}
