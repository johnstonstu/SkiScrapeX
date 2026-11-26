import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Lift } from '../../world/resort'
import { mergedAsset, partsNamed, placeAsset, type AssetSet } from './sceneryAssets'

const TOWER_HEIGHT = 11
/** Surface lift (T-bar) towers are shorter: the rope only has to clear the hangers. */
const SURFACE_TOWER_HEIGHT = 7
/** Height of the T-bar crossbar above the snow while it is pulling a rider. */
const BAR_HEIGHT = 0.85
/** Metres between T-bar hangers along the rope. */
const HANGER_SPACING = 14
/** The rider stands this far to the side of the hanger stem, on one half of the bar. */
const RIDER_BESIDE_STEM = 0.4
const STATION_HEIGHT = 4.5
const HALF_GAUGE = 2.6
const AERIAL = new Set(['chair_lift', 'gondola', 'mixed_lift', 'cable_car'])
const SEAT_DROP = 2.3

export interface RidePath {
  points: THREE.Vector3[]
  lengths: number[]
  total: number
  aerial: boolean
  speed: number
  boardingDistance: number
  /** Surface lifts: the rider stands on the snow under the rope, not on it. */
  onSnow?: boolean
  /** Metres between chairs or hangers; moving the rider by a multiple keeps them on one. */
  spacing?: number
}

