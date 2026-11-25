import { addRowRanges } from '../rowUpload';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from 'three';

/** Centre of the stance, on the snow. Numbers are copied during `update`. */
export interface TrackInput {
  position: Vector3;
  /** Travel direction. It does not need to be unit length. */
  direction: Vector3;
  normal: Vector3;
  /** 0 is a clean edge, 1 is a sideways scrub. Widens and softens the track. */
  skid: number;
  /** 0 is straight, 1 is a carved edge. Narrows the track. */
  carving: number;
  /** Loose snow displaced by the skis, 0..1. */
  powder?: number;
  grounded?: boolean;
}

export interface SkiTracksOptions {
  /** Ribbon samples kept at once. Older samples are dropped. */
  maxSamples?: number;
  /** Metres between ribbon samples. */
  spacing?: number;
  /** Seconds before a ribbon sample fades out. */
  lifetime?: number;
  /** Metres between ski centrelines. */
  stance?: number;
  /** Metres across one ski. */
  skiWidth?: number;
  /** Metres to lift the ribbon off the mesh. */
  lift?: number;
  /** Square world window of the stamp, metres. */
  windowMetres?: number;
  /** Stamp texels along one edge. */
  resolution?: number;
}

interface Sample {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  lx: number;
  ly: number;
  lz: number;
  age: number;
  skid: number;
  carving: number;
  powder: number;
  gap: number;
}

