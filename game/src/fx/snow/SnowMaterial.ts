import {
  Color,
  DataTexture,
  FrontSide,
  NoColorSpace,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type ColorRepresentation,
  type IUniform,
  type Texture,
} from 'three';

export interface SnowMaterialOptions {
  mask?: Texture | null;
  /** World XZ minimum of the mask, metres. */
  maskOrigin?: { x: number; z: number };
  /** World size of the mask, metres. */
  maskSize?: { x: number; z: number };
  /** Fallback groom direction in world XZ when the mask is off. */
  groomDirection?: { x: number; z: number };
  /** Direction toward the sun. */
  sunDirection?: Vector3;
  sunColor?: ColorRepresentation;
  skyColor?: ColorRepresentation;
  groundColor?: ColorRepresentation;
  fogColor?: ColorRepresentation;
  fogDensity?: number;
  slopeStartDeg?: number;
  slopeFullDeg?: number;
  sparkle?: number;
  /** Metres between corduroy ridges. */
  corduroySpacing?: number;
  /** Ridge height in metres. */
  corduroyDepth?: number;
}

interface SnowUniforms {
  uSnowColor: { value: Color };
  uPowderColor: { value: Color };
  uIceColor: { value: Color };
  uRockColor: { value: Color };
  uRockDark: { value: Color };
  uTreeColor: { value: Color };
  uSunDirection: { value: Vector3 };
  uSunColor: { value: Color };
  uSkyColor: { value: Color };
  uGroundColor: { value: Color };
  uFogColor: { value: Color };
  uFogDensity: { value: number };
  uSlopeStart: { value: number };
  uSlopeFull: { value: number };
  uSlopeRockEnabled: { value: number };
  uSparkle: { value: number };
  uCordSpacing: { value: number };
  uCordDepth: { value: number };
  uMask: { value: Texture };
  uMaskOrigin: { value: Vector2 };
  uMaskSize: { value: Vector2 };
  uHasMask: { value: number };
  uMaskEnabled: { value: number };
  uGroomDir: { value: Vector2 };
  uTrack: { value: Texture };
  uTrackOrigin: { value: Vector2 };
  uTrackSize: { value: number };
  uTrackResolution: { value: number };
  uHasTrack: { value: number };
  uCanopy: { value: Texture };
  uCanopyOrigin: { value: Vector2 };
  uCanopySize: { value: Vector2 };
  uHasCanopy: { value: number };
  uGroomTex: { value: Texture };
  uHasGroomTex: { value: number };
  uDetailCentre: { value: Vector2 };
  uDetailMorph: { value: Vector2 };
  uDetailMask: { value: Texture };
  uDetailMaskRect: { value: Vector4 };
  uDetailLimit: { value: Vector2 };
  uHasDetail: { value: number };
  uPatchCentre: { value: Vector2 };
  uPatchRadius: { value: number };
  uHasPatch: { value: number };
}

const vertexShader = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHoleable;
varying float vTerrain;
// x: detail chunk vertex (morphs toward aBase), y: coarse terrain (cut where detail draws).
attribute vec2 aFlags;
// Coarse surface under a detail vertex: height, then normal.
attribute vec4 aBase;
uniform vec2 uDetailCentre;
uniform vec2 uDetailMorph;

