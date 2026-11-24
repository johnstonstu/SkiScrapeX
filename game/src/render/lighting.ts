import * as THREE from 'three'

/** Clear late-morning winter light over Apex. Shared by the snow shader and the scene. */
export interface Lighting {
  sunDirection: THREE.Vector3
  sunColor: THREE.Color
  skyColor: THREE.Color
  groundColor: THREE.Color
  fogColor: THREE.Color
  fogDensity: number
  horizon: THREE.Color
  zenith: THREE.Color
}

export function createLighting(): Lighting {
  return {
    // Low southeast light picks out the sides of rollers and groomed banks.
    sunDirection: new THREE.Vector3(0.67, 0.43, 0.60).normalize(),
    sunColor: new THREE.Color('#fff0d7'),
    skyColor: new THREE.Color('#b5d1ee'),
    groundColor: new THREE.Color('#aeb4b6'),
    fogColor: new THREE.Color('#cfdde9'),
    fogDensity: 0.00008,
    horizon: new THREE.Color('#cddfed'),
    zenith: new THREE.Color('#3472b8'),
  }
}

/** Scene lights for everything that is not the snow shader (trees, skier, lifts). */
export function addSceneLights(scene: THREE.Scene, lighting: Lighting, shadowRange = 110): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(lighting.skyColor, lighting.groundColor, 1.1))
  const sun = new THREE.DirectionalLight(lighting.sunColor, 2.0)
  sun.position.copy(lighting.sunDirection).multiplyScalar(1000)
  // Shadows cover a box around the skier; main.ts moves the light with them.
  sun.castShadow = true
  setShadowRange(sun, shadowRange)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 1600
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.5
  sun.shadow.radius = 2
  scene.add(sun, sun.target)
  // Linear fog keeps distant ridges readable; roughly matches the snow shader's exp fog.
  scene.fog = new THREE.Fog(lighting.fogColor, 200, 24000)
  return sun
}

/** Orthographic shadow box half-extent in metres (High uses a longer reach). */
export function setShadowRange(sun: THREE.DirectionalLight, half: number): void {
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.updateProjectionMatrix()
  sun.userData.shadowRange = half
}

/** Keep the shadow box centred a little ahead of the skier. */
export function followSun(sun: THREE.DirectionalLight, lighting: Lighting, focus: THREE.Vector3): void {
  // Snap to whole shadow texels so shadows do not shimmer as the box moves.
  const half = typeof sun.userData.shadowRange === 'number' ? sun.userData.shadowRange : 110
  const texel = ((half * 2) / sun.shadow.mapSize.x) * 4
  const fx = Math.round(focus.x / texel) * texel
  const fz = Math.round(focus.z / texel) * texel
  sun.target.position.set(fx, focus.y, fz)
  sun.position.set(fx, focus.y, fz).addScaledVector(lighting.sunDirection, 800)
  sun.target.updateMatrixWorld()
}

/** Gradient sky dome that follows the camera. */
export function createSky(lighting: Lighting): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uHorizon: { value: lighting.horizon },
      uZenith: { value: lighting.zenith },
      uSun: { value: lighting.sunDirection },
      uSunColor: { value: lighting.sunColor },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0; float a = 0.5;
        for (int i = 0; i < 5; i++) { v += noise(p) * a; p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.5));
        float s = max(dot(dir, normalize(uSun)), 0.0);
        // Thin fair-weather cumulus on a flat layer above the camera.
        if (dir.y > 0.01) {
          vec2 uv = dir.xz / (dir.y + 0.08) * 1.6;
          float c = smoothstep(0.52, 0.78, fbm(uv + vec2(3.1, 9.7)));
          float edge = smoothstep(0.01, 0.18, dir.y);
          vec3 cloud = mix(vec3(0.78, 0.82, 0.88), vec3(1.0, 0.98, 0.95), smoothstep(0.5, 0.9, fbm(uv * 1.7 + 4.0)) * 0.6 + s * 0.4);
          col = mix(col, cloud, c * edge * 0.85);
        }
        col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material)
  sky.scale.setScalar(20000)
  sky.frustumCulled = false
  sky.renderOrder = -1
  return sky
}
