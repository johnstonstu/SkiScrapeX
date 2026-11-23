/**
 * Pick a starting graphics level from the hardware, so Auto suits an older
 * MacBook and a new desktop alike. The browser names the graphics chip
 * through WEBGL_debug_renderer_info (some browsers mask it); memory and core
 * counts are a backstop. Runtime frame times can still step it down (see
 * `adaptive.ts`), and a GPU reset steps it down for the next load.
 */
import type { QualityLevel } from './settings'

export interface HardwareInfo {
  /** Unmasked renderer string, for example "ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 640, OpenGL 4.1)". */
  renderer: string
  /** navigator.deviceMemory in GB, when the browser reports it. */
  memoryGb?: number
  cores?: number
  touch: boolean
  /** WebGL 2 was available. */
  webgl2: boolean
}

export interface HardwareTier {
  level: QualityLevel
  /** Short reason, shown in Settings next to Auto. */
  reason: string
}

/** Graphics level for a chip. Pure, so it is unit tested against real renderer strings. */
export function classifyHardware(info: HardwareInfo): HardwareTier {
  const r = info.renderer.toLowerCase()
  let tier: HardwareTier
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r)) tier = { level: 'low', reason: 'software graphics' }
  else if (!info.webgl2) tier = { level: 'low', reason: 'older WebGL only' }
  else if (/mali|adreno|powervr|videocore|tegra/.test(r)) tier = { level: 'low', reason: 'mobile graphics' }
  else if (/apple m\d|apple gpu/.test(r)) tier = { level: 'high', reason: 'Apple silicon' }
  else if (/intel/.test(r)) {
    // Arc and Iris Xe (2020 on) cope with Medium; older HD, UHD and Iris
    // (the chips in pre-2020 MacBooks) do not keep up above Low.
    if (/\barc\b/.test(r)) tier = { level: 'high', reason: 'Intel Arc' }
    else if (/iris\(r\) xe|iris xe|\bxe graphics/.test(r)) tier = { level: 'medium', reason: 'Intel Iris Xe' }
    else tier = { level: 'low', reason: 'older Intel graphics' }
  } else if (/nvidia|geforce|quadro|rtx|gtx/.test(r)) {
    // Laptop chips from the early 2010s (GT 650M, 750M) are mid-range now.
    tier = /\bgt \d{3}m?\b|\b[1-9]\d{2}m\b/.test(r) ? { level: 'medium', reason: 'older NVIDIA graphics' } : { level: 'high', reason: 'NVIDIA graphics' }
  } else if (/amd|radeon|ati /.test(r)) {
    // The Radeon Pro chips in 2016 to 2019 MacBook Pros are mid-range.
    tier = /radeon pro \d{3}x?\b|radeon \(tm\) r\d|vega \d\b|radeon hd/.test(r) ? { level: 'medium', reason: 'mid-range AMD graphics' } : { level: 'high', reason: 'AMD graphics' }
  } else tier = { level: 'medium', reason: 'unrecognised graphics' }

  if (info.touch && tier.level !== 'low') tier = { level: 'low', reason: `${tier.reason}, touch device` }
  // Little memory or few cores: stay off High whatever the chip says.
  if (tier.level === 'high' && ((info.memoryGb !== undefined && info.memoryGb <= 4) || (info.cores !== undefined && info.cores <= 4))) {
    tier = { level: 'medium', reason: `${tier.reason}, limited memory or cores` }
  }
  return tier
}

/** Read the chip from a throwaway WebGL context. Null when WebGL is unavailable. */
export function probeHardware(touch: boolean): HardwareInfo | null {
  try {
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    const gl = gl2 ?? canvas.getContext('webgl')
    if (!gl) return null
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String((debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    const nav = navigator as Navigator & { deviceMemory?: number }
    return { renderer, memoryGb: nav.deviceMemory, cores: nav.hardwareConcurrency, touch, webgl2: Boolean(gl2) }
  } catch {
    return null
  }
}
