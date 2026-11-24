import * as THREE from 'three'
import type { SkiState } from '../sim'

type HeightAt = (x: number, z: number) => number | null

interface Drop {
  kind: 'ski' | 'pole' | 'board'
  mesh: THREE.Object3D
  x: number
  z: number
}

const HARD = 12
const PICK = 2.4
const FAILSAFE = 14

/**
 * World-space yard-sale pickups after a hard crash. Soft crashes still use the
 * visual gather on the rider; hard ones leave gear on the snow to ski over.
 */
export function createGearDrops(scene: THREE.Object3D) {
  const group = new THREE.Group()
  group.name = 'gear-drops'
  scene.add(group)
  const drops: Drop[] = []
  let armed = false
  let active = false
  let age = 0
  const skiMat = new THREE.MeshStandardMaterial({ color: '#c9d4de', roughness: 0.45, metalness: 0.15 })
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2a3340', roughness: 0.55, metalness: 0.35 })
  const boardMat = new THREE.MeshStandardMaterial({ color: '#3d6ea8', roughness: 0.5, metalness: 0.2 })

  const syncFlags = (state: SkiState) => {
    state.missingSkis = drops.some((d) => d.kind === 'ski' || d.kind === 'board')
    state.missingPoles = drops.some((d) => d.kind === 'pole')
  }

  const clear = () => {
    for (const drop of drops) {
      group.remove(drop.mesh)
      drop.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
      })
    }
    drops.length = 0
    armed = active = false
    age = 0
  }

  const place = (kind: Drop['kind'], x: number, z: number, yaw: number, heightAt: HeightAt) => {
    const y = heightAt(x, z)
    if (y == null || !Number.isFinite(y)) return
    let mesh: THREE.Object3D
    if (kind === 'pole') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.15, 6), poleMat)
      mesh.rotation.z = Math.PI / 2
    } else if (kind === 'board') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 1.45), boardMat)
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 1.55), skiMat)
    }
    mesh.position.set(x, y + 0.04, z)
    mesh.rotation.y = yaw
    mesh.castShadow = true
    group.add(mesh)
    drops.push({ kind, mesh, x, z })
  }

  return {
    clear,
    update(state: SkiState, heightAt: HeightAt, boarding: boolean, dt: number) {
      if (state.crashed > 0 && state.crashSpeed >= HARD) {
        if (!active) {
          active = true
          armed = true
          age = 0
        }
        // Spawn once as the visual gather would begin, so gear leaves the rider.
        if (armed && state.crashed < 0.55 && drops.length === 0) {
          const heading = state.crashHeading || state.heading
          const fx = -Math.sin(heading)
          const fz = Math.cos(heading)
          const rx = fz
          const rz = -fx
          if (boarding) {
            place('board', state.x + rx * 1.1 + fx * 0.4, state.z + rz * 1.1 + fz * 0.4, heading + 0.4, heightAt)
          } else {
            place('ski', state.x + rx * 1.35 + fx * 0.55, state.z + rz * 1.35 + fz * 0.55, heading + 0.55, heightAt)
            place('ski', state.x - rx * 1.1 - fx * 0.35, state.z - rz * 1.1 - fz * 0.35, heading - 0.45, heightAt)
            place('pole', state.x + rx * 0.7 - fx * 0.9, state.z + rz * 0.7 - fz * 0.9, heading + 1.1, heightAt)
            place('pole', state.x - rx * 0.85 + fx * 0.7, state.z - rz * 0.85 + fz * 0.7, heading - 0.9, heightAt)
          }
          armed = false
          syncFlags(state)
        }
      } else if (active && state.crashed <= 0) {
        active = false
        armed = false
      }

      if (!drops.length) {
        if (!active) {
          state.missingSkis = false
          state.missingPoles = false
        }
        return
      }

      // Stay down until get-up — collecting starts once you are skiing again.
      if (state.crashed > 0) {
        syncFlags(state)
        return
      }

      age += dt
      const kept: Drop[] = []
      for (const drop of drops) {
        const dist = Math.hypot(drop.x - state.x, drop.z - state.z)
        if (dist < PICK || age > FAILSAFE) {
          group.remove(drop.mesh)
          drop.mesh.traverse((o) => {
            if (o instanceof THREE.Mesh) o.geometry.dispose()
          })
        } else {
          kept.push(drop)
        }
      }
      drops.length = 0
      drops.push(...kept)
      syncFlags(state)
      if (!drops.length) age = 0
      // Awkward without skis / board until you gather them.
      if (state.missingSkis && state.grounded && state.crashed <= 0) {
        const keep = Math.max(0, 1 - 0.4 * dt)
        state.vx *= keep
        state.vz *= keep
      }
    },
  }
}
