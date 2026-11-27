import { KEYS, readJson, writeJson } from './storage'
import type { ForestDetail } from '../render/scenery/forestView'
import type { DetailOptions } from '../render/terrain/terrainView'
import type { WeatherId } from '../render/weather'

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
  /** Adaptive music on or off. */
  music: boolean
  /** Procedural stems made in the browser, the adaptive instrumentals, or the radio songs (`public/audio/music/`). */
  musicSource: 'procedural' | 'tracks' | 'radio'
  /** Synced lyrics on screen while a song with lyrics plays. */
  lyrics: boolean
  /** Which songs the radio plays. */
  radioMix: 'all' | 'vocal' | 'instrumental'
  /** 0 to 1, on top of the Sound button. */
  musicVolume: number
  /** Follow-camera field of view, degrees. */
  fov: number
  cameraShake: boolean
  /** Steady looks down the hill; tight turns with the skis. */
  cameraStyle: 'steady' | 'tight'
  /** Day conditions: snow density, fog and light. */
  weather: WeatherId
  landingRing: boolean
  /** Rotation snap near touchdown. */
  landingAssist: boolean
  /** Other skiers on the hill. */
  npcs: boolean
  /** Race events: steering toward the next gate is pulled onto the racing line. */
  raceAssist: boolean
  /** Screen while skiing. Auto is minimal on touch screens and full elsewhere. */
  hud: 'auto' | 'minimal' | 'full'
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  shadows: 'auto',
  viewDistance: 1,
  steering: 1,
  invertPitch: false,
  volume: 0.8,
  music: true,
  musicSource: 'procedural',
  lyrics: true,
  radioMix: 'all',
  musicVolume: 0.6,
  fov: 58,
  cameraShake: true,
  cameraStyle: 'steady',
  weather: 'snow',
  landingRing: true,
  landingAssist: true,
  npcs: true,
  raceAssist: true,
  hud: 'auto',
}

export function readSettings(): Settings {
  const settings = readJson<Settings>(KEYS.settings, { ...DEFAULT_SETTINGS })
  // Saves from before 0.8.7 stored shadows as a boolean: on becomes auto.
  const stored = settings.shadows as unknown
  if (stored === true) settings.shadows = 'auto'
  if (stored === false) settings.shadows = 'off'
  if (!['procedural', 'tracks', 'radio'].includes(settings.musicSource)) settings.musicSource = 'procedural'
  if (typeof settings.lyrics !== 'boolean') settings.lyrics = DEFAULT_SETTINGS.lyrics
  if (!['all', 'vocal', 'instrumental'].includes(settings.radioMix)) settings.radioMix = DEFAULT_SETTINGS.radioMix
  if (typeof settings.musicVolume !== 'number' || !Number.isFinite(settings.musicVolume)) settings.musicVolume = DEFAULT_SETTINGS.musicVolume
  if (!['auto', 'minimal', 'full'].includes(settings.hud)) settings.hud = DEFAULT_SETTINGS.hud
  if (!settings.weather || !['clear', 'snow', 'storm', 'flat'].includes(settings.weather)) settings.weather = 'snow'
  return settings
}

/** Whether the minimal in-run screen is used: speed and pause only, everything else when it matters. */
export function minimalHud(settings: Pick<Settings, 'hud'>, touch: boolean): boolean {
  return settings.hud === 'minimal' || (settings.hud === 'auto' && touch)
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
  /** Orthographic shadow box half-extent in metres (High reaches farther). */
  shadowRange: number
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
  /** Powder clouds (landings, crashes, deep turns). Each is a large transparent quad, so this is a fill-rate budget. */
  powderClouds: number
  /** Speed streaks at the edges of the view at high speed; 0 is off. */
  speedStreaks: number
  /** Deformable snow around the player: radius and vertex spacing in metres, or null (trenches only in the physics). */
  snowPatch: { radius: number; spacing: number } | null
  /** Village props: High full; Medium thinned cars/decks; Low hut only. */
  villageDetail: 'full' | 'mid' | 'lite'
  /** Canvas / map anisotropy (clamped to the renderer max at boot). */
  anisotropy: number
  /** Main crop forest plant density (apron has its own fields). */
  forestDensity: number
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: {
    level: 'low',
    npcCount: 4,
    pixelRatioMax: 1.5,
    antialias: false,
    shadowMapSize: 1024,
    shadowRange: 110,
    shadows: false,
    snowDetail: false,
    forest: { near: 150, mid: 600, midShare: 0.45, farShare: 0.1, compact: true, leanStandIns: true },
    apronForestDensity: 0.6,
    apronForestReach: 900,
    terrain: { near: 90, far: 150, cache: 24, coarseStride: 2 },
    sprayParticles: 900,
    snowflakes: 1600,
    trackResolution: 256,
    powderClouds: 48,
    speedStreaks: 120,
    snowPatch: null,
    villageDetail: 'lite',
    anisotropy: 2,
    forestDensity: 0.7,
  },
  medium: {
    level: 'medium',
    npcCount: 7,
    pixelRatioMax: 1.75,
    antialias: true,
    shadowMapSize: 2048,
    shadowRange: 110,
    shadows: true,
    snowDetail: true,
    forest: { near: 200, mid: 750, midShare: 0.55, farShare: 0.15, fullNear: 60, leanFrom: 260 },
    apronForestDensity: 0.8,
    apronForestReach: 1100,
    terrain: { near: 110, far: 180, cache: 36, coarseStride: 1 },
    sprayParticles: 1400,
    snowflakes: 2800,
    trackResolution: 512,
    powderClouds: 96,
    speedStreaks: 220,
    snowPatch: { radius: 8, spacing: 0.12 },
    villageDetail: 'mid',
    anisotropy: 4,
    forestDensity: 0.8,
  },
  high: {
    level: 'high',
    npcCount: 10,
    pixelRatioMax: 2,
    antialias: true,
    shadowMapSize: 2048,
    shadowRange: 160,
    shadows: true,
    snowDetail: true,
    forest: { near: 260, mid: 900, midShare: 0.7, farShare: 0.22, fullNear: 90, leanFrom: 340 },
    apronForestDensity: 1,
    apronForestReach: 1800,
    terrain: { near: 160, far: 250, cache: 56 },
    sprayParticles: 2048,
    snowflakes: 4200,
    trackResolution: 512,
    powderClouds: 160,
    speedStreaks: 360,
    snowPatch: { radius: 12, spacing: 0.1 },
    villageDetail: 'full',
    anisotropy: 8,
    forestDensity: 0.85,
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
    leanStandIns: base.leanStandIns,
    near: base.near * Math.min(1.2, viewDistance),
    mid: base.mid * viewDistance,
    midShare: Math.min(1, base.midShare * viewDistance),
    farShare: Math.min(1, base.farShare * viewDistance),
    fullNear: base.fullNear === undefined ? undefined : base.fullNear * Math.min(1.2, viewDistance),
    leanFrom: base.leanFrom === undefined ? undefined : base.leanFrom * viewDistance,
  }
}

