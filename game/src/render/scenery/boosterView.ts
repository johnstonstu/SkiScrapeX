import * as THREE from 'three'
import type { Booster } from '../../world/glide'

/** Chevrons per booster zone and how they are drawn, metres. */
const CHEVRONS = 3
const ARM = 6
const THICKNESS = 3.2
const SWEEP = 5
const LIFT = 0.3
/** The gate over the start of the zone: pole height and banner depth, metres. */
const GATE_HEIGHT = 4.4
const BANNER = 0.9

/**
 * Booster zones on the glide tracks (world/glide.ts): a row of orange chevrons
 * painted on the snow, pointing the way the track runs, under an orange gate
 * you can see from up the track. One merged mesh for the paint (it pulses in
 * `update`) and instanced poles and banners for the gates.
 */
export function createBoosterView(boosters: readonly Booster[], heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group()
  group.name = 'boosters'
  const positions: number[] = []
  const indices: number[] = []
  const y = (x: number, z: number) => {
    const h = heightAt(x, z)
    return (Number.isFinite(h) ? h : 0) + LIFT
  }
  const quad = (corners: [number, number][]) => {
    const base = positions.length / 3
    for (const [x, z] of corners) positions.push(x, y(x, z), z)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const poleSpots: THREE.Vector3[] = []
  const banners: { at: THREE.Vector3; yaw: number; width: number }[] = []
  for (const b of boosters) {
    const sideX = b.dirZ
    const sideZ = -b.dirX
    const at = (along: number, across: number): [number, number] => [b.x + b.dirX * along + sideX * across, b.z + b.dirZ * along + sideZ * across]
    const gap = (b.length - SWEEP - THICKNESS) / (CHEVRONS - 1)
    for (let i = 0; i < CHEVRONS; i++) {
      const s = i * gap
      // Two arms meeting at the point, which leads down the track. Each arm is cut in two so it follows the snow.
      for (const side of [-1, 1]) {
        const mid = ARM / 2
        quad([at(s + SWEEP, 0), at(s + SWEEP + THICKNESS, 0), at(s + SWEEP / 2 + THICKNESS, side * mid), at(s + SWEEP / 2, side * mid)])
        quad([at(s + SWEEP / 2, side * mid), at(s + SWEEP / 2 + THICKNESS, side * mid), at(s + THICKNESS, side * ARM), at(s, side * ARM)])
      }
    }
    let top = -Infinity
    for (const side of [-1, 1]) {
      const [px, pz] = at(0, side * b.halfWidth)
      const ground = y(px, pz) - LIFT
      top = Math.max(top, ground)
      poleSpots.push(new THREE.Vector3(px, ground, pz))
    }
    banners.push({ at: new THREE.Vector3(b.x, top + GATE_HEIGHT - BANNER / 2, b.z), yaw: Math.atan2(b.dirX, b.dirZ), width: b.halfWidth * 2 })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  const paint = new THREE.MeshBasicMaterial({
    color: 0xff9a1f,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const chevrons = new THREE.Mesh(geometry, paint)
  chevrons.name = 'booster-chevrons'
  chevrons.renderOrder = 2
  group.add(chevrons)

  const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, emissive: 0x7a2c00, emissiveIntensity: 0.35 })
  if (poleSpots.length) {
    const pole = new THREE.CylinderGeometry(0.09, 0.09, GATE_HEIGHT, 6)
    pole.translate(0, GATE_HEIGHT / 2, 0)
    const poles = new THREE.InstancedMesh(pole, orange, poleSpots.length)
    poles.name = 'booster-poles'
    const m = new THREE.Matrix4()
    poleSpots.forEach((p, i) => poles.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)))
    poles.instanceMatrix.needsUpdate = true
    const cloth = new THREE.InstancedMesh(new THREE.BoxGeometry(1, BANNER, 0.08), orange, banners.length)
    cloth.name = 'booster-banners'
    const q = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    banners.forEach((banner, i) => cloth.setMatrixAt(i, m.compose(banner.at, q.setFromAxisAngle(up, banner.yaw), new THREE.Vector3(banner.width, 1, 1))))
    cloth.instanceMatrix.needsUpdate = true
    group.add(poles, cloth)
  }

  return {
    object: group,
    /** Pulse the paint. `time` in seconds. */
    update(time: number) {
      paint.opacity = 0.7 + 0.22 * Math.sin(time * 5)
    },
    dispose() {
      geometry.dispose()
      paint.dispose()
    },
  }
}
