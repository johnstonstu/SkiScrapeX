import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { TelecomSite } from '../../world/telecom'

/**
 * Telecom towers: galvanised lattice towers with antenna panels and a dish,
 * monopoles with a triangular antenna head, and equipment cabinets with
 * snow on top. Everything is merged into one mesh (one draw call, plus the
 * shadow pass) with vertex colours.
 */
export function createTelecomView(sites: TelecomSite[]) {
  const parts: THREE.BufferGeometry[] = []
  const steel = new THREE.Color('#9aa3a8')
  const panel = new THREE.Color('#e9ecee')
  const cabinetColour = new THREE.Color('#c9c4b4')
  const snow = new THREE.Color('#f2f6f9')
  const dark = new THREE.Color('#4a5055')
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)

  const add = (geometry: THREE.BufferGeometry, colour: THREE.Color, matrix: THREE.Matrix4) => {
    const g = (geometry.index ? geometry.toNonIndexed() : geometry).applyMatrix4(matrix)
    g.deleteAttribute('uv')
    const count = g.attributes.position.count
    const colours = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) colours.set([colour.r, colour.g, colour.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    parts.push(g)
  }
  /** A box beam from a to b, `w` metres thick. */
  const beam = (a: THREE.Vector3, b: THREE.Vector3, w: number, colour: THREE.Color) => {
    const d = new THREE.Vector3().subVectors(b, a)
    const length = d.length()
    q.setFromUnitVectors(up, d.normalize())
    m.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1))
    add(new THREE.BoxGeometry(w, length, w), colour, m)
  }
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, colour: THREE.Color) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1))
    add(new THREE.BoxGeometry(sx, sy, sz), colour, m)
  }

  for (const site of sites) {
    const { x, y, z, height, yaw } = site
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const local = (lx: number, ly: number, lz: number) => new THREE.Vector3(x + lx * c - lz * s, y + ly, z + lx * s + lz * c)
    if (site.kind === 'lattice') {
      // Square lattice tapering from about 1/9 of its height at the base to 1.4 m at the top.
      const base = Math.max(3.2, height / 9) / 2
      const head = 0.7
      const half = (h: number) => base + (head - base) * (h / height)
      const corners: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]]
      for (const [cx, cz] of corners) beam(local(cx * base, -1, cz * base), local(cx * head, height, cz * head), 0.32, steel)
      const sections = Math.round(height / 5)
      for (let k = 0; k < sections; k++) {
        const h0 = (k / sections) * height
        const h1 = ((k + 1) / sections) * height
        for (let i = 0; i < 4; i++) {
          const [ax, az] = corners[i]
          const [bx, bz] = corners[(i + 1) % 4]
          beam(local(ax * half(h0), h0, az * half(h0)), local(bx * half(h1), h1, bz * half(h1)), 0.14, steel)
          beam(local(ax * half(h1), h1, az * half(h1)), local(bx * half(h1), h1, bz * half(h1)), 0.14, steel)
        }
      }
      // Antenna panels on three faces near the top, a whip mast and a microwave dish.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2
        const r = head + 0.5
        const p = local(Math.cos(a) * r, height - 2.2, Math.sin(a) * r)
        box(p.x, p.y, p.z, 0.35, 2.4, 0.9, yaw - a, panel)
      }
      beam(local(0, height - 1, 0), local(0, height + 6, 0), 0.18, steel)
      const dish = local(half(height * 0.62) + 0.9, height * 0.62, 0)
      m.compose(dish, q.setFromAxisAngle(up, yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)), new THREE.Vector3(1, 1, 1))
      add(new THREE.CylinderGeometry(1.1, 1.1, 0.5, 14), panel, m)
    } else if (site.kind === 'monopole') {
      m.compose(local(0, height / 2 - 1, 0), q.identity(), new THREE.Vector3(1, 1, 1))
      add(new THREE.CylinderGeometry(0.35, 0.65, height + 2, 10), steel, m)
      // Triangular platform with panels.
      m.compose(local(0, height - 1.5, 0), q.setFromAxisAngle(up, yaw), new THREE.Vector3(1, 1, 1))
      add(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 3), dark, m)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 3
        const p = local(Math.cos(a) * 1.5, height - 0.4, Math.sin(a) * 1.5)
        box(p.x, p.y, p.z, 0.3, 2.2, 0.8, yaw - a, panel)
      }
    } else {
      // Equipment cabinet on a plinth, snow on the roof, a cable bridge toward the tower.
      box(x, y + height / 2 - 0.3, z, 3.2, height + 0.6, 2.4, yaw, cabinetColour)
      box(x, y + height + 0.42, z, 3.4, 0.25, 2.6, yaw, snow)
      const door = local(0, height / 2 - 0.3, 1.21)
      box(door.x, door.y, door.z, 0.9, 2, 0.05, yaw, dark)
    }
  }

  const merged = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry()
  for (const p of parts) p.dispose()
  merged.computeBoundingSphere()
  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  const mesh = new THREE.Mesh(merged, material)
  mesh.name = 'telecom'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return {
    object: mesh,
    dispose() {
      merged.dispose()
      material.dispose()
    },
  }
}
