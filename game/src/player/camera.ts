import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fallLineHeading, type SampleTerrain, type SkiState, type TrickEvent } from '../sim'

export type CameraMode = 'follow' | 'first' | 'orbit'
/**
 * `steady` holds the view down the hill and lets the skier swing across it,
 * like a follow-cam filmer; `tight` turns with the skis.
 */
export type CameraStyle = 'steady' | 'tight'

/**
 * Third-person follow camera that leans toward the travel direction, plus a
 * free orbit view for looking around the mountain.
 */
export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
  const target = new THREE.Vector3()
  const desired = new THREE.Vector3()
  const orbit = new OrbitControls(camera, dom)
  orbit.enabled = false
  orbit.enableDamping = true
  orbit.maxPolarAngle = Math.PI * 0.49
  orbit.minDistance = 4
  orbit.maxDistance = 4000
  let lookHeight = 0
  let heading = 0
  let snap = true
  /** Heading snaps but the position eases in: handing over from a held shot without a cut. */
  let ease = false
  /** A fixed shot (lift arrivals): where the camera waits and what it watches. */
  let shot: { position: THREE.Vector3; look: THREE.Vector3 } | null = null
  const shotLook = new THREE.Vector3()
  let mode: CameraMode = 'follow'
  let style: CameraStyle = 'steady'
  const eyeQuat = new THREE.Quaternion()
  const lookDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.25)
  // Three.js cameras look down -Z; the skier faces +Z, so turn the camera around.
  const turnAround = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  const eyePos = new THREE.Vector3()
  const smoothQuat = new THREE.Quaternion()
  let baseFov = camera.fov
  let shake = 1
  let landing = 0
  /** Extra degrees of FOV from speed; eased so it does not pump on every turn. */
  let speedFov = 0
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')

  const applyFov = () => {
    if (mode === 'first') {
      camera.fov = 85
    } else if (mode === 'follow') {
      camera.fov = baseFov + speedFov
    } else {
      camera.fov = baseFov
    }
    camera.updateProjectionMatrix()
  }

  return {
    get mode() {
      return mode
    },
    /** Follow-camera field of view, degrees. */
    setFov(fov: number) {
      baseFov = fov
      applyFov()
    },
    setStyle(next: CameraStyle) {
      style = next
    },
    /** 0 turns chatter shake and speed FOV off. */
    /** In orbit view, the point the camera looks at (the orbit target); otherwise null. */
    get focus(): THREE.Vector3 | null {
      return mode === 'orbit' ? orbit.target : null
    },
    setShake(amount: number) {
      shake = amount
      if (amount === 0) speedFov = 0
      applyFov()
    },
    landingImpulse(trick: TrickEvent) {
      if (mode !== 'follow' || motion.matches || shake === 0) return
      landing = Math.max(landing, THREE.MathUtils.clamp(0.035 + trick.efh * 0.062, 0.035, 0.25))
    },
    snap() {
      snap = true
      landing = 0
      speedFov = 0
      applyFov()
    },
    /**
     * Hold a shot from `position` watching `look` (both copied), e.g. beside a
     * lift's top station so the camera never drives through the terminal.
     */
    holdShot(position: THREE.Vector3, look: THREE.Vector3) {
      if (!shot) {
        shot = { position: position.clone(), look: look.clone() }
        shotLook.copy(look)
        return
      }
      shot.position.copy(position)
      shot.look.copy(look)
    },
    /** Back to the follow camera, easing out of the held shot rather than cutting. */
    releaseShot() {
      if (!shot) return
      shot = null
      snap = false
      ease = true
    },
    get holding() {
      return shot !== null
    },
    setMode(next: CameraMode, state: SkiState) {
      mode = next
      orbit.enabled = next === 'orbit'
      camera.near = next === 'first' ? 0.05 : 0.25
      applyFov()
      if (next === 'orbit') {
        orbit.target.set(state.x, state.y + 1, state.z)
        camera.position.set(state.x + 140, state.y + 120, state.z - 160)
        orbit.update()
      } else {
        snap = true
      }
    },
    /**
     * `blocked(x, z)` reports a tree or wall at a candidate camera spot; the
     * camera then pulls in toward the skier until it is clear.
     * `aimHint` softly pulls the look target toward a park feature or rail.
     */
    update(
      state: SkiState,
      sampleTerrain: SampleTerrain,
      dt: number,
      blocked?: (x: number, z: number) => boolean,
      eye?: THREE.Object3D,
      body?: THREE.Object3D,
      aimHint?: { x: number; z: number; strength?: number } | null,
    ) {
      if (mode === 'orbit') {
        orbit.update()
        return
      }
      if (shot && mode !== 'first') {
        const k = snap ? 1 : 1 - Math.exp(-2.5 * dt)
        camera.position.lerp(shot.position, k)
        shotLook.lerp(shot.look, snap ? 1 : 1 - Math.exp(-6 * dt))
        camera.up.set(0, 1, 0)
        camera.lookAt(shotLook)
        snap = false
        return
      }
      // Sense of speed: widen FOV from about 10 m/s, more in a tuck; gated with shake / reduced motion.
      const wantFov =
        mode === 'follow' && shake > 0 && !motion.matches
          ? THREE.MathUtils.clamp((state.speed - 10) / 20, 0, 1) * (state.tuck ? 12 : 10)
          : 0
      speedFov = snap ? wantFov : THREE.MathUtils.lerp(speedFov, wantFov, 1 - Math.exp(-2.2 * dt))
      applyFov()
      if (mode === 'first' && eye) {
        // Eyes in the helmet, looking a little down so the hands, poles and
        // ski tips are in view. Smoothed so body sway does not jitter.
        eye.updateWorldMatrix(true, false)
        eye.getWorldPosition(eyePos)
        // Look along the skis (root), not the torso, so a tuck does not stare at the snow.
        ;(body ?? eye).getWorldQuaternion(eyeQuat)
        eyeQuat.multiply(turnAround).multiply(lookDown)
        if (snap) smoothQuat.copy(eyeQuat)
        else smoothQuat.slerp(eyeQuat, 1 - Math.exp(-14 * dt))
        camera.position.copy(eyePos)
        camera.quaternion.copy(smoothQuat)
        if (state.chatter > 0.05 && shake > 0) {
          camera.position.x += (Math.random() - 0.5) * state.chatter * 0.02 * shake
          camera.position.y += (Math.random() - 0.5) * state.chatter * 0.02 * shake
        }
        snap = false
        return
      }
      heading = followHeading(style, state, sampleTerrain, heading, snap || ease ? Infinity : dt)
      // Pull back and up a little with speed.
      let back = 7.2 + Math.min(4, state.speed * 0.08)
      landing *= Math.exp(-9 * dt)
      const height = 2.6 + Math.min(1.5, state.speed * 0.03) - landing * shake
      while (blocked && back > 2.6 && blocked(state.x + Math.sin(heading) * back, state.z - Math.cos(heading) * back)) back -= 0.8
      desired.set(state.x + Math.sin(heading) * back, state.y + height, state.z - Math.cos(heading) * back)
      const under = sampleTerrain(desired.x, desired.z)
      if (under) desired.y = Math.max(desired.y, under.height + 1.4)
      if (snap) camera.position.copy(desired)
      else camera.position.lerp(desired, 1 - Math.exp(-(ease ? 2.2 : 6) * dt))
      if (ease && camera.position.distanceToSquared(desired) < 0.25) ease = false
      target.set(state.x - Math.sin(heading) * 8, state.y + 1.1, state.z + Math.cos(heading) * 8)
      const ahead = sampleTerrain(target.x, target.z)
      const current = sampleTerrain(state.x, state.z)
      const gradeDrop = ahead && current ? THREE.MathUtils.clamp((ahead.height - current.height) * 0.55, -3.2, 2) : 0
      lookHeight = snap ? gradeDrop : THREE.MathUtils.lerp(lookHeight, gradeDrop, 1 - Math.exp(-4 * dt))
      target.y += lookHeight
      // Soft line hint toward the next park feature or rail (approach assist).
      if (aimHint && mode === 'follow' && state.grounded && !state.rail && state.crashed <= 0 && shake > 0 && !motion.matches) {
        const pull = THREE.MathUtils.clamp(aimHint.strength ?? 0.16, 0, 0.35)
        target.x = THREE.MathUtils.lerp(target.x, aimHint.x, pull)
        target.z = THREE.MathUtils.lerp(target.z, aimHint.z, pull)
      }
      // Edge chatter shakes the view a little.
      if (state.chatter > 0.05 && shake > 0) {
        const k = state.chatter * 0.05 * shake
        camera.position.x += (Math.random() - 0.5) * k
        camera.position.y += (Math.random() - 0.5) * k
      }
      camera.up.set(0, 1, 0)
      camera.lookAt(target)
      snap = false
    },
    dispose() {
      orbit.dispose()
    },
  }
}

