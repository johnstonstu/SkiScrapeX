import type { Vec3 } from './vec'
import { length } from './vec'

/**
 * Same contract as game/src/world/terrainGrid.ts `sampleTerrain`.
 * Heights are metres. The unit normal points upward.
 * `null` is outside the slope (or a hole, once real terrain is wired in).
 */
export interface SurfaceSample {
  height: number
  normal: Vec3
}

export type SampleTerrain = (x: number, z: number) => SurfaceSample | null

export interface Spawn {
  x: number
  z: number
  /** Radians. 0 faces +Z (south, down a south-falling slope). Positive is the skier's right. */
  heading: number
}

export interface Slope {
  id: string
  label: string
  width: number
  depth: number
  originX: number
  originZ: number
  /** Grid step used when meshing this slope. The sampler itself is analytic. */
  visualStep: number
  spawn: Spawn
  sampleTerrain: SampleTerrain
  /** Snow under the skis; groomed everywhere when missing. */
  sampleSurface?: import('./surface').SampleSurface
}

export interface SlopeBounds {
  width?: number
  depth?: number
  originX?: number
  originZ?: number
  spawnX?: number
  spawnZ?: number
  heading?: number
  /** Height at the uphill edge (z = originZ), in metres. */
  crest?: number
  visualStep?: number
}

const DEFAULT_WIDTH = 160
const DEFAULT_DEPTH = 800

function resolveBounds(bounds: SlopeBounds | undefined, pitchDeg: number) {
  const width = bounds?.width ?? DEFAULT_WIDTH
  const depth = bounds?.depth ?? DEFAULT_DEPTH
  const originX = bounds?.originX ?? 0
  const originZ = bounds?.originZ ?? 0
  const crest = bounds?.crest ?? Math.tan((pitchDeg * Math.PI) / 180) * depth + 40
  const spawn = {
    x: bounds?.spawnX ?? originX + width / 2,
    z: bounds?.spawnZ ?? originZ + Math.min(30, depth * 0.5),
    heading: bounds?.heading ?? 0,
  }
  return { width, depth, originX, originZ, crest, spawn, visualStep: bounds?.visualStep ?? 4 }
}

function inside(bounds: { originX: number; originZ: number; width: number; depth: number }, x: number, z: number): boolean {
  return (
    Number.isFinite(x) &&
    Number.isFinite(z) &&
    x >= bounds.originX &&
    z >= bounds.originZ &&
    x <= bounds.originX + bounds.width &&
    z <= bounds.originZ + bounds.depth
  )
}

/** Unit upward normal from height derivatives ∂h/∂x and ∂h/∂z. */
export function normalFromGradient(dhdx: number, dhdz: number): Vec3 {
  const n = { x: -dhdx, y: 1, z: -dhdz }
  const len = length(n)
  return { x: n.x / len, y: n.y / len, z: n.z / len }
}

export function createFlatSlope(bounds?: SlopeBounds & { height?: number }): Slope {
  const box = resolveBounds({ crest: 0, ...bounds }, 0)
  const height = bounds?.height ?? 0
  const sampleTerrain: SampleTerrain = (x, z) => {
    if (!inside(box, x, z)) return null
    return { height, normal: { x: 0, y: 1, z: 0 } }
  }
  return {
    id: 'flat',
    label: 'Flat',
    ...box,
    sampleTerrain,
  }
}

/**
 * Constant pitch falling toward +Z (south). `pitchDeg` is the fall-line angle
 * above the horizontal. The normal matches game/src/world/terrainGrid.ts: (-∂h/∂x, 1, -∂h/∂z) normalized.
 */
export function createSteadySlope(pitchDeg: number, bounds?: SlopeBounds): Slope {
  if (!Number.isFinite(pitchDeg) || pitchDeg < 0 || pitchDeg >= 89) {
    throw new Error('Pitch must be a finite angle in [0, 89) degrees')
  }
  const box = resolveBounds(bounds, pitchDeg)
  const pitch = (pitchDeg * Math.PI) / 180
  const grade = Math.tan(pitch)
  const normal = normalFromGradient(0, -grade)
  const sampleTerrain: SampleTerrain = (x, z) => {
    if (!inside(box, x, z)) return null
    const height = box.crest - grade * (z - box.originZ)
    return { height, normal }
  }
  const label = pitchDeg === 0 ? 'Flat' : `${pitchDeg}° pitch`
  return {
    id: `pitch-${pitchDeg}`,
    label,
    ...box,
    sampleTerrain,
  }
}

export interface RollingOptions extends SlopeBounds {
  /** Mean fall-line pitch, degrees, toward +Z. */
  basePitchDeg?: number
  /** Wave height, metres. Kept small enough that the run still descends. */
  amplitude?: number
  /** Wavelength along Z, metres. */
  wavelength?: number
}

/** A groomed fall line with a sine wave so pitch tightens and eases. */
export function createRollingSlope(options?: RollingOptions): Slope {
  const basePitchDeg = options?.basePitchDeg ?? 16
  const amplitude = options?.amplitude ?? 3.5
  const wavelength = options?.wavelength ?? 110
  if (wavelength <= 0) throw new Error('Wavelength must be positive')
  const box = resolveBounds({ ...options, visualStep: options?.visualStep ?? 2 }, basePitchDeg)
  const grade = Math.tan((basePitchDeg * Math.PI) / 180)
  const wave = (2 * Math.PI) / wavelength

  const heightAt = (z: number) => {
    const s = z - box.originZ
    return box.crest - grade * s + amplitude * Math.sin(wave * s)
  }
  const dhdz = (z: number) => -grade + amplitude * wave * Math.cos(wave * (z - box.originZ))

  const sampleTerrain: SampleTerrain = (x, z) => {
    if (!inside(box, x, z)) return null
    return { height: heightAt(z), normal: normalFromGradient(0, dhdz(z)) }
  }
  return {
    id: 'rolling',
    label: 'Rolling',
    ...box,
    sampleTerrain,
  }
}

export type PresetId = 'flat' | 'gentle' | 'pitch' | 'steep' | 'rolling'

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'flat', label: 'Flat' },
  { id: 'gentle', label: 'Gentle 10°' },
  { id: 'pitch', label: 'Test pitch 15°' },
  { id: 'steep', label: 'Steep 25°' },
  { id: 'rolling', label: 'Rolling' },
]

const DEV_BOUNDS: SlopeBounds = { width: 500, depth: 1800, visualStep: 5 }

export function createPreset(id: PresetId): Slope {
  switch (id) {
    case 'flat':
      return { ...createFlatSlope({ ...DEV_BOUNDS, height: 0, crest: 0, spawnZ: 360 }), id: 'flat', label: 'Flat' }
    case 'gentle':
      return { ...createSteadySlope(10, DEV_BOUNDS), id: 'gentle', label: 'Gentle 10°' }
    case 'pitch':
      return { ...createSteadySlope(15, DEV_BOUNDS), id: 'pitch', label: 'Test pitch 15°' }
    case 'steep':
      return { ...createSteadySlope(25, { ...DEV_BOUNDS, visualStep: 4 }), id: 'steep', label: 'Steep 25°' }
    case 'rolling':
      return {
        ...createRollingSlope({ ...DEV_BOUNDS, visualStep: 4, basePitchDeg: 16, amplitude: 3.5, wavelength: 110 }),
        id: 'rolling',
        label: 'Rolling',
      }
    default: {
      const never: never = id
      throw new Error(`Unknown slope ${never}`)
    }
  }
}