/** Position and travel yaw at `s` metres along a path. */
export function sampleRide(path: RidePath, s: number, out: THREE.Vector3): number {
  const d = Math.max(0, Math.min(path.total, s))
  let first = 1, last = path.lengths.length - 1
  while (first < last) {
    const middle = (first + last) >>> 1
    if (path.lengths[middle] < d) first = middle + 1
    else last = middle
  }
  const k = first
  const a = path.points[k - 1]
  const b = path.points[k]
  const t = (d - path.lengths[k - 1]) / Math.max(1e-6, path.lengths[k] - path.lengths[k - 1])
  out.lerpVectors(a, b, t)
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/**
 * Towers, haul rope, terminals and moving chairs for each lift. With `models`
 * (lifts.glb, from tools/blender/build_lifts.py) the chairs, towers and
 * terminals are the modelled ones; without, the code-built parts below.
 */
export function createLiftView(lifts: Lift[], heightAt: (x: number, z: number) => number, models: AssetSet | null = null) {
  const group = new THREE.Group()
  group.name = 'lifts'
  const steel = new THREE.MeshLambertMaterial({ color: 0x5b6168 })
  const paint = new THREE.MeshLambertMaterial({ color: 0x1f4f86 })
  const roof = new THREE.MeshLambertMaterial({ color: 0x6b3b2d })
  const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x2a2a2a })
  // Chairlift hardware after Quickdraw (Doppelmayr-CTEC detachable quad, 1994): galvanized
  // tubular towers and chairs, Uni terminals under a light hood. Stock's (GMD Müller triple)
  // uses open green-frame terminals instead. T-bar uses portal towers + split terminals.
  const galv = new THREE.MeshStandardMaterial({ color: 0xb0b6bc, metalness: 0.55, roughness: 0.42 })
  const pad = new THREE.MeshStandardMaterial({ color: 0x1e2329, roughness: 0.8 })
  const hood = new THREE.MeshStandardMaterial({ color: 0xe4e8ec, roughness: 0.5, metalness: 0.1 })
  const stocksGreen = new THREE.MeshLambertMaterial({ color: 0x3f6b3a })
  const stocksCabin = new THREE.MeshLambertMaterial({ color: 0x6e7a68 })
  const aerialTower = chairTower()

  const disposables: { dispose(): void }[] = [
    steel, paint, roof, ropeMaterial, galv, pad, hood, stocksGreen, stocksCabin, aerialTower,
  ]
  const ropes: {
    liftId: string
    circuit: RidePath
    uphill: RidePath
    chairs: THREE.InstancedMesh
    /** T-bar crossbars; `chairs` then holds the stems, scaled to reach the snow. */
    bars?: THREE.InstancedMesh
    distance: number
  }[] = []
  const transform = new THREE.Object3D()
  const housings: THREE.Object3D[] = []
  const rides = new Map<string, RidePath>()
  const beltMaterial = new THREE.MeshLambertMaterial({ color: 0x2b2f33 })
  const carpetRail = new THREE.MeshLambertMaterial({ color: 0x8a9098 })
  const carpetClear = new THREE.MeshLambertMaterial({ color: 0xc8d8e8, transparent: true, opacity: 0.35, depthWrite: false })
  const tbarYellow = new THREE.MeshLambertMaterial({ color: 0xc4a035 })
  const mazeOrange = new THREE.MeshLambertMaterial({ color: 0xe85a1a })
  disposables.push(beltMaterial, carpetRail, carpetClear, tbarYellow, mazeOrange)
  const surfaceTower = tbarPortal()
  disposables.push(surfaceTower)

  for (const lift of lifts) {
    const aerial = AERIAL.has(lift.type)
    const ground = (x: number, z: number) => {
      const h = heightAt(x, z)
      return Number.isFinite(h) ? h : 0
    }
    const towerHeight = aerial ? TOWER_HEIGHT : SURFACE_TOWER_HEIGHT
    const stops: { x: number; z: number; y: number }[] = [
      { x: lift.bottom[0], z: lift.bottom[1], y: ground(lift.bottom[0], lift.bottom[1]) + STATION_HEIGHT },
      ...lift.towers.map(([x, z]) => ({ x, z, y: ground(x, z) + towerHeight })),
      { x: lift.top[0], z: lift.top[1], y: ground(lift.top[0], lift.top[1]) + STATION_HEIGHT },
    ]
    const dir = new THREE.Vector2(lift.top[0] - lift.bottom[0], lift.top[1] - lift.bottom[1]).normalize()
    const side = new THREE.Vector2(-dir.y, dir.x)
    const yaw = Math.atan2(dir.x, dir.y)

    if (lift.type === 'magic_carpet') {
      addMagicCarpet(group, lift.line, ground, { belt: beltMaterial, rail: carpetRail, cover: carpetClear }, disposables)
      const points = lift.line.map(([x, z]) => new THREE.Vector3(x, ground(x, z) + 0.25, z))
      rides.set(lift.id, ridePath(points, false))
      continue
    }

    const stocksLift = aerial && (lift.seats === 3 || /stock/i.test(lift.name))
    const kind = !aerial ? 'tb' : stocksLift ? 'st' : 'qd'
    for (const [x, z] of lift.towers) {
      const modelled = models && placeAsset(models, `${kind}_tower`)
      if (modelled) {
        modelled.position.set(x, ground(x, z), z)
        modelled.rotation.y = yaw
        group.add(modelled)
        continue
      }
      if (aerial) {
        const tower = new THREE.Mesh(aerialTower, galv)
        tower.position.set(x, ground(x, z), z)
        tower.rotation.y = yaw
        tower.castShadow = true
        group.add(tower)
        continue
      }
      const tower = new THREE.Mesh(surfaceTower, steel)
      tower.position.set(x, ground(x, z), z)
      tower.rotation.y = yaw
      tower.castShadow = true
      group.add(tower)
    }
    for (const [x, z] of [lift.bottom, lift.top]) {
      const atTop = x === lift.top[0] && z === lift.top[1]
      const modelled = models && placeAsset(models, `${kind}_terminal_${atTop ? 'top' : 'bottom'}`)
      if (modelled) {
        // Housing parts hide when the camera is inside them (boarding and unloading).
        const hood = partsNamed(modelled, 'hood_')
        for (const mesh of hood) mesh.userData.hood = true
        if (hood.length) modelled.userData.housing = { parts: hood, halfWidth: 5.9, from: -6, to: 17, top: STATION_HEIGHT + 5.5 }
      }
      const station = modelled ?? (!aerial
        ? surfaceTerminal({ steel, paint, roof, yellow: tbarYellow }, disposables, atTop ? 'top' : 'bottom')
        : stocksLift
          ? stocksTerminal({ green: stocksGreen, cabin: stocksCabin, steel, roof }, disposables, atTop ? 'top' : 'bottom')
          : terminal({ galv, hood, paint, roof }, disposables))
      station.position.set(x, ground(x, z), z)
      // Each terminal's detach section faces down the line toward the other end.
      station.rotation.y = yaw + (aerial && atTop ? Math.PI : 0)
      // A station stands at the ground under its centre; where the slope falls away
      // under a corner (a hut, a leg, the end of the deck), reach down to the snow.
      disposables.push(...reachGround(station, ground))
      group.add(station)
      if (station.userData.housing) housings.push(station)
    }
    // Tiny orange load corral at Quickdraw bottom only (review #27 slice).
    if (aerial && !models && /quick\s*draw/i.test(lift.name)) {
      group.add(liftMazeHint(lift.bottom, dir, side, ground, mazeOrange, disposables))
    }

    // Up rope on one side, down rope on the other, joined at the bull wheels.
    const legs: THREE.Vector3[][] = []
    for (const sign of [1, -1]) {
      const path = (sign === 1 ? stops : [...stops].reverse()).map(
        (stop) => new THREE.Vector3(stop.x + side.x * HALF_GAUGE * sign, stop.y, stop.z + side.y * HALF_GAUGE * sign),
      )
      // Sample the suspended rope between supports; chairs and riders follow it too.
      const spans = path.slice()
      path.length = 0
      for (let j = 1; j < spans.length; j++) {
        const a = spans[j - 1], b = spans[j]
        const sag = Math.min(2.2, a.distanceTo(b) * 0.017)
        for (let k = 0; k < 6; k++) {
          const t = k / 6
          const p = a.clone().lerp(b, t)
          p.y -= Math.min(4 * t * (1 - t) * sag, Math.max(0, p.y - ground(p.x, p.z) - 4.5))
          path.push(p)
        }
      }
      path.push(spans[spans.length - 1])
      const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), ropeMaterial)
      disposables.push(rope.geometry)
      group.add(rope)
      legs.push(path)
    }
    const triple = lift.seats === 3
    // T-Bar: 668 m in 4.6 min per the OSM/Apex lift data (2.4 m/s).
    const speed = !aerial ? 2.4 : triple ? 2.28 : 5
    let uphill: RidePath
    if (aerial) {
      uphill = ridePath(legs[0].map(p => p.clone().setY(p.y - SEAT_DROP - 0.39)), true, speed)
    } else {
      // Ride beside a hanger under the up rope. Distances stay those of the
      // rope so the rider keeps pace with the hanger pulling them.
      uphill = ridePath(legs[0], false, speed)
      uphill.points = legs[0].map((p) => {
        const x = p.x - side.x * RIDER_BESIDE_STEM
        const z = p.z - side.y * RIDER_BESIDE_STEM
        return new THREE.Vector3(x, ground(x, z), z)
      })
      uphill.onSnow = true
    }
    rides.set(lift.id, uphill)
    const loop: THREE.Vector3[] = []
    for (const [i, leg] of legs.entries()) {
      loop.push(...leg)
      const end = leg[leg.length - 1]
      const sign = i === 0 ? 1 : -1
      for (let k = 1; k < 10; k++) {
        const theta = k * Math.PI / 10
        const across = sign * HALF_GAUGE * (Math.cos(theta) - 1)
        const ahead = sign * HALF_GAUGE * Math.sin(theta)
        loop.push(new THREE.Vector3(end.x + across * side.x + ahead * dir.x, end.y, end.z + across * side.y + ahead * dir.y))
      }
    }
    loop.push(loop[0])
    const circuit = ridePath(loop, true, speed)
    if (!aerial) {
      const count = Math.max(2, Math.round(circuit.total / HANGER_SPACING))
      const stem = new THREE.CylinderGeometry(0.03, 0.03, 1, 5)
      stem.translate(0, -0.5, 0)
      const bar = new THREE.BoxGeometry(0.9, 0.07, 0.07)
      disposables.push(stem, bar)
      const chairs = new THREE.InstancedMesh(stem, steel, count)
      const bars = new THREE.InstancedMesh(bar, tbarYellow, count)
      chairs.frustumCulled = bars.frustumCulled = false
      group.add(chairs, bars)
      ropes.push({ liftId: lift.id, circuit, uphill, chairs, bars, distance: 0 })
      continue
    }
    const model = models && mergedAsset(models, triple ? 'st_chair' : 'qd_chair')
    const geometry = model?.geometry ?? chair()
    if (!model) geometry.scale(triple ? 0.75 : 1, 1, 1)
    disposables.push(geometry)
    const chairs = new THREE.InstancedMesh(geometry, model?.materials ?? [galv, pad], triple ? 138 : 79)
    chairs.castShadow = true
    chairs.frustumCulled = false
    group.add(chairs)
    ropes.push({ liftId: lift.id, circuit, uphill, chairs, distance: 0 })
  }

  const point = new THREE.Vector3()
  const local = new THREE.Vector3()

  return {
    object: group,
    /** Hide a terminal's housing and hood while the camera is inside or right under it (boarding, unloading). */
    clearView(camera: THREE.Vector3) {
      for (const station of housings) {
        const h = station.userData.housing as { parts: THREE.Mesh[]; halfWidth: number; from: number; to: number; top: number }
        station.worldToLocal(local.copy(camera))
        const inside = Math.abs(local.x) < h.halfWidth && local.z > h.from && local.z < h.to && local.y < h.top
        for (const part of h.parts) part.visible = !inside
      }
    },
    ride(liftId: string): RidePath | null {
      return rides.get(liftId) ?? null
    },
    /** Move a lift's rope so a chair sits at `s` metres up the ride (a session opening on the chair). */
    alignChair(liftId: string, s: number) {
      const rope = ropes.find((r) => r.liftId === liftId)
      if (!rope) return
      const spacing = rope.circuit.total / rope.chairs.count
      const offset = (((s - rope.distance) % spacing) + spacing) % spacing
      rope.distance = (rope.distance + offset) % rope.circuit.total
      rope.uphill.spacing = spacing
      rope.uphill.boardingDistance = rope.distance % spacing
    },
    update(dt: number, fastLift?: string) {
      for (const rope of ropes) {
        const spacing = rope.circuit.total / rope.chairs.count
        rope.uphill.spacing = spacing
        rope.distance = (rope.distance + dt * rope.uphill.speed * (rope.liftId === fastLift ? 6 : 1)) % rope.circuit.total
        rope.uphill.boardingDistance = rope.distance % spacing
        for (let i = 0; i < rope.chairs.count; i++) {
          const s = (rope.distance + i * spacing) % rope.circuit.total
          const yaw = sampleRide(rope.circuit, s, point)
          transform.position.copy(point)
          transform.rotation.set(0, yaw, 0)
          if (rope.bars) {
            // Pulling on the way up (stem reaches the rider's seat), wound in on the way down.
            const snow = heightAt(point.x, point.z)
            const reach = s < rope.uphill.total && Number.isFinite(snow) ? point.y - snow - BAR_HEIGHT : 1.2
            transform.scale.set(1, Math.max(0.5, reach), 1)
            transform.updateMatrix()
            rope.chairs.setMatrixAt(i, transform.matrix)
            transform.position.y -= Math.max(0.5, reach)
            transform.scale.set(1, 1, 1)
            transform.updateMatrix()
            rope.bars.setMatrixAt(i, transform.matrix)
            continue
          }
          transform.updateMatrix()
          rope.chairs.setMatrixAt(i, transform.matrix)
        }
        rope.chairs.instanceMatrix.needsUpdate = true
        if (rope.bars) rope.bars.instanceMatrix.needsUpdate = true
      }
    },
    dispose() {
      for (const item of disposables) item.dispose()
      for (const rope of ropes) {
        rope.chairs.dispose()
        rope.bars?.dispose()
      }
    },
  }
}

