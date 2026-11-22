import {
  BufferAttribute,
  BufferGeometry,
  NormalBlending,
  Points,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

export interface SnowfallOptions {
  /** Hard cap on flakes. Density only draws a prefix of this pool. */
  count?: number;
  /** World size of the box that follows the camera, metres. */
  boxMetres?: number;
  pixelRatio?: number;
}

const vertexShader = /* glsl */ `
uniform float uTime;
uniform vec3 uFocus;
uniform vec2 uWind;
uniform float uBox;
uniform float uPixelRatio;

varying float vAlpha;

void main() {
  vec3 seed = position;
  float speed = 0.85 + seed.y * 1.7;
  vec3 world = seed * uBox;
  world.y -= uTime * speed;
  world.x += uTime * uWind.x + sin(uTime * 1.3 + seed.x * 24.0) * 0.35;
  world.z += uTime * uWind.y;
  vec3 rel = world - uFocus;
  rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wrapped = rel + uFocus;
  vec4 view = viewMatrix * vec4(wrapped, 1.0);
  gl_Position = projectionMatrix * view;
  float dist = max(-view.z, 0.4);
  gl_PointSize = (1.5 + seed.x * 2.6) * uPixelRatio * clamp(18.0 / dist, 0.4, 1.7);
  float edge = uBox * 0.5 - max(abs(rel.x), max(abs(rel.y), abs(rel.z)));
  vAlpha = smoothstep(0.0, 7.0, edge) * (0.35 + seed.z * 0.4);
}
`;

const fragmentShader = /* glsl */ `
varying float vAlpha;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float alpha = smoothstep(1.0, 0.2, r) * vAlpha;
  if (alpha < 0.03) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 0.99), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Ambient snowfall. Motion is entirely in the vertex shader: a fixed set of
 * seeds falls in world space and wraps inside a box around the camera.
 * Memory is one point buffer and does not grow.
 */
export class Snowfall {
  readonly object: Points;
  private readonly geometry: BufferGeometry;
  private readonly count: number;
  private readonly uniforms: {
    uTime: { value: number };
    uFocus: { value: Vector3 };
    uWind: { value: Vector2 };
    uBox: { value: number };
    uPixelRatio: { value: number };
  };
  private time = 0;
  private enabled = true;
  private density = 0.75;

  constructor(options: SnowfallOptions = {}) {
    this.count = options.count ?? 4200;
    const seeds = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i += 1) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(seeds, 3));
    this.geometry.setDrawRange(0, Math.floor(this.count * this.density));

    this.uniforms = {
      uTime: { value: 0 },
      uFocus: { value: new Vector3() },
      uWind: { value: new Vector2(1.4, 0.3) },
      uBox: { value: options.boxMetres ?? 52 },
      uPixelRatio: { value: options.pixelRatio ?? 1 },
    };
    const material = new ShaderMaterial({
      name: 'snowfall',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      toneMapped: true,
    });
    this.object = new Points(this.geometry, material);
    this.object.name = 'snowfall';
    this.object.frustumCulled = false;
    this.object.renderOrder = 3;
  }

  get capacity(): number {
    return this.count;
  }

  update(dt: number, focus: Vector3): void {
    this.time += Math.min(Math.max(dt, 0), 0.05);
    this.uniforms.uTime.value = this.time;
    this.uniforms.uFocus.value.copy(focus);
    this.object.visible = this.enabled && this.density > 0.01;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.object.visible = enabled && this.density > 0.01;
  }

  /** 0 hides every flake, 1 draws the whole pool. */
  setDensity(density: number): void {
    this.density = Math.min(1, Math.max(0, density));
    this.geometry.setDrawRange(0, Math.floor(this.count * this.density));
    this.object.visible = this.enabled && this.density > 0.01;
  }

  /** Wind in metres per second. X is east, Z is south. */
  setWind(east: number, south: number): void {
    this.uniforms.uWind.value.set(east, south);
  }

  setPixelRatio(pixelRatio: number): void {
    this.uniforms.uPixelRatio.value = pixelRatio;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
  }
}
