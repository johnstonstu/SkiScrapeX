import * as THREE from 'three'
import type { Lift } from '../../world/resort'

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

/** Towers, haul rope, terminals and moving chairs for each lift. */
export function createLiftView(lifts: Lift[], heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group()
  group.name = 'lifts'
  const steel = new THREE.MeshLambertMaterial({ color: 0x5b6168 })
  const paint = new THREE.MeshLambertMaterial({ color: 0x1f4f86 })
  const roof = new THREE.MeshLambertMaterial({ color: 0x6b3b2d })
  const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x2a2a2a })
  const towerGeometry = new THREE.CylinderGeometry(0.35, 0.5, TOWER_HEIGHT, 8)
  towerGeometry.translate(0, TOWER_HEIGHT / 2, 0)
  const armGeometry = new THREE.BoxGeometry(HALF_GAUGE * 2 + 1, 0.4, 0.5)

  const disposables: { dispose(): void }[] = [steel, paint, roof, ropeMaterial, towerGeometry, armGeometry]
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
  const rides = new Map<string, RidePath>()
  const beltMaterial = new THREE.MeshLambertMaterial({ color: 0x2b2f33 })
  disposables.push(beltMaterial)

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
      const points = lift.line.map(([x, z]) => new THREE.Vector3(x, ground(x, z) + 0.15, z))
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        const belt = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, a.distanceTo(b)), beltMaterial)
        disposables.push(belt.geometry)
        belt.position.lerpVectors(a, b, 0.5)
        belt.lookAt(b)
        group.add(belt)
      }
      rides.set(lift.id, ridePath(points.map((p) => p.clone().setY(p.y + 0.1)), false))
      continue
    }

    for (const [x, z] of lift.towers) {
      const tower = new THREE.Mesh(towerGeometry, steel)
      tower.position.set(x, ground(x, z) - 0.5 - (TOWER_HEIGHT - towerHeight), z)
      const arm = new THREE.Mesh(armGeometry, steel)
      arm.position.set(x, ground(x, z) + towerHeight - 0.2, z)
      arm.rotation.y = yaw
      group.add(tower, arm)
    }
    for (const [x, z] of [lift.bottom, lift.top]) {
      const station = aerial ? terminal(paint, roof, disposables) : surfaceTerminal(steel, paint, roof, disposables)
      station.position.set(x, ground(x, z), z)
      station.rotation.y = yaw
      group.add(station)
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
      const bar = new THREE.BoxGeometry(1.1, 0.07, 0.07)
      disposables.push(stem, bar)
      const chairs = new THREE.InstancedMesh(stem, steel, count)
      const bars = new THREE.InstancedMesh(bar, paint, count)
      chairs.frustumCulled = bars.frustumCulled = false
      group.add(chairs, bars)
      ropes.push({ liftId: lift.id, circuit, uphill, chairs, bars, distance: 0 })
      continue
    }
    const geometry = chair()
    geometry.scale(triple ? 0.75 : 1, 1, 1)
    disposables.push(geometry)
    const chairs = new THREE.InstancedMesh(geometry, paint, triple ? 138 : 79)
    chairs.frustumCulled = false
    group.add(chairs)
    ropes.push({ liftId: lift.id, circuit, uphill, chairs, distance: 0 })
  }

  const point = new THREE.Vector3()

  return {
    object: group,
    ride(liftId: string): RidePath | null {
      return rides.get(liftId) ?? null
    },
    update(dt: number, fastLift?: string) {
      for (const rope of ropes) {
        const spacing = rope.circuit.total / rope.chairs.count
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

/** Quad chair hanging 2.4 m below the rope. Origin at the grip. */
function chair(): THREE.BufferGeometry {
  const hanger = new THREE.BoxGeometry(0.08, 2.2, 0.08)
  hanger.translate(0, -1.1, 0)
  const seat = new THREE.BoxGeometry(2.2, 0.12, 0.6)
  seat.translate(0, -2.3, 0.15)
  const back = new THREE.BoxGeometry(2.2, 0.7, 0.08)
  back.translate(0, -1.95, -0.15)
  const geometries = [hanger, seat, back].map((g) => g.toNonIndexed())
  const merged = new THREE.BufferGeometry()
  const positions = geometries.flatMap((g) => Array.from(g.attributes.position.array as Float32Array))
  const normals = geometries.flatMap((g) => Array.from(g.attributes.normal.array as Float32Array))
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  for (const g of [hanger, seat, back, ...geometries]) g.dispose()
  return merged
}

function terminal(
  paint: THREE.Material,
  roof: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  const base = new THREE.BoxGeometry(1.4, 4, 5)
  base.translate(0, 2, 0)
  const top = new THREE.BoxGeometry(9, 1, 11)
  top.translate(0, 4.5, 0)
  disposables.push(base, top)
  group.add(new THREE.Mesh(base, paint), new THREE.Mesh(top, roof))
  return group
}

/**
 * T-bar terminal: a post carrying the bull wheel at rope height and a small
 * operator hut off to the down-rope side, leaving the loading track open.
 */
function surfaceTerminal(
  steel: THREE.Material,
  paint: THREE.Material,
  roof: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  const post = new THREE.BoxGeometry(0.5, STATION_HEIGHT, 0.5)
  post.translate(0, STATION_HEIGHT / 2, 0)
  const wheel = new THREE.TorusGeometry(HALF_GAUGE, 0.12, 6, 24)
  wheel.rotateX(Math.PI / 2)
  wheel.translate(0, STATION_HEIGHT, 0)
  const hut = new THREE.BoxGeometry(3, 2.4, 3)
  hut.translate(HALF_GAUGE + 4.5, 1.2, 0)
  const hutRoof = new THREE.BoxGeometry(3.6, 0.3, 3.6)
  hutRoof.translate(HALF_GAUGE + 4.5, 2.55, 0)
  disposables.push(post, wheel, hut, hutRoof)
  group.add(new THREE.Mesh(post, steel), new THREE.Mesh(wheel, steel), new THREE.Mesh(hut, paint), new THREE.Mesh(hutRoof, roof))
  return group
}

function ridePath(points: THREE.Vector3[], aerial: boolean, speed = 1): RidePath {
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]))
  return { points, lengths, total: lengths[lengths.length - 1], aerial, speed, boardingDistance: 0 }
}
