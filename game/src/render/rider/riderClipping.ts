/**
 * Clipping check for the skinned rider: how deep does one body part's cloth
 * cut into another body part in the current pose?
 *
 * Each body segment gets a capsule (a "core") around its bone, sized in the
 * bind pose from the slimmest garments and shrunk to 80%, so loose cloth
 * brushing past does not count. A garment vertex belongs to the segment of
 * its heaviest joint. In a pose, any vertex inside a capsule that is not its
 * own segment or a neighbour (parent or child) is clipping, by how much deeper
 * it sits than it did in the bind pose (so joints that already touch at rest,
 * like the waist over the hip sockets, do not report).
 *
 * Used by tests/riderClipping.test.ts and the rider lab's `?clip` view. No DOM.
 */
import * as THREE from 'three'
import { SHIN_LENGTH } from './skierModel'

/** One body part: a capsule on `bone` between two points fixed in the bone's frame. */
interface SegmentDef {
  name: string
  bone: string
  /** Capsule ends at rest, from joint heads (world space in the bind pose). */
  ends: (head: (joint: string) => THREE.Vector3) => [THREE.Vector3, THREE.Vector3]
  /** Garments that size the core: the slimmest one covering this part. */
  sizedBy: string
  neighbours: string[]
}

const along = (from: THREE.Vector3, to: THREE.Vector3, length: number) =>
  to.clone().add(to.clone().sub(from).setLength(length))

function sides(): SegmentDef[] {
  const out: SegmentDef[] = []
  for (const s of ['L', 'R']) {
    out.push(
      { name: `upperarm_${s}`, bone: `upperarm_${s}`, ends: (h) => [h(`upperarm_${s}`), h(`forearm_${s}`)], sizedBy: 'jacket_racer', neighbours: ['chest', `forearm_${s}`] },
      { name: `forearm_${s}`, bone: `forearm_${s}`, ends: (h) => [h(`forearm_${s}`), h(`hand_${s}`)], sizedBy: 'jacket_racer', neighbours: [`upperarm_${s}`, `hand_${s}`] },
      { name: `hand_${s}`, bone: `hand_${s}`, ends: (h) => [h(`hand_${s}`), along(h(`forearm_${s}`), h(`hand_${s}`), 0.1)], sizedBy: 'gloves_glove', neighbours: [`forearm_${s}`] },
      { name: `thigh_${s}`, bone: `thigh_${s}`, ends: (h) => [h(`thigh_${s}`), h(`shin_${s}`)], sizedBy: 'pants_race', neighbours: ['pelvis', 'spine', `shin_${s}`] },
      { name: `shin_${s}`, bone: `shin_${s}`, ends: (h) => [h(`shin_${s}`), along(h(`thigh_${s}`), h(`shin_${s}`), SHIN_LENGTH)], sizedBy: 'pants_race', neighbours: [`thigh_${s}`] },
    )
  }
  return out
}

const SEGMENTS: SegmentDef[] = [
  { name: 'pelvis', bone: 'hips', ends: (h) => [h('thigh_L'), h('thigh_R')], sizedBy: 'pants_race', neighbours: ['spine', 'thigh_L', 'thigh_R'] },
  { name: 'spine', bone: 'spine', ends: (h) => [h('spine'), h('chest')], sizedBy: 'jacket_racer', neighbours: ['pelvis', 'chest', 'thigh_L', 'thigh_R'] },
  { name: 'chest', bone: 'chest', ends: (h) => [h('chest'), h('head')], sizedBy: 'jacket_racer', neighbours: ['spine', 'head', 'upperarm_L', 'upperarm_R'] },
  { name: 'head', bone: 'head', ends: (h) => [h('head'), h('head').add(new THREE.Vector3(0, 0.2, 0))], sizedBy: 'head_face', neighbours: ['chest'] },
  ...sides(),
]
/** Joint name to segment; cloth joints (hem, hood, cords, pack, pom) are loose fabric and not checked. */
const OWNER: Record<string, string> = { hips: 'pelvis', spine: 'spine', chest: 'chest', head: 'head' }
for (const s of SEGMENTS) OWNER[s.bone] ??= s.name
/** Core radius as a share of the median rest distance of the sizing garment's vertices. */
const CORE = 0.8
/** Deeper than this (metres) counts as a hit. */
const MIN_DEPTH = 0.005
/** Garment vertices this far below the snow count as sunk in. */
const GROUND_SLACK = 0.02

