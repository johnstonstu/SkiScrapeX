import * as THREE from 'three'

/** Sitting on a chair: soft swing and hands on the bar. */
export function applySitPose(args: {
  ridePhase: number
  boarding: boolean
  hips: THREE.Object3D
  spine: THREE.Object3D
  chest: THREE.Object3D
  head: THREE.Object3D
  skis: THREE.Object3D[]
  placeBoard: (x: number, y: number, z: number, edge: number, yaw?: number, pitch?: number) => void
  placeArm: (hand: number, handPos: THREE.Vector3, tip: THREE.Vector3, inRoot?: boolean, floor?: number) => void
  fitLegs: () => void
  scratch: THREE.Vector3
}) {
  const { ridePhase, boarding, hips, spine, chest, head, skis, placeBoard, placeArm, fitLegs, scratch } = args
  const swing = Math.sin(ridePhase) * 0.045
  hips.position.set(0, 0.5, 0)
  spine.rotation.x = -0.1
  chest.rotation.x = -0.04
  head.rotation.y = Math.sin(ridePhase * 0.23) * 0.5
  head.rotation.x = 0.1
  skis[0].position.set(0.14, -0.16, 0.44 + swing)
  skis[1].position.set(-0.14, -0.16, 0.44 - swing)
  skis[0].rotation.x = -0.07 - swing
  skis[1].rotation.x = -0.07 + swing
  if (boarding) placeBoard(0, -0.2, 0.46, 0, Math.PI / 2, swing)
  fitLegs()
  // Hands rest on the bar, poles across the lap.
  placeArm(0, scratch.set(0.2, -0.2, 0.34).clone(), new THREE.Vector3(0.3, 0.2, 1.2))
  placeArm(1, scratch.set(-0.2, -0.2, 0.34).clone(), new THREE.Vector3(-0.3, 0.2, 1.2))
}
