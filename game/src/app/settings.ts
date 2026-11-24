import { KEYS, readJson, writeJson } from './storage'
import type { ForestDetail } from '../render/scenery/forestView'
import type { DetailOptions } from '../render/terrain/terrainView'

export type QualityLevel = 'low' | 'medium' | 'high'

export interface Settings {
  /** `auto` is low on touch devices and high elsewhere. Applies on reload. */
  quality: 'auto' | QualityLevel
  /** `auto` is off on the Low profile and on otherwise. */
  shadows: 'auto' | 'on' | 'off'
  /** 0.6 near to 1.4 far: scales how far trees and detail reach. */
  viewDistance: number
  /** 0.5 to 1.5: how quickly keys and sticks reach full edge. */
  steering: number
  invertPitch: boolean
  /** 0 to 1. */
  volume: number
  /** Follow-camera field of view, degrees. */
  fov: number
  cameraShake: boolean
  /** Steady looks down the hill; tight turns with the skis. */
  cameraStyle: 'steady' | 'tight'
  landingRing: boolean
  /** Rotation snap near touchdown. */
  landingAssist: boolean
  /** Other skiers on the hill. */
  npcs: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  shadows: 'auto',
  viewDistance: 1,
  steering: 1,
  invertPitch: false,
  volume: 0.8,
  fov: 58,
  cameraShake: true,
  cameraStyle: 'steady',
  landingRing: true,
  landingAssist: true,
  npcs: true,
}

export function readSettings(): Settings {
  const settings = readJson<Settings>(KEYS.settings, { ...DEFAULT_SETTINGS })
  // Saves from before 0.8.7 stored shadows as a boolean: on becomes auto.
  const stored = settings.shadows as unknown
  if (stored === true) settings.shadows = 'auto'
  if (stored === false) settings.shadows = 'off'
  return settings
}

/** Whether shadows draw, from the setting and the graphics profile. */
export function shadowsOn(settings: Settings, quality: QualityProfile): boolean {
  return settings.shadows === 'on' || (settings.shadows === 'auto' && quality.shadows)
}

export function writeSettings(settings: Settings): void {
  writeJson(KEYS.settings, settings)
}

/** Everything a quality level decides at start-up. */
export interface QualityProfile {
  level: QualityLevel
  /** Other skiers on the hill. */
  npcCount: number
  pixelRatioMax: number
  antialias: boolean
  shadowMapSize: number
  /** Shadows when the setting is Auto. Off on Low: the shadow pass is the biggest single cost on phones. */
  shadows: boolean
  /** Close-up snow detail in the terrain shader (fine relief, worn patches, wandering edges). */
  snowDetail: boolean
  forest: ForestDetail
  apronForestDensity: number
  apronForestReach: number
  terrain: Partial<DetailOptions>
  sprayParticles: number
  snowflakes: number
  trackResolution: number
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: {
    level: 'low',
    npcCount: 4,
    pixelRatioMax: 1.5,
    antialias: false,
    shadowMapSize: 1024,
    shadows: false,
    snowDetail: false,
    forest: { near: 150, mid: 600, midShare: 0.45, farShare: 0.1, compact: true },
    apronForestDensity: 0.6,
    apronForestReach: 900,
    terrain: { near: 90, far: 150, cache: 24, coarseStride: 2 },
    sprayParticles: 900,
    snowflakes: 1600,
    trackResolution: 256,
  },
  medium: {
    level: 'medium',
    npcCount: 7,
    pixelRatioMax: 1.75,
    antialias: true,
    shadowMapSize: 2048,
    shadows: true,
    snowDetail: true,
    forest: { near: 200, mid: 750, midShare: 0.55, farShare: 0.15 },
    apronForestDensity: 0.8,
    apronForestReach: 1300,
    terrain: { near: 110, far: 180, cache: 36, coarseStride: 1 },
    sprayParticles: 1400,
    snowflakes: 2800,
    trackResolution: 512,
  },
  high: {
    level: 'high',
    npcCount: 10,
    pixelRatioMax: 2,
    antialias: true,
    shadowMapSize: 2048,
    shadows: true,
    snowDetail: true,
    forest: { near: 260, mid: 900, midShare: 0.7, farShare: 0.22 },
    apronForestDensity: 1,
    apronForestReach: 1800,
    terrain: {},
    sprayParticles: 2048,
    snowflakes: 4200,
    trackResolution: 512,
  },
}

/**
 * The profile for this session. Auto starts from the level the hardware
 * suggests (see app/hardware.ts; High on desktops and Low on touch when it is
 * unknown) and never goes above `cap`, a limit learned on this machine after
 * a GPU reset or slow frames. A level picked by hand is used as it is.
 */
