/**
 * Race-day dressing for one Apex event: the start house, race gates, split and
 * radar boards, safety netting, the finish arch with fencing, a cheering crowd,
 * parked cars and the timing hut. Built when the event starts and removed when
 * it ends, so none of it shows in free ski.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { besideLine, type EventCourse } from '../../world/events'
import { pointAlong } from '../../world/resort'
import { createGatesView } from './goalsView'
import { carParts } from './villageView'

type HeightAt = (x: number, z: number) => number

const DOWNHILL_RED = [0xd8262c]
const GS_COLOURS = [0xd8262c, 0x1f5fd1]
const JACKETS = [0xd8262c, 0x1f5fd1, 0xf0c419, 0x2f9e5b, 0xf2f2f2, 0x1b1f24, 0xe46b1f, 0x8a3fc4, 0x13a3b5, 0xc2185b]
const CAR_COLOURS = [0xf2f5f8, 0x1b1f24, 0x8a929b, 0xa31d1d, 0x2b4f86, 0x3f5a3a, 0xc9b896]

/** A seeded random so the same event always looks the same. */
function seeded(seed: number) {
  let state = seed
  return () => ((state = (state * 16807) % 2147483647) / 2147483647)
}

/** A painted board: bold text on a coloured ground with a border. */
function boardTexture(text: string, ground: string, ink: string, width = 1024, height = 160): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')!
  g.fillStyle = ground
  g.fillRect(0, 0, width, height)
  g.strokeStyle = ink
  g.lineWidth = 10
  g.strokeRect(5, 5, width - 10, height - 10)
  g.fillStyle = ink
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = height * 0.62
  g.font = `900 ${size}px system-ui, sans-serif`
  while (g.measureText(text).width > width * 0.9 && size > 12) g.font = `900 ${(size -= 4)}px system-ui, sans-serif`
  g.fillText(text, width / 2, height / 2 + 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export function createEventView(course: EventCourse, heightAt: HeightAt) {
  const { def, line, length } = course
  const group = new THREE.Group()
  group.name = `event:${def.id}`
  const disposables: { dispose(): void }[] = []
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x)
  const random = seeded(def.id.length * 7919 + Math.round(length))
  const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => keep(new THREE.MeshLambertMaterial({ color, ...extra }))
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, yaw = 0) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.rotation.y = yaw
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }

  // Gates: downhill panels are all red; GS alternates red and blue.
  const gatesView = course.gates.length
    ? createGatesView(course.gates, heightAt, def.gates.kind === 'downhill' ? DOWNHILL_RED : GS_COLOURS)
    : null
  if (gatesView) group.add(gatesView.object)

  const post = keep(new THREE.CylinderGeometry(0.12, 0.14, 1, 8).translate(0, 0.5, 0))
  const postMaterial = lambert(0x2a2d31)
  /** A banner on two posts, spanning `span` metres across the line at `s`, its face `height` m up. */
  const arch = (s: number, span: number, text: string, ground: string, ink: string, height = 4) => {
    const centre = besideLine(line, s, 0)
    const texture = keep(boardTexture(text, ground, ink))
    const material = keep(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide }))
    const banner = new THREE.Mesh(keep(new THREE.PlaneGeometry(span, span * (160 / 1024) * 1.4)), material)
    const ends = [-1, 1].map((k) => besideLine(line, s, (k * span) / 2))
    const base = Math.max(...ends.map((e) => heightAt(e.x, e.z)))
    banner.position.set(centre.x, base + height, centre.z)
    // Face up the hill, toward the racer coming down.
    banner.rotation.y = centre.yaw + Math.PI
    group.add(banner)
    for (const end of ends) {
      const mesh = add(post, postMaterial, end.x, heightAt(end.x, end.z) - 0.2, end.z)
      mesh.scale.y = base + height + 1 - heightAt(end.x, end.z)
    }
  }
  /** A board on one post beside the course. */
  const sign = (s: number, side: number, text: string, ground: string, ink: string) => {
    const spot = besideLine(line, s, side)
    const y = heightAt(spot.x, spot.z)
    add(post, postMaterial, spot.x, y - 0.2, spot.z).scale.y = 3.2
    const texture = keep(boardTexture(text, ground, ink, 512, 160))
    const board = new THREE.Mesh(keep(new THREE.PlaneGeometry(3.2, 1)), keep(new THREE.MeshLambertMaterial({ map: texture, side: THREE.DoubleSide })))
    board.position.set(spot.x, y + 3.2, spot.z)
    // Face up the hill so it reads on the way down.
    board.rotation.y = spot.yaw + Math.PI
    group.add(board)
  }

  // Start house: a small timber hut beside the start (clear of the chase camera behind the racer),
  // and the start wand just below the racer at knee height.
  {
    const beside = besideLine(line, 1, 7)
    const house = add(keep(new THREE.BoxGeometry(3.2, 2.8, 4.6).translate(0, 1.4, 0)), lambert(0x6b4a33), beside.x, heightAt(beside.x, beside.z) - 0.1, beside.z, beside.yaw)
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(4, 0.3, 5.4).translate(0, 3, 0)), lambert(0x2f3438))
    roof.castShadow = true
    house.add(roof)
    const wandSpot = besideLine(line, 1.6, 0)
    const wand = add(keep(new THREE.BoxGeometry(2.4, 0.06, 0.06)), lambert(0xf0c419), wandSpot.x, heightAt(wandSpot.x, wandSpot.z) + 0.55, wandSpot.z, wandSpot.yaw)
    wand.castShadow = false
    arch(2, 9, def.finish.banner.length > 14 ? 'START' : `${def.finish.banner} · START`, '#1b1f24', '#f0c419', 3.6)
  }

  // Split and radar boards.
  course.splits.forEach((s, i) => sign(s, 11, `SPLIT ${i + 1}`, '#1b1f24', '#ffffff'))
  if (course.trap) {
    sign(course.trap[0], -11, 'RADAR', '#f0c419', '#1b1f24')
    sign(course.trap[1], -11, 'END TRAP', '#f0c419', '#1b1f24')
    // The radar gun on its tripod.
    const spot = besideLine(line, course.trap[0] + 6, -9)
    const y = heightAt(spot.x, spot.z)
    const tripod = keep(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 5).translate(0, 0.75, 0))
    for (let k = 0; k < 3; k++) {
      const leg = add(tripod, postMaterial, spot.x + Math.cos(k * 2.1) * 0.3, y, spot.z + Math.sin(k * 2.1) * 0.3)
      leg.rotation.z = Math.cos(k * 2.1) * 0.25
      leg.rotation.x = -Math.sin(k * 2.1) * 0.25
    }
    add(keep(new THREE.BoxGeometry(0.4, 0.25, 0.6)), lambert(0xf0c419), spot.x, y + 1.6, spot.z, spot.yaw + Math.PI)
  }

  // Safety netting both sides of the gated steep of a speed course (from just above the first gate to past the last).
  if (def.gates.kind === 'downhill' && course.gates.length) {
    const from = course.gates[0].s - 10
    const to = course.gates[course.gates.length - 1].s + 30
    const net = keep(new THREE.MeshLambertMaterial({ color: 0xd84a1c, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }))
    for (const side of [-15, 15]) {
      const positions: number[] = []
      const indices: number[] = []
      let n = 0
      for (let s = from; s <= to; s += 4) {
        const p = besideLine(line, s, side)
        const y = heightAt(p.x, p.z)
        positions.push(p.x, y, p.z, p.x, y + 2.2, p.z)
        if (n) indices.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1)
        n++
      }
      const geometry = keep(new THREE.BufferGeometry())
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      group.add(new THREE.Mesh(geometry, net))
    }
  }

  // Finish: the arch, orange fencing down both sides of the last stretch and the run-out.
  const finishS = length - 10
  arch(finishS, 26, def.finish.banner, '#d8262c', '#ffffff', 4.5)
  const fence = keep(new THREE.MeshLambertMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }))
  for (const side of [-15, 15]) {
    const positions: number[] = []
    const indices: number[] = []
    let n = 0
    for (let s = finishS - 90; s <= length + 25; s += 3) {
      const p = besideLine(line, s, side)
      const y = heightAt(p.x, p.z)
      positions.push(p.x, y, p.z, p.x, y + 1.2, p.z)
      if (n) indices.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, (n - 1) * 2 + 1, n * 2, n * 2 + 1)
      n++
    }
    const geometry = keep(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    group.add(new THREE.Mesh(geometry, fence))
  }

  // The crowd: behind the fences near the finish, a few at the start and the radar.
  const crowdSpots: { x: number; z: number; face: number }[] = []
  const behind = (s: number, side: number, spread: number) => {
    const p = besideLine(line, s, side + Math.sign(side) * random() * spread)
    const centre = besideLine(line, s, 0)
    crowdSpots.push({ x: p.x, z: p.z, face: Math.atan2(centre.x - p.x, centre.z - p.z) + (random() - 0.5) * 0.8 })
  }
  for (let i = 0; i < def.finish.crowd; i++) behind(finishS - 70 + random() * 95, random() < 0.5 ? -16.5 : 16.5, 5)
  for (let i = 0; i < 10; i++) behind(random() * 25, random() < 0.5 ? -7 : 7, 4)
  if (course.trap) for (let i = 0; i < 12; i++) behind(course.trap[0] + random() * 40, -13, 4)
  const people = crowdSpots.length
  const body = keep(mergeGeometries([new THREE.CylinderGeometry(0.24, 0.2, 0.75, 8).translate(0, 1.05, 0), new THREE.CylinderGeometry(0.09, 0.09, 0.55, 6).translate(0.3, 1.15, 0).rotateZ(0)])!)
  const legs = keep(mergeGeometries([new THREE.CylinderGeometry(0.1, 0.09, 0.68, 6).translate(-0.1, 0.34, 0), new THREE.CylinderGeometry(0.1, 0.09, 0.68, 6).translate(0.1, 0.34, 0)])!)
  const head = keep(mergeGeometries([new THREE.SphereGeometry(0.14, 10, 8).translate(0, 1.58, 0), new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.62, 0)])!)
  const jackets = new THREE.InstancedMesh(body, lambert(0xffffff), people)
  const pants = new THREE.InstancedMesh(legs, lambert(0x23272c), people)
  const heads = new THREE.InstancedMesh(head, lambert(0xffffff), people)
  const skin = [0xe8c2a0, 0xc99b78, 0x8d5f3f, 0xf1d3b8]
  const base: { x: number; y: number; z: number; face: number; phase: number; keen: number }[] = []
  const colour = new THREE.Color()
  crowdSpots.forEach((spot, i) => {
    jackets.setColorAt(i, colour.setHex(JACKETS[Math.floor(random() * JACKETS.length)]))
    heads.setColorAt(i, colour.setHex(skin[Math.floor(random() * skin.length)]))
    base.push({ x: spot.x, y: heightAt(spot.x, spot.z) - 0.05, z: spot.z, face: spot.face, phase: random() * Math.PI * 2, keen: 0.5 + random() })
  })
  for (const mesh of [jackets, pants, heads]) {
    mesh.castShadow = true
    mesh.frustumCulled = false
    group.add(mesh)
  }

  // Parked cars in a row beside the run-out (Shoot the Chute's crowd watched from the upper lot).
  if (def.finish.cars) {
    const car = carParts(4.5, 1.85, 1.5, 0.5)
    keep(car.painted)
    keep(car.plain)
    const painted = new THREE.InstancedMesh(car.painted, lambert(0xffffff, { vertexColors: true }), def.finish.cars)
    const plain = new THREE.InstancedMesh(car.plain, lambert(0xffffff, { vertexColors: true }), def.finish.cars)
    const matrix = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let i = 0; i < def.finish.cars; i++) {
      const row = i % 2
      const spot = besideLine(line, length - 40 + Math.floor(i / 2) * 5.5, (row ? 1 : -1) * (24 + random() * 2))
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.yaw + (row ? Math.PI / 2 : -Math.PI / 2) + (random() - 0.5) * 0.2)
      matrix.compose(new THREE.Vector3(spot.x, heightAt(spot.x, spot.z), spot.z), q, new THREE.Vector3(1, 1, 1))
      painted.setMatrixAt(i, matrix)
      plain.setMatrixAt(i, matrix)
      painted.setColorAt(i, colour.setHex(CAR_COLOURS[Math.floor(random() * CAR_COLOURS.length)]))
      plain.setColorAt(i, colour.setHex(0xffffff))
    }
    for (const mesh of [painted, plain]) {
      mesh.castShadow = true
      group.add(mesh)
    }
  }

  // The timing hut beside the finish line.
  if (def.finish.hut) {
    const spot = besideLine(line, finishS + 4, 21)
    const y = heightAt(spot.x, spot.z)
    const hut = add(keep(new THREE.BoxGeometry(3.2, 2.6, 2.6).translate(0, 1.3, 0)), lambert(0xe9e4d8), spot.x, y - 0.1, spot.z, spot.yaw)
    const window = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.4, 0.8)), lambert(0x22303c))
    window.position.set(-1.61, 1.7, 0)
    window.rotation.y = -Math.PI / 2
    hut.add(window)
    const roof = new THREE.Mesh(keep(new THREE.BoxGeometry(3.6, 0.25, 3)), lambert(0x8a2a22))
    roof.position.y = 2.7
    hut.add(roof)
    sign(finishS + 4, 18, 'TIMING', '#1b1f24', '#ffffff')
  }

  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  let time = 0
  /** Pose every spectator: a sway, plus jumping and waving when the skier is close. */
  const pose = (skier: { x: number; z: number } | null) => {
    base.forEach((b, i) => {
      const near = skier ? Math.max(0, 1 - Math.hypot(skier.x - b.x, skier.z - b.z) / 60) : 0
      const hop = near * b.keen * Math.max(0, Math.sin(time * 9 + b.phase)) * 0.25
      quaternion.setFromAxisAngle(up, b.face + Math.sin(time * 0.7 + b.phase) * 0.15)
      position.set(b.x, b.y + hop, b.z)
      matrix.compose(position, quaternion, scale)
      jackets.setMatrixAt(i, matrix)
      pants.setMatrixAt(i, matrix)
      heads.setMatrixAt(i, matrix)
    })
    for (const mesh of [jackets, pants, heads]) mesh.instanceMatrix.needsUpdate = true
  }
  pose(null)

  // Points for tests and the start screen: where the start and finish are.
  const [fx, fz] = pointAlong(line, finishS)

  return {
    object: group,
    finish: { x: fx, z: fz },
    crowd: people,
    update(camera: THREE.Vector3, skier: { x: number; z: number } | null, dt: number) {
      time += dt
      gatesView?.update(camera)
      pose(skier)
    },
    mark(index: number, result: 'pass' | 'miss') {
      gatesView?.mark(index, result)
    },
    reset() {
      gatesView?.reset()
    },
    dispose() {
      gatesView?.dispose()
      for (const item of disposables) item.dispose()
      for (const mesh of [jackets, pants, heads]) mesh.dispose()
    },
  }
}

export type EventView = ReturnType<typeof createEventView>
