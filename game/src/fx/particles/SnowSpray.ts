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

/** One ski contact. The module copies the numbers during `update`. */
export interface SprayInput {
  /** World contact, metres. */
  position: Vector3;
  /** World velocity, metres per second. */
  velocity: Vector3;
  /** 0 is a clean glide, 1 is a full sideways scrub. */
  skid: number;
  /** 0 is straight, 1 is an edged carve. */
  carving: number;
  /**
   * Unit direction on the snow, pointing to the outside of the turn.
   * Carve spray is thrown this way. Omit it on a straight run.
   */
  lateral?: Vector3;
  grounded?: boolean;
  powder?: number;
  impact?: number;
}

export interface SnowSprayOptions {
  /** Hard cap. The pool never grows. */
  maxParticles?: number;
  /** Downward acceleration while a flake is airborne. */
  gravity?: number;
  drag?: number;
}

interface Flake {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  stretch: number;
  peak: number;
  spawnY: number;
  fall: number;
  alive: boolean;
}

const vertexShader = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aVelocity;
attribute vec3 aSprite;

varying vec2 vUv;
varying float vAlpha;

void main() {
  vec2 corner = position.xy;
  vec3 vel = aVelocity;
  float speed = length(vel);
  vec3 axis = speed > 0.05 ? vel / speed : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - aOffset);
  vec3 side = cross(axis, toCam);
  float sideLen = length(side);
  side = sideLen > 0.001 ? side / sideLen : normalize(cross(axis, vec3(0.0, 1.0, 0.0)));
  float size = aSprite.x;
  float stretch = size * (1.0 + speed * aSprite.y);
  vec3 world = aOffset + side * corner.x * size + axis * corner.y * stretch;
  vUv = corner + 0.5;
  vAlpha = aSprite.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uShade;
uniform vec3 uLit;
varying vec2 vUv;
varying float vAlpha;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float alpha = (1.0 - smoothstep(0.15, 1.0, r)) * vAlpha;
  if (alpha < 0.03) discard;
  vec3 color = mix(uShade, uLit, (1.0 - smoothstep(0.2, 1.0, r)));
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** One quad, drawn once per live flake with instanced attributes. */
const QUAD = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];

/**
 * Ski spray from a fixed pool of camera-facing streaks.
 * Simulation is on the CPU because spawn rate, direction and shape come from
 * the ski inputs. Drawing is one instanced quad (one draw call), and only live
 * flakes are written, once each. The pool size is the memory bound.
 */
export class SnowSpray {
  readonly object: Mesh;
  /** Multiplier on flakes per second. */
  amount = 1;
  gravity: number;
  drag: number;

  private readonly pool: Flake[];
  private readonly max: number;
  private cursor = 0;
  private aliveCount = 0;
  private spawnDebt = 0;
  private enabled = true;
  private readonly geometry: InstancedBufferGeometry;
  private readonly uniforms: { uShade: { value: Color }; uLit: { value: Color } };
  private readonly offsets: Float32Array;
  private readonly velocities: Float32Array;
  private readonly sprites: Float32Array;

  constructor(options: SnowSprayOptions = {}) {
    this.max = options.maxParticles ?? 2048;
    this.gravity = options.gravity ?? 7;
    this.drag = options.drag ?? 1.7;
    this.pool = Array.from({ length: this.max }, () => ({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      age: 0, life: 1, size: 0.1, stretch: 0.08, peak: 0.3,
      spawnY: 0, fall: 0.3, alive: false,
    }));

    this.offsets = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.sprites = new Float32Array(this.max * 3);

    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(QUAD, 3));
    this.geometry.setIndex(QUAD_INDEX);
    const offsetAttr = new InstancedBufferAttribute(this.offsets, 3);
    const velocityAttr = new InstancedBufferAttribute(this.velocities, 3);
    const spriteAttr = new InstancedBufferAttribute(this.sprites, 3);
    offsetAttr.setUsage(DynamicDrawUsage);
    velocityAttr.setUsage(DynamicDrawUsage);
    spriteAttr.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('aOffset', offsetAttr);
    this.geometry.setAttribute('aVelocity', velocityAttr);
    this.geometry.setAttribute('aSprite', spriteAttr);
    this.geometry.instanceCount = 0;
    this.uniforms = {
      uShade: { value: new Color(0.78, 0.84, 0.9) },
      uLit: { value: new Color(0.97, 0.98, 0.99) },
    };

