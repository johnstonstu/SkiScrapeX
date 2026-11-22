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
  const linearSun = new THREE.Vector3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b)
  const linearSky = new THREE.Vector3(lighting.skyColor.r, lighting.skyColor.g, lighting.skyColor.b)
  tracks.setSun(lighting.sunDirection, linearSun, linearSky)
  tracks.setFog(lighting.fogDensity, new THREE.Vector3(lighting.fogColor.r, lighting.fogColor.g, lighting.fogColor.b))
  scene.add(spray.object, snowfall.object, tracks.object)

  const left = new THREE.Vector3()
  const right = new THREE.Vector3()
  const centre = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  const lateral = new THREE.Vector3()
  const normal = new THREE.Vector3()

  let wasAirborne = false
  let descent = 0

  return {
    /** One wide track for a snowboard, two narrow ones for skis. */
    setBoard(on: boolean) {
      tracks.stance = on ? 0 : 0.28
      tracks.skiWidth = on ? 0.27 : 0.11
    },
    clear() {
      wasAirborne = false
      descent = 0
      spray.clear()
      tracks.clear()
    },
    update(dt: number, state: SkiState, ground: SurfaceSample | null, camera: THREE.Camera, material: SnowMaterial | null) {
      snowfall.update(dt, camera.position)
      if (!ground || state.offMap) {
        wasAirborne = false
        descent = 0
        const impact = wasAirborne && state.grounded ? Math.min(1, descent / 9) : 0
      wasAirborne = !state.grounded
      descent = wasAirborne ? Math.max(0, -state.vy) : 0
      spray.update(dt, [])
        tracks.update(dt, null)
        return
      }
      const frame = skiFrame(state.heading, ground.normal)
      const side = new THREE.Vector3(frame.side.x, frame.side.y, frame.side.z)
      centre.set(state.x, state.y, state.z)
      left.copy(centre).addScaledVector(side, -0.16)
      right.copy(centre).addScaledVector(side, 0.16)
      velocity.set(state.vx, state.vy, state.vz)
      normal.set(ground.normal.x, ground.normal.y, ground.normal.z)
      const carving = state.mode === 'carving' ? Math.min(1, Math.abs(state.edgeAngle) / 0.7) : 0
      // Outside of the turn: away from the edged side.
      lateral.copy(side).multiplyScalar(state.edgeAngle >= 0 ? -1 : 1)
      const fast = Math.min(1, state.speed / 6)
      // Powder throws a plume proportional to how deep the skis run.
      const powder = Math.min(1, state.sink * 3)
      const skid = Math.min(1, (state.mode === 'braking' ? Math.max(state.skid, 0.7) : state.skid) * fast + powder * fast * 0.8)
      const grounded = state.grounded && !state.rail && state.crashed <= 0
      const impact = wasAirborne && state.grounded ? Math.min(1, descent / 9) : 0
      wasAirborne = !state.grounded
      descent = wasAirborne ? Math.max(0, -state.vy) : 0
      spray.update(dt, [
        { position: left, velocity, skid, carving: carving * fast, lateral, grounded: grounded || impact > 0, powder, impact },
        { position: right, velocity, skid, carving: carving * fast, lateral, grounded: grounded || impact > 0, powder, impact },
      ])
      tracks.update(dt, { position: centre, direction: velocity, normal, skid, carving, grounded })
      material?.setTrackMap(tracks.stampTexture, tracks.originX, tracks.originZ, tracks.windowMetres, tracks.resolution)
    },
  }
}
