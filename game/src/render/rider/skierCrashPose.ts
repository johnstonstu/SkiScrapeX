import * as THREE from 'three'
import type { SkiState } from '../../sim'
import type { Spring } from './spring'

/** Yard-sale tumble then gather; same numbers as the former inline crash branch. */
export function applyCrashPose(args: {
  state: SkiState
  boarding: boolean
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  skis: THREE.Object3D[]
  crouch: Spring
  placeBoard: (x: number, y: number, z: number, edge: number, yaw?: number, pitch?: number) => void
  placeArm: (hand: number, handPos: THREE.Vector3, tip: THREE.Vector3, skipPole?: boolean) => void
  fitLegs: () => void
}) {
  const { state, boarding, hips, spine, chest, head, skis, crouch, placeBoard, placeArm, fitLegs } = args
  const hard = THREE.MathUtils.clamp(state.crashSpeed / 18, 0, 1)
  const sliding = Math.min(1, Math.hypot(state.vx, state.vz) / 8)
  const tumble = hard * Math.max(sliding, 0.35) * Math.max(0, 1 - state.crashAge / 1.15)
  const impactOff = Math.atan2(
    Math.sin(state.crashHeading - state.heading),
    Math.cos(state.crashHeading - state.heading),
  )
  const roll = Math.sin(state.crashAge * 9.5) * tumble + Math.sin(impactOff) * tumble * 0.55
  const pitch = Math.cos(state.crashAge * 7.2) * tumble + Math.cos(impactOff) * tumble * 0.4
  hips.position.set(roll * 0.08, 0.12 + (1 - hard) * 0.14 + Math.abs(pitch) * 0.04, hard * 0.08)
  hips.rotation.set(hard * 0.55 + pitch * 1.1, roll * 0.35, 0.95 + hard * 0.55 + roll * 1.4)
  spine.rotation.x = 0.2 + hard * 0.2 + pitch * 0.25
  chest.rotation.x = 0.12 + hard * 0.12
  chest.rotation.z = -0.15 - hard * 0.12 + roll * 0.3
  head.rotation.set(-0.25 - hard * 0.2 + pitch * 0.2, 0.25 + hard * 0.15, 0.15 + hard * 0.15 + roll * 0.25)
  // Yard-sale then re-attach: scatter peaks mid-crash and gathers in the last half-second.
  const gather = state.crashed < 0.55 ? state.crashed / 0.55 : 1
  const scatter = hard * (0.55 + (1 - tumble) * 0.45) * gather
  const sideThrow = Math.sin(impactOff)
  const alongThrow = Math.cos(impactOff)
  skis[0].position.set(
    0.45 + scatter * (0.55 + sideThrow * 0.35),
    0.04,
    0.12 + scatter * (0.35 + alongThrow * 0.25) + roll * 0.1,
  )
  skis[1].position.set(
    0.35 + scatter * (0.4 - sideThrow * 0.3),
    0.04,
    -0.12 - scatter * (0.45 - alongThrow * 0.2) - roll * 0.08,
  )
  skis[0].rotation.set(hard * 0.15 + pitch * 0.3, 0.3 + scatter * 0.5, 0.55 + scatter * 0.7)
  skis[1].rotation.set(-hard * 0.1 - pitch * 0.2, -0.25 - scatter * 0.4, 0.4 + scatter * 0.55)
  if (boarding) placeBoard(0.45 + scatter * 0.2, 0.1 + hard * 0.04, roll * 0.2, 0.75 + hard * 0.25, 0.15 + hard * 0.1)
  fitLegs()
  // Poles follow the yard-sale then come back with gather.
  placeArm(
    0,
    new THREE.Vector3(0.4 + hard * 0.2 * gather + roll * 0.1, -0.02, 0.08 + hard * 0.12 * gather),
    new THREE.Vector3(0.75 + hard * 0.35 * gather, 0, 0.5 + hard * 0.25 * gather),
  )
  placeArm(
    1,
    new THREE.Vector3(-0.3 - hard * 0.18 * gather - roll * 0.1, 0.06 + hard * 0.04, 0.25 + hard * 0.15 * gather),
    new THREE.Vector3(-0.15 - hard * 0.25 * gather, 0, 1.0 + hard * 0.35 * gather),
  )
  crouch.x = 0.85 + hard * 0.1 * gather
  crouch.v = 0
}