/** Vertices this close to a station's base (metres) are its footings. */
const FOOTING_HEIGHT = 0.35

/**
 * Lower every footing vertex of `station` (walls, legs and skirts at its base)
 * that hangs over the snow down to just under it, so nothing floats on a
 * slope. Footings over higher ground are left alone (they stand in the snow).
 * Meshes it changes get their own copy of the geometry, returned for disposal.
 */
export function reachGround(station: THREE.Object3D, ground: (x: number, z: number) => number): THREE.BufferGeometry[] {
  station.updateMatrixWorld(true)
  const base = station.position.y
  const copies: THREE.BufferGeometry[] = []
  const v = new THREE.Vector3()
  const inverse = new THREE.Matrix4()
  station.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return
    inverse.copy(mesh.matrixWorld).invert()
    let geometry: THREE.BufferGeometry | null = null
    const source = mesh.geometry.attributes.position
    for (let i = 0; i < source.count; i++) {
      v.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld)
      if (v.y - base > FOOTING_HEIGHT) continue
      const snow = ground(v.x, v.z) - 0.1
      if (snow >= v.y - 0.02) continue
      if (!geometry) {
        geometry = mesh.geometry.clone()
        copies.push(geometry)
      }
      v.y = snow
      v.applyMatrix4(inverse)
      geometry.attributes.position.setXYZ(i, v.x, v.y, v.z)
    }
    if (geometry) {
      geometry.computeBoundingSphere()
      geometry.computeBoundingBox()
      mesh.geometry = geometry
    }
  })
  return copies
}