/**
 * One step of the follow camera's heading. `dt = Infinity` snaps to the target.
 */
export function followHeading(style: CameraStyle, state: SkiState, sampleTerrain: SampleTerrain, heading: number, dt: number): number {
  const moving = state.speed > 3
  const travel = moving ? Math.atan2(-state.vx, state.vz) : state.heading
  // In the air or on a rail the skis rotate; follow the line of travel instead.
  const spinning = state.ridingSwitch || !state.grounded || Boolean(state.rail) || state.crashed > 0
  let targetHeading: number
  let rate: number
  if (style === 'steady') {
    const steady = steadyHeading(state, sampleTerrain, moving ? travel : state.heading, moving)
    targetHeading = spinning && moving ? travel : steady
    // Slow to swing, so linked turns move the skier across a still view;
    // quicker when the skier is heading well off the view (a long traverse).
    const off = Math.abs(Math.atan2(Math.sin(targetHeading - heading), Math.cos(targetHeading - heading)))
    // 0.9.40: looser (1.3 to 1.0) and the catch-up starts later (0.9 to 1.2 rad off), so
    // the view stays on the fall line through held turns. Guesses, tune in play.
    rate = (spinning ? 3 : 1.0) + 5 * THREE.MathUtils.clamp((off - 1.2) / 0.9, 0, 1)
  } else {
    // Mostly the ski heading, so the view turns when you steer rather than
    // when the path has caught up; travel keeps it steady through skids.
    targetHeading = spinning && moving ? travel : blendAngle(state.heading, travel, moving ? 0.3 : 0)
    rate = 7
  }
  return blendAngle(heading, targetHeading, 1 - Math.exp(-rate * dt))
}

/**
 * Where the steady camera points: the travel direction pulled toward the
 * fall line on a real slope, less so the further the skier is traversing
 * away from it, so the view looks down the hill through linked turns.
 */
export function steadyHeading(state: SkiState, sampleTerrain: SampleTerrain, aim: number, moving: boolean): number {
  if (!moving) return aim
  const ground = sampleTerrain(state.x, state.z)
  if (!ground) return aim
  const fall = fallLineHeading(ground.normal)
  if (fall === null) return aim
  // Full pull from about 9° (was 12°), and it holds further into a traverse (0.6π to 0.75π).
  const steep = THREE.MathUtils.clamp(Math.hypot(ground.normal.x, ground.normal.z) / 0.15, 0, 1)
  const off = Math.abs(Math.atan2(Math.sin(fall - aim), Math.cos(fall - aim)))
  const pull = 0.85 * steep * Math.max(0, 1 - off / (Math.PI * 0.75))
  return blendAngle(aim, fall, pull)
}

function blendAngle(current: number, goal: number, amount: number): number {
  const delta = Math.atan2(Math.sin(goal - current), Math.cos(goal - current))
  return current + delta * amount
}
