import * as THREE from 'three'
import { pointOnMogul, type buildMoguls } from '../../world/moguls'

export function createMogulView(field: ReturnType<typeof buildMoguls>, material: THREE.Material) {
  const positions: number[] = [], normals: number[] = [], indices: number[] = []
  for (const bump of field.bumps) {
    const start = positions.length / 3
    for (let ring = 0; ring <= 4; ring++) {
      for (let j = 0; j < 12; j++) {
        const angle = j * Math.PI / 6
        const [x, z] = pointOnMogul(bump, Math.cos(angle) * ring / 4, Math.sin(angle) * ring / 4)
        const ground = field.sampleTerrain(x, z)
        positions.push(x, ground?.height ?? 0, z)
        normals.push(ground?.normal.x ?? 0, ground?.normal.y ?? 1, ground?.normal.z ?? 0)
        if (!ring) continue
        const a = start + ring * 12 + j
        const b = start + ring * 12 + (j + 1) % 12
        indices.push(a - 12, b, a)
        if (ring > 1) indices.push(a - 12, b - 12, b)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  mesh.castShadow = true
  return mesh
}
