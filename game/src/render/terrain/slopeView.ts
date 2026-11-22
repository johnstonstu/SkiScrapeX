import * as THREE from 'three'
import type { Slope } from '../../sim'

/** Snow mesh, fall-line centre stripe and gate poles for one synthetic slope. */
export function createSlopeView(slope: Slope): { object: THREE.Group; dispose: () => void } {
  const group = new THREE.Group()
  const disposables: { dispose: () => void }[] = []
  const step = slope.visualStep
  const columns = Math.round(slope.width / step) + 1
  const rows = Math.round(slope.depth / step) + 1
  const positions = new Float32Array(columns * rows * 3)
  const colors = new Float32Array(columns * rows * 3)
  const normals = new Float32Array(columns * rows * 3)
  const centerX = slope.originX + slope.width / 2

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = Math.min(slope.originX + column * step, slope.originX + slope.width)
      const z = Math.min(slope.originZ + row * step, slope.originZ + slope.depth)
      const sample = slope.sampleTerrain(x, z)
      const height = sample?.height ?? 0
      const normal = sample?.normal ?? { x: 0, y: 1, z: 0 }
      const index = (row * columns + column) * 3
      positions[index] = x
      positions[index + 1] = height
      positions[index + 2] = z
      normals[index] = normal.x
      normals[index + 1] = normal.y
      normals[index + 2] = normal.z
      const steep = 1 - Math.min(1, Math.abs(normal.y))
      const onCentre = Math.abs(x - centerX) < 1.6
      colors[index] = onCentre ? 0.62 : 0.86 - steep * 0.22
      colors[index + 1] = onCentre ? 0.78 : 0.9 - steep * 0.1
      colors[index + 2] = onCentre ? 0.9 : 0.95 - steep * 0.04
    }
  }

  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6)
  let cursor = 0
  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns - 1; column++) {
      const a = row * columns + column
      const b = a + 1
      const c = a + columns
      const d = c + 1
      // Same diagonal as game/src/world/terrainGrid.ts so a future height grid will match.
      indices[cursor++] = a
      indices[cursor++] = c
      indices[cursor++] = b
      indices[cursor++] = b
      indices[cursor++] = c
      indices[cursor++] = d
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  disposables.push(geometry)

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
  })
  disposables.push(material)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  group.add(mesh)

  const poleGeometry = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 8)
  const red = new THREE.MeshStandardMaterial({ color: 0xc4473a, roughness: 0.55 })
  const blue = new THREE.MeshStandardMaterial({ color: 0x2c6fce, roughness: 0.55 })
  disposables.push(poleGeometry, red, blue)
  const span = Math.min(24, slope.width * 0.22)
  for (let z = slope.originZ + 80; z < slope.originZ + slope.depth - 20; z += 50) {
    const gate = Math.round((z - slope.originZ) / 50)
    const materialForGate = gate % 2 === 0 ? red : blue
    for (const side of [-1, 1]) {
      const x = centerX + side * span
      const sample = slope.sampleTerrain(x, z)
      if (!sample) continue
      const pole = new THREE.Mesh(poleGeometry, materialForGate)
      pole.position.set(x, sample.height + 1.2, z)
      group.add(pole)
    }
  }

  return {
    object: group,
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}
