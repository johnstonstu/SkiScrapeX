import * as THREE from 'three'
import type { LandingPrediction } from '../../sim'

/**
 * Ring on the snow where an airborne skier will touch down: green when the
 * rotation will line up, amber when it will not. Fades in after takeoff so
 * small hops do not flash it.
 */
export function createLandingMarker() {
  const material = new THREE.MeshBasicMaterial({ color: 0x5be07a, transparent: true, opacity: 0, depthWrite: false })
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 40).rotateX(-Math.PI / 2), material)
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20).rotateX(-Math.PI / 2), material)
  const object = new THREE.Group()
  object.add(ring, dot)
  object.renderOrder = 2
  object.visible = false
  const up = new THREE.Vector3(0, 1, 0)
  const normal = new THREE.Vector3()
  const green = new THREE.Color(0x5be07a)
  const amber = new THREE.Color(0xffb03b)
  let fade = 0
  return {
    object,
    /** `prediction` is null on the ground; `airTime` is seconds since takeoff. */
    update(prediction: LandingPrediction | null, airTime: number, dt: number) {
      const want = prediction && airTime > 0.25 && prediction.time > 0.15 ? 1 : 0
      fade += (want - fade) * (1 - Math.exp(-10 * dt))
      object.visible = fade > 0.02
      material.opacity = fade * 0.75
      if (!prediction) return
      object.position.set(prediction.x, prediction.y + 0.06, prediction.z)
      object.quaternion.setFromUnitVectors(up, normal.set(prediction.normal.x, prediction.normal.y, prediction.normal.z))
      material.color.lerp(prediction.lined ? green : amber, 1 - Math.exp(-12 * dt))
      const pulse = 1 + 0.08 * Math.sin(performance.now() / 120)
      ring.scale.setScalar(pulse)
    },
  }
}
