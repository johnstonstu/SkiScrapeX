import { createTerrainGrid, decodeDetailHeights, withDetail, type TerrainGrid } from './terrainGrid'
import { overlayRuns } from './runOverlay'
import { applyCorrections } from './corrections'
import {
  chooseCourse,
  downhill,
  resortFromFeatures,
  resortFromReferences,
  type Course,
  type FeaturesDocument,
  type ReferencesDocument,
  type Resort,
} from './resort'
import type { Canopy } from './surface'
import type { Horizon } from './apron'

export interface TerrainManifest {
  version: number
  columns: number
  rows: number
  stepMetres: number
  originEasting: number
  originNorthing: number
  originElevation: number
  minimumElevation: number
  maximumElevation: number
  heightEncoding: string
  attribution: string
  canopy?: { coverFile: string; heightFile: string; heightScale: number }
  detail?: DetailManifest
}

export interface DetailManifest {
  file: string
  columns: number
  rows: number
  stepMetres: number
  baseElevation: number
  scale: number
  hole: number
}

export interface World {
  manifest: TerrainManifest
  grid: TerrainGrid
  canopy: Canopy | null
  resort: Resort
  course: Course
  /** URL of the north-up hillshade, for the minimap. */
  hillshade: string | null
  /** MRDEM terrain around the crop, when the data build produced it. */
  horizon: Horizon | null
  featureSource: 'osm-export' | 'references'
}

/** Generated files live in `data/` beside the page (see the data branch). */
export async function loadWorld(base: string, onProgress?: (message: string) => void): Promise<World> {
  const url = (name: string) => `${base}${name}`
  onProgress?.('Loading Apex terrain…')
  const manifest = await fetchJson<TerrainManifest>(url('terrain.json'))
  if (manifest.version !== 1 || manifest.heightEncoding !== 'float32-le') {
    throw new Error('Unsupported terrain manifest')
  }
  const buffer = await fetchBuffer(url('heights.f32'))
  if (buffer.byteLength !== manifest.columns * manifest.rows * 4) throw new Error('Height grid size mismatch')
  const heights = littleEndianFloats(buffer)
  let grid = createTerrainGrid(manifest, heights)
  if (manifest.detail) {
    onProgress?.('Loading 2 m terrain…')
    const detail = await loadDetail(manifest, url).catch((error) => {
      console.warn('Detail terrain skipped', error)
      return null
    })
    if (detail) grid = withDetail(grid, detail)
  }

  onProgress?.('Loading forest and runs…')
  const [canopy, features, references, hillshade, horizon] = await Promise.all([
    loadCanopy(manifest, url),
    fetchJson<FeaturesDocument>(url('features.json')).catch(() => null),
    fetchJson<ReferencesDocument>(url('references.json')).catch(() => null),
    probe(url('hillshade.png')),
    loadHorizon(url).catch(() => null),
  ])
  let resort: Resort
  let featureSource: World['featureSource']
  if (features && features.version === 1) {
    resort = resortFromFeatures(features, grid.heightAt)
    featureSource = 'osm-export'
  } else if (references) {
    resort = resortFromReferences(references, grid.heightAt)
    featureSource = 'references'
  } else {
    throw new Error('No resort features (features.json or references.json)')
  }
  // Runs OSM lacks, traced from the LiDAR canopy (see runOverlay.ts).
  resort.runs.push(...overlayRuns((part) => downhill(part, grid.heightAt)))
  applyCorrections(resort)
  // Keep only what lies on the terrain crop.
  resort.lifts = resort.lifts.filter((lift) =>
    lift.line.every(([x, z]) => Number.isFinite(grid.heightAt(x, z))),
  )
  resort.runs = resort.runs.filter((run) =>
    run.parts.some((part) => part.some(([x, z]) => Number.isFinite(grid.heightAt(x, z)))),
  )
  const course = chooseCourse(resort, grid.heightAt)
  return { manifest, grid, canopy, resort, course, hillshade: hillshade ? url('hillshade.png') : null, horizon, featureSource }
}

async function loadDetail(manifest: TerrainManifest, url: (name: string) => string): Promise<TerrainGrid> {
  const info = manifest.detail!
  const heights = decodeDetailHeights(await fetchBuffer(url(info.file)), info, manifest.originElevation)
  return createTerrainGrid({ columns: info.columns, rows: info.rows, stepMetres: info.stepMetres }, heights)
}

async function loadCanopy(manifest: TerrainManifest, url: (name: string) => string): Promise<Canopy | null> {
  const info = manifest.canopy
  if (!info) return null
  try {
    const [cover, height] = await Promise.all([fetchBuffer(url(info.coverFile)), fetchBuffer(url(info.heightFile))])
    const count = manifest.columns * manifest.rows
    if (cover.byteLength !== count || height.byteLength !== count) return null
    const coverBytes = new Uint8Array(cover)
    const heightBytes = new Uint8Array(height)
    const canopy: Canopy = { cover: new Float32Array(count), height: new Float32Array(count) }
    for (let i = 0; i < count; i++) {
      canopy.cover[i] = coverBytes[i] / 255
      canopy.height[i] = heightBytes[i] / info.heightScale
    }
    return canopy
  } catch {
    return null
  }
}

async function loadHorizon(url: (name: string) => string): Promise<Horizon | null> {
  const meta = await fetchJson<{
    version: number
    columns: number
    rows: number
    stepMetres: number
    originX: number
    originZ: number
    heightFile: string
    canopyFile?: string
  }>(url('horizon.json'))
  if (meta.version !== 1) return null
  const heights = littleEndianFloats(await fetchBuffer(url(meta.heightFile)))
  if (heights.length !== meta.columns * meta.rows) return null
  let canopy: Float32Array | null = null
  if (meta.canopyFile) {
    const bytes = new Uint8Array(await fetchBuffer(url(meta.canopyFile)))
    if (bytes.length === heights.length) canopy = Float32Array.from(bytes, (b) => b / 4)
  }
  return { columns: meta.columns, rows: meta.rows, step: meta.stepMetres, originX: meta.originX, originZ: meta.originZ, heights, canopy }
}

function littleEndianFloats(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer)
  const out = new Float32Array(buffer.byteLength / 4)
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Missing ${url}`)
  return (await response.json()) as T
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Missing ${url}`)
  return response.arrayBuffer()
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch {
    return false
  }
}
