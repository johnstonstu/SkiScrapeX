import * as THREE from 'three'
import type { Lift } from '../../world/resort'

/**
 * Summit windsock and flag poles beside the Quickdraw top terminal (the
 * summit webcam shows a red windsock). The sock and flags swing with a
 * slow gusting wind in `update`.
 */
export function createSummitFlags(lifts: Lift[], heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group()
  group.name = 'summit-flags'
  const quickdraw = lifts.find((lift) => /quick\s*draw/i.test(lift.name))
  const animated: { pivot: THREE.Object3D; kind: 'sock' | 'flag'; phase: number }[] = []
  if (!quickdraw) return { object: group, update() {} }
  const [tx, tz] = quickdraw.top
  const [bx, bz] = quickdraw.bottom
  const length = Math.hypot(tx - bx, tz - bz) || 1
  // Off to the side of the terminal and a little behind it, clear of the unload ramp.
  const sideX = -(tz - bz) / length
  const sideZ = (tx - bx) / length
  const backX = (tx - bx) / length
  const backZ = (tz - bz) / length
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bfc6, metalness: 0.5, roughness: 0.45 })
  const red = new THREE.MeshStandardMaterial({ color: 0xe0321e, roughness: 0.7, side: THREE.DoubleSide })
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.7, side: THREE.DoubleSide })

  const place = (along: number, out: number) => {
    const x = tx + sideX * out + backX * along
    const z = tz + sideZ * out + backZ * along
    const y = heightAt(x, z)
    return Number.isFinite(y) ? new THREE.Vector3(x, y, z) : null
  }

  // Windsock: a 6 m mast and a striped tapered sock on a swivel.
  const sockBase = place(4, -16)
  if (sockBase) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 6, 8), steel)
    mast.position.copy(sockBase).y += 3
    const pivot = new THREE.Group()
    pivot.position.copy(sockBase).y += 5.9
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 16), steel)
    ring.rotation.y = Math.PI / 2
    pivot.add(ring)
    for (let i = 0; i < 5; i++) {
      const r0 = 0.25 - i * 0.03
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0 - 0.03, 0.4, 14, 1, true), i % 2 ? white : red)
      band.rotation.z = Math.PI / 2
      band.position.x = 0.2 + i * 0.4
      pivot.add(band)
    }
    group.add(mast, pivot)
    animated.push({ pivot, kind: 'sock', phase: 0 })
  }

  // Three flag poles in a row: Canada, BC and a resort flag in plain colours.
  const flags: [THREE.Material, THREE.Material][] = [[red, white], [white, red], [red, red]]
  flags.forEach(([field, stripe], i) => {
    const base = place(10 + i * 2.4, -20)
    if (!base) return
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 8, 8), steel)
    pole.position.copy(base).y += 4
    const pivot = new THREE.Group()
    pivot.position.copy(base).y += 7.4
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8, 8, 1), field)
    cloth.position.set(0.8, 0, 0)
    const band = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), stripe)
    band.position.set(0.8, 0, 0.002)
    pivot.add(cloth, band)
    group.add(pole, pivot)
    animated.push({ pivot, kind: 'flag', phase: i * 1.7 })
  })
  for (const child of group.children) child.castShadow = true

  let time = 0
  return {
    object: group,
    update(dt: number) {
      time += dt
      // Prevailing westerly with slow gusts; flags ripple faster than the sock swings.
      const gust = 0.6 + 0.4 * Math.sin(time * 0.37) * Math.sin(time * 0.11 + 1)
      const heading = -Math.PI * 0.1 + 0.25 * Math.sin(time * 0.23)
      for (const a of animated) {
        a.pivot.rotation.y = heading + (a.kind === 'flag' ? 0.12 * Math.sin(time * 3.1 + a.phase) : 0.05 * Math.sin(time * 1.3))
        // A slack sock droops; a full one flies level.
        a.pivot.rotation.z = a.kind === 'sock' ? -(1 - gust) * 0.9 : -0.08 * (1 - gust)
      }
    },
  }
}