/** Merge boxes and tubes into one geometry (all indexed, same attributes). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!
  for (const g of parts) g.dispose()
  return merged
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rx) g.rotateX(rx)
  g.translate(x, y, z)
  return g
}

const tube = (r: number, from: THREE.Vector3, to: THREE.Vector3, sides = 6) => {
  const length = from.distanceTo(to)
  const g = new THREE.CylinderGeometry(r, r, length, sides)
  g.translate(0, length / 2, 0)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
  g.applyQuaternion(q)
  g.translate(from.x, from.y, from.z)
  return g
}

/**
 * Galvanized quad chair (CTEC style) hanging below the grip at the origin:
 * a hanger that bends back over the seat, four seat and back pads, and a
 * lowered safety bar with a footrest. Group 0 is the frame, group 1 the pads.
 */
function chair(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const frame = merge([
    box(0.16, 0.22, 0.3, 0, -0.08, 0),
    tube(0.045, v(0, -0.15, 0), v(0, -1.45, 0.05)),
    tube(0.045, v(0, -1.45, 0.05), v(0, -1.8, -0.32)),
    tube(0.035, v(-1.12, -1.8, -0.32), v(1.12, -1.8, -0.32)),
    tube(0.035, v(-1.12, -2.36, 0.25), v(1.12, -2.36, 0.25)),
    tube(0.035, v(-1.12, -2.36, -0.3), v(1.12, -2.36, -0.3)),
    ...[-1.12, 1.12].flatMap((x) => [tube(0.035, v(x, -1.8, -0.32), v(x, -2.36, -0.3)), tube(0.035, v(x, -2.36, -0.3), v(x, -2.36, 0.25))]),
    // Safety bar pivots at the hanger, comes forward over the lap, drops to the footrest.
    tube(0.03, v(0, -1.5, 0.05), v(0, -1.72, 0.62)),
    tube(0.03, v(-1.05, -1.72, 0.62), v(1.05, -1.72, 0.62)),
    ...[-0.6, 0.6].map((x) => tube(0.025, v(x, -1.72, 0.62), v(x, -2.72, 0.66))),
    tube(0.03, v(-0.95, -2.72, 0.66), v(0.95, -2.72, 0.66)),
  ])
  const pads = merge(
    [-0.83, -0.28, 0.28, 0.83].flatMap((x) => [
      box(0.5, 0.08, 0.5, x, -2.3, -0.02),
      box(0.5, 0.42, 0.07, x, -2.07, -0.27, -0.18),
    ]),
  )
  const geometry = mergeGeometries([frame, pads], true)!
  frame.dispose()
  pads.dispose()
  return geometry
}

