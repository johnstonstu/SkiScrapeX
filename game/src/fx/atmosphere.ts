import { Color } from 'three';

/**
 * Aerial perspective shared by the snow shader and (through render/atmosphere.ts)
 * every built-in material: distant ground fades toward a haze that is thicker
 * low down and warmer toward the sun.
 */
/** Shared uniform values. Float32Arrays are passed by reference when three clones uniforms, so one write reaches every material. */
export const ATMOSPHERE = {
  /** Direction toward the sun (world). */
  sun: new Float32Array([0.67, 0.43, 0.6]),
  /** Sun colour times in-scatter strength. */
  sunColor: new Float32Array([1, 0.94, 0.84]),
  /** x: base height (m) where haze is at its stated density, y: height scale (m), z: sun glow, w: unused. */
  params: new Float32Array([0, 650, 0.55, 0]),
  /** Drifting cloud shadows: x strength (0 off), y scale (1/m), z/w drift offset (m). */
  clouds: new Float32Array([0, 1 / 700, 0, 0]),
}

/** Uniform entries for a ShaderMaterial that includes ATMOSPHERE_GLSL. */
export function atmosphereUniforms() {
  return {
    atmoSun: { value: ATMOSPHERE.sun },
    atmoSunColor: { value: ATMOSPHERE.sunColor },
    atmoParams: { value: ATMOSPHERE.params },
    atmoClouds: { value: ATMOSPHERE.clouds },
  }
}

/**
 * `atmosphere(color, world, haze, density)`: blend a lit colour toward the haze.
 * Expects `cameraPosition` (three declares it in every program). Materials that
 * never received the shared uniforms read zeros and fall back to plain exp fog.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 atmoSun;
uniform vec3 atmoSunColor;
uniform vec4 atmoParams;
uniform vec4 atmoClouds;
float atmoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atmoNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(atmoHash(i), atmoHash(i + vec2(1.0, 0.0)), f.x), mix(atmoHash(i + vec2(0.0, 1.0)), atmoHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** 1 in open sun, down to 1 - strength under a drifting cloud. Projected along the sun onto the ground. */
float cloudSun(vec3 world) {
  if (atmoClouds.x <= 0.0) return 1.0;
  vec2 p = (world.xz + atmoSun.xz / max(atmoSun.y, 0.2) * (900.0 - world.y) + atmoClouds.zw) * atmoClouds.y;
  float n = atmoNoise(p) * 0.65 + atmoNoise(p * 2.7 + 13.0) * 0.35;
  return 1.0 - atmoClouds.x * smoothstep(0.5, 0.72, n);
}
vec3 atmosphereHaze(vec3 dir, vec3 haze) {
  float s = max(dot(dir, atmoSun), 0.0);
  // Forward scatter: the air glows warm toward the sun and stays cool away from it.
  return haze + atmoSunColor * (pow(s, 5.0) * atmoParams.z + pow(s, 40.0) * atmoParams.z * 0.8);
}
float atmosphereAmount(vec3 world, float density) {
  vec3 ray = world - cameraPosition;
  float dist = length(ray);
  // Air is thicker low down: use the density at the ray's mean height.
  float scale = atmoParams.y > 0.0 ? atmoParams.y : 1e9;
  float h = 0.5 * (world.y + cameraPosition.y) - atmoParams.x;
  float thick = exp(-clamp(h, -600.0, 3000.0) / scale);
  return 1.0 - exp(-dist * density * thick);
}
vec3 atmosphere(vec3 color, vec3 world, vec3 haze, float density) {
  float amount = atmosphereAmount(world, density);
  vec3 dir = normalize(world - cameraPosition);
  return mix(color, atmosphereHaze(dir, haze), amount);
}
`


/** Haze colour and density, one value for every material that draws the ground. */
export const HAZE = {
  density: { value: 0.00008 },
  color: { value: new Color('#cfdde9') },
}
