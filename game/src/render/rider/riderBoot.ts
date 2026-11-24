import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

type Ring = [height: number, halfWidth: number, heel: number, toe: number]
type BootMaterials = {
  boot: THREE.Material
  bootAccent: THREE.Material
  boardBoot: THREE.Material
  trim: THREE.Material
  buckle: THREE.Material
  strap: THREE.Material
}

/** Horizontal outlines from the sole upward, with an asymmetric toe and heel. */
function bootShell(rings: Ring[]): THREE.BufferGeometry {
  const sides = 16
  const positions: number[] = []
  const indices: number[] = []
  for (const [y, width, heel, toe] of rings) {
    for (let i = 0; i < sides; i++) {
      const a = i * 2 * Math.PI / sides
      const front = Math.cos(a)
      const z = (heel + toe) / 2 + front * (toe - heel) / 2
      positions.push(Math.sin(a) * width * (0.94 + front * 0.12), y, z)
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < sides; i++) {
      const a = ring * sides + i
      const b = ring * sides + (i + 1) % sides
      indices.push(a, b, a + sides, b, b + sides, a + sides)
    }
  }
  for (let i = 1; i < sides - 1; i++) {
    const top = (rings.length - 1) * sides
    indices.push(0, i + 1, i, top, top + i, top + i + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function detail(w: number, h: number, d: number, radius: number, x: number, y: number, z: number, pitch = 0) {
  const geometry = new RoundedBoxGeometry(w, h, d, 1, radius)
  return geometry.rotateX(pitch).translate(x, y, z)
}

function details(material: THREE.Material, parts: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  return new THREE.Mesh(geometry, material)
}

export function makeSkiBoot(mat: BootMaterials, side: number): THREE.Group {
  const boot = new THREE.Group()
  boot.name = 'ski-boot'
  const sole = new THREE.Mesh(bootShell([
    [0.052, 0.045, -0.131, 0.166], [0.06, 0.057, -0.138, 0.177], [0.078, 0.055, -0.134, 0.174],
  ]), mat.trim)
  const shell = new THREE.Mesh(bootShell([
    [0.07, 0.051, -0.127, 0.17], [0.092, 0.057, -0.133, 0.174],
    [0.125, 0.056, -0.131, 0.159], [0.156, 0.048, -0.118, 0.119],
    [0.19, 0.046, -0.104, 0.081], [0.222, 0.052, -0.103, 0.061],
    [0.275, 0.058, -0.094, 0.08], [0.32, 0.051, -0.065, 0.083],
  ]), mat.boot)
  const cuff = new THREE.Mesh(bootShell([
    [0.272, 0.057, -0.097, 0.081], [0.302, 0.058, -0.081, 0.089], [0.325, 0.053, -0.066, 0.08],
  ]), mat.bootAccent)
  const buckles = details(mat.buckle, [
    detail(0.071, 0.008, 0.022, 0.004, 0, 0.139, 0.135, 0.4),
    detail(0.073, 0.008, 0.022, 0.004, 0, 0.175, 0.093, 0.62),
    detail(0.015, 0.018, 0.036, 0.006, side * 0.042, 0.132, 0.133, 0.4),
    detail(0.015, 0.018, 0.037, 0.006, side * 0.043, 0.162, 0.089, 0.62),
  ])
  boot.add(sole, shell, cuff, buckles)
  return boot
}

export function makeBoardBoot(mat: BootMaterials): THREE.Group {
  const boot = new THREE.Group()
  boot.name = 'snowboard-boot'
  const sole = new THREE.Mesh(bootShell([
    [0.015, 0.047, -0.115, 0.145], [0.025, 0.057, -0.125, 0.16], [0.044, 0.058, -0.123, 0.157],
  ]), mat.trim)
  const upper = new THREE.Mesh(bootShell([
    [0.035, 0.055, -0.12, 0.154], [0.057, 0.06, -0.122, 0.155],
    [0.092, 0.057, -0.119, 0.146], [0.124, 0.051, -0.111, 0.116],
    [0.16, 0.05, -0.104, 0.076], [0.202, 0.057, -0.095, 0.063],
    [0.254, 0.057, -0.078, 0.064], [0.284, 0.053, -0.062, 0.062],
  ]), mat.boardBoot)
  const frame = details(mat.trim, [
    detail(0.119, 0.016, 0.22, 0.007, 0, 0.002, 0.002),
    detail(0.092, 0.117, 0.022, 0.01, 0, 0.078, -0.12, -0.22),
    detail(0.013, 0.037, 0.105, 0.006, -0.056, 0.031, -0.06),
    detail(0.013, 0.037, 0.105, 0.006, 0.056, 0.031, -0.06),
  ])
  const straps = details(mat.bootAccent, [
    bindingStrap(0.088, 0.144, 0.055, 0.012),
    bindingStrap(0.144, 0.095, 0.052, 0.018),
  ])
  const ratchets = details(mat.strap, [
    detail(0.014, 0.018, 0.027, 0.006, 0.055, 0.078, 0.085, -0.2),
    detail(0.017, 0.022, 0.031, 0.006, 0.053, 0.132, 0.053, -0.24),
  ])
  boot.add(sole, upper, frame, straps, ratchets)
  return boot
}

/** Straps follow the boot across the instep and curl down at the sides. */
function bindingStrap(y: number, toe: number, halfWidth: number, halfHeight: number) {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= 8; i++) {
    const angle = (i - 4) * 0.34
    const wrap = 1 - Math.cos(angle)
    const x = Math.sin(angle) * halfWidth
    const z = toe + 0.008 - wrap * 0.065
    const height = y - wrap * 0.029
    positions.push(x, height - halfHeight, z + 0.011, x, height + halfHeight, z - 0.011)
    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}