/**
 * Chairlift line tower: a tapered tube, a crossarm, a sheave train under
 * each rope (rope runs along local Z at TOWER_HEIGHT, HALF_GAUGE either
 * side), a ladder up the downhill face and a railed walkway on the arm.
 */
function chairTower(): THREE.BufferGeometry {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const top = TOWER_HEIGHT
  const parts: THREE.BufferGeometry[] = []
  const column = new THREE.CylinderGeometry(0.3, 0.46, top + 0.4, 10)
  column.translate(0, (top + 0.4) / 2 - 0.9, 0)
  parts.push(column)
  parts.push(box(HALF_GAUGE * 2 + 1.4, 0.45, 0.55, 0, top - 0.75, 0))
  parts.push(box(0.7, 0.7, 0.7, 0, top - 0.75, 0))
  for (const sx of [-1, 1]) {
    const x = sx * HALF_GAUGE
    parts.push(box(0.14, 0.3, 0.3, x, top - 0.45, 0))
    parts.push(box(0.12, 0.16, 3, x, top - 0.3, 0))
    for (let k = 0; k < 4; k++) {
      const wheel = new THREE.CylinderGeometry(0.17, 0.17, 0.1, 10)
      wheel.rotateZ(Math.PI / 2)
      wheel.translate(x, top - 0.13, -1.1 + k * 0.73)
      parts.push(wheel)
    }
  }
  // Walkway grate on the downhill side of the arm, with a handrail.
  parts.push(box(HALF_GAUGE * 2 + 1.2, 0.05, 0.6, 0, top - 1.0, -0.6))
  parts.push(tube(0.025, v(-HALF_GAUGE - 0.6, top - 0.05, -0.88), v(HALF_GAUGE + 0.6, top - 0.05, -0.88), 4))
  for (const x of [-HALF_GAUGE - 0.6, 0, HALF_GAUGE + 0.6]) parts.push(tube(0.025, v(x, top - 1.0, -0.88), v(x, top - 0.05, -0.88), 4))
  // Ladder.
  for (const x of [-0.2, 0.2]) parts.push(tube(0.025, v(x, 1.5, -0.52), v(x, top - 1.0, -0.4), 4))
  for (let y = 1.8; y < top - 1.1; y += 0.4) parts.push(box(0.4, 0.03, 0.03, 0, y, -0.52 + ((y - 1.5) / (top - 2.5)) * 0.12))
  return merge(parts)
}

/**
 * Detachable (Uni) terminal: the bull wheel and detach section in a long
 * housing under a rounded hood, carried on a column at the bull wheel and
 * two legs at the line end, open underneath so riders (and the camera
 * behind them) pass through. Local +Z points down the line. An operator
 * hut stands beside the loading area.
 */
