import * as THREE from 'three'
import { SkiTracks, SnowSpray, Snowfall, type SnowMaterial } from '../fx'
import { skiFrame, type SkiState, type SurfaceSample } from '../sim'
import type { Lighting } from '../render/lighting'

/** Spray, ski tracks and light snowfall driven by the sim state. */
export function createSnowEffects(
  scene: THREE.Scene,
  lighting: Lighting,
  pixelRatio: number,
  budget: { sprayParticles: number; snowflakes: number; trackResolution: number },
) {
  const spray = new SnowSpray({ maxParticles: budget.sprayParticles })
  const snowfall = new Snowfall({ count: budget.snowflakes, boxMetres: 60, pixelRatio })
  snowfall.setDensity(0.55)
  snowfall.setWind(0.6, 0.3)
  const tracks = new SkiTracks({ windowMetres: 112, resolution: budget.trackResolution })
  const shadow = makeContactShadow()
  const linearSun = new THREE.Vector3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b)
  const linearSky = new THREE.Vector3(lighting.skyColor.r, lighting.skyColor.g, lighting.skyColor.b)
  tracks.setSun(lighting.sunDirection, linearSun, linearSky)
  tracks.setFog(lighting.fogDensity, new THREE.Vector3(lighting.fogColor.r, lighting.fogColor.g, lighting.fogColor.b))
  scene.add(spray.object, snowfall.object, tracks.object, shadow)

  const left = new THREE.Vector3()
  const right = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const side = new THREE.Vector3()

  let wasAirborne = false
  let descent = 0

  return {
    /** One wide track for a snowboard, two narrow ones for skis. */
    setBoard(on: boolean) {
      tracks.stance = on ? 0 : 0.28
      tracks.skiWidth = on ? 0.27 : 0.11
    },
    setWeather(density: number, windEast: number, windSouth: number, lighting: Lighting) {
      snowfall.setDensity(density)
      snowfall.setWind(windEast, windSouth)
      const linearSun = new THREE.Vector3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b)
      const linearSky = new THREE.Vector3(lighting.skyColor.r, lighting.skyColor.g, lighting.skyColor.b)
      tracks.setSun(lighting.sunDirection, linearSun, linearSky)
      tracks.setFog(lighting.fogDensity, new THREE.Vector3(lighting.fogColor.r, lighting.fogColor.g, lighting.fogColor.b))
    },
    clear() {
      wasAirborne = false
      descent = 0
      spray.clear()
      tracks.clear()
    },
    update(dt: number, state: SkiState, ground: SurfaceSample | null, camera: THREE.Camera, material: SnowMaterial | null, contactShadow: boolean) {
      snowfall.update(dt, camera.position)
      shadow.visible = false
      if (!ground || state.offMap) {
        wasAirborne = false
        descent = 0
        spray.update(dt, [])
        tracks.update(dt, null)
        return
      }
      const frame = skiFrame(state.heading, ground.normal)
      if (contactShadow && state.y - ground.height < 3) {
        const height = Math.max(0, state.y - ground.height)
        shadow.visible = true
        shadow.position.set(state.x, ground.height + 0.045, state.z)
        shadow.quaternion.setFromUnitVectors(up, normal.set(ground.normal.x, ground.normal.y, ground.normal.z))
        const spread = 1 + height * 0.34
        shadow.scale.set(0.68 * spread, 1, 1.14 * spread)
        shadow.material.uniforms.uOpacity.value = 0.29 * (1 - height / 3) ** 2
      }
      side.set(frame.side.x, frame.side.y, frame.side.z)
      centre.set(state.x, state.y, state.z)
      left.copy(centre).addScaledVector(side, -0.16)
      right.copy(centre).addScaledVector(side, 0.16)
      velocity.set(state.vx, state.vy, state.vz)
      normal.set(ground.normal.x, ground.normal.y, ground.normal.z)
      const carving = state.mode === 'carving' ? Math.min(1, Math.abs(state.edgeAngle) / 0.7) : 0
      // Outside of the turn: away from the edged side.
      lateral.copy(side).multiplyScalar(state.edgeAngle >= 0 ? -1 : 1)
      const fast = Math.min(1, state.speed / 6)
      // The buried area and travel speed drive displaced snow; side slips push more aside.
      const powder = Math.min(1, state.sink * (2.1 + state.skid * 1.9) + Math.min(state.sink, state.surface.depth) * fast)
      const skid = Math.min(1, (state.mode === 'braking' ? Math.max(state.skid, 0.7) : state.skid) * fast)
      const grounded = state.grounded && !state.rail && state.crashed <= 0
      const impact = wasAirborne && state.grounded ? Math.min(1, descent / 9) : 0
      wasAirborne = !state.grounded
      descent = wasAirborne ? Math.max(0, -state.vy) : 0
      spray.update(dt, [
        { position: left, velocity, skid, carving: carving * fast, lateral, grounded: grounded || impact > 0, powder, impact },
        { position: right, velocity, skid, carving: carving * fast, lateral, grounded: grounded || impact > 0, powder, impact },
      ])
      tracks.update(dt, { position: centre, direction: velocity, normal, skid, carving, powder, grounded })
      material?.setTrackMap(tracks.stampTexture, tracks.originX, tracks.originZ, tracks.windowMetres, tracks.resolution)
    },
  }
}

const up = new THREE.Vector3(0, 1, 0)

/** A soft ground-contact cue for rendering without the directional shadow map. */
function makeContactShadow() {
  const geometry = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float softness = 1.0 - smoothstep(0.08, 1.0, dot(vUv, vUv));
        gl_FragColor = vec4(0.08, 0.15, 0.22, softness * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  })
  const shadow = new THREE.Mesh(geometry, material)
  shadow.name = 'rider contact shadow'
  shadow.visible = false
  return shadow
}
