import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';

export interface SnowPuffOptions {
  /** Hard cap on live clouds. The pool never grows. */
  maxPuffs?: number;
}

/** One burst of loose snow: a landing, a crash, a hard stop. */
export interface PuffBurst {
  /** Clouds to start. */
  count: number;
  /** Starting radius of each cloud, metres. */
  size: number;
  /** How far each cloud grows by the end of its life, as a multiple of `size`. */
  grow?: number;
  /** Horizontal throw, metres per second. */
  spread: number;
  /** Upward throw, metres per second. */
  rise: number;
  /** Seconds. */
  life: number;
  /** Peak opacity, 0-1. */
  opacity?: number;
  /** Share of the carrier's velocity the clouds keep, 0-1. */
  carry?: number;
}

interface Cloud {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  peak: number;
  seed: number;
  alive: boolean;
}

const vertexShader = /* glsl */ `
attribute vec3 aCentre;
attribute vec3 aLook;    // x radius, y opacity, z seed

varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

void main() {
  vec4 view = viewMatrix * vec4(aCentre, 1.0);
  float radius = aLook.x;
  // A slow spin per cloud so overlapping billows do not line up.
  float a = aLook.z * 6.2831 + radius * 0.35;
  vec2 c = vec2(cos(a), sin(a));
  vec2 corner = position.xy;
  vec2 turned = vec2(corner.x * c.x - corner.y * c.y, corner.x * c.y + corner.y * c.x);
  view.xy += turned * radius * 2.0;
  gl_Position = projectionMatrix * view;
  vUv = corner + 0.5;
  vAlpha = aLook.y;
  vSeed = aLook.z;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uShade;
uniform vec3 uLit;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  vec2 q = p * 2.2 + vSeed * 17.0;
  float billow = noise(q) * 0.62 + noise(q * 2.1 + 3.7) * 0.38;
  float edge = r + (billow - 0.5) * 0.6;
  float body = 1.0 - smoothstep(0.1, 0.95, edge);
  float alpha = sqrt(body) * vAlpha;
  if (alpha < 0.01) discard;
  // Lit from above, shaded underneath and in the folds: snow on snow only
  // reads through its shading, so the contrast here is deliberate.
  float light = clamp(0.35 + p.y * 0.6 + (billow - 0.5) * 0.9, 0.0, 1.0);
  gl_FragColor = vec4(mix(uShade, uLit, light), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const QUAD = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

/**
 * Powder clouds: soft billows that bloom, drift and settle after a landing,
 * a crash or a deep-snow turn. A small fixed pool of camera-facing quads in one
 * instanced draw. They are large and transparent, so the pool is kept small:
 * fill rate, not vertex count, is what they cost.
 */
export class SnowPuff {
  readonly object: Mesh;
  gravity = 1.6;
  drag = 1.8;

  private readonly pool: Cloud[];
  private readonly max: number;
  private cursor = 0;
  private aliveCount = 0;
  private trailDebt = 0;
  private enabled = true;
  private readonly geometry: InstancedBufferGeometry;
  private readonly clouds: Float32Array;
  private readonly looks: Float32Array;
  private readonly uniforms: { uShade: { value: Color }; uLit: { value: Color } };

  constructor(options: SnowPuffOptions = {}) {
    this.max = Math.max(1, options.maxPuffs ?? 128);
    this.pool = Array.from({ length: this.max }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      age: 0, life: 1, size: 0.5, grow: 2, peak: 0.5, seed: 0, alive: false,
    }));
    this.clouds = new Float32Array(this.max * 3);
    this.looks = new Float32Array(this.max * 3);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(QUAD, 3));
    this.geometry.setIndex(QUAD_INDEX);
    const cloudAttr = new InstancedBufferAttribute(this.clouds, 3);
    const lookAttr = new InstancedBufferAttribute(this.looks, 3);
    cloudAttr.setUsage(DynamicDrawUsage);
    lookAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aCentre', cloudAttr);
    this.geometry.setAttribute('aLook', lookAttr);
    this.geometry.instanceCount = 0;
    this.uniforms = {
      uShade: { value: new Color(0.7, 0.78, 0.88) },
      uLit: { value: new Color(1, 1, 1) },
    };
    const material = new ShaderMaterial({
      name: 'snow-puff',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: true,
    });
    this.object = new Mesh(this.geometry, material);
    this.object.name = 'snow-puff';
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.object.visible = false;
  }

  get alive(): number {
    return this.aliveCount;
  }

  get capacity(): number {
    return this.max;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Linear colours for the sunny top and shaded underside of a cloud. */
  setLight(lit: Color, shade: Color): void {
    this.uniforms.uLit.value.copy(lit);
    this.uniforms.uShade.value.copy(shade);
  }

  /** Start `count` clouds at once around `position`. */
  burst(position: Vector3, velocity: Vector3, burst: PuffBurst): void {
    if (!this.enabled) return;
    const count = Math.min(this.max, Math.round(burst.count));
    const carry = burst.carry ?? 0.35;
    for (let n = 0; n < count; n += 1) {
      const cloud = this.acquire();
      const angle = Math.random() * Math.PI * 2;
      const out = 0.35 + Math.random() * 0.65;
      cloud.x = position.x + Math.cos(angle) * burst.size * 0.6 * out;
      cloud.y = position.y + burst.size * (0.25 + Math.random() * 0.35);
      cloud.z = position.z + Math.sin(angle) * burst.size * 0.6 * out;
      cloud.vx = velocity.x * carry + Math.cos(angle) * burst.spread * out;
      cloud.vy = Math.max(0, velocity.y * carry * 0.3) + burst.rise * (0.4 + Math.random() * 0.6);
      cloud.vz = velocity.z * carry + Math.sin(angle) * burst.spread * out;
      this.start(cloud, burst.size * (0.7 + Math.random() * 0.6), burst.grow ?? 2.2, burst.life * (0.75 + Math.random() * 0.5), (burst.opacity ?? 0.6) * (0.7 + Math.random() * 0.3));
    }
  }

  /**
   * A continuous plume behind a carrier, `rate` clouds per second. Used for
   * deep powder turns and a crash tumble. The clouds are left behind, not carried.
   */
  trail(dt: number, position: Vector3, velocity: Vector3, rate: number, size: number, opacity: number): void {
    if (!this.enabled || rate <= 0) return;
    this.trailDebt += rate * Math.min(Math.max(dt, 0), 0.05);
    while (this.trailDebt >= 1) {
      this.trailDebt -= 1;
      const cloud = this.acquire();
      const jx = Math.random() - 0.5;
      const jz = Math.random() - 0.5;
      cloud.x = position.x + jx * size;
      cloud.y = position.y + size * 0.35;
      cloud.z = position.z + jz * size;
      cloud.vx = velocity.x * 0.18 + jx * 1.2;
      cloud.vy = 0.5 + Math.random() * 0.8;
      cloud.vz = velocity.z * 0.18 + jz * 1.2;
      this.start(cloud, size * (0.7 + Math.random() * 0.6), 1.9, 1.1 + Math.random() * 0.8, opacity * (0.6 + Math.random() * 0.4));
    }
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    const damp = Math.exp(-this.drag * step);
    let n = 0;
    for (const cloud of this.pool) {
      if (!cloud.alive) continue;
      cloud.age += step;
      if (cloud.age >= cloud.life) {
        cloud.alive = false;
        continue;
      }
      cloud.vx *= damp;
      cloud.vy = cloud.vy * damp - this.gravity * step;
      cloud.vz *= damp;
      cloud.x += cloud.vx * step;
      cloud.y += cloud.vy * step;
      cloud.z += cloud.vz * step;
      const t = cloud.age / cloud.life;
      // Bloom fast, then hang and thin out.
      const radius = cloud.size * (1 + (cloud.grow - 1) * (1 - (1 - t) * (1 - t)));
      const alpha = cloud.peak * Math.min(1, cloud.age / 0.06) * (1 - t) * (1 - t);
      const o3 = n * 3;
      this.clouds[o3] = cloud.x;
      this.clouds[o3 + 1] = cloud.y;
      this.clouds[o3 + 2] = cloud.z;
      this.looks[o3] = radius;
      this.looks[o3 + 1] = alpha;
      this.looks[o3 + 2] = cloud.seed;
      n += 1;
    }
    this.aliveCount = n;
    for (const name of ['aCentre', 'aLook']) {
      const attr = this.geometry.getAttribute(name) as InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
    this.geometry.instanceCount = n;
    this.object.visible = n > 0;
  }

  clear(): void {
    for (const cloud of this.pool) cloud.alive = false;
    this.aliveCount = 0;
    this.trailDebt = 0;
    this.geometry.instanceCount = 0;
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
  }

  private start(cloud: Cloud, size: number, grow: number, life: number, peak: number): void {
    cloud.age = 0;
    cloud.size = size;
    cloud.grow = grow;
    cloud.life = life;
    cloud.peak = peak;
    cloud.seed = Math.random();
    cloud.alive = true;
  }

  /** The next free cloud, or the oldest one when the pool is full. */
  private acquire(): Cloud {
    let oldest = this.pool[this.cursor];
    for (let i = 0; i < this.max; i += 1) {
      const cloud = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      if (!cloud.alive) return cloud;
      if (cloud.age / cloud.life > oldest.age / oldest.life) oldest = cloud;
    }
    return oldest;
  }
}
