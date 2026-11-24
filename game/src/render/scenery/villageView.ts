import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Village } from '../../world/village'
import { mergeStatic } from '../mergeStatic'

type HeightAt = (x: number, z: number) => number
export type VillageDetail = 'full' | 'mid' | 'lite'

/**
 * Parked cars (instanced: painted shell plus unpainted glass, tyres and a
 * snow cap), decks with posts and railings, patio tables, and the Billy Goat
 * Hut on the summit. Low = hut only; Medium thins cars and skips patio /
 * prop shadows; High keeps full fidelity. Props distance-cull past ~420 m.
 */
export function createVillageView(
  village: Village,
  heightAt: HeightAt,
  options: { detail?: VillageDetail } = {},
) {
  const group = new THREE.Group()
  group.name = 'village'
  const props = new THREE.Group()
  props.name = 'village-props'
  group.add(props)
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)
  const detail = options.detail ?? 'full'
  const showProps = detail !== 'lite'
  const full = detail === 'full'
  const castPropShadows = full

  let propCx = village.hut?.x ?? 0
  let propCz = village.hut?.z ?? 0
  let propCount = village.hut ? 1 : 0
  const noteProp = (x: number, z: number) => {
    propCx += x
    propCz += z
    propCount++
  }

  // ---- Cars (skipped on Low / lite to cut village draws at load) ----
  if (showProps) {
    const paint = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5 }))
    const trim = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))
    const bodies = [carParts(4.5, 1.8, 1.45, 0.62), carParts(4.7, 1.9, 1.75, 0.78), carParts(5.4, 2, 1.85, 0.55, true)]
    const placement = new THREE.Object3D()
    const tint = new THREE.Color()
    // Medium keeps about half the cars to cut instance count and load.
    const cars = full ? village.cars : village.cars.filter((_, i) => i % 2 === 0)
    bodies.forEach((parts, body) => {
      const ofBody = cars.filter((c) => c.body === body)
      if (!ofBody.length) return
      const shell = new THREE.InstancedMesh(keep(parts.painted), paint, ofBody.length)
      const rest = new THREE.InstancedMesh(keep(parts.plain), trim, ofBody.length)
      ofBody.forEach((car, i) => {
        placement.position.set(car.x, heightAt(car.x, car.z), car.z)
        placement.rotation.set(0, car.heading, 0)
        placement.updateMatrix()
        shell.setMatrixAt(i, placement.matrix)
        rest.setMatrixAt(i, placement.matrix)
        shell.setColorAt(i, tint.setHex(car.colour))
        noteProp(car.x, car.z)
      })
      for (const mesh of [shell, rest]) {
        mesh.castShadow = castPropShadows
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        props.add(mesh)
      }
    })
  }

  // ---- Decks and patios ----
  const deckParts: THREE.BufferGeometry[] = []
  const tables: THREE.Matrix4[] = []
  for (const deck of village.decks) {
    if (!showProps) continue
    const [a, b, , d] = deck.corners
    const ux = b[0] - a[0], uz = b[1] - a[1]
    const length = Math.hypot(ux, uz)
    const ox = d[0] - a[0], oz = d[1] - a[1]
    const depth = Math.hypot(ox, oz)
    const cx = (a[0] + b[0]) / 2 + ox / 2
    const cz = (a[1] + b[1]) / 2 + oz / 2
    noteProp(cx, cz)
    const floor = deck.floor
    // Local frame: X along the wall, Y up, Z outward (kept right-handed).
    const outward = new THREE.Vector3(ox / depth, 0, oz / depth)
    const up = new THREE.Vector3(0, 1, 0)
    const along = new THREE.Vector3(ux / length, 0, uz / length)
    if (along.clone().cross(up).dot(outward) < 0) along.negate()
    const toWorld = new THREE.Matrix4().makeBasis(along, up, outward).setPosition(cx, 0, cz)
    const box = (w: number, h: number, dz: number, x: number, y: number, z: number, colour: THREE.Color) => {
      const g = new THREE.BoxGeometry(w, h, dz).translate(x, y, z)
      colourise(g, colour)
      deckParts.push(g.applyMatrix4(toWorld))
    }
    const wood = new THREE.Color('#6b4a32'), snow = new THREE.Color('#e6edf2'), post = new THREE.Color('#5a3d29')
    box(length, 0.18, depth, 0, floor, 0, wood)
    box(length, 0.12, depth, 0, floor + 0.15, 0, snow)
    // Posts down to the ground at the outer corners and every 3 m.
    for (let s = -length / 2 + 0.2; s <= length / 2 - 0.2 + 1e-6; s += Math.max(2.8, (length - 0.4) / Math.ceil((length - 0.4) / 3))) {
      const wx = cx + along.x * s + outward.x * (depth / 2 - 0.15)
      const wz = cz + along.z * s + outward.z * (depth / 2 - 0.15)
      const ground = heightAt(wx, wz)
      const h = Math.max(0.3, floor - ground + 0.3)
      box(0.18, h, 0.18, s, floor - h / 2, depth / 2 - 0.15, post)
    }
    // Railings on the three open sides.
    box(length, 0.08, 0.08, 0, floor + 1.0, depth / 2 - 0.05, wood)
    box(length, 0.12, 0.1, 0, floor + 1.08, depth / 2 - 0.05, snow)
    for (const side of [-1, 1]) box(0.08, 0.08, depth, side * (length / 2 - 0.05), floor + 1.0, 0, wood)
    // Dense balusters only on High — Medium keeps the rail line without the spindles.
    if (full) {
      for (let s = -length / 2; s <= length / 2 + 1e-6; s += 0.5) box(0.04, 1.0, 0.04, s, floor + 0.5, depth / 2 - 0.05, post)
    }
    if (full && deck.patio) {
      for (let s = -length / 2 + 1.5; s < length / 2 - 1; s += 3) {
        const m = new THREE.Matrix4().makeTranslation(s, floor + 0.09, 0).premultiply(toWorld)
        tables.push(m)
      }
    }
  }
  if (deckParts.length) {
    const merged = keep(mergeGeometries(deckParts)!)
    for (const g of deckParts) g.dispose()
    const mesh = new THREE.Mesh(merged, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })))
    mesh.castShadow = mesh.receiveShadow = castPropShadows
    props.add(mesh)
  }
  if (tables.length) {
    const patio = keep(patioSet())
    const mesh = new THREE.InstancedMesh(patio, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })), tables.length)
    tables.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.castShadow = castPropShadows
    props.add(mesh)
  }

  // ---- Billy Goat Hut ----
  if (village.hut) {
    const hut = billyGoatHut()
    hut.position.set(village.hut.x, heightAt(village.hut.x, village.hut.z) - 0.2, village.hut.z)
    hut.rotation.y = village.hut.heading
    group.add(hut)
    hut.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true
    })
    mergeStatic(hut)
    hut.traverse((o) => {
      if (o instanceof THREE.Mesh) disposables.push(o.geometry)
    })
  }

  const centreX = propCount ? propCx / propCount : 0
  const centreZ = propCount ? propCz / propCount : 0
  // Hide cars/decks when the camera is far from the village cluster.
  const CULL = 420

  return {
    object: group,
    update(camera: { x: number; z: number }) {
      if (!props.children.length) return
      const dx = camera.x - centreX
      const dz = camera.z - centreZ
      props.visible = dx * dx + dz * dz < CULL * CULL
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

function colourise(geometry: THREE.BufferGeometry, colour: THREE.Color) {
  const n = geometry.getAttribute('position').count
  const colours = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) colour.toArray(colours, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

/** Car facing +Z: painted lower body and pillars, and an unpainted set (glass, tyres, lights, snow on the roof). */
function carParts(length: number, width: number, height: number, cabin: number, pickup = false) {
  const painted: THREE.BufferGeometry[] = []
  const plain: THREE.BufferGeometry[] = []
  const white = new THREE.Color(1, 1, 1)
  const add = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, c: THREE.Color = white) => list.push(colourise(g, c))
  const ride = 0.32
  const bodyH = height * 0.48
  add(painted, new THREE.BoxGeometry(width, bodyH, length).translate(0, ride + bodyH / 2, 0))
  const cabinLength = pickup ? length * 0.4 : length * cabin
  const cabinZ = pickup ? length * 0.12 : -length * 0.05
  const cabinH = height - ride - bodyH
  // Glass all round, a painted roof on top.
  add(plain, new THREE.BoxGeometry(width * 0.9, cabinH * 0.9, cabinLength).translate(0, ride + bodyH + cabinH * 0.45, cabinZ), new THREE.Color('#1d2833'))
  add(painted, new THREE.BoxGeometry(width * 0.92, 0.08, cabinLength * 1.02).translate(0, ride + bodyH + cabinH * 0.92, cabinZ))
  // Snow on the roof and hood.
  add(plain, new THREE.BoxGeometry(width * 0.86, 0.16, cabinLength * 0.95).translate(0, ride + bodyH + cabinH + 0.04, cabinZ), new THREE.Color('#eef3f7'))
  add(plain, new THREE.BoxGeometry(width * 0.85, 0.08, length * 0.22).translate(0, ride + bodyH + 0.02, length * 0.36), new THREE.Color('#e3eaf0'))
  if (pickup) add(plain, new THREE.BoxGeometry(width * 0.85, 0.22, length * 0.36).translate(0, ride + bodyH + 0.02, -length * 0.3), new THREE.Color('#e3eaf0'))
  // Tyres and lights.
  const tyre = new THREE.Color('#15181c')
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      add(plain, new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10).rotateZ(Math.PI / 2).translate(sx * (width / 2 - 0.1), 0.34, sz * length * 0.32), tyre)
    }
    add(plain, new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(sx * (width / 2 - 0.25), ride + bodyH * 0.7, length / 2 + 0.01), new THREE.Color('#f4f1d8'))
    add(plain, new THREE.BoxGeometry(0.3, 0.12, 0.05).translate(sx * (width / 2 - 0.25), ride + bodyH * 0.7, -length / 2 - 0.01), new THREE.Color('#9b1c1c'))
  }
  return { painted: mergeGeometries(painted)!, plain: mergeGeometries(plain)! }
}

