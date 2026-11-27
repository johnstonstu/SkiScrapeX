import * as THREE from 'three'
import type { Lighting } from './lighting'
import { ATMOSPHERE, ATMOSPHERE_GLSL, HAZE, atmosphereUniforms } from '../fx/atmosphere'

/**
 * Aerial perspective and colour grade shared by every material.
 *
 * Distant ridges fade toward a blue-white haze that is thicker low in the
 * valleys and warmer when looking toward the sun, so depth reads on a white
 * mountain without extra passes. Three's own fog chunks are replaced once at
 * start-up, so every built-in material (trees, lifts, buildings, the rider,
 * sprites) and the snow shader use the same formula and meet the sky at the
 * horizon. The colour grade runs inside tone mapping: no extra render pass.
 */

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif
`
// World position from the view-space one (the view matrix is rigid), so instanced and skinned meshes need nothing extra.
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`
const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ATMOSPHERE_GLSL}
#endif
`
const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    // Cloud shadows dim everything a little (direct sun is most of the light on a clear day).
    gl_FragColor.rgb *= mix(1.0, cloudSun(vFogWorld), 0.6);
    gl_FragColor.rgb = atmosphere(gl_FragColor.rgb, vFogWorld, fogColor, fogDensity);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, length(vFogWorld - cameraPosition));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif
`

/**
 * Colour grade on top of Khronos PBR Neutral: Neutral keeps sunlit snow white
 * (ACES greyed it and pushed it yellow), then a gentle contrast curve around
 * mid grey, a little saturation for jackets, signs and trees, and cool shade
 * with warm light.
 */
const GRADE_GLSL = /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  color *= toneMappingExposure;
  color = NeutralToneMapping( color );
  // Split tone: shade toward blue, highlights a touch warm.
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color *= mix( vec3( 0.97, 0.988, 1.03 ), vec3( 1.006, 1.0, 0.99 ), smoothstep( 0.1, 0.75, luma ) );
  // Saturation.
  luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  color = max( mix( vec3( luma ), color, 1.08 ), 0.0 );
  // Contrast in perceptual space around mid grey, so whites stay white.
  vec3 p = pow( max( color, 0.0 ), vec3( 1.0 / 2.2 ) );
  p = clamp( p + ( p - 0.5 ) * 0.12 * ( 1.0 - p ), 0.0, 1.0 );
  return pow( p, vec3( 2.2 ) );
}
`

let installed = false
let cloudShadows = true

/** Cloud shadows cost a few noise lookups per pixel; Low leaves them out. */
export function setCloudShadows(on: boolean): void {
  cloudShadows = on
  if (!on) ATMOSPHERE.clouds[0] = 0
}

/** Drift the cloud shadows with the wind (m/s east and south, scaled up: clouds move faster than the snow). */
export function driftClouds(dt: number, windEast: number, windSouth: number): void {
  ATMOSPHERE.clouds[2] -= dt * (4 + windEast * 6)
  ATMOSPHERE.clouds[3] -= dt * (2 + windSouth * 6)
}

/** Replace three's fog chunks and add the custom grade. Call once, before any material compiles. */
export function installAtmosphere(): void {
  if (installed) return
  installed = true
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>
  chunks.fog_pars_vertex = FOG_PARS_VERTEX
  chunks.fog_vertex = FOG_VERTEX
  chunks.fog_pars_fragment = FOG_PARS_FRAGMENT
  chunks.fog_fragment = FOG_FRAGMENT
  chunks.tonemapping_pars_fragment = chunks.tonemapping_pars_fragment.replace(
    /vec3 CustomToneMapping\( vec3 color \) \{ return color; \}/,
    GRADE_GLSL,
  )
  // Built-in materials clone their ShaderLib uniforms; the Float32Array values stay shared.
  const extra = atmosphereUniforms()
  Object.assign(THREE.UniformsLib.fog, extra)
  for (const shader of Object.values(THREE.ShaderLib)) {
    if ('fogColor' in shader.uniforms) Object.assign(shader.uniforms, atmosphereUniforms())
  }
}

/** Haze density for a visibility distance: about 90% hazed out at `visibility` metres at the base height. */
export function hazeDensity(visibility: number): number {
  return 2.3 / Math.max(visibility, 1)
}

/** Copy the sun from the lighting into the shared uniforms. */
export function syncAtmosphere(lighting: Lighting, glow: number, clouds = 0): void {
  ATMOSPHERE.clouds[0] = cloudShadows ? clouds : 0
  const d = lighting.sunDirection
  ATMOSPHERE.sun.set([d.x, d.y, d.z])
  const c = lighting.sunColor
  ATMOSPHERE.sunColor.set([c.r * 0.55, c.g * 0.5, c.b * 0.38])
  ATMOSPHERE.params[2] = glow
}

/** Haze density and colour for the scene fog (built-in materials) and the snow materials together. */
export function setHaze(scene: THREE.Scene, density: number, color?: THREE.Color): void {
  if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(color ?? HAZE.color.value, density)
  scene.fog.density = density
  HAZE.density.value = density
  if (color) {
    scene.fog.color.copy(color)
    HAZE.color.value.copy(color)
  }
}

/**
 * A small image-based light from the day's sky and sunlit snow, for the
 * physically based materials (rider, lift steel, park rails, cars): jackets
 * pick up bounce light from the snow below and helmets, goggles and metal
 * reflect the sky instead of going flat grey. Rebuilt when the weather changes.
 */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSun: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
  }
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSun; uniform vec3 uSunColor;
        void main() {
          vec3 d = normalize(vDir);
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.5));
          // Snow below the horizon, brightest straight down where it is sunlit.
          vec3 ground = mix(uHorizon, uGround, smoothstep(0.0, 0.25, -d.y));
          vec3 col = d.y > 0.0 ? sky : ground;
          float s = max(dot(d, uSun), 0.0);
          col += uSunColor * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.25);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  )
  const envScene = new THREE.Scene()
  envScene.add(dome)
  let target: THREE.WebGLRenderTarget | null = null
  return {
    /** Rebuild from the current lighting; returns the texture for scene.environment. */
    update(lighting: Lighting, sunIntensity: number): THREE.Texture {
      uniforms.uZenith.value.copy(lighting.zenith)
      uniforms.uHorizon.value.copy(lighting.fogColor)
      // Sunlit snow: near white, a little warm in sun, greyer in flat light.
      uniforms.uGround.value.setRGB(0.92, 0.94, 0.96).multiplyScalar(0.55 + 0.25 * Math.min(1, sunIntensity / 2))
      uniforms.uSun.value.copy(lighting.sunDirection).normalize()
      uniforms.uSunColor.value.copy(lighting.sunColor).multiplyScalar(Math.min(1, sunIntensity / 2))
      target?.dispose()
      target = pmrem.fromScene(envScene, 0, 0.1, 10)
      return target.texture
    },
    dispose() {
      target?.dispose()
      pmrem.dispose()
      dome.geometry.dispose()
      ;(dome.material as THREE.Material).dispose()
    },
  }
}
