import * as THREE from 'three'
import { SkiTracks, SnowPuff, SnowSpray, Snowfall, SpeedStreaks, type SnowMaterial, type SprayInput } from '../fx'
import { skiFrame, type SkiState, type SurfaceSample } from '../sim'
import type { Lighting } from '../render/lighting'

/** Pool sizes per quality level (see QUALITY in app/settings.ts). */
export interface SnowEffectsBudget {
  sprayParticles: number
  snowflakes: number
  trackResolution: number
  /** Powder clouds for landings, crashes and deep turns. Large and transparent, so kept small. */
  powderClouds: number
  /** Speed streaks at the edges of the view; 0 turns them off. */
  speedStreaks: number
}

/**
 * Spray, powder clouds, ski tracks, speed streaks and light snowfall, all
 * read from the sim state. Nothing here writes back to the sim.
 */
export function createSnowEffects(
  scene: THREE.Scene,
  lighting: Lighting,
  pixelRatio: number,
  budget: SnowEffectsBudget,
) {
  const spray = new SnowSpray({ maxParticles: budget.sprayParticles })
  const puffs = new SnowPuff({ maxPuffs: budget.powderClouds })
  const streaks = budget.speedStreaks > 0 ? new SpeedStreaks({ count: budget.speedStreaks }) : null
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  const snowfall = new Snowfall({ count: budget.snowflakes, boxMetres: 60, pixelRatio })
  snowfall.setDensity(0.55)
  snowfall.setWind(0.6, 0.3)
  const tracks = new SkiTracks({ windowMetres: 112, resolution: budget.trackResolution })
  const shadow = makeContactShadow()
  const linearSun = new THREE.Vector3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b)
  const linearSky = new THREE.Vector3(lighting.skyColor.r, lighting.skyColor.g, lighting.skyColor.b)
  tracks.setSun(lighting.sunDirection, linearSun, linearSky)
  tracks.setFog(lighting.fogDensity, new THREE.Vector3(lighting.fogColor.r, lighting.fogColor.g, lighting.fogColor.b))
  scene.add(spray.object, puffs.object, snowfall.object, tracks.object, shadow)
  if (streaks) scene.add(streaks.object)
  lightParticles(lighting)

  const left = new THREE.Vector3()
  const right = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const side = new THREE.Vector3()

  let wasAirborne = false
  let descent = 0
  let wasCrashed = false
  // Reused every frame: two skis, plus the body during a crash.
  const leftInput: SprayInput = { position: left, velocity, skid: 0, carving: 0, lateral }
  const rightInput: SprayInput = { position: right, velocity, skid: 0, carving: 0, lateral }
  const bodyInput: SprayInput = { position: centre, velocity, skid: 0, carving: 0, lateral }
  const twoContacts = [leftInput, rightInput]
  const threeContacts = [leftInput, rightInput, bodyInput]
  function setSpray(input: SprayInput, skid: number, carving: number, grounded: boolean, powder: number, impact: number) {
    input.skid = skid
    input.carving = carving
    input.grounded = grounded
    input.powder = powder
    input.impact = impact
  }

  /** Tint spray and clouds from the scene's sun and sky, relative to the default midday light. */
  function lightParticles(light: Lighting) {
    for (const [target, base, sunShare, skyShare] of [
      [lit, LIT_NOON, 0.6, 0.4],
      [shade, SHADE_NOON, 0.25, 0.75],
    ] as const) {
      target.setRGB(
        base.r * (light.sunColor.r * sunShare + light.skyColor.r * skyShare) / (NOON_SUN.r * sunShare + NOON_SKY.r * skyShare),
        base.g * (light.sunColor.g * sunShare + light.skyColor.g * skyShare) / (NOON_SUN.g * sunShare + NOON_SKY.g * skyShare),
        base.b * (light.sunColor.b * sunShare + light.skyColor.b * skyShare) / (NOON_SUN.b * sunShare + NOON_SKY.b * skyShare),
      )
    }
    spray.setLight(lit, shade)
    // Clouds need a deeper shade than flakes: white on white snow otherwise disappears.
    puffs.setLight(lit, puffShade.copy(shade).multiply(PUFF_SHADE_SCALE))
  }

  /** Powder clouds: a landing bloom, a crash burst and a plume behind deep turns. */
  function updatePuffs(dt: number, state: SkiState, powder: number, skid: number, impact: number, crashStart: boolean, tumble: number) {
    const loose = Math.max(powder, state.surface.depth > 0.05 ? 0.4 : 0)
    if (impact > 0.12) {
      puffs.burst(centre, velocity, {
        count: 3 + impact * (6 + loose * 7),
        size: 0.35 + impact * 0.35 + loose * 0.25,
        spread: 1.2 + impact * 2.4 + state.speed * 0.06,
        rise: 0.8 + impact * 1.4,
        life: 0.9 + impact * 0.6 + loose * 0.6,
        opacity: 0.6 + impact * 0.3 + loose * 0.1,
        carry: 0.85,
      })
    }
    if (crashStart) {
      const hit = Math.min(1, state.crashSpeed / 14)
      puffs.burst(centre, velocity, {
        count: 6 + hit * 10,
        size: 0.65 + hit * 0.5,
        spread: 1.8 + hit * 2.8,
        rise: 0.9 + hit * 1.1,
        life: 1.4 + hit * 0.7,
        opacity: 0.75,
        carry: 0.5,
      })
    }
    // Plumes: deep snow at speed, the crash slide, and a little on a hard skidded stop.
    const fast = THREE.MathUtils.smoothstep(state.speed, 3, 14)
    const plume = state.grounded && state.crashed <= 0 ? powder * fast * (5 + skid * 6) + skid * fast * 1.5 : 0
    puffs.trail(dt, centre, velocity, plume + tumble * 12, 0.35 + powder * 0.3 + tumble * 0.25, 0.22 + powder * 0.18 + tumble * 0.2)
    puffs.update(dt)
  }

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
      lightParticles(lighting)
    },
    /**
     * Ribbon tracks sit just above the snow surface. Where the deep-snow patch
     * draws real trenches they would float over them, so they fade out in loose
     * snow; on groomers they still draw two clean carve lines.
     */
    setDeepSnowPatch(active: boolean) {
      tracks.deepSnowPatch = active
    },
    clear() {
      wasAirborne = false
      descent = 0
      wasCrashed = false
      spray.clear()
      puffs.clear()
      tracks.clear()
    },
    /** Live counts, for the perf overlay and headless checks. */
    get stats() {
      return { spray: spray.alive, clouds: puffs.alive, streaks: streaks?.level ?? 0 }
    },
    update(dt: number, state: SkiState, ground: SurfaceSample | null, camera: THREE.Camera, material: SnowMaterial | null, contactShadow: boolean) {
      snowfall.update(dt, camera.position)
      velocity.set(state.vx, state.vy, state.vz)
      // Sense of speed from about 50 km/h, full by 90 km/h; a tuck brings it on a little sooner.
      const streakTarget = ground && !state.offMap && !reducedMotion?.matches
        ? THREE.MathUtils.smoothstep(state.speed + (state.tuck ? 3 : 0), 14, 25)
        : 0
      streaks?.update(dt, camera.position, velocity, streakTarget)
      shadow.visible = false
      if (!ground || state.offMap) {
        wasAirborne = false
        descent = 0
        wasCrashed = false
        spray.update(dt, [])
        puffs.update(dt)
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
      normal.set(ground.normal.x, ground.normal.y, ground.normal.z)
      // Carve spray grows with edge angle: a whisper on a shallow edge, a fan when laid over.
      const carving = state.mode === 'carving' ? THREE.MathUtils.smoothstep(Math.abs(state.edgeAngle), 0.08, 0.75) : 0
      // Outside of the turn: away from the edged side.
      lateral.copy(side).multiplyScalar(state.edgeAngle >= 0 ? -1 : 1)
      const fast = Math.min(1, state.speed / 6)
      // The buried area and travel speed drive displaced snow; side slips push more aside.
      // Face-shot energy: buried area × speed × slip throws a Steep-style plume.
      const powder = Math.min(
        1,
        state.sink * (2.8 + state.skid * 2.6) + Math.min(state.sink, state.surface.depth) * fast * 1.35 + state.unweight * 0.45,
      )
      spray.amount = 0.85 + powder * 0.55
      const skid = Math.min(1, (state.mode === 'braking' ? Math.max(state.skid, 0.7) : state.skid) * fast)
      const grounded = state.grounded && !state.rail && state.crashed <= 0
      const impact = wasAirborne && state.grounded ? Math.min(1, descent / 9) : 0
      wasAirborne = !state.grounded
      descent = wasAirborne ? Math.max(0, -state.vy) : 0
      // Weight the outside ski in a carve: it throws most of the fan.
      const outsideLeft = state.edgeAngle >= 0
      const carveFast = carving * fast
      const crashing = state.crashed > 0
      const crashStart = crashing && !wasCrashed
      wasCrashed = crashing
      const tumble = crashing && state.crashAge < 1.4 && state.speed > 1.5 ? Math.min(1, state.speed / 10) : 0
      const contact = grounded || impact > 0
      setSpray(leftInput, skid, carveFast * (outsideLeft ? 1.25 : 0.7), contact, powder, impact)
      setSpray(rightInput, skid, carveFast * (outsideLeft ? 0.7 : 1.25), contact, powder, impact)
      // A crash ploughs the body through the snow.
      setSpray(bodyInput, tumble, 0, true, Math.max(powder, 0.4) * tumble, crashStart ? 1 : 0)
      spray.update(dt, tumble > 0 ? threeContacts : twoContacts)
      updatePuffs(dt, state, powder, skid, impact, crashStart, tumble)
      tracks.update(dt, { position: centre, direction: velocity, normal, skid, carving, powder, grounded })
      material?.setTrackMap(tracks.stampTexture, tracks.originX, tracks.originZ, tracks.windowMetres, tracks.resolution)
    },
  }
}

const up = new THREE.Vector3(0, 1, 0)
const NOON_SUN = new THREE.Color('#fff0d7')
const NOON_SKY = new THREE.Color('#b5d1ee')
const LIT_NOON = new THREE.Color(0.97, 0.98, 0.99)
const SHADE_NOON = new THREE.Color(0.74, 0.81, 0.89)
const lit = new THREE.Color()
const shade = new THREE.Color()
const puffShade = new THREE.Color()
const PUFF_SHADE_SCALE = new THREE.Color(0.5, 0.58, 0.72)

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