const vertexShader = /* glsl */ `
attribute vec3 aNormal;
attribute vec3 aLateral;
attribute vec3 aProfile;

varying vec3 vNormal;
varying vec3 vLateral;
varying vec3 vWorld;
varying vec3 vProfile;

void main() {
  vec4 world = vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = aNormal;
  vLateral = aLateral;
  vProfile = aProfile;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vLateral;
varying vec3 vWorld;
varying vec3 vProfile;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uTrench;
uniform vec3 uBerm;
uniform vec3 uFogColor;
uniform float uFogDensity;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float side = vProfile.x;
  float fade = vProfile.y;
  float skid = vProfile.z;
  float edge = mix(1.0, smoothstep(1.05, 0.4, abs(side)), skid);
  float alpha = fade * edge;
  if (alpha < hash(gl_FragCoord.xy)) discard;

  vec3 N = normalize(vNormal - vLateral * side * mix(0.95, 0.28, skid));
  vec3 L = normalize(uSunDirection);
  vec3 V = normalize(cameraPosition - vWorld);
  float wrap = 0.45;
  float diff = clamp((dot(N, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
  float hemi = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 albedo = mix(uBerm, uTrench, smoothstep(0.2, 0.95, 1.0 - abs(side)));
  albedo *= mix(vec3(0.78, 0.84, 0.95), vec3(1.0), diff);
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 36.0) * 0.1 * (1.0 - skid * 0.6);
  vec3 color = albedo * (uSkyColor * hemi * 0.45 + uSunColor * diff) + uSunColor * spec;
  float fog = 1.0 - exp(-length(cameraPosition - vWorld) * uFogDensity);
  color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Two ski ribbons plus a fixed-resolution stamp the snow material can sample.
 *
 * The ribbon is the fresh groove (bounded by `maxSamples`). The stamp is one
 * byte per texel over a square window that follows the skier; texels that
 * scroll out of the window are dropped. Nothing here grows with how long
 * the run has been skied.
 */
export class SkiTracks {
  readonly object: Mesh;
  readonly stampTexture: DataTexture;
  readonly windowMetres: number;
  readonly resolution: number;
  /** World minimum of the stamp window, metres. */
  originX = 0;
  originZ = 0;
  lifetime: number;
  /** When false, the stamp is left untouched. */
  stampEnabled = true;
  stance: number;
  skiWidth: number;

  private readonly data: Uint8Array;
  private readonly scratch: Uint8Array;
  private readonly samples: Sample[];
  private readonly max: number;
  private readonly spacing: number;
  private readonly lift: number;
  private head = 0;
  private count = 0;
  private placed = false;
  /** Rows painted this segment, and whether the whole stamp is already due for upload. */
  private dirtyMin = Infinity;
  private dirtyMax = -Infinity;
  private fullUpload = true;
  private ribbonEnabled = true;
  private hasPaint = false;
  private paintX = 0;
  private paintZ = 0;
  /** Where each ski last painted the stamp (left, right). */
  private skiPaint = [0, 0, 0, 0];
  /**
   * When the deep-snow patch is drawing real trenches, ribbon samples taken in
   * loose snow fade out (they would float over the trench); on firm snow the
   * ribbons still draw the two carve lines.
   */
  deepSnowPatch = false;
  private ribbonReady = false;
  private ribbonX = 0;
  private ribbonZ = 0;
  private readonly sunDirection = new Vector3(-0.55, 0.42, 0.72);
  private readonly geometry: BufferGeometry;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly laterals: Float32Array;
  private readonly profiles: Float32Array;

  constructor(options: SkiTracksOptions = {}) {
    this.max = options.maxSamples ?? 800;
    this.spacing = options.spacing ?? 0.4;
    this.lifetime = options.lifetime ?? 12;
    this.stance = options.stance ?? 0.28;
    this.skiWidth = options.skiWidth ?? 0.11;
    this.lift = options.lift ?? 0.03;
    this.windowMetres = options.windowMetres ?? 112;
    this.resolution = options.resolution ?? 512;

    this.data = new Uint8Array(this.resolution * this.resolution * 4);
    this.scratch = new Uint8Array(this.data.length);
    this.stampTexture = new DataTexture(this.data, this.resolution, this.resolution, RGBAFormat, UnsignedByteType);
    this.stampTexture.magFilter = LinearFilter;
    this.stampTexture.minFilter = LinearFilter;
    this.stampTexture.colorSpace = NoColorSpace;
    this.stampTexture.generateMipmaps = false;
    this.stampTexture.needsUpdate = true;
    this.stampTexture.onUpdate = () => {
      this.fullUpload = false;
    };

    this.samples = Array.from({ length: this.max }, () => ({
      x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, lx: 1, ly: 0, lz: 0,
      age: 0, skid: 0, carving: 0, powder: 0, gap: 0,
    }));

    const vertCapacity = Math.max(0, this.max - 1) * 2 * 6;
    this.positions = new Float32Array(vertCapacity * 3);
    this.normals = new Float32Array(vertCapacity * 3);
    this.laterals = new Float32Array(vertCapacity * 3);
    this.profiles = new Float32Array(vertCapacity * 3);
    this.geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(this.positions, 3);
    const normalAttr = new BufferAttribute(this.normals, 3);
    const lateralAttr = new BufferAttribute(this.laterals, 3);
    const profileAttr = new BufferAttribute(this.profiles, 3);
    positionAttr.setUsage(DynamicDrawUsage);
    normalAttr.setUsage(DynamicDrawUsage);
    lateralAttr.setUsage(DynamicDrawUsage);
    profileAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', positionAttr);
    this.geometry.setAttribute('aNormal', normalAttr);
    this.geometry.setAttribute('aLateral', lateralAttr);
    this.geometry.setAttribute('aProfile', profileAttr);
    this.geometry.setDrawRange(0, 0);

    const material = new ShaderMaterial({
      name: 'ski-tracks',
      uniforms: {
        uSunDirection: { value: this.sunDirection },
        uSunColor: { value: new Vector3(1, 0.93, 0.82) },
        uSkyColor: { value: new Vector3(0.62, 0.72, 0.82) },
        uTrench: { value: new Vector3(0.42, 0.5, 0.58) },
        uBerm: { value: new Vector3(0.92, 0.95, 0.98) },
        uFogColor: { value: new Vector3(0.72, 0.8, 0.86) },
        uFogDensity: { value: 0.007 },
      },
      vertexShader,
      fragmentShader,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
      toneMapped: true,
    });
    this.object = new Mesh(this.geometry, material);
    this.object.name = 'ski-tracks';
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
  }

  /** Direction toward the sun. Colours are linear RGB. */
  setSun(direction: Vector3, color?: Vector3, sky?: Vector3): void {
    this.sunDirection.copy(direction).normalize();
    const material = this.object.material as ShaderMaterial;
    if (color) material.uniforms.uSunColor.value.copy(color);
    if (sky) material.uniforms.uSkyColor.value.copy(sky);
  }

  setFog(density: number, color?: Vector3): void {
    const material = this.object.material as ShaderMaterial;
    material.uniforms.uFogDensity.value = density;
    if (color) material.uniforms.uFogColor.value.copy(color);
  }

  setRibbonEnabled(enabled: boolean): void {
    this.ribbonEnabled = enabled;
    this.object.visible = enabled;
  }

  clear(): void {
    this.data.fill(0);
    this.uploadAll();
    this.count = 0;
    this.head = 0;
    this.placed = false;
    this.hasPaint = false;
    this.ribbonReady = false;
    this.geometry.setDrawRange(0, 0);
  }

  update(dt: number, input: TrackInput | null): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.age(step);
    if (input && input.grounded !== false && input.direction.lengthSq() > 1e-6) {
      this.record(input);
    }
    this.rebuild();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
    this.stampTexture.dispose();
  }

  private age(dt: number): void {
    for (let i = 0; i < this.count; i += 1) this.at(i).age += dt;
    while (this.count > 0 && this.at(0).age > this.lifetime) {
      this.head = (this.head + 1) % this.max;
      this.count -= 1;
    }
  }

  private record(input: TrackInput): void {
    const x = input.position.x;
    const y = input.position.y;
    const z = input.position.z;
    const frame = this.frame(input.direction, input.normal);
    const skid = clamp01(input.skid);
    const carving = clamp01(input.carving);
    const powder = clamp01(input.powder ?? 0);
    const jumped = this.hasPaint && Math.hypot(x - this.paintX, z - this.paintZ) > 4;

    if (!this.placed || jumped) this.placeWindow(x, z);
    else this.recenter(x, z);

    // One groove per ski (one for a board), a ski's width apart; a skid smears them
    // into one wide scrape, and loose snow widens them.
    const skis = this.stance > 0.01 ? [-0.5, 0.5] : [0];
    const radius = Math.max(this.skiWidth * 0.9, 0.12) + skid * 0.75 + powder * 0.3;
    skis.forEach((offset, i) => {
      const sx = x + frame.lx * offset * this.stance;
      const sz = z + frame.lz * offset * this.stance;
      if (this.stampEnabled && this.hasPaint && !jumped) {
        this.paintSegment(this.skiPaint[i * 2], this.skiPaint[i * 2 + 1], sx, sz, radius, 0.55 + carving * 0.45);
      }
      this.skiPaint[i * 2] = sx;
      this.skiPaint[i * 2 + 1] = sz;
    });
    this.paintX = x;
    this.paintZ = z;
    this.hasPaint = true;

    const fromRibbon = Math.hypot(x - this.ribbonX, z - this.ribbonZ);
    if (this.ribbonReady && fromRibbon < this.spacing && !jumped) return;

    const sample = this.push();
    sample.x = x;
    sample.y = y;
    sample.z = z;
    sample.nx = frame.nx;
    sample.ny = frame.ny;
    sample.nz = frame.nz;
    sample.lx = frame.lx;
    sample.ly = frame.ly;
    sample.lz = frame.lz;
    sample.age = 0;
    sample.skid = skid;
    sample.carving = carving;
    sample.powder = powder;
    sample.gap = !this.ribbonReady || jumped ? 1 : 0;
    this.ribbonX = x;
    this.ribbonZ = z;
    this.ribbonReady = true;
  }

  private frame(direction: Vector3, normal: Vector3): {
    nx: number; ny: number; nz: number; lx: number; ly: number; lz: number;
  } {
    let nx = normal.x;
    let ny = normal.y;
    let nz = normal.z;
    let nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-5) {
      nx = 0; ny = 1; nz = 0; nLen = 1;
    }
    nx /= nLen; ny /= nLen; nz /= nLen;

    let tx = direction.x;
    let ty = direction.y;
    let tz = direction.z;
    const along = tx * nx + ty * ny + tz * nz;
    tx -= nx * along;
    ty -= ny * along;
    tz -= nz * along;
    let tLen = Math.hypot(tx, ty, tz);
    if (tLen < 1e-5) {
      tx = 0; ty = 0; tz = 1;
      const fallback = tx * nx + ty * ny + tz * nz;
      tx -= nx * fallback;
      ty -= ny * fallback;
      tz -= nz * fallback;
      tLen = Math.hypot(tx, ty, tz) || 1;
    }
    tx /= tLen; ty /= tLen; tz /= tLen;

    // normal × tangent: +X when facing south on flat ground, which is the skier's right.
    const lx = ny * tz - nz * ty;
    const ly = nz * tx - nx * tz;
    const lz = nx * ty - ny * tx;
    const lLen = Math.hypot(lx, ly, lz) || 1;
    return { nx, ny, nz, lx: lx / lLen, ly: ly / lLen, lz: lz / lLen };
  }

  private placeWindow(x: number, z: number): void {
    const texel = this.windowMetres / this.resolution;
    this.originX = Math.round((x - this.windowMetres * 0.5) / texel) * texel;
    this.originZ = Math.round((z - this.windowMetres * 0.5) / texel) * texel;
    this.data.fill(0);
    this.uploadAll();
    this.placed = true;
  }

  private recenter(x: number, z: number): void {
    const margin = this.windowMetres * 0.22;
    if (
      x > this.originX + margin &&
      x < this.originX + this.windowMetres - margin &&
      z > this.originZ + margin &&
      z < this.originZ + this.windowMetres - margin
    ) return;

    const texel = this.windowMetres / this.resolution;
    const nextX = Math.round((x - this.windowMetres * 0.5) / texel) * texel;
    const nextZ = Math.round((z - this.windowMetres * 0.5) / texel) * texel;
    const dx = Math.round((nextX - this.originX) / texel);
    const dz = Math.round((nextZ - this.originZ) / texel);
    this.shift(dx, dz);
    this.originX = nextX;
    this.originZ = nextZ;
  }

  /** Positive dx moves the window east, so existing texels slide toward -X. */
  private shift(dx: number, dz: number): void {
    const n = this.resolution;
    if (Math.abs(dx) >= n || Math.abs(dz) >= n) {
      this.data.fill(0);
      this.uploadAll();
      return;
    }
    this.scratch.fill(0);
    for (let y = 0; y < n; y += 1) {
      const srcY = y + dz;
      if (srcY < 0 || srcY >= n) continue;
      for (let x = 0; x < n; x += 1) {
        const srcX = x + dx;
        if (srcX < 0 || srcX >= n) continue;
        const dst = (y * n + x) * 4;
        const src = (srcY * n + srcX) * 4;
        this.scratch[dst] = this.data[src];
        this.scratch[dst + 1] = this.data[src + 1];
        this.scratch[dst + 2] = this.data[src + 2];
        this.scratch[dst + 3] = this.data[src + 3];
      }
    }
    this.data.set(this.scratch);
    this.uploadAll();
  }

  private paintSegment(x0: number, z0: number, x1: number, z1: number, radius: number, amount: number): void {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const step = Math.max(radius * 0.45, this.windowMetres / this.resolution);
    const steps = Math.min(48, Math.max(1, Math.ceil(dist / step)));
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.paintDisc(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius, amount);
    }
    if (this.dirtyMax < this.dirtyMin) return;
    // Upload only the rows this segment touched (a few KB) instead of the whole
    // 1 MB stamp. A pending full upload (window moved or cleared) wins.
    if (!this.fullUpload) addRowRanges(this.stampTexture, this.dirtyMin, this.dirtyMax, this.resolution);
    this.stampTexture.needsUpdate = true;
  }

  /** Mark the whole stamp for upload, dropping any row ranges. */
  private uploadAll(): void {
    this.stampTexture.clearUpdateRanges();
    this.fullUpload = true;
    this.stampTexture.needsUpdate = true;
  }

  private paintDisc(x: number, z: number, radius: number, amount: number): void {
    const texel = this.windowMetres / this.resolution;
    const cx = (x - this.originX) / texel;
    const cy = (z - this.originZ) / texel;
    const r = Math.max(radius / texel, 1);
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(this.resolution - 1, Math.ceil(cx + r));
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(this.resolution - 1, Math.ceil(cy + r));
    if (minY < this.dirtyMin) this.dirtyMin = minY;
    if (maxY > this.dirtyMax) this.dirtyMax = maxY;
    const r2 = r * r;
    const n = this.resolution;
    for (let y = minY; y <= maxY; y += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const d2 = (px - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        const falloff = 1 - d2 / r2;
        const value = Math.round(255 * falloff * amount);
        const index = (y * n + px) * 4;
        if (value > this.data[index]) this.data[index] = value;
      }
    }
  }

  private rebuild(): void {
    let vertex = 0;
    const capacity = this.positions.length / 3;
    for (let i = 1; i < this.count; i += 1) {
      const a = this.at(i - 1);
      const b = this.at(i);
      if (b.gap) continue;
      if (vertex + 12 > capacity) break;
      vertex = this.writeSki(a, b, -1, i, vertex);
      vertex = this.writeSki(a, b, 1, i, vertex);
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aNormal') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aLateral') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aProfile') as BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, vertex);
    this.object.visible = this.ribbonEnabled && vertex > 0;
  }

  private writeSki(a: Sample, b: Sample, skiSign: number, index: number, vertex: number): number {
    const fadeA = this.fade(a, index - 1);
    const fadeB = this.fade(b, index);
    const halfA = this.halfWidth(a);
    const halfB = this.halfWidth(b);
    const centerA = skiSign * this.stance * 0.5;
    const centerB = skiSign * this.stance * 0.5;
    // BL, FL, BR, BR, FL, FR — front face is the surface normal.
    this.vertex(vertex, a, centerA - halfA, -1, fadeA);
    this.vertex(vertex + 1, b, centerB - halfB, -1, fadeB);
    this.vertex(vertex + 2, a, centerA + halfA, 1, fadeA);
    this.vertex(vertex + 3, a, centerA + halfA, 1, fadeA);
    this.vertex(vertex + 4, b, centerB - halfB, -1, fadeB);
    this.vertex(vertex + 5, b, centerB + halfB, 1, fadeB);
    return vertex + 6;
  }

  private vertex(vertex: number, sample: Sample, across: number, side: number, fade: number): void {
    const o = vertex * 3;
    this.positions[o] = sample.x + sample.lx * across + sample.nx * this.lift;
    this.positions[o + 1] = sample.y + sample.ly * across + sample.ny * this.lift;
    this.positions[o + 2] = sample.z + sample.lz * across + sample.nz * this.lift;
    this.normals[o] = sample.nx;
    this.normals[o + 1] = sample.ny;
    this.normals[o + 2] = sample.nz;
    this.laterals[o] = sample.lx;
    this.laterals[o + 1] = sample.ly;
    this.laterals[o + 2] = sample.lz;
    this.profiles[o] = side;
    this.profiles[o + 1] = fade;
    this.profiles[o + 2] = Math.max(sample.skid, sample.powder * 0.7);
  }

  private fade(sample: Sample, index: number): number {
    const life = this.lifetime > 0.05 ? this.lifetime : 0.05;
    const ageFade = Math.max(0, 1 - sample.age / life);
    const along = this.count <= 1 ? 1 : index / (this.count - 1);
    const capFade = smoothstep(0, 0.16, along);
    const trench = this.deepSnowPatch ? 1 - smoothstep(0.12, 0.35, sample.powder) : 1;
    return ageFade * capFade * trench;
  }

  private halfWidth(sample: Sample): number {
    return (this.skiWidth * 0.5) * (1 + sample.skid * 2.5) * (1 - sample.carving * 0.2) + sample.powder * 0.09;
  }

  private push(): Sample {
    if (this.count === this.max) {
      this.head = (this.head + 1) % this.max;
      this.count -= 1;
    }
    const sample = this.at(this.count);
    this.count += 1;
    return sample;
  }

  private at(index: number): Sample {
    return this.samples[(this.head + index) % this.max];
  }
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
