import * as THREE from 'three'
import type { Lighting } from './lighting'

export type WeatherId = 'clear' | 'snow' | 'storm' | 'flat'

export interface WeatherPreset {
  id: WeatherId
  label: string
  /** Snowfall particle density 0..1. */
  snowDensity: number
  windEast: number
  windSouth: number
  sunIntensity: number
  hemiIntensity: number
  fogNear: number
  fogFar: number
  apply(lighting: Lighting): void
}

const PRESETS: Record<WeatherId, WeatherPreset> = {
  clear: {
    id: 'clear',
    label: 'Bluebird',
    snowDensity: 0.05,
    windEast: 0.15,
    windSouth: 0.05,
    sunIntensity: 2.15,
    hemiIntensity: 1.15,
    fogNear: 280,
    fogFar: 26000,
    apply(lighting) {
      lighting.sunDirection.set(0.67, 0.48, 0.56).normalize()
      lighting.sunColor.set('#fff2dc')
      lighting.skyColor.set('#a8c8ef')
      lighting.groundColor.set('#aeb4b6')
      lighting.fogColor.set('#d5e4f2')
      lighting.fogDensity = 0.00005
      lighting.horizon.set('#d2e4f5')
      lighting.zenith.set('#2f6bb8')
    },
  },
  snow: {
    id: 'snow',
    label: 'Light snow',
    snowDensity: 0.55,
    windEast: 0.6,
    windSouth: 0.3,
    sunIntensity: 2.0,
    hemiIntensity: 1.1,
    fogNear: 200,
    fogFar: 24000,
    apply(lighting) {
      lighting.sunDirection.set(0.67, 0.43, 0.6).normalize()
      lighting.sunColor.set('#fff0d7')
      lighting.skyColor.set('#b5d1ee')
      lighting.groundColor.set('#aeb4b6')
      lighting.fogColor.set('#cfdde9')
      lighting.fogDensity = 0.00008
      lighting.horizon.set('#cddfed')
      lighting.zenith.set('#3472b8')
    },
  },
  storm: {
    id: 'storm',
    label: 'Storm',
    snowDensity: 1,
    windEast: 1.4,
    windSouth: 0.9,
    sunIntensity: 0.85,
    hemiIntensity: 0.95,
    fogNear: 40,
    fogFar: 9000,
    apply(lighting) {
      lighting.sunDirection.set(0.45, 0.28, 0.84).normalize()
      lighting.sunColor.set('#d8dde4')
      lighting.skyColor.set('#8a97a6')
      lighting.groundColor.set('#9aa0a4')
      lighting.fogColor.set('#b7c0c8')
      lighting.fogDensity = 0.00028
      lighting.horizon.set('#b8c2cb')
      lighting.zenith.set('#5a6774')
    },
  },
  flat: {
    id: 'flat',
    label: 'Flat light',
    snowDensity: 0.2,
    windEast: 0.25,
    windSouth: 0.1,
    sunIntensity: 0.55,
    hemiIntensity: 1.35,
    fogNear: 120,
    fogFar: 16000,
    apply(lighting) {
      lighting.sunDirection.set(0.2, 0.72, 0.66).normalize()
      lighting.sunColor.set('#e8ecf0')
      lighting.skyColor.set('#c5ced6')
      lighting.groundColor.set('#c2c6c8')
      lighting.fogColor.set('#d4dade')
      lighting.fogDensity = 0.00014
      lighting.horizon.set('#d0d6db')
      lighting.zenith.set('#8a96a2')
    },
  },
}

export const WEATHER_PRESETS = PRESETS

export function weatherPreset(id: WeatherId): WeatherPreset {
  return PRESETS[id] ?? PRESETS.snow
}

/** Push a preset into the shared lighting object and live scene lights / sky / fog. */
export function applyWeather(
  id: WeatherId,
  lighting: Lighting,
  scene: THREE.Scene,
  sun: THREE.DirectionalLight,
  sky: THREE.Mesh,
): WeatherPreset {
  const preset = weatherPreset(id)
  preset.apply(lighting)
  sun.color.copy(lighting.sunColor)
  sun.intensity = preset.sunIntensity
  const hemi = scene.children.find((child): child is THREE.HemisphereLight => child instanceof THREE.HemisphereLight)
  if (hemi) {
    hemi.color.copy(lighting.skyColor)
    hemi.groundColor.copy(lighting.groundColor)
    hemi.intensity = preset.hemiIntensity
  }
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.copy(lighting.fogColor)
    scene.fog.near = preset.fogNear
    scene.fog.far = preset.fogFar
  }
  const material = sky.material as THREE.ShaderMaterial
  material.uniforms.uHorizon.value.copy(lighting.horizon)
  material.uniforms.uZenith.value.copy(lighting.zenith)
  material.uniforms.uSun.value.copy(lighting.sunDirection)
  material.uniforms.uSunColor.value.copy(lighting.sunColor)
  return preset
}
