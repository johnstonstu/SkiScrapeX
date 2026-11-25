/**
 * The material every skinned garment uses. A standard material plus:
 * - colour from three slots picked by the baked mask (R accent, G trim, B AO),
 * - smoother trim and a soft rim sheen, so fabric reads as fabric,
 * - wind flutter on loose fabric (hems, sleeves, baggy legs) at speed,
 * - snow: patches after a crash and powder caked up the legs, fading over time.
 * Garments of one rider share the weather uniforms; shader programs are shared
 * by every rider.
 */
import * as THREE from 'three'

export interface GarmentSurface {
  roughness: number
  metalness?: number
  /** Normal-map strength. */
  normal?: number
  /** Rim sheen strength. */
  sheen?: number
  /** Flutter amplitude in metres at full wind, and the rest-pose height band it fades out over. */
  loose?: number
  band?: [number, number]
  /** How much the forearms and cuffs flutter, 0..1 of `loose`. */
  sleeve?: number
}

/** Per-rider weather, shared by all of that rider's garments. */
export function createRiderWeather() {
  return {
    uTime: { value: 0 },
    /** 0..1 with speed. */
    uWind: { value: 0 },
    /** 0..1 snow left by crashes. */
    uSnowCrash: { value: 0 },
    /** Which way the rider hit the snow (rest-pose space), where crash snow collects. */
    uSnowSide: { value: new THREE.Vector3(0, 0, 1) },
    /** Powder caked up the legs: height above the boot top (m) and how much is left (0..1). */
    uSnowLegHeight: { value: 0 },
    uSnowLegAmount: { value: 0 },
  }
}
export type RiderWeather = ReturnType<typeof createRiderWeather>

const NOISE = /* glsl */ `
varying vec3 vRestPos;
varying vec3 vRestNormal;
float garmentHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float garmentNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( garmentHash( i ), garmentHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( garmentHash( i + vec3( 0, 1, 0 ) ), garmentHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( garmentHash( i + vec3( 0, 0, 1 ) ), garmentHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( garmentHash( i + vec3( 0, 1, 1 ) ), garmentHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
`

/** Top of the boots in the rest pose (the ankle joints), where leg snow starts. */
const BOOT_TOP = 0.26

export function createGarmentMaterial(
  maps: { mask: THREE.Texture | null; normal: THREE.Texture | null; normalScale: THREE.Vector2 },
  surface: GarmentSurface,
  weather: RiderWeather,
) {
  const material = new THREE.MeshStandardMaterial({
    map: maps.mask,
    normalMap: maps.normal,
    normalScale: maps.normalScale.clone().multiplyScalar(surface.normal ?? 1.25),
    roughness: surface.roughness,
    metalness: surface.metalness ?? 0,
  })
  const own = {
    uBase: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uTrim: { value: new THREE.Color() },
    uSheen: { value: surface.sheen ?? 0.28 },
    uLoose: { value: surface.loose ?? 0 },
    uBand: { value: new THREE.Vector2(...(surface.band ?? [0, 0.01])) },
    uSleeve: { value: surface.sleeve ?? 0 },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, own, weather)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE}
        uniform float uTime;
        uniform float uWind;
        uniform float uLoose;
        uniform vec2 uBand;
        uniform float uSleeve;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRestPos = position;
        vRestNormal = normal;`,
      )
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
        // Loose fabric ripples along its normal at speed: hems and baggy legs most, cuffs a little.
        float hemness = 1.0 - smoothstep( uBand.x, uBand.y, position.y );
        float sleeve = smoothstep( 0.32, 0.46, abs( position.x ) ) * uSleeve;
        float flutterAmp = uLoose * uWind * max( hemness, sleeve );
        float flutter = sin( uTime * 23.0 + position.y * 26.0 + position.x * 13.0 ) * 0.6 + sin( uTime * 37.0 + position.z * 31.0 ) * 0.4;
        transformed += normalize( objectNormal ) * flutterAmp * flutter;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${NOISE}
        uniform vec3 uBase;
        uniform vec3 uAccent;
        uniform vec3 uTrim;
        uniform float uSheen;
        uniform float uSnowCrash;
        uniform vec3 uSnowSide;
        uniform float uSnowLegHeight;
        uniform float uSnowLegAmount;`,
      )
      .replace(
        '#include <map_fragment>',
        `float snowCover = 0.0;
        #ifdef USE_MAP
          vec4 garmentMask = texture2D( map, vMapUv );
          vec3 garmentColour = mix( mix( uBase, uAccent, garmentMask.r ), uTrim, garmentMask.g );
          diffuseColor.rgb *= garmentColour * garmentMask.b;
          // Snow: crash patches gather on the side that hit the snow; powder cakes the legs
          // from the boots up with a ragged edge. Both thin out as their amounts fade.
          float snowNoise = garmentNoise( vRestPos * 15.0 ) * 0.62 + garmentNoise( vRestPos * 46.0 ) * 0.38;
          float side = dot( normalize( vRestNormal ), uSnowSide ) * 0.5 + 0.5;
          float crash = smoothstep( 0.98 - uSnowCrash * 0.45, 1.1 - uSnowCrash * 0.45, snowNoise * 0.75 + 0.25 * side * side );
          // Powdery fringe: fine grain breaks up the patch edges.
          crash *= smoothstep( 0.15, 0.55, garmentNoise( vRestPos * 140.0 ) + crash * 0.6 );
          float edge = ${BOOT_TOP.toFixed(2)} + uSnowLegHeight + ( snowNoise - 0.5 ) * 0.09;
          float legs = ( 1.0 - smoothstep( edge - 0.015, edge + 0.015, vRestPos.y ) ) * smoothstep( 1.32 * ( 1.0 - uSnowLegAmount ), 1.32 * ( 1.0 - uSnowLegAmount ) + 0.05, snowNoise + 0.3 ) * step( 0.001, uSnowLegAmount );
          snowCover = max( crash * step( 0.001, uSnowCrash ), legs );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.94, 0.99 ), snowCover );
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        #ifdef USE_MAP
          // Zips, piping and trim are smoother than the fabric around them; snow is matte.
          roughnessFactor = mix( roughnessFactor, 0.38, garmentMask.g * 0.7 );
          roughnessFactor = mix( roughnessFactor, 0.92, snowCover );
        #endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `float garmentRim = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
        outgoingLight += garmentRim * ( uSheen + snowCover * 0.2 ) * diffuseColor.rgb;
        #include <opaque_fragment>`,
      )
  }
  material.customProgramCacheKey = () => 'rider-garment'
  return { material, uniforms: own }
}
