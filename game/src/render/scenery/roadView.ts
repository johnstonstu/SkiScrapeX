import * as THREE from 'three'
import type { Point2 } from '../../world/resort'

const HALF_WIDTH = 3.6
const BANK_OFFSET = 4.6
const LAMP_SPACING = 38

/**
 * Plowed roads: a packed-snow ribbon with tyre tracks, snowbanks on both
 * sides, and lamp posts where the road passes near buildings.
 */
export function createRoadView(
  roads: Point2[][],
  heightAt: (x: number, z: number) => number,
  nearVillage: (x: number, z: number) => boolean,
) {
  const group = new THREE.Group()
  group.name = 'roads'
  const ribbon = { positions: [] as number[], uvs: [] as number[], indices: [] as number[] }
  const banks = { positions: [] as number[], indices: [] as number[] }
  const lamps: THREE.Vector3[] = []

  for (const road of roads) {
    const points = densify(road, 4)
    let along = 0
    let nextLamp = LAMP_SPACING / 2
    points.forEach(([x, z], i) => {
      const [px, pz] = points[Math.max(0, i - 1)]
      const [nx, nz] = points[Math.min(points.length - 1, i + 1)]
      const dx = nx - px
      const dz = nz - pz
      const length = Math.hypot(dx, dz) || 1
      const sx = -dz / length
      const sz = dx / length
      if (i > 0) along += Math.hypot(x - px, z - pz)
      const base = ribbon.positions.length / 3
      for (const side of [-1, 1]) {
        const rx = x + sx * HALF_WIDTH * side
        const rz = z + sz * HALF_WIDTH * side
        ribbon.positions.push(rx, ground(heightAt, rx, rz) + 0.12, rz)
        ribbon.uvs.push(side * HALF_WIDTH, along)
      }
      // Bank cross-section: inner foot, crest, outer foot, per side.
      const bankBase = banks.positions.length / 3
      for (const side of [-1, 1]) {
        for (const [offset, rise] of [
          [HALF_WIDTH + 0.2, 0.1],
          [BANK_OFFSET, 0.75 + 0.25 * Math.sin(along * 0.21 + side)],
          [BANK_OFFSET + 1.6, 0],
        ]) {
          const bx = x + sx * offset * side
          const bz = z + sz * offset * side
          banks.positions.push(bx, ground(heightAt, bx, bz) + rise, bz)
        }
      }
      if (i > 0) {
        const prev = base - 2
        ribbon.indices.push(prev, base, prev + 1, prev + 1, base, base + 1)
        const pb = bankBase - 6
        for (let k = 0; k < 2; k++) {
          for (const side of [0, 3]) {
            const a = pb + side + k
            const b = bankBase + side + k
            banks.indices.push(a, b, a + 1, a + 1, b, b + 1)
          }
        }
      }
      if (along >= nextLamp) {
        nextLamp += LAMP_SPACING
        const lx = x + sx * (BANK_OFFSET + 0.4)
        const lz = z + sz * (BANK_OFFSET + 0.4)
        if (nearVillage(lx, lz)) lamps.push(new THREE.Vector3(lx, ground(heightAt, lx, lz), lz))
      }
    })
  }

  const roadGeometry = new THREE.BufferGeometry()
  roadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3))
  roadGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(ribbon.uvs, 2))
  roadGeometry.setIndex(upward(ribbon.positions, ribbon.indices))
  roadGeometry.computeVertexNormals()
  const roadMaterial = new THREE.MeshLambertMaterial({ color: 0xd8dde1, polygonOffset: true, polygonOffsetFactor: -2 })
  roadMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoad;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Two pairs of packed tyre tracks, slightly icy and grey.
        float a = abs(abs(vRoad.x) - 1.7);
        float track = smoothstep(0.55, 0.2, a);
        float grit = fract(sin(dot(floor(vRoad * vec2(6.0, 3.0)), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= mix(1.0, 0.82 + grit * 0.05, track);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.78, 0.84), track * 0.25);`,
      )
  }
  const roadMesh = new THREE.Mesh(roadGeometry, roadMaterial)
  roadMesh.receiveShadow = true

  const bankGeometry = new THREE.BufferGeometry()
  bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(banks.positions, 3))
  bankGeometry.setIndex(upward(banks.positions, banks.indices))
  bankGeometry.computeVertexNormals()
  const bankMaterial = new THREE.MeshLambertMaterial({ color: 0xf1f5f8, side: THREE.DoubleSide })
  const bankMesh = new THREE.Mesh(bankGeometry, bankMaterial)
  bankMesh.receiveShadow = true
  bankMesh.castShadow = true

  // Lamp posts: dark pole, warm lantern.
  const poleGeometry = new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6)
  poleGeometry.translate(0, 2.1, 0)
  const headGeometry = new THREE.BoxGeometry(0.34, 0.42, 0.34)
  headGeometry.translate(0, 4.35, 0)
  const poleMaterial = new THREE.MeshLambertMaterial({ color: 0x2a2d31 })
  const headMaterial = new THREE.MeshLambertMaterial({ color: 0xffe2a8, emissive: 0xffc46b, emissiveIntensity: 0.6 })
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, Math.max(1, lamps.length))
  const heads = new THREE.InstancedMesh(headGeometry, headMaterial, Math.max(1, lamps.length))
  const m = new THREE.Matrix4()
  lamps.forEach((p, i) => {
    m.makeTranslation(p.x, p.y - 0.2, p.z)
    poles.setMatrixAt(i, m)
    heads.setMatrixAt(i, m)
  })
  poles.count = heads.count = lamps.length
  poles.castShadow = true

  group.add(roadMesh, bankMesh, poles, heads)
  return {
    object: group,
    lampCount: lamps.length,
    dispose() {
      for (const item of [roadGeometry, roadMaterial, bankGeometry, bankMaterial, poleGeometry, headGeometry, poleMaterial, headMaterial]) item.dispose()
      poles.dispose()
      heads.dispose()
    },
  }
}

function ground(heightAt: (x: number, z: number) => number, x: number, z: number): number {
  const h = heightAt(x, z)
  return Number.isFinite(h) ? h : 0
}

function densify(line: Point2[], step: number): Point2[] {
  const out: Point2[] = [line[0]]
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
  }
  return out
}

/** Flip every triangle whose normal points down, so lighting reads the top face. */
function upward(positions: number[], indices: number[]): number[] {
  const out = indices.slice()
  for (let i = 0; i < out.length; i += 3) {
    const [a, b, c] = [out[i] * 3, out[i + 1] * 3, out[i + 2] * 3]
    const ux = positions[b] - positions[a]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vz = positions[c + 2] - positions[a + 2]
    // y component of (b - a) x (c - a)
    if (uz * vx - ux * vz < 0) [out[i + 1], out[i + 2]] = [out[i + 2], out[i + 1]]
  }
  return out
}
