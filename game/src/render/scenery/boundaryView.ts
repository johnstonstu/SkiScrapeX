import * as THREE from 'three'
import { createStaticBatch } from './mergeStatic'
import { nearestOnPolyline, type Point2 } from '../../world/resort'

const POLE_SPACING = 5
const POLE_HEIGHT = 1.5
const ROPE_HEIGHT = 1.05
const SIGN_SPACING = 220
/** Leave the rope open where a road crosses the boundary. */
const ROAD_GAP = 9

/**
 * Ski-area boundary: orange bamboo poles with a sagging rope along the OSM
 * winter-sports boundary, and "Area boundary / Closed" signs facing into the
 * resort. Visual only; like the real rope, you can still duck it.
 */
export function createBoundaryView(ring: Point2[] | undefined, heightAt: (x: number, z: number) => number, roads: Point2[][]) {
  const group = new THREE.Group()
  group.name = 'boundary'
  const disposables: { dispose(): void }[] = []
  if (!ring || ring.length < 3) return { object: group, dispose() {} }
  const closed = [...ring, ring[0]]
  let cx = 0
  let cz = 0
  for (const [x, z] of ring) {
    cx += x / ring.length
    cz += z / ring.length
  }
  const nearRoad = (x: number, z: number) => roads.some((road) => nearestOnPolyline(x, z, road).distanceSq < ROAD_GAP * ROAD_GAP)

  // Walk the ring at even spacing.
  const poles: { x: number; y: number; z: number; open: boolean }[] = []
  const signs: { x: number; y: number; z: number; yaw: number }[] = []
  let carry = 0
  let sinceSign = SIGN_SPACING / 2
  for (let i = 1; i < closed.length; i++) {
    const [ax, az] = closed[i - 1]
    const [bx, bz] = closed[i]
    const length = Math.hypot(bx - ax, bz - az)
    for (let d = carry; d < length; d += POLE_SPACING) {
      const t = d / length
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const y = heightAt(x, z)
      if (!Number.isFinite(y)) {
        poles.push({ x, y: 0, z, open: true })
        continue
      }
      const open = nearRoad(x, z)
      poles.push({ x, y, z, open })
      sinceSign += POLE_SPACING
      if (!open && sinceSign >= SIGN_SPACING) {
        sinceSign = 0
        signs.push({ x, y, z, yaw: Math.atan2(cx - x, cz - z) })
      }
    }
    carry = (carry - length) % POLE_SPACING
    if (carry < 0) carry += POLE_SPACING
  }

  const standing = poles.filter((p) => !p.open)
  const poleGeometry = new THREE.CylinderGeometry(0.025, 0.03, POLE_HEIGHT, 5)
  poleGeometry.translate(0, POLE_HEIGHT / 2 - 0.1, 0)
  const poleMaterial = new THREE.MeshLambertMaterial({ color: 0xff7a1a })
  const instanced = new THREE.InstancedMesh(poleGeometry, poleMaterial, Math.max(1, standing.length))
  const matrix = new THREE.Matrix4()
  standing.forEach((p, i) => instanced.setMatrixAt(i, matrix.makeTranslation(p.x, p.y, p.z)))
  instanced.count = standing.length
  disposables.push(poleGeometry, poleMaterial)
  group.add(instanced)

  // Rope between neighbouring standing poles, sagging 0.15 m mid-span.
  const rope: number[] = []
  for (let i = 1; i < poles.length; i++) {
    const a = poles[i - 1]
    const b = poles[i]
    if (a.open || b.open) continue
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    const my = (a.y + b.y) / 2 + ROPE_HEIGHT - 0.15
    rope.push(a.x, a.y + ROPE_HEIGHT, a.z, mx, my, mz, mx, my, mz, b.x, b.y + ROPE_HEIGHT, b.z)
  }
  const ropeGeometry = new THREE.BufferGeometry()
  ropeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3))
  const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x1b1b1b })
  disposables.push(ropeGeometry, ropeMaterial)
  group.add(new THREE.LineSegments(ropeGeometry, ropeMaterial))

  // Signs: a board on its own post, readable from inside the boundary.
  const texture = signTexture()
  const board = new THREE.PlaneGeometry(0.9, 0.6)
  const boardMaterial = new THREE.MeshLambertMaterial({ map: texture })
  const backMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2a2a })
  const post = new THREE.CylinderGeometry(0.04, 0.04, 2, 6)
  post.translate(0, 1, 0)
  const postMaterial = new THREE.MeshLambertMaterial({ color: 0x6b5138 })
  disposables.push(texture, board, boardMaterial, backMaterial, post, postMaterial)
  // Every sign's post, face and back merged per material: three draw calls in all.
  const batch = createStaticBatch()
  const front = new THREE.Object3D()
  front.position.set(0, 1.75, 0.05)
  const back = new THREE.Object3D()
  back.position.set(0, 1.75, 0.04)
  back.rotation.y = Math.PI
  const at = new THREE.Vector3()
  for (const s of signs) {
    at.set(s.x, s.y, s.z)
    batch.add(post, postMaterial, batch.matrix(at, s.yaw))
    batch.add(board, boardMaterial, batch.matrix(at, s.yaw, front))
    batch.add(board, backMaterial, batch.matrix(at, s.yaw, back))
  }
  for (const mesh of batch.build()) {
    disposables.push(mesh.geometry)
    group.add(mesh)
  }
  return {
    object: group,
    dispose() {
      for (const item of disposables) item.dispose()
      instanced.dispose()
    },
  }
}

function signTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 170
  const c = canvas.getContext('2d')!
  c.fillStyle = '#ffb000'
  c.fillRect(0, 0, 256, 170)
  c.strokeStyle = '#111'
  c.lineWidth = 10
  c.strokeRect(5, 5, 246, 160)
  c.fillStyle = '#111'
  c.textAlign = 'center'
  c.font = 'bold 34px sans-serif'
  c.fillText('AREA', 128, 52)
  c.fillText('BOUNDARY', 128, 92)
  c.font = 'bold 22px sans-serif'
  c.fillText('CLOSED BEYOND', 128, 128)
  c.font = '15px sans-serif'
  c.fillText('Not patrolled · Avalanche risk', 128, 152)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