function terminal(
  m: { galv: THREE.Material; hood: THREE.Material; paint: THREE.Material; roof: THREE.Material },
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  const width = HALF_GAUGE * 2 + 1.6
  const length = 13
  const from = -3
  const base = STATION_HEIGHT + 0.5
  const frame = merge([
    box(1, base, 1.8, 0, base / 2, -0.5),
    ...[-1, 1].map((sx) => box(0.4, base, 0.4, sx * (width / 2 - 0.3), base / 2, from + length - 1.2)),
    box(width, 0.9, length, 0, base + 0.45, from + length / 2),
  ])
  const shell = new THREE.CylinderGeometry(width / 2 + 0.15, width / 2 + 0.15, length + 0.4, 20, 1, false, Math.PI / 2, Math.PI)
  shell.rotateX(Math.PI / 2)
  shell.scale(1, 0.58, 1)
  shell.translate(0, base + 0.9, from + length / 2)
  const skirt = box(width + 0.3, 0.35, length + 0.4, 0, base + 0.75, from + length / 2)
  const hut = box(3.2, 2.6, 3.2, width / 2 + 3, 1.3, 6)
  const hutRoof = new THREE.ConeGeometry(2.7, 1.2, 4)
  hutRoof.rotateY(Math.PI / 4)
  hutRoof.translate(width / 2 + 3, 3.2, 6)
  const windows = box(3.24, 0.9, 2.4, width / 2 + 3, 1.7, 6)
  disposables.push(frame, shell, skirt, hut, hutRoof, windows)
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2630, roughness: 0.2, metalness: 0.3 })
  disposables.push(dark)
  const meshes = [
    new THREE.Mesh(frame, m.galv),
    new THREE.Mesh(shell, m.hood),
    new THREE.Mesh(skirt, m.paint),
    new THREE.Mesh(hut, m.paint),
    new THREE.Mesh(windows, dark),
    new THREE.Mesh(hutRoof, m.roof),
  ]
  for (const mesh of meshes) mesh.castShadow = true
  // The housing and hood stay separate meshes (see mergeStatic's keep) so they can hide around the camera.
  for (const mesh of meshes.slice(0, 3)) mesh.userData.hood = true
  group.userData.housing = { parts: meshes.slice(0, 3), halfWidth: width / 2 + 2.5, from: from - 3, to: from + length + 7, top: base + 5 }
  group.add(...meshes)
  return group
}

/**
 * Stock's Chair (GMD Müller fixed-grip triple): open green steel at the bottom
 * return, grey-green A-frame drive cabin at the top. Rope height matches Uni
 * terminals so the shared stop / ride path stays valid.
 */
function stocksTerminal(
  m: { green: THREE.Material; cabin: THREE.Material; steel: THREE.Material; roof: THREE.Material },
  disposables: { dispose(): void }[],
  end: 'bottom' | 'top',
): THREE.Group {
  const group = new THREE.Group()
  const width = HALF_GAUGE * 2 + 1.2
  const base = STATION_HEIGHT
  if (end === 'bottom') {
    // Open return: four legs, crossbeams, bullwheel, small attendant hut.
    const legs = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => box(0.28, base, 0.28, sx * (width / 2 - 0.2), base / 2, sz * 2.4)),
    )
    const beams = [
      box(width, 0.22, 0.22, 0, base - 0.2, -2.4),
      box(width, 0.22, 0.22, 0, base - 0.2, 2.4),
      box(0.22, 0.22, 5.0, -width / 2 + 0.2, base - 0.2, 0),
      box(0.22, 0.22, 5.0, width / 2 - 0.2, base - 0.2, 0),
      box(width * 0.7, 0.35, 0.35, 0, base + 0.15, 0),
    ]
    const wheel = new THREE.TorusGeometry(HALF_GAUGE, 0.14, 6, 24)
    wheel.rotateX(Math.PI / 2)
    wheel.translate(0, base, 0)
    const hut = box(2.8, 2.2, 2.8, width / 2 + 3.2, 1.1, 1.5)
    const hutRoof = box(3.2, 0.25, 3.2, width / 2 + 3.2, 2.35, 1.5)
    const frame = merge([...legs, ...beams])
    disposables.push(frame, wheel, hut, hutRoof)
    const meshes = [
      new THREE.Mesh(frame, m.green),
      new THREE.Mesh(wheel, m.steel),
      new THREE.Mesh(hut, m.cabin),
      new THREE.Mesh(hutRoof, m.roof),
    ]
    for (const mesh of meshes) mesh.castShadow = true
    group.add(...meshes)
    return group
  }
  // Top drive: grey-green A-frame cabin with a window strip; open under the rope.
  const cabin = box(5.2, 3.2, 4.4, 0, base + 0.2, -0.4)
  const roofA = box(5.8, 0.28, 2.6, 0, base + 2.2, -1.3, -0.45)
  const roofB = box(5.8, 0.28, 2.6, 0, base + 2.2, 0.5, 0.45)
  const posts = [-1, 1].flatMap((sx) => [
    box(0.35, base, 0.35, sx * 2.0, base / 2, -1.6),
    box(0.35, base, 0.35, sx * 2.0, base / 2, 1.2),
  ])
  const windows = box(5.3, 1.0, 3.6, 0, base + 0.6, -0.4)
  const frame = merge([...posts, cabin, roofA, roofB])
  disposables.push(frame, windows)
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2630, roughness: 0.25, metalness: 0.25 })
  disposables.push(dark)
  const meshes = [new THREE.Mesh(frame, m.cabin), new THREE.Mesh(windows, dark)]
  for (const mesh of meshes) mesh.castShadow = true
  group.add(...meshes)
  return group
}