/** Table with a closed umbrella and two benches, for patios. */
function patioSet() {
  const parts: THREE.BufferGeometry[] = []
  const wood = new THREE.Color('#7a5236'), pole = new THREE.Color('#d9d4c8'), canvas = new THREE.Color('#a32a2a'), snow = new THREE.Color('#eef3f7')
  parts.push(colourise(new THREE.BoxGeometry(1.6, 0.06, 0.8).translate(0, 0.74, 0), wood))
  parts.push(colourise(new THREE.BoxGeometry(1.6, 0.04, 0.78).translate(0, 0.8, 0), snow))
  for (const s of [-1, 1]) {
    parts.push(colourise(new THREE.BoxGeometry(1.6, 0.05, 0.3).translate(0, 0.44, s * 0.62), wood))
    parts.push(colourise(new THREE.BoxGeometry(0.06, 0.74, 0.7).translate(s * 0.7, 0.37, 0), wood))
  }
  parts.push(colourise(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 6).translate(0, 1.15, 0), pole))
  parts.push(colourise(new THREE.ConeGeometry(0.16, 1.1, 8).rotateX(Math.PI).translate(0, 1.95, 0), canvas))
  parts.push(colourise(new THREE.SphereGeometry(0.1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2.48, 0), snow))
  return mergeGeometries(parts)!
}