export interface ClipHit {
  /** Segment whose cloth cuts in (or a garment, for `snow`). */
  from: string
  /** Segment it cuts into, or `snow`. */
  into: string
  /** Worst depth, metres. */
  depth: number
  /** Garment with the worst vertex. */
  garment: string
  /** Vertices past MIN_DEPTH. */
  count: number
}

export interface ClipReport {
  /** Every pair past MIN_DEPTH, deepest first. */
  hits: ClipHit[]
  /** World positions of the offending vertices (only when asked for, capped). */
  points: THREE.Vector3[]
}

export interface ClipRig {
  object: THREE.Object3D
  bones: Record<string, THREE.Bone>
  withRestPose: (fn: () => void) => void
}

interface Capsule {
  name: string
  bone: THREE.Bone
  localA: THREE.Vector3
  localB: THREE.Vector3
  radius: number
  neighbours: Set<number>
  a: THREE.Vector3
  b: THREE.Vector3
}

interface MeshInfo {
  mesh: THREE.SkinnedMesh
  /** Segment index per vertex, or -1 for cloth joints. */
  owner: Int8Array
  /** Bind-pose depth of each vertex in each capsule (vertex * segments + segment). */
  restDepth: Float32Array
}

const tmp = new THREE.Vector3()
const ab = new THREE.Vector3()