    const material = new ShaderMaterial({
      name: 'snow-spray',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: true,
    });
    this.object = new Mesh(this.geometry, material);
    this.object.name = 'snow-spray';
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
  }

  get alive(): number {
    return this.aliveCount;
  }

  get capacity(): number {
    return this.max;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.object.visible = this.aliveCount > 0;
  }

  /**
   * Flake colours, linear. `lit` is the sunny side of a flake, `shade` its rim.
   * Follow the scene's sun and sky so spray does not glow at dusk.
   */
  setLight(lit: Color, shade: Color): void {
    this.uniforms.uLit.value.copy(lit);
    this.uniforms.uShade.value.copy(shade);
  }

  clear(): void {
    for (const flake of this.pool) flake.alive = false;
    this.aliveCount = 0;
    this.spawnDebt = 0;
    this.geometry.instanceCount = 0;
    this.object.visible = false;
  }

  update(dt: number, inputs: readonly SprayInput[]): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.integrate(step);
    if (this.enabled) {
      for (const input of inputs) this.spawn(step, input);
    }
    this.write();
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
  }

  private integrate(dt: number): void {
    const damp = Math.exp(-this.drag * dt);
    let alive = 0;
    for (const flake of this.pool) {
      if (!flake.alive) continue;
      flake.vy -= this.gravity * dt;
      flake.vx *= damp;
      flake.vy *= damp;
      flake.vz *= damp;
      flake.x += flake.vx * dt;
      flake.y += flake.vy * dt;
      flake.z += flake.vz * dt;
      flake.age += dt;
      if (flake.age >= flake.life || flake.y < flake.spawnY - flake.fall) flake.alive = false;
      else alive += 1;
    }
    this.aliveCount = alive;
  }

  private spawn(dt: number, input: SprayInput): void {
    if (input.grounded === false) return;
    const vx = input.velocity.x;
    const vy = input.velocity.y;
    const vz = input.velocity.z;
    const speed = Math.hypot(vx, vy, vz);
    const speed01 = smoothstep(1.4, 10, speed);
    const skid = clamp01(input.skid);
    const carving = clamp01(input.carving);
    const powder = clamp01(input.powder ?? 0);
    const rate = (4 + skid * 120 + carving * (60 + carving * 110) + powder * (120 + skid * 70)) * speed01 * Math.max(this.amount, 0);
    this.spawnDebt += rate * dt;
    const continuous = Math.min(32, Math.floor(this.spawnDebt));
    const impact = clamp01(input.impact ?? 0);
    const count = continuous + Math.round(impact * 16);
    this.spawnDebt -= continuous;
    if (count <= 0) return;

      const lateral = input.lateral;
      const hasLateral = lateral !== undefined && lateral.lengthSq() > 1e-4;
      const invSpeed = 1 / Math.max(0.01, speed);
      const dirX = vx * invSpeed;
      const dirY = vy * invSpeed;
      const dirZ = vz * invSpeed;

      for (let n = 0; n < count; n += 1) {
        const flake = this.acquire();
        if (!flake) return;
        const jx = Math.random() - 0.5;
        const jy = Math.random();
        const jz = Math.random() - 0.5;
        flake.x = input.position.x + jx * (0.08 + skid * 0.25);
        flake.y = input.position.y + 0.06 + jy * (0.05 + powder * 0.22);
        flake.z = input.position.z + jz * (0.08 + skid * 0.25);
        flake.spawnY = flake.y;
        const backKick = 0.7 + skid * 2.6 + powder * 1.55;
        flake.vx = vx * 0.22 - dirX * backKick + jx * (0.45 + skid * 2);
        flake.vy = 0.9 + skid * 2.3 + carving * (0.6 + jy * 1.1) + jy * 0.7 + Math.abs(dirY) * 0.3 + powder * (1.1 + jy * 1.8);
        flake.vz = vz * 0.22 - dirZ * backKick + jz * (0.45 + skid * 2);
        if (hasLateral && lateral) {
          const side = (carving * (2.2 + jy * 2.2) + skid * 0.65 + powder * (1.1 + skid * 2.0)) * Math.min(speed / 9, 1.6);
          flake.vx += lateral.x * side;
          flake.vy += lateral.y * side * 0.2 + powder * 0.35;
          flake.vz += lateral.z * side;
        }
      flake.vx += jx * impact * 5;
      flake.vz += jz * impact * 5;
      flake.vy += impact + powder * (0.95 + jy * 2.1);
      flake.age = 0;
      flake.life = 0.6 + Math.random() * 0.45 + skid * 0.2 + powder * 0.38;
      flake.size = 0.07 + carving * 0.07 + skid * 0.16 + Math.random() * 0.06;
      flake.size += (powder * 0.4 + impact * 0.2) * jy;
      flake.stretch = (0.06 + carving * 0.14) * (1 - powder * 0.8);
      flake.peak = (0.42 + skid * 0.28 + carving * 0.3) * (1 - powder * 0.5);
      flake.fall = 0.18 + skid * 0.45;
      flake.alive = true;
      this.aliveCount += 1;
    }
  }

  private acquire(): Flake | null {
    for (let i = 0; i < this.max; i += 1) {
      const flake = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
      if (!flake.alive) return flake;
    }
    return null;
  }

  private write(): void {
    let n = 0;
    for (const flake of this.pool) {
      if (!flake.alive) continue;
      const t = flake.age / flake.life;
      const fadeIn = Math.min(1, flake.age / 0.04);
      const o3 = n * 3;
      this.offsets[o3] = flake.x;
      this.offsets[o3 + 1] = flake.y;
      this.offsets[o3 + 2] = flake.z;
      this.velocities[o3] = flake.vx;
      this.velocities[o3 + 1] = flake.vy;
      this.velocities[o3 + 2] = flake.vz;
      this.sprites[o3] = flake.size;
      this.sprites[o3 + 1] = flake.stretch;
      this.sprites[o3 + 2] = fadeIn * (1 - t) * flake.peak;
      n += 1;
    }
    for (const name of ['aOffset', 'aVelocity', 'aSprite']) {
      const attr = this.geometry.getAttribute(name) as InstancedBufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 3);
      attr.needsUpdate = true;
    }
    this.geometry.instanceCount = n;
    this.object.visible = n > 0;
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