/**
 * T-bar portal tower: two legs, a crossbeam at rope height, and a short
 * sheave shelf — lighter than chair towers, same SURFACE_TOWER_HEIGHT.
 */
function tbarPortal(): THREE.BufferGeometry {
  const top = SURFACE_TOWER_HEIGHT
  const span = HALF_GAUGE * 2 + 0.8
  return merge([
    box(0.18, top + 0.3, 0.18, -span / 2, (top + 0.3) / 2 - 0.15, 0),
    box(0.18, top + 0.3, 0.18, span / 2, (top + 0.3) / 2 - 0.15, 0),
    box(span + 0.4, 0.22, 0.28, 0, top - 0.2, 0),
    box(span + 0.2, 0.12, 0.5, 0, top - 0.05, 0),
  ])
}

/**
 * T-bar terminals: blue drive house at the bottom, yellow return wheel +
 * lookout at the top. Rope height stays at STATION_HEIGHT.
 */
function surfaceTerminal(
  m: { steel: THREE.Material; paint: THREE.Material; roof: THREE.Material; yellow: THREE.Material },
  disposables: { dispose(): void }[],
  end: 'bottom' | 'top',
): THREE.Group {
  const group = new THREE.Group()
  const wheel = new THREE.TorusGeometry(HALF_GAUGE, 0.14, 6, 24)
  wheel.rotateX(Math.PI / 2)
  wheel.translate(0, STATION_HEIGHT, 0)
  if (end === 'bottom') {
    const column = box(0.7, STATION_HEIGHT, 0.7, 0, STATION_HEIGHT / 2, 0)
    const hut = box(4, 3, 3.5, HALF_GAUGE + 4.8, 1.5, 0.5)
    const hutRoof = box(4.5, 0.3, 4, HALF_GAUGE + 4.8, 3.15, 0.5)
    const windows = box(4.08, 1.0, 2.6, HALF_GAUGE + 4.8, 1.9, 0.5)
    disposables.push(column, wheel, hut, hutRoof, windows)
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2630, roughness: 0.3, metalness: 0.2 })
    disposables.push(dark)
    const meshes = [
      new THREE.Mesh(column, m.steel),
      new THREE.Mesh(wheel, m.steel),
      new THREE.Mesh(hut, m.paint),
      new THREE.Mesh(windows, dark),
      new THREE.Mesh(hutRoof, m.roof),
    ]
    for (const mesh of meshes) mesh.castShadow = true
    group.add(...meshes)
    return group
  }
  const frame = merge([
    box(0.35, STATION_HEIGHT, 0.35, -HALF_GAUGE - 0.4, STATION_HEIGHT / 2, 0),
    box(0.35, STATION_HEIGHT, 0.35, HALF_GAUGE + 0.4, STATION_HEIGHT / 2, 0),
    box(HALF_GAUGE * 2 + 1.2, 0.25, 0.25, 0, STATION_HEIGHT - 0.15, 0),
  ])
  const lookout = box(2.4, 2.1, 2.2, HALF_GAUGE + 3.8, 1.05, -0.4)
  const lookoutRoof = box(2.8, 0.22, 2.6, HALF_GAUGE + 3.8, 2.2, -0.4)
  disposables.push(frame, wheel, lookout, lookoutRoof)
  const meshes = [
    new THREE.Mesh(frame, m.steel),
    new THREE.Mesh(wheel, m.yellow),
    new THREE.Mesh(lookout, m.yellow),
    new THREE.Mesh(lookoutRoof, m.roof),
  ]
  for (const mesh of meshes) mesh.castShadow = true
  group.add(...meshes)
  return group
}