export function resolveQuality(settings: Settings, touch: boolean, hardware: QualityLevel | null = null, cap: QualityLevel | null = null): QualityProfile {
  if (settings.quality !== 'auto') return QUALITY[settings.quality]
  let level: QualityLevel = hardware ?? (touch ? 'low' : 'high')
  if (cap && LEVELS.indexOf(cap) < LEVELS.indexOf(level)) level = cap
  return QUALITY[level]
}

const LEVELS: QualityLevel[] = ['low', 'medium', 'high']

/** One level lighter than `level` (Low stays Low). */
export function lighterQuality(level: QualityLevel): QualityLevel {
  return LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)]
}

/** Forest reach scaled by the view distance setting (the base profile is left untouched). */
export function scaledForest(base: ForestDetail, viewDistance: number): ForestDetail {
  return {
    compact: base.compact,
    near: base.near * Math.min(1.2, viewDistance),
    mid: base.mid * viewDistance,
    midShare: Math.min(1, base.midShare * viewDistance),
    farShare: Math.min(1, base.farShare * viewDistance),
  }
}

type Changed = (settings: Settings, key: keyof Settings) => void

/** Settings panel: chip groups, sliders and toggles; calls `onChange` after every edit. */
export function createSettingsPanel(panel: HTMLElement, settings: Settings, appliedQuality: QualityLevel, onChange: Changed, autoReason = ''): void {
  const render = () => {
    panel.innerHTML =
      '<header><div><h2>Settings</h2><p class="menu-lead">Graphics, camera, sound and assists.</p></div>' +
      '<button type="button" class="close" aria-label="Close">✕</button></header>'
    panel.querySelector('.close')!.addEventListener('click', () => (panel.hidden = true))
    const row = (title: string, note = '') => {
      const element = document.createElement('div')
      element.className = 'style-row settings-row'
      element.innerHTML = `<span>${title}${note ? ` <em>${note}</em>` : ''}</span>`
      panel.append(element)
      return element
    }
    const chips = <K extends keyof Settings>(title: string, key: K, options: [Settings[K], string][], note = '') => {
      const element = row(title, note)
      const group = document.createElement('div')
      group.className = 'chips'
      for (const [value, label] of options) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.setAttribute('aria-pressed', String(settings[key] === value))
        button.addEventListener('click', () => {
          settings[key] = value
          onChange(settings, key)
          render()
        })
        group.append(button)
      }
      element.append(group)
    }
    const slider = (title: string, key: 'viewDistance' | 'steering' | 'volume' | 'fov', min: number, max: number, step: number, format: (v: number) => string) => {
      const element = row(title)
      const input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(settings[key])
      input.setAttribute('aria-label', title)
      const value = document.createElement('output')
      value.textContent = format(settings[key])
      input.addEventListener('input', () => {
        settings[key] = Number(input.value)
        value.textContent = format(settings[key])
        onChange(settings, key)
      })
      const wrap = document.createElement('div')
      wrap.className = 'slider'
      wrap.append(input, value)
      element.append(wrap)
    }
    const percent = (v: number) => `${Math.round(v * 100)}%`
    const pending = (settings.quality === 'auto' ? null : settings.quality) !== null && settings.quality !== appliedQuality
    chips('Graphics', 'quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], `now ${appliedQuality}${settings.quality === 'auto' && autoReason ? `, for ${autoReason}` : ''}`)
    if (pending) {
      const reload = document.createElement('button')
      reload.type = 'button'
      reload.className = 'reload'
      reload.textContent = 'Reload to apply graphics'
      reload.addEventListener('click', () => location.reload())
      panel.lastElementChild!.append(reload)
    }
    chips('Shadows', 'shadows', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'Auto is off on Low graphics')
    slider('View distance', 'viewDistance', 0.6, 1.4, 0.05, percent)
    slider('Steering sensitivity', 'steering', 0.5, 1.5, 0.05, percent)
    chips('Flip controls (up and down)', 'invertPitch', [[false, 'Normal'], [true, 'Inverted']])
    slider('Camera field of view', 'fov', 48, 75, 1, (v) => `${v}°`)
    chips('Camera follow', 'cameraStyle', [['steady', 'Steady'], ['tight', 'Tight']], 'steady looks down the hill, tight turns with the skis')
    chips('Camera shake & rumble', 'cameraShake', [[true, 'On'], [false, 'Off']])
    slider('Volume', 'volume', 0, 1, 0.05, percent)
    chips('Other skiers', 'npcs', [[true, 'On'], [false, 'Off']])
    chips('Landing marker', 'landingRing', [[true, 'On'], [false, 'Off']])
    chips('Landing assist', 'landingAssist', [[true, 'On'], [false, 'Off']], 'lines up rotation near touchdown')
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'reset'
    reset.textContent = 'Reset to defaults'
    reset.addEventListener('click', () => {
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        ;(settings as unknown as Record<string, unknown>)[key] = DEFAULT_SETTINGS[key]
        onChange(settings, key)
      }
      render()
    })
    panel.append(reset)
  }
  render()
}