/** Signed depth of `p` inside a capsule (positive inside). */
function depthIn(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, radius: number): number {
  ab.subVectors(b, a)
  const t = THREE.MathUtils.clamp(tmp.subVectors(p, a).dot(ab) / Math.max(ab.lengthSq(), 1e-9), 0, 1)
  tmp.copy(a).addScaledVector(ab, t)
  return radius - p.distanceTo(tmp)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((x, y) => x - y)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Sets up the check for one rider whose skinned garments are attached. Call
 * `measure()` after each `view.update` to get that frame's clipping.
 */
export function createClipCheck(rig: ClipRig) {
  const meshes: THREE.SkinnedMesh[] = []
  rig.object.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh)
  })
  if (!meshes.length) throw new Error('Clipping check needs the skinned rider; attach rider.glb first')

  const capsules: Capsule[] = []
  const infos: MeshInfo[] = []
  const p = new THREE.Vector3()

  rig.withRestPose(() => {
    rig.object.updateMatrixWorld(true)
    const head = (joint: string) => {
      const bone = rig.bones[joint]
      if (!bone) throw new Error(`Clipping check: the rig has no joint ${joint}`)
      return bone.getWorldPosition(new THREE.Vector3())
    }
    const index = new Map(SEGMENTS.map((s, i) => [s.name, i]))
    for (const def of SEGMENTS) {
      const bone = rig.bones[def.bone]
      const [a, b] = def.ends(head)
      capsules.push({
        name: def.name, bone, radius: 0,
        localA: bone.worldToLocal(a.clone()), localB: bone.worldToLocal(b.clone()),
        neighbours: new Set(def.neighbours.map((n) => index.get(n)!)),
        a, b,
      })
    }
    // Vertex owners and rest positions.
    const rest: THREE.Vector3[][] = []
    for (const mesh of meshes) {
      const count = mesh.geometry.attributes.position.count
      const owner = new Int8Array(count)
      const names = mesh.skeleton.bones.map((bone) => bone.name)
      const skinIndex = mesh.geometry.attributes.skinIndex
      const skinWeight = mesh.geometry.attributes.skinWeight
      const positions: THREE.Vector3[] = []
      for (let v = 0; v < count; v++) {
        let best = 0
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(v, k) > skinWeight.getComponent(v, best)) best = k
        const segment = OWNER[names[skinIndex.getComponent(v, best)]]
        owner[v] = segment === undefined ? -1 : index.get(segment)!
        positions.push(mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))
      }
      rest.push(positions)
      infos.push({ mesh, owner, restDepth: new Float32Array(count * capsules.length) })
    }
    // Core radii from the slimmest garment over each part.
    SEGMENTS.forEach((def, s) => {
      const distances: number[] = []
      infos.forEach((info, m) => {
        if (info.mesh.name !== def.sizedBy) return
        rest[m].forEach((at, v) => {
          if (info.owner[v] === s) distances.push(-depthIn(at, capsules[s].a, capsules[s].b, 0))
        })
      })
      if (!distances.length) throw new Error(`Clipping check: garment ${def.sizedBy} has no vertices on ${def.name}`)
      capsules[s].radius = median(distances) * CORE
    })
    infos.forEach((info, m) => {
      rest[m].forEach((at, v) => {
        for (let s = 0; s < capsules.length; s++) info.restDepth[v * capsules.length + s] = Math.max(0, depthIn(at, capsules[s].a, capsules[s].b, capsules[s].radius))
      })
    })
  })

  return {
    /** Segment names with their core radius (metres), for reports. */
    segments: capsules.map((c) => ({ name: c.name, radius: c.radius })),
    /**
     * Clipping in the rider's current pose. `garments` limits the check to
     * those garment names (default: every garment, shown or not). `groundY`
     * is the snow height in world space, or null to skip the snow check.
     */
    measure(options: { garments?: ReadonlySet<string>; groundY?: number | null; points?: number } = {}): ClipReport {
      const groundY = options.groundY === undefined ? 0 : options.groundY
      const maxPoints = options.points ?? 0
      rig.object.updateMatrixWorld(true)
      for (const c of capsules) {
        c.a.copy(c.localA).applyMatrix4(c.bone.matrixWorld)
        c.b.copy(c.localB).applyMatrix4(c.bone.matrixWorld)
      }
      const hits = new Map<string, ClipHit>()
      const points: THREE.Vector3[] = []
      const record = (from: string, into: string, depth: number, garment: string) => {
        const key = `${from}>${into}`
        const hit = hits.get(key)
        if (!hit) hits.set(key, { from, into, depth, garment, count: 1 })
        else {
          hit.count++
          if (depth > hit.depth) {
            hit.depth = depth
            hit.garment = garment
          }
        }
        if (points.length < maxPoints) points.push(p.clone())
      }
      for (const { mesh, owner, restDepth } of infos) {
        if (options.garments && !options.garments.has(mesh.name)) continue
        const count = owner.length
        for (let v = 0; v < count; v++) {
          const own = owner[v]
          if (own < 0) continue
          mesh.getVertexPosition(v, p).applyMatrix4(mesh.matrixWorld)
          const neighbours = capsules[own].neighbours
          for (let s = 0; s < capsules.length; s++) {
            if (s === own || neighbours.has(s)) continue
            const c = capsules[s]
            const depth = depthIn(p, c.a, c.b, c.radius) - restDepth[v * capsules.length + s]
            if (depth > MIN_DEPTH) record(capsules[own].name, c.name, depth, mesh.name)
          }
          if (groundY !== null && p.y < groundY - GROUND_SLACK) record(capsules[own].name, 'snow', groundY - p.y, mesh.name)
        }
      }
      return { hits: [...hits.values()].sort((x, y) => y.depth - x.depth), points }
    },
  }
}

export type ClipCheck = ReturnType<typeof createClipCheck>