/** Magic carpet: belt deck, side rails, end ramps, and a light clear cover. */
function addMagicCarpet(
  group: THREE.Group,
  line: [number, number][],
  ground: (x: number, z: number) => number,
  materials: { belt: THREE.Material; rail: THREE.Material; cover: THREE.Material },
  disposables: { dispose(): void }[],
) {
  // Follow the snow in short pieces: one level box per mapped segment floated over
  // the low end and buried the high end (the 164 m carpet rises 25 m).
  const points: THREE.Vector3[] = []
  for (let k = 0; k < line.length; k++) {
    const [x, z] = line[k]
    points.push(new THREE.Vector3(x, ground(x, z) + 0.15, z))
    if (k === line.length - 1) break
    const [nx, nz] = line[k + 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(nx - x, nz - z) / 2))
    for (let j = 1; j < steps; j++) {
      const px = x + ((nx - x) * j) / steps
      const pz = z + ((nz - z) * j) / steps
      points.push(new THREE.Vector3(px, ground(px, pz) + 0.15, pz))
    }
  }
  const forward = new THREE.Vector3(0, 0, 1)
  let run = 0
  const total = points.reduce((sum, p, k) => (k ? sum + p.distanceTo(points[k - 1]) : 0), 0)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const length = a.distanceTo(b)
    const mid = a.clone().lerp(b, 0.5)
    const tilt = new THREE.Quaternion().setFromUnitVectors(forward, b.clone().sub(a).normalize())
    const place = (mesh: THREE.Mesh, offset: THREE.Vector3) => {
      mesh.position.copy(mid).add(offset.applyQuaternion(tilt))
      mesh.quaternion.copy(tilt)
      mesh.castShadow = true
      group.add(mesh)
    }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.28, length + 0.02), materials.belt)
    disposables.push(belt.geometry)
    place(belt, new THREE.Vector3())
    for (const side of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, length + 0.02), materials.rail)
      disposables.push(rail.geometry)
      place(rail, new THREE.Vector3(side, 0.25, 0))
    }
    // Clear cover over the middle, open for the first and last few metres.
    run += length
    if (run > 4 && run < total - 4) {
      const cover = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, length + 0.02), materials.cover)
      disposables.push(cover.geometry)
      place(cover, new THREE.Vector3(0, 1.05, 0))
    }
  }
  // End ramps at first and last points.
  for (const [index, outward] of [
    [0, -1],
    [points.length - 1, 1],
  ] as const) {
    const p = points[index]
    const q = points[Math.max(0, Math.min(points.length - 1, index + outward))]
    const yaw = Math.atan2(q.x - p.x, q.z - p.z)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 1.6), materials.rail)
    disposables.push(ramp.geometry)
    ramp.position.set(p.x, p.y - 0.05, p.z)
    ramp.rotation.set(-0.35 * outward, yaw, 0)
    ramp.castShadow = true
    group.add(ramp)
  }
}

/** Short orange U-corral in front of Quickdraw bottom. */
function liftMazeHint(
  bottom: [number, number],
  dir: THREE.Vector2,
  side: THREE.Vector2,
  ground: (x: number, z: number) => number,
  orange: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  const y0 = ground(bottom[0], bottom[1])
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 5)
  postGeo.translate(0, 0.6, 0)
  disposables.push(postGeo)
  const posts: [number, number][] = []
  for (const across of [-4, 4]) {
    for (let ahead = 4; ahead <= 12; ahead += 4) {
      posts.push([bottom[0] + dir.x * ahead + side.x * across, bottom[1] + dir.y * ahead + side.y * across])
    }
  }
  for (const across of [-4, 0, 4]) {
    posts.push([bottom[0] + dir.x * 12 + side.x * across, bottom[1] + dir.y * 12 + side.y * across])
  }
  for (const [x, z] of posts) {
    const post = new THREE.Mesh(postGeo, orange)
    post.position.set(x, ground(x, z) || y0, z)
    post.castShadow = true
    group.add(post)
  }
  const railGeo = new THREE.BoxGeometry(8.2, 0.06, 0.06)
  disposables.push(railGeo)
  for (const height of [0.45, 0.95]) {
    for (const across of [-4, 4]) {
      const rail = new THREE.Mesh(railGeo, orange)
      const x = bottom[0] + dir.x * 8 + side.x * across
      const z = bottom[1] + dir.y * 8 + side.y * across
      rail.position.set(x, (ground(x, z) || y0) + height, z)
      rail.rotation.y = Math.atan2(dir.x, dir.y)
      group.add(rail)
    }
    const cross = new THREE.Mesh(railGeo, orange)
    const x = bottom[0] + dir.x * 12
    const z = bottom[1] + dir.y * 12
    cross.position.set(x, (ground(x, z) || y0) + height, z)
    cross.rotation.y = Math.atan2(side.x, side.y)
    group.add(cross)
  }
  return group
}

function ridePath(points: THREE.Vector3[], aerial: boolean, speed = 1): RidePath {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]))
  return { points, lengths, total: lengths[lengths.length - 1], aerial, speed, boardingDistance: 0 }
}
