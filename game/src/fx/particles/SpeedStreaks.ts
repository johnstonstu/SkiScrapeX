import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineSegments,
  ShaderMaterial,
  Vector3,
} from 'three';

export interface SpeedStreaksOptions {
  /** Hard cap on streaks. Strength draws them all; the count is fixed. */
  count?: number;
  /** World size of the box that follows the camera, metres. */
  boxMetres?: number;
}

const vertexShader = /* glsl */ `
attribute float aEnd;

uniform vec3 uFocus;
uniform vec3 uVelocity;
uniform float uBox;
uniform float uExposure;
uniform float uStrength;

varying float vAlpha;

void main() {
  // Seeds are fixed in the world and wrap in a box around the camera, so the
  // camera flies through them. Each line is the smear of one airborne flake
  // over a short exposure: from where it is toward where it was, relative to the rider.
  vec3 world = position * uBox;
  vec3 rel = world - uFocus;
  rel = mod(rel + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 head = rel + uFocus;
  vec3 tail = head + uVelocity * uExposure;
  vec3 p = mix(head, tail, aEnd);
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  vec2 ndc = gl_Position.xy / max(gl_Position.w, 0.001);
  // Keep the middle of the screen (the rider) clear; streaks live at the edges.
  float edge = smoothstep(0.25, 0.75, length(ndc * vec2(1.0, 1.3)));
  float dist = -view.z;
  float near = smoothstep(1.2, 3.5, dist) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist));
  float seed = fract(position.x * 13.7 + position.z * 7.3);
  vAlpha = uStrength * edge * near * (0.35 + 0.65 * seed) * (1.0 - aEnd);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  if (vAlpha < 0.004) discard;
  gl_FragColor = vec4(uColor * vAlpha, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Sense of speed: faint wind-blown snow streaks that only show at high speed
 * and only toward the edges of the view. Motion is in the vertex shader; the
 * buffer is fixed. One line draw, additive, so it never darkens the scene.
 */
export class SpeedStreaks {
  readonly object: LineSegments;
  private readonly geometry: BufferGeometry;
  private readonly uniforms: {
    uFocus: { value: Vector3 };
    uVelocity: { value: Vector3 };
    uBox: { value: number };
    uExposure: { value: number };
    uStrength: { value: number };
    uColor: { value: Vector3 };
  };
  private strength = 0;
  private enabled = true;

  constructor(options: SpeedStreaksOptions = {}) {
    const count = Math.max(0, options.count ?? 400);
    const positions = new Float32Array(count * 2 * 3);
    const ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let k = 0; k < 2; k += 1) {
        const o = (i * 2 + k) * 3;
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        ends[i * 2 + k] = k;
      }
    }
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setAttribute('aEnd', new BufferAttribute(ends, 1));
    this.uniforms = {
      uFocus: { value: new Vector3() },
      uVelocity: { value: new Vector3() },
      uBox: { value: options.boxMetres ?? 26 },
      uExposure: { value: 0.07 },
      uStrength: { value: 0 },
      uColor: { value: new Vector3(0.85, 0.9, 0.95) },
    };
    const material = new ShaderMaterial({
      name: 'speed-streaks',
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.object = new LineSegments(this.geometry, material);
    this.object.name = 'speed-streaks';
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.object.visible = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.object.visible = false;
  }

  /** Current 0-1 strength after easing, for tests and the HUD. */
  get level(): number {
    return this.strength;
  }

  /**
   * `velocity` is the rider's world velocity in m/s; `target` 0-1 is how strong
   * the streaks should be. Eased so a single bump does not flash them on.
   */
  update(dt: number, focus: Vector3, velocity: Vector3, target: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    const want = this.enabled ? Math.min(1, Math.max(0, target)) : 0;
    this.strength += (want - this.strength) * (1 - Math.exp(-(want > this.strength ? 3 : 5) * step));
    this.uniforms.uStrength.value = this.strength * 0.55;
    this.uniforms.uFocus.value.copy(focus);
    this.uniforms.uVelocity.value.copy(velocity);
    this.object.visible = this.strength > 0.01;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.object.material as ShaderMaterial).dispose();
  }
}