void main() {
  vec3 p = position;
  vec3 n = normal;
  if (aFlags.x > 0.5) {
    float morph = smoothstep(uDetailMorph.x, uDetailMorph.y, distance(position.xz, uDetailCentre));
    p.y = mix(position.y, aBase.x, morph);
    n = normalize(mix(normal, aBase.yzw, morph));
  }
  vHoleable = aFlags.y;
  vTerrain = max(aFlags.x, aFlags.y);
  vec4 worldPosition = modelMatrix * vec4(p, 1.0);
  vWorld = worldPosition.xyz;
  vNormal = mat3(modelMatrix) * n;
  vec3 transformedNormal = normalMatrix * n;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

/**
 * Vertex program for the deformable snow patch (SNOW_PATCH). The patch is a fine
 * grid that follows the player: each vertex rebuilds the terrain height from the
 * 2 m height texture on the same triangle split as the terrain mesh, so it meets
 * the terrain exactly, then adds the trench and berm offsets, faded to zero at
 * the rim.
 */
export const snowPatchVertexShader = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHoleable;
varying float vTerrain;
uniform sampler2D uHeights;
uniform vec2 uHeightsSize;
uniform float uHeightsStep;
uniform vec2 uPatchOrigin;
uniform vec2 uPatchCentre;
uniform float uPatchRadius;
uniform sampler2D uDeform;
uniform vec4 uDeformRect;
uniform vec2 uDeformRange;

float ground(vec2 p) {
  vec2 g = clamp(p / uHeightsStep, vec2(0.0), uHeightsSize - 1.001);
  ivec2 c = ivec2(min(floor(g), uHeightsSize - 2.0));
  vec2 f = g - vec2(c);
  float a = texelFetch(uHeights, c, 0).r;
  float b = texelFetch(uHeights, c + ivec2(1, 0), 0).r;
  float l = texelFetch(uHeights, c + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeights, c + ivec2(1, 1), 0).r;
  // NE to SW split, as in world/terrainGrid.ts.
  if (f.x + f.y <= 1.0) return a + f.x * (b - a) + f.y * (l - a);
  return d - (1.0 - f.x) * (d - l) - (1.0 - f.y) * (d - b);
}

float offsetAt(vec2 p) {
  vec2 uv = (p - uDeformRect.xy) / uDeformRect.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  float rim = 1.0 - smoothstep(uPatchRadius - 2.5, uPatchRadius - 0.6, distance(p, uPatchCentre));
  return (texture2D(uDeform, uv).r * (uDeformRange.x + uDeformRange.y) - uDeformRange.x) * rim;
}

float surface(vec2 p) {
  return ground(p) + offsetAt(p);
}

void main() {
  vec2 p = uPatchOrigin + position.xz;
  float h = surface(p);
  float e = 0.12;
  vec3 n = normalize(vec3(surface(p - vec2(e, 0.0)) - surface(p + vec2(e, 0.0)), 2.0 * e, surface(p - vec2(0.0, e)) - surface(p + vec2(0.0, e))));
  vHoleable = 0.0;
  vTerrain = 0.0;
  vec4 worldPosition = vec4(p.x, h, p.y, 1.0);
  vWorld = worldPosition.xyz;
  vNormal = n;
  vec3 transformedNormal = (viewMatrix * vec4(n, 0.0)).xyz;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHoleable;
varying float vTerrain;
uniform vec2 uPatchCentre;
uniform float uPatchRadius;
uniform float uHasPatch;
uniform sampler2D uDetailMask;
uniform vec4 uDetailMaskRect;
uniform vec2 uDetailLimit;
uniform float uHasDetail;

uniform vec3 uSnowColor;
uniform vec3 uPowderColor;
uniform vec3 uIceColor;
uniform vec3 uRockColor;
uniform vec3 uRockDark;
uniform vec3 uTreeColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uSlopeStart;
uniform float uSlopeFull;
uniform float uSlopeRockEnabled;
uniform float uSparkle;
uniform float uCordSpacing;
uniform float uCordDepth;
uniform sampler2D uMask;
uniform vec2 uMaskOrigin;
uniform vec2 uMaskSize;
uniform float uHasMask;
uniform float uMaskEnabled;
uniform vec2 uGroomDir;
uniform sampler2D uTrack;
uniform vec2 uTrackOrigin;
uniform float uTrackSize;
uniform float uTrackResolution;
uniform float uHasTrack;
uniform sampler2D uCanopy;
uniform vec2 uCanopyOrigin;
uniform vec2 uCanopySize;
uniform float uHasCanopy;
uniform sampler2D uGroomTex;
uniform float uHasGroomTex;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Value noise on a rotated, warped domain. Thresholding plain value noise leaves
// blobs lined up with the world axes, which reads as tiles; this does not.
const mat2 ROT_A = mat2(0.8, -0.6, 0.6, 0.8);
const mat2 ROT_B = mat2(0.28, 0.96, -0.96, 0.28);
float patchFbm(vec2 p) {
#ifdef SNOW_DETAIL
  vec2 w = p + (vec2(valueNoise(ROT_B * p * 0.02), valueNoise(ROT_B * p * 0.02 + 5.2)) - 0.5) * 24.0;
  return valueNoise(ROT_A * w * 0.045) * 0.5 + valueNoise(ROT_B * w * 0.13 + 11.0) * 0.3 + valueNoise(ROT_A * ROT_B * w * 0.41 + 29.0) * 0.2;
#else
  // Low graphics: two octaves, no warp.
  return valueNoise(ROT_A * p * 0.045) * 0.5 + valueNoise(ROT_B * p * 0.13 + 11.0) * 0.3 + 0.1;
#endif
}

void main() {
  // Deformable snow patch: it replaces the terrain inside a circle round the player.
#ifdef SNOW_PATCH
  if (distance(vWorld.xz, uPatchCentre) > uPatchRadius) discard;
#else
  if (uHasPatch > 0.5 && vTerrain > 0.5 && distance(vWorld.xz, uPatchCentre) < uPatchRadius) discard;
#endif
  if (vHoleable > 0.5 && uHasDetail > 0.5) {
    vec2 cellUv = (vWorld.xz - uDetailMaskRect.xy) / uDetailMaskRect.zw;
    if (all(greaterThanEqual(cellUv, vec2(0.0))) && all(lessThan(cellUv, vec2(1.0))) && all(lessThanEqual(vWorld.xz, uDetailLimit)) && texture2D(uDetailMask, cellUv).r > 0.5) discard;
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDirection);
  vec3 H = normalize(L + V);

  float slopeDeg = degrees(acos(clamp(N.y, 0.0, 1.0)));

  float id = 0.0;
  vec2 groom = uGroomDir;
  vec2 maskUv = (vWorld.xz - uMaskOrigin) / max(uMaskSize, vec2(1.0));
  vec4 maskSample = texture2D(uMask, clamp(maskUv, 0.0, 1.0));
  if (uHasMask > 0.5 && uMaskEnabled > 0.5) {
    id = floor(maskSample.r * 255.0 / 32.0 + 0.5);
    // Park snow looks like a groomer.
    if (id > 4.5) id = 0.0;
    float ang = maskSample.g * 6.28318530718;
    groom = vec2(cos(ang), sin(ang));
  }

  float groomed = 1.0 - step(0.5, abs(id - 0.0));
  float powder = 1.0 - step(0.5, abs(id - 1.0));
  float ice = 1.0 - step(0.5, abs(id - 2.0));
  if (uHasGroomTex > 0.5 && uMaskEnabled > 0.5) {
    // Soft run edges: a linear-filtered groomed share instead of the nearest-texel id.
    // The edge is warped by about 2 m of noise so run borders wander instead of ruling straight lines.
#ifdef SNOW_DETAIL
    vec2 warp = (vec2(valueNoise(vWorld.xz * 0.09), valueNoise(vWorld.xz * 0.09 + 17.3)) - 0.5) * 4.0 / max(uMaskSize, vec2(1.0));
#else
    vec2 warp = vec2(0.0);
#endif
    float g = smoothstep(0.22, 0.78, texture2D(uGroomTex, clamp(maskUv + warp, 0.0, 1.0)).r);
    float other = 1.0 - groomed - powder;
    groomed = g * (1.0 - other);
    powder = (1.0 - g) * (1.0 - other);
  }
  float rockMask = 1.0 - step(0.5, abs(id - 3.0));
  float tree = 1.0 - step(0.5, abs(id - 4.0));

  // Canopy cover (r), loose snow depth (g) and wind exposure (b), linear filtered at 5 m.
  vec2 cuv = (vWorld.xz - uCanopyOrigin) / max(uCanopySize, vec2(1.0));
  vec4 canopyTex = texture2D(uCanopy, clamp(cuv, 0.0, 1.0)) * uHasCanopy;
  vec2 snowpack = canopyTex.rg;

  // Patch edges: fractal noise breaks the smooth 5 m fields into ragged, organic shapes,
  // so crust, rock and snow interlock instead of following texels.
  float patchNoise = patchFbm(vWorld.xz);
  float patchJitter = patchNoise - 0.5;

  // Summit wind-scour off-piste: crust first, rock through it on the most exposed ridges.
  // Thresholds match SCOUR (crust 0.35, rock 0.62) in world/exposure.ts so the skis feel what the eye sees.
  float scourable = 1.0 - groomed;
  float exposure = canopyTex.b + patchJitter * 0.3;
  float crust = smoothstep(0.32, 0.38, exposure) * scourable;
  // Rock breaks through as clusters of boulders on gentle ground and as slabs on steeper ground.
  float rockBreak = valueNoise(ROT_B * vWorld.xz * 0.38 + 7.0) * 0.65 + valueNoise(ROT_A * vWorld.xz * 1.3 + 2.0) * 0.35;
  float rockSteep = smoothstep(14.0, 34.0, slopeDeg);
  float scourRockZone = smoothstep(0.585, 0.655, exposure + (rockBreak - 0.5) * 0.2) * scourable;
  float scourRock = scourRockZone * smoothstep(0.44, 0.54, rockBreak + rockSteep * 0.35);
  ice = max(ice, crust);
  powder *= 1.0 - crust;

  // Steep faces: rock in ragged outcrops with snow between them, not one smooth fade.
  float slopeShare = smoothstep(uSlopeStart, max(uSlopeFull, uSlopeStart + 0.5), slopeDeg + patchJitter * 14.0);
  float slopeRock = smoothstep(0.3, 0.7, slopeShare + patchJitter * 0.45) * uSlopeRockEnabled;
  float rockMix = max(max(rockMask, scourRock), slopeRock);
  float snowMask = 1.0 - rockMix;

  vec2 tuv = (vWorld.xz - uTrackOrigin) / max(uTrackSize, 1.0);
  float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
  float texel = 1.0 / max(uTrackResolution, 1.0);
  float dep = texture2D(uTrack, clamp(tuv, 0.0, 1.0)).r * inside * uHasTrack;
  float depX = texture2D(uTrack, clamp(tuv + vec2(texel, 0.0), 0.0, 1.0)).r * inside * uHasTrack;
  float depZ = texture2D(uTrack, clamp(tuv + vec2(0.0, texel), 0.0, 1.0)).r * inside * uHasTrack;
  float metresPerTexel = uTrackSize / max(uTrackResolution, 1.0);

  float grain = valueNoise(vWorld.xz * 0.62);
  float field = valueNoise(vWorld.xz * 0.028);
  float puff = valueNoise(vWorld.xz * 0.16);

  vec3 snow = uSnowColor * mix(0.93, 1.02, grain) * mix(0.97, 1.03, field);
  vec3 powderCol = uPowderColor * mix(0.9, 1.08, puff);
  // Wind crust: grey-white with a cold cast; glazed patches read a little bluer.
  float glaze = smoothstep(0.62, 0.82, valueNoise(ROT_A * vWorld.xz * 0.19 + 41.0)) * ice;
  vec3 iceCol = uIceColor * mix(0.95, 1.02, grain) * mix(0.97, 1.02, field);
  iceCol = mix(iceCol, uIceColor * vec3(0.86, 0.93, 1.0), glaze * 0.7);
  // Small stones and grit show through the crust around the outcrops.
  float grit = step(0.93, hash12(floor(vWorld.xz * 2.5))) * scourRockZone * (1.0 - smoothstep(12.0, 40.0, length(cameraPosition - vWorld)));
  iceCol = mix(iceCol, uRockDark * 1.2, grit * 0.6);
  float strata = valueNoise(vec2(vWorld.y * 0.42, vWorld.x * 0.04 + vWorld.z * 0.015));
  float cracks = smoothstep(0.55, 0.82, valueNoise(vWorld.xz * 0.11 + vWorld.y * 0.18));
  vec3 rockCol = mix(uRockDark, uRockColor, strata);
  rockCol *= mix(1.0, 0.68, cracks);
  // Snow sits on flatter ledges and in the cracks, so outcrops look dusted, not painted on.
  float ledge = smoothstep(0.6, 0.9, N.y) * smoothstep(0.3, 0.7, valueNoise(ROT_B * vWorld.xz * 0.6 + 3.0));
  float dusting = max(ledge * 0.85, cracks * 0.4 * smoothstep(0.4, 0.8, N.y));
  rockCol = mix(rockCol, uSnowColor * 0.9, dusting);
  float canopy = valueNoise(vWorld.xz * 0.23);
  vec3 treeCol = uTreeColor * mix(0.62, 1.0, canopy);

  float camDist = length(cameraPosition - vWorld);
  float near = 1.0 - smoothstep(25.0, 70.0, camDist);
  // Broad brightness drift so distant slopes are not one flat tone.
#ifdef SNOW_DETAIL
  snow *= mix(0.955, 1.03, valueNoise(vWorld.xz * 0.006 + 5.0));
#endif
  vec3 albedo = snow;
  albedo = mix(albedo, powderCol, powder);
  albedo = mix(albedo, iceCol, ice);
  albedo = mix(albedo, treeCol, tree);

  // Smooth canopy cover: snow in the forest sits in shade and collects debris.
  float canopyShade = snowpack.r * (1.0 - groomed * uHasMask);
  // Apex supplies visual depth in green. An apron or standalone slope has no depth field.
  float loose = mix(0.5, smoothstep(0.14, 0.86, snowpack.g), step(0.01, snowpack.g));
  albedo *= mix(vec3(1.0), vec3(0.8, 0.85, 0.9), canopyShade);
  albedo *= mix(vec3(1.0), mix(vec3(0.94, 0.967, 0.985), vec3(1.035, 1.023, 1.012), loose), powder * snowMask);
  // Needles and twigs dropped on the snow under the trees, close up only.
#ifdef SNOW_DETAIL
  float debris = step(0.94, hash12(floor(vWorld.xz * 9.0))) * smoothstep(0.35, 0.8, canopyShade) * near * (1.0 - tree);
  albedo = mix(albedo, vec3(0.36, 0.31, 0.26), debris * 0.55);
#endif

  vec2 perp = vec2(-groom.y, groom.x);
  float freq = 6.28318530718 / max(uCordSpacing, 0.05);
  float phase = dot(vWorld.xz, perp) * freq;
  phase += (valueNoise(vWorld.xz * 0.08) - 0.5) * 0.7;
  float aa = 1.0 - smoothstep(0.65, 2.4, fwidth(phase));
  float broken = smoothstep(0.02, 0.28, dep);
  // Traffic wears patches of a groomer: the corduroy fades and faint streaks run along the run.
#ifdef SNOW_DETAIL
  float worn = groomed * smoothstep(0.55, 0.8, valueNoise(vWorld.xz * 0.045 + 3.0));
  float streak = valueNoise(vec2(dot(vWorld.xz, perp) * 2.4, dot(vWorld.xz, groom) * 0.07));
  albedo *= mix(1.0, mix(0.92, 1.0, streak), worn * snowMask);
#else
  float worn = 0.0;
#endif
  float cordMask = groomed * snowMask * step(0.0001, uCordDepth) * aa * (1.0 - broken) * (1.0 - 0.75 * worn);
  float cordJitter = phase - dot(vWorld.xz, perp) * freq;
  float wave = sin(phase) * 0.78 + sin(phase * 0.5 + 1.3) * 0.22;
  vec2 tilt = perp * cos(phase);
  if (uHasMask > 0.5 && uMaskEnabled > 0.5 && cordMask > 0.0) {
    // Where runs with different grooming directions meet, cross-fade the corduroy of the
    // four nearest mask texels (seam wobbled by noise) instead of switching per texel.
    vec2 maskRes = vec2(textureSize(uMask, 0));
    vec2 seam = (vec2(valueNoise(ROT_A * vWorld.xz * 0.21), valueNoise(ROT_B * vWorld.xz * 0.21 + 3.7)) - 0.5) * 1.6;
    vec2 st = maskUv * maskRes - 0.5 + seam;
    vec2 cell = floor(st);
    vec2 f = smoothstep(0.15, 0.85, fract(st));
    float total = 0.0;
    float waveSum = 0.0;
    vec2 tiltSum = vec2(0.0);
    for (int k = 0; k < 4; k++) {
      vec2 o = vec2(float(k - (k / 2) * 2), float(k / 2));
      vec4 m = texture2D(uMask, clamp((cell + o + 0.5) / maskRes, 0.0, 1.0));
      float mid = floor(m.r * 255.0 / 32.0 + 0.5);
      float w = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y);
      w *= (mid < 0.5 || mid > 4.5) ? 1.0 : 0.001;
      float a = m.g * 6.28318530718;
      vec2 p2 = vec2(-sin(a), cos(a));
      float ph = dot(vWorld.xz, p2) * freq + cordJitter;
      waveSum += w * (sin(ph) * 0.78 + sin(ph * 0.5 + 1.3) * 0.22);
      tiltSum += w * p2 * cos(ph);
      total += w;
    }
    wave = waveSum / max(total, 1e-4);
    tilt = tiltSum / max(total, 1e-4);
  }
  vec3 Np = N + vec3(tilt.x, 0.0, tilt.y) * (freq * uCordDepth * cordMask);
  albedo *= mix(1.0, mix(0.88, 1.0, wave * 0.5 + 0.5), cordMask);

  // Low wind ripples break up open powder; tracks and shelter flatten them.
  vec2 wind = vec2(0.87, 0.49);
  float driftPhase = dot(vWorld.xz, wind) * 1.75 + puff * 5.0 + field * 9.0;
  float drift = powder * snowMask * (1.0 - canopyShade) * (1.0 - broken) * mix(0.55, 1.45, loose);
  drift *= (1.0 - smoothstep(0.6, 2.2, fwidth(driftPhase))) * smoothstep(0.25, 0.75, field);
  Np -= vec3(wind.x, 0.0, wind.y) * (0.095 * cos(driftPhase) * drift);
  // Sastrugi on the crust: wind-carved ridges that run with the wind and wander along their length.
  vec2 windPerp = vec2(-wind.y, wind.x);
  float sasPhase = dot(vWorld.xz, windPerp) * 1.4 + valueNoise(vec2(dot(vWorld.xz, windPerp) * 0.3, dot(vWorld.xz, wind) * 0.06)) * 7.0;
  float sasAA = 1.0 - smoothstep(0.6, 2.2, fwidth(sasPhase));
  float sastrugi = ice * snowMask * (1.0 - broken) * sasAA * (1.0 - glaze * 0.6);
  Np -= vec3(windPerp.x, 0.0, windPerp.y) * (0.13 * cos(sasPhase) * sastrugi);
  albedo *= mix(1.0, mix(0.95, 1.02, sin(sasPhase) * 0.5 + 0.5), sastrugi);

  // A skied path breaks the corduroy and settles into a soft trench.
  albedo = mix(albedo, albedo * vec3(0.78, 0.84, 0.9), broken * snowMask);
  vec2 grad = vec2(depX - dep, depZ - dep) / max(metresPerTexel, 0.001);
  Np -= vec3(grad.x, 0.0, grad.y) * 0.45 * snowMask;
  // Fine relief near the camera: wind-pressed bumps on groomers, softer lumps in powder.
#ifdef SNOW_DETAIL
  if (near > 0.0) {
    vec2 q = vWorld.xz;
    float e = 0.15;
    float n0 = valueNoise(q * 0.9) + 0.5 * valueNoise(q * 2.3 + 7.0);
    float nx = valueNoise((q + vec2(e, 0.0)) * 0.9) + 0.5 * valueNoise((q + vec2(e, 0.0)) * 2.3 + 7.0);
    float nz = valueNoise((q + vec2(0.0, e)) * 0.9) + 0.5 * valueNoise((q + vec2(0.0, e)) * 2.3 + 7.0);
    float amp = (0.03 * groomed + 0.085 * powder + 0.05 * tree) * snowMask * near * (1.0 - 0.5 * broken);
    Np -= vec3(nx - n0, 0.0, nz - n0) / e * amp;
  }
#endif
  float rockNoise = valueNoise(vWorld.xz * 0.35 + vWorld.y);
  vec3 rockN = normalize(Np + vec3(rockNoise - 0.5, 0.0, hash12(vWorld.xz) - 0.5));
  Np = normalize(mix(Np, rockN, rockMix * 0.55));

  albedo = mix(albedo, rockCol, rockMix);

  float wrap = mix(0.34, 0.12, rockMix);
  wrap = mix(wrap, 0.52, powder);
  wrap = mix(wrap, 0.2, ice);
  // Sun shadow from the scene's directional light, when the renderer has shadows on.
  float sunShadow = 1.0;
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    DirectionalLightShadow sunInfo = directionalLightShadows[ 0 ];
    sunShadow = getShadow( directionalShadowMap[ 0 ], sunInfo.shadowMapSize, sunInfo.shadowIntensity, sunInfo.shadowBias, sunInfo.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  #endif

  float ndl = dot(Np, L);
  float diff = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0) * mix(0.18, 1.0, sunShadow);
  float hemi = clamp(Np.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi);
  vec3 shadeTint = mix(vec3(0.68, 0.8, 0.98), vec3(1.0), diff);
  shadeTint = mix(shadeTint, vec3(1.0), rockMix);

  float shininess = mix(32.0, 10.0, powder);
  shininess = mix(shininess, 56.0, ice);
  shininess = mix(shininess, 6.0, rockMix);
  float ndh = clamp(dot(Np, H), 0.0, 1.0);
  float spec = pow(ndh, shininess) * mix(0.14, 0.03, powder);
  spec = mix(spec, pow(ndh, 56.0) * 0.2 + pow(ndh, 180.0) * 0.55 * glaze, ice);
  spec *= 1.0 - rockMix * 0.85;
  spec *= 1.0 - tree * 0.45;

  float fres = pow(1.0 - clamp(dot(Np, V), 0.0, 1.0), 3.0);
  vec3 sheen = uSkyColor * fres * 0.16 * snowMask * (1.0 - ice * 0.3);

  float dist = length(cameraPosition - vWorld);
  float sparkle = 0.0;
  if (uSparkle > 0.001) {
    float scale = mix(26.0, 11.0, powder);
    vec2 cell = floor(vWorld.xz * scale);
    float gate = step(0.86, hash12(cell));
    vec3 micro = normalize(vec3(hash12(cell + 3.1) - 0.5, 1.45, hash12(cell + 8.7) - 0.5));
    float glint = pow(clamp(dot(micro, H), 0.0, 1.0), mix(42.0, 96.0, ice));
    float distFade = smoothstep(48.0, 12.0, dist);
    sparkle = glint * gate * uSparkle * distFade * snowMask * (1.0 - tree * 0.88) * (1.0 - powder * 0.35);
  }

  vec3 color = albedo * shadeTint * (ambient * 0.58 + uSunColor * diff * 1.12);
  color += uSunColor * (spec + sparkle) * sunShadow;
  color += sheen;
  color += uSunColor * powder * diff * 0.05;

  float fog = 1.0 - exp(-dist * uFogDensity);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function dummyTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array([0, 64, 0, 255]), 1, 1);
  texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function unitDirection(x: number, z: number, out: Vector2): void {
  const length = Math.hypot(x, z);
  if (length < 1e-5) out.set(0, 1);
  else out.set(x / length, z / length);
}

/**
 * One-pass snow surface for any heightfield mesh.
 * Lighting is in the shader (sun + sky + ground bounce), so the mesh does not
 * need scene lights. Mask and track textures are sampled in world XZ metres.
 */
/**
 * Close-up snow detail (wandering run edges, fine relief, worn groomer
 * patches, forest debris): about a dozen extra noise lookups per pixel, so
 * low-end graphics leave it out. Set before the materials are built.
 */
let snowDetail = true
export function setSnowDetail(on: boolean): void {
  snowDetail = on
}

export class SnowMaterial extends ShaderMaterial {
  private readonly u: SnowUniforms;
  private readonly dummyMask: DataTexture;
  private readonly dummyTrack: DataTexture;

  constructor(options: SnowMaterialOptions = {}) {
    const groom = new Vector2(0, 1);
    unitDirection(options.groomDirection?.x ?? 0, options.groomDirection?.z ?? 1, groom);
    const sun = options.sunDirection?.clone().normalize() ?? new Vector3(-0.55, 0.42, 0.72).normalize();
    const maskDummy = dummyTexture();
    const trackDummy = dummyTexture();
    const uniforms: SnowUniforms = {
      uSnowColor: { value: new Color('#e7eef3') },
      uPowderColor: { value: new Color('#f4efe2') },
      uIceColor: { value: new Color('#d9e3ea') },
      uRockColor: { value: new Color('#77756f') },
      uRockDark: { value: new Color('#3a3936') },
      uTreeColor: { value: new Color('#6d848c') },
      uSunDirection: { value: sun },
      uSunColor: { value: new Color(options.sunColor ?? '#ffe6c2') },
      uSkyColor: { value: new Color(options.skyColor ?? '#c5d6e4') },
      uGroundColor: { value: new Color(options.groundColor ?? '#b7b8b0') },
      uFogColor: { value: new Color(options.fogColor ?? '#d5e2ea') },
      uFogDensity: { value: options.fogDensity ?? 0.0032 },
      uSlopeStart: { value: options.slopeStartDeg ?? 36 },
      uSlopeFull: { value: options.slopeFullDeg ?? 52 },
      uSlopeRockEnabled: { value: 1 },
      uSparkle: { value: options.sparkle ?? 0.45 },
      uCordSpacing: { value: options.corduroySpacing ?? 0.22 },
      uCordDepth: { value: options.corduroyDepth ?? 0.011 },
      uMask: { value: options.mask ?? maskDummy },
      uMaskOrigin: { value: new Vector2(options.maskOrigin?.x ?? 0, options.maskOrigin?.z ?? 0) },
      uMaskSize: { value: new Vector2(options.maskSize?.x ?? 1, options.maskSize?.z ?? 1) },
      uHasMask: { value: options.mask ? 1 : 0 },
      uMaskEnabled: { value: 1 },
      uGroomDir: { value: groom },
      uTrack: { value: trackDummy },
      uTrackOrigin: { value: new Vector2() },
      uTrackSize: { value: 1 },
      uTrackResolution: { value: 1 },
      uHasTrack: { value: 0 },
      uCanopy: { value: trackDummy },
      uCanopyOrigin: { value: new Vector2() },
      uCanopySize: { value: new Vector2(1, 1) },
      uHasCanopy: { value: 0 },
      uGroomTex: { value: trackDummy },
      uHasGroomTex: { value: 0 },
      uDetailCentre: { value: new Vector2() },
      uDetailMorph: { value: new Vector2(1e6, 2e6) },
      uDetailMask: { value: trackDummy },
      uDetailMaskRect: { value: new Vector4(0, 0, 1, 1) },
      uDetailLimit: { value: new Vector2(1e9, 1e9) },
      uHasDetail: { value: 0 },
      uPatchCentre: { value: new Vector2() },
      uPatchRadius: { value: 0 },
      uHasPatch: { value: 0 },
    };

    super({
      name: 'snow',
      // Light uniforms are only read for the directional shadow map.
      lights: true,
      uniforms: { ...UniformsUtils.clone(UniformsLib.lights), ...(uniforms as unknown as Record<string, IUniform>) },
      vertexShader,
      fragmentShader,
      defines: snowDetail ? { SNOW_DETAIL: '' } : {},
      side: FrontSide,
      toneMapped: true,
    });
    // Meshes without these attributes (moguls, coarse-only terrain) must read
    // zeros, not a generic value another program left in the slot.
    Object.assign(this.defaultAttributeValues as Record<string, number[]>, { aFlags: [0, 0], aBase: [0, 0, 1, 0] });
    this.u = uniforms;
    this.dummyMask = maskDummy;
    this.dummyTrack = trackDummy;
  }

  /** `direction` points toward the sun. */
  setSun(direction: Vector3, color?: ColorRepresentation): void {
    this.u.uSunDirection.value.copy(direction);
    if (this.u.uSunDirection.value.lengthSq() < 1e-8) this.u.uSunDirection.value.set(0, 1, 0);
    else this.u.uSunDirection.value.normalize();
    if (color !== undefined) this.u.uSunColor.value.set(color);
  }

  setGroomDirection(x: number, z: number): void {
    unitDirection(x, z, this.u.uGroomDir.value);
  }

  setMask(
    mask: Texture | null,
    originX = this.u.uMaskOrigin.value.x,
    originZ = this.u.uMaskOrigin.value.y,
    sizeX = this.u.uMaskSize.value.x,
    sizeZ = this.u.uMaskSize.value.y,
  ): void {
    this.u.uMask.value = mask ?? this.dummyMask;
    this.u.uHasMask.value = mask ? 1 : 0;
    this.u.uMaskOrigin.value.set(originX, originZ);
    this.u.uMaskSize.value.set(Math.max(sizeX, 1e-3), Math.max(sizeZ, 1e-3));
  }

  /**
   * Linear-filtered cover in the red channel (0 open, 1 closed canopy),
   * addressed like the mask. Darkens off-piste snow under trees. Null hides it.
   */
  setCanopy(map: Texture | null, originX: number, originZ: number, sizeX: number, sizeZ: number): void {
    this.u.uCanopy.value = map ?? this.dummyTrack;
    this.u.uHasCanopy.value = map ? 1 : 0;
    this.u.uCanopyOrigin.value.set(originX, originZ);
    this.u.uCanopySize.value.set(Math.max(sizeX, 1e-3), Math.max(sizeZ, 1e-3));
  }

  /** Linear-filtered groomed share (red channel), same addressing as the mask. Softens run edges. */
  setGroomTexture(map: Texture | null): void {
    this.u.uGroomTex.value = map ?? this.dummyTrack;
    this.u.uHasGroomTex.value = map ? 1 : 0;
  }

  /**
   * Detail terrain: chunks flagged in `mask` (red > 0.5, nearest filtered,
   * one texel per chunk over `rect` = originX, originZ, sizeX, sizeZ) hide the
   * coarse mesh; detail vertices morph to the coarse surface between `near`
   * and `far` metres from `centre`. Null mask turns it off.
   */
  setDetail(mask: Texture | null, rect?: { x: number; z: number; width: number; depth: number; limitX: number; limitZ: number }): void {
    this.u.uDetailMask.value = mask ?? this.dummyTrack;
    this.u.uHasDetail.value = mask ? 1 : 0;
    if (rect) {
      this.u.uDetailMaskRect.value.set(rect.x, rect.z, rect.width, rect.depth);
      // The coarse mesh still draws past the last detail sample.
      this.u.uDetailLimit.value.set(rect.limitX, rect.limitZ);
    }
  }

  setDetailMorph(centreX: number, centreZ: number, near: number, far: number): void {
    this.u.uDetailCentre.value.set(centreX, centreZ);
    this.u.uDetailMorph.value.set(near, Math.max(far, near + 1));
  }

  /** Hide the terrain inside a circle where the deformable snow patch draws instead. */
  setPatch(centreX: number, centreZ: number, radius: number, on: boolean): void {
    this.u.uPatchCentre.value.set(centreX, centreZ);
    this.u.uPatchRadius.value = radius;
    this.u.uHasPatch.value = on ? 1 : 0;
  }

  setMaskEnabled(enabled: boolean): void {
    this.u.uMaskEnabled.value = enabled ? 1 : 0;
  }

  /**
   * Scalar stamp in the red channel: 1 is fully skied-out snow.
   * Addressed in world XZ over a square of `size` metres starting at the origin.
   * Pass null to hide the stamp. The caller owns the texture.
   */
  setTrackMap(
    map: Texture | null,
    originX: number,
    originZ: number,
    size: number,
    resolution: number,
  ): void {
    this.u.uTrack.value = map ?? this.dummyTrack;
    this.u.uHasTrack.value = map ? 1 : 0;
    this.u.uTrackOrigin.value.set(originX, originZ);
    this.u.uTrackSize.value = Math.max(size, 1e-3);
    this.u.uTrackResolution.value = Math.max(resolution, 1);
  }

  setSparkle(amount: number): void {
    this.u.uSparkle.value = Math.max(0, amount);
  }

  /** `depthMetres` of 0 turns corduroy off. */
  setCorduroy(spacingMetres: number, depthMetres: number): void {
    this.u.uCordSpacing.value = Math.max(0.05, spacingMetres);
    this.u.uCordDepth.value = Math.max(0, depthMetres);
  }

  setSlopeBlend(startDeg: number, fullDeg: number, enabled: boolean): void {
    this.u.uSlopeStart.value = startDeg;
    this.u.uSlopeFull.value = Math.max(fullDeg, startDeg + 0.5);
    this.u.uSlopeRockEnabled.value = enabled ? 1 : 0;
  }

  setFog(density: number, color?: ColorRepresentation): void {
    this.u.uFogDensity.value = Math.max(0, density);
    if (color !== undefined) this.u.uFogColor.value.set(color);
  }

  override dispose(): void {
    this.dummyMask.dispose();
    if (this.dummyTrack !== this.dummyMask) this.dummyTrack.dispose();
    super.dispose();
  }
}