type Changed = (settings: Settings, key: keyof Settings) => void

/** Settings panel: chip groups, sliders and toggles; calls `onChange` after every edit. */
export function createSettingsPanel(panel: HTMLElement, settings: Settings, appliedQuality: QualityLevel, onChange: Changed, autoReason = ''): void {
  const render = () => {
    panel.innerHTML =
      '<header><div><h2>Settings</h2><p class="menu-lead">Graphics, camera, sound and assists.</p></div>' +
      '<button type="button" class="close" aria-label="Close"><kbd>Esc</kbd><span>Back</span></button></header>'
    panel.querySelector('.close')!.addEventListener('click', () => (panel.hidden = true))
    const heading = (title: string) => {
      const element = document.createElement('h3')
      element.className = 'settings-section'
      element.textContent = title
      panel.append(element)
    }
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
    const slider = (title: string, key: 'viewDistance' | 'steering' | 'volume' | 'musicVolume' | 'fov', min: number, max: number, step: number, format: (v: number) => string) => {
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
      const fill = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`)
      fill()
      input.addEventListener('input', () => {
        settings[key] = Number(input.value)
        value.textContent = format(settings[key])
        fill()
        onChange(settings, key)
      })
      const wrap = document.createElement('div')
      wrap.className = 'slider'
      wrap.append(input, value)
      element.append(wrap)
    }
    const percent = (v: number) => `${Math.round(v * 100)}%`
    const pending = (settings.quality === 'auto' ? null : settings.quality) !== null && settings.quality !== appliedQuality
    heading('Graphics')
    chips('Quality', 'quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], `now ${appliedQuality}${settings.quality === 'auto' && autoReason ? `, for ${autoReason}` : ''}`)
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
    heading('Mountain')
    chips('Weather', 'weather', [
      ['clear', 'Bluebird'],
      ['snow', 'Light snow'],
      ['storm', 'Storm'],
      ['flat', 'Flat light'],
    ])
    chips('Other skiers', 'npcs', [[true, 'On'], [false, 'Off']])
    heading('Screen')
    chips('Screen while skiing', 'hud', [['auto', 'Auto'], ['minimal', 'Minimal'], ['full', 'Full']], 'Minimal shows speed and pause; the run, clock and map appear when they matter. Auto is minimal on touch screens')
    heading('Camera')
    slider('Field of view', 'fov', 48, 75, 1, (v) => `${v}°`)
    chips('Camera follow', 'cameraStyle', [['steady', 'Steady'], ['tight', 'Tight']], 'Steady looks down the hill, tight turns with the skis')
    chips('Camera shake & rumble', 'cameraShake', [[true, 'On'], [false, 'Off']])
    heading('Controls')
    slider('Steering sensitivity', 'steering', 0.5, 1.5, 0.05, percent)
    chips('Flip controls (up and down)', 'invertPitch', [[false, 'Normal'], [true, 'Inverted']])
    heading('Sound')
    slider('Volume', 'volume', 0, 1, 0.05, percent)
    chips('Music', 'music', [[true, 'On'], [false, 'Off']], 'Follows how you ski: calm on lifts, driving on steeps, punchy in the park')
    if (settings.music) {
      chips('Music source', 'musicSource', [['procedural', 'Procedural'], ['tracks', 'Tracks'], ['radio', 'Radio']], 'Radio plays Chair 9 FM songs on the music player')
      if (settings.musicSource === 'radio') chips('Radio songs', 'radioMix', [['all', 'Shuffle all'], ['vocal', 'Sing-along'], ['instrumental', 'Instrumental']])
      chips('Lyrics', 'lyrics', [[true, 'On'], [false, 'Off']], 'Sing-along lines on screen, by your head on lifts. Also on the player')
      slider('Music volume', 'musicVolume', 0, 1, 0.05, percent)
    }
    heading('Assists')
    chips('Landing marker', 'landingRing', [[true, 'On'], [false, 'Off']])
    chips('Landing assist', 'landingAssist', [[true, 'On'], [false, 'Off']], 'Lines up rotation near touchdown')
    chips('Racing line assist', 'raceAssist', [[true, 'On'], [false, 'Off']], 'Steer toward a gate and it helps you carve round the pole')
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