/** Small log cabin with a snow-loaded gable roof, stovepipe and a patrol sign. */
function billyGoatHut() {
  const hut = new THREE.Group()
  const logs = new THREE.MeshStandardMaterial({ color: '#6e4a2f', roughness: 0.9 })
  const dark = new THREE.MeshStandardMaterial({ color: '#3a281b', roughness: 0.9 })
  const snow = new THREE.MeshStandardMaterial({ color: '#eef3f7', roughness: 0.95 })
  const glass = new THREE.MeshStandardMaterial({ color: '#f3c46a', emissive: '#6a4410', roughness: 0.3 })
  const w = 5, d = 4, h = 2.6
  for (let y = 0.15; y < h; y += 0.3) {
    for (const [sx, sz, len, rot] of [[0, d / 2, w + 0.4, 0], [0, -d / 2, w + 0.4, 0], [w / 2, 0, d + 0.4, Math.PI / 2], [-w / 2, 0, d + 0.4, Math.PI / 2]] as const) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, len, 7), logs)
      log.rotation.set(0, rot, Math.PI / 2)
      log.position.set(sx, y, sz)
      hut.add(log)
    }
  }
  const rise = 1.5
  const roofShape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.5, 0), new THREE.Vector2(w / 2 + 0.5, 0), new THREE.Vector2(0, rise)])
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: d + 0.8, bevelEnabled: false }).translate(0, h, -(d + 0.8) / 2), dark)
  hut.add(gable)
  // Heavy snow load on both roof planes.
  const slope = Math.atan2(rise, w / 2 + 0.5)
  const plane = Math.hypot(rise, w / 2 + 0.5)
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(plane, 0.35, d + 1), snow)
    cap.position.set(s * (w / 4 + 0.25), h + rise / 2 + 0.12, 0)
    cap.rotation.z = -s * slope
    hut.add(cap)
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.1), dark)
  door.position.set(-0.9, 0.95, d / 2 + 0.16)
  const window1 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.08), glass)
  window1.position.set(1.0, 1.4, d / 2 + 0.16)
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), new THREE.MeshStandardMaterial({ color: '#2a2d31', metalness: 0.6, roughness: 0.5 }))
  pipe.position.set(1.4, h + rise * 0.6 + 0.4, -0.6)
  // Ski patrol sign: white board, red cross.
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), new THREE.MeshStandardMaterial({ color: '#f4f4f0' }))
  board.position.set(0, h + 0.35, d / 2 + 0.45)
  const red = new THREE.MeshStandardMaterial({ color: '#c81e1e' })
  const crossA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.06), red)
  const crossB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.06), red)
  crossA.position.copy(board.position).z += 0.02
  crossB.position.copy(board.position).z += 0.02
  // A drift banked against the uphill wall.
  const drift = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), snow)
  drift.scale.set(w * 0.65, 1.2, 1.6)
  drift.position.set(0, 0, -d / 2 - 0.4)
  hut.add(door, window1, pipe, board, crossA, crossB, drift)
  hut.name = 'billy-goat-hut'
  return hut
}
