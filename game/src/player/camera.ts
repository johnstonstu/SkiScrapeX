import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { SampleTerrain, SkiState, TrickEvent } from '../sim'
import { createFollowCamera, type CameraStyle } from './followCamera'

export { followHeading, steadyHeading, type CameraStyle } from './followCamera'

export type CameraMode = 'follow' | 'first' | 'orbit'
/** Metres the Camera height setting adds to the follow camera. */
export const CAMERA_LIFT = { low: -0.6, standard: 0, high: 1.2 } as const

/**
 * Third-person follow camera that leans toward the travel direction, plus a
 * free orbit view for looking around the mountain.
 */
export function createCameraRig(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
  const target = new THREE.Vector3()
  const follow = createFollowCamera()
  const orbit = new OrbitControls(camera, dom)
  orbit.enabled = false
  orbit.enableDamping = true
  orbit.maxPolarAngle = Math.PI * 0.49
  orbit.minDistance = 4
  orbit.maxDistance = 4000
  let snap = true
  /** Metres added to the follow height (the Camera height setting). */
  let lift = 0
  /** Heading snaps but the position eases in: handing over from a held shot without a cut. */
  let ease = false
  /** Seconds since the shot was released; the hand-over tightens as it runs and ends on time, however fast the rider goes. */
  let easeTime = 0
  const EASE_SECONDS = 2.4
  /** A fixed shot (lift arrivals): where the camera waits and what it watches. */
  let shot: { position: THREE.Vector3; look: THREE.Vector3; fov: number | null } | null = null
  /** Degrees the lens is off the follow FOV: a held shot can use a longer lens, and it eases back after. */
  let lens = 0
  const shotLook = new THREE.Vector3()
  /** What the camera looked at last frame, so a released shot turns to the follow view instead of jumping. */
  const lastLook = new THREE.Vector3()
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
      camera.fov = baseFov + speedFov + lens
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
    /** Raise or lower the follow camera, metres. */
    setLift(metres: number) {
      lift = metres
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
      ease = false
      landing = 0
      speedFov = 0
      applyFov()
    },
    /**
     * Hold a shot from `position` watching `look` (both copied), e.g. beside a
     * lift's top station so the camera never drives through the terminal.
     */
    holdShot(position: THREE.Vector3, look: THREE.Vector3, cut = false, fov: number | null = null) {
      // `cut`: be there this frame (a camera riding with a chair, or an edit between two shots).
      if (cut) snap = true
      if (!shot) {
        shot = { position: position.clone(), look: look.clone(), fov }
        shotLook.copy(look)
        return
      }
      shot.position.copy(position)
      shot.look.copy(look)
      shot.fov = fov
    },
    /** Back to the follow camera, easing out of the held shot rather than cutting. */
    releaseShot() {
      if (!shot) return
      shot = null
      snap = false
      ease = true
      easeTime = 0
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
      aimHint?: { x: number; z: number; strength?: number; distance?: number; jump?: boolean } | null,
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
        const wantLens = shot.fov === null ? 0 : shot.fov - baseFov
        lens = snap ? wantLens : THREE.MathUtils.lerp(lens, wantLens, 1 - Math.exp(-2.5 * dt))
        speedFov = 0
        applyFov()
        lastLook.copy(shotLook)
        snap = false
        return
      }
      // Sense of speed: widen FOV from about 10 m/s, more in a tuck; gated with shake / reduced motion.
      const wantFov =
        mode === 'follow' && shake > 0 && !motion.matches
          ? THREE.MathUtils.clamp((state.speed - 10) / 20, 0, 1) * (state.tuck ? 12 : 10)
          : 0
      speedFov = snap ? wantFov : THREE.MathUtils.lerp(speedFov, wantFov, 1 - Math.exp(-2.2 * dt))
      lens = snap || Math.abs(lens) < 0.05 ? 0 : lens * Math.exp(-2.4 * dt)
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
      landing *= Math.exp(-9 * dt)
      const handing = ease ? THREE.MathUtils.smoothstep(easeTime / EASE_SECONDS, 0, 1) : 1
      const effects = shake > 0 && !motion.matches
      // Out of a held shot the camera starts from where the shot left it.
      if (ease && easeTime === 0) follow.place(camera.position.x, camera.position.y, camera.position.z)
      const frame = follow.step(state, sampleTerrain, dt, {
        style,
        blocked,
        aim: mode === 'follow' ? aimHint : null,
        motion: effects,
        lift,
        dip: landing * shake,
        rate: THREE.MathUtils.lerp(2.2, 6, handing),
        snap,
        snapHeading: ease && easeTime === 0,
      })
      camera.position.set(frame.x, frame.y, frame.z)
      target.set(frame.lookX, frame.lookY, frame.lookZ)
      // Edge chatter shakes the view a little.
      if (state.chatter > 0.05 && shake > 0) {
        const k = state.chatter * 0.05 * shake
        camera.position.x += (Math.random() - 0.5) * k
        camera.position.y += (Math.random() - 0.5) * k
      }
      camera.up.set(0, 1, 0)
      if (ease) {
        // Out of a held shot: the look swings round to the follow view as the camera travels.
        lastLook.lerp(target, 1 - Math.exp(-THREE.MathUtils.lerp(2.6, 14, handing) * dt))
        camera.lookAt(lastLook)
        easeTime += dt
        if (easeTime >= EASE_SECONDS) ease = false
      } else {
        lastLook.copy(target)
        camera.lookAt(target)
      }
      snap = false
    },
    dispose() {
      orbit.dispose()
    },
  }
}
