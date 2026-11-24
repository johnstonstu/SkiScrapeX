import * as THREE from 'three'
import type { Building } from '../../world/buildings'
import { pointInRing } from '../../world/resort'

// Village tones from the aerial photo: timber browns, barn red, grey board, tan stucco.
const WALLS = ['#8a6243', '#6b4a33', '#7a8088', '#8c3b2b', '#c2a684', '#5f4636'].map((c) => new THREE.Color(c))
const SNOW = new THREE.Color('#eef3f7')
const TRIM = new THREE.Color('#3b2e26')
const OVERHANG = 0.7
/** Show the windowed near mesh inside this distance of the village cluster. */
const NEAR_LOD = 340

/**
 * Buildings as near (windowed) and far (shell) meshes. Collision stays on the
 * world index; this only swaps draws by camera distance.
 */
export function createBuildingView(buildings: Building[]) {
  const group = new THREE.Group()
  group.name = 'buildings'
  const near = buildMesh(buildings, true)
  const far = buildMesh(buildings, false)
  group.add(near.mesh, far.mesh)
  near.mesh.visible = true
  far.mesh.visible = false

  let cx = 0
  let cz = 0
  if (buildings.length) {
    for (const b of buildings) {
      const [x, z] = centroid(b.ring)
      cx += x
      cz += z
    }
    cx /= buildings.length
    cz /= buildings.length
  }

  return {
    object: group,
    update(camera: { x: number; z: number }) {
      if (!buildings.length) return
      const dx = camera.x - cx
      const dz = camera.z - cz
      const nearCam = dx * dx + dz * dz < NEAR_LOD * NEAR_LOD
      near.mesh.visible = nearCam
      far.mesh.visible = !nearCam
    },
    dispose() {
      near.dispose()
      far.dispose()
    },
  }
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0
  let z = 0
  for (const [px, pz] of ring) {
    x += px
    z += pz
  }
  return [x / ring.length, z / ring.length]
}

function buildMesh(buildings: Building[], detail: boolean) {
  const positions: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const walls: number[] = []

  const push = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, u = 0, v = 0, window = 0) => {
    positions.push(p.x, p.y, p.z)
    normals.push(n.x, n.y, n.z)
    colors.push(c.r, c.g, c.b)
    walls.push(u, v, window)
  }
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color, uv?: number[][], window = 0) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
    push(a, n, color, uv?.[0][0], uv?.[0][1], window)
    push(b, n, color, uv?.[1][0], uv?.[1][1], window)
    push(c, n, color, uv?.[2][0], uv?.[2][1], window)
  }
  const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

  for (const building of buildings) {
    const wall = building.wall ? new THREE.Color(building.wall) : WALLS[building.palette].clone().multiplyScalar(0.9 + (building.palette % 3) * 0.05)
    const { ring, base, eaves } = building
    const windows = detail && building.kind !== 'service' ? 1 : 0
    let u = 0
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]
      const [bx, bz] = ring[(i + 1) % ring.length]
      const length = Math.hypot(bx - ax, bz - az)
      // Wind each wall so its normal points out of the footprint: probe just
      // off the edge along the default normal (dz, -dx) and flip if that is inside.
      const mx = (ax + bx) / 2 + ((bz - az) / Math.max(length, 1e-6)) * 0.05
      const mz = (az + bz) / 2 + ((ax - bx) / Math.max(length, 1e-6)) * 0.05
      const flip = pointInRing(mx, mz, ring)
      const a0 = v3(ax, base, az)
      const b0 = v3(bx, base, bz)
      const a1 = v3(ax, eaves, az)
      const b1 = v3(bx, eaves, bz)
      const h = eaves - base
      // (a1 - a0) x (b0 - a0) points along (dz, -dx).
      if (!flip) {
        tri(a0, a1, b0, wall, [[u, 0], [u, h], [u + length, 0]], windows)
        tri(b0, a1, b1, wall, [[u + length, 0], [u, h], [u + length, h]], windows)
      } else {
        tri(a0, b0, a1, wall, [[u, 0], [u + length, 0], [u, h]], windows)
        tri(b0, b1, a1, wall, [[u + length, 0], [u + length, h], [u, h]], windows)
      }
      u += length
    }

    if (building.roof) {
      const { centre, axis, halfLength, halfWidth, rise } = building.roof
      const side: [number, number] = [-axis[1], axis[0]]
      const L = halfLength + OVERHANG
      const W = halfWidth + OVERHANG
      const drop = OVERHANG * (rise / halfWidth)
      const at = (along: number, across: number, y: number) =>
        v3(centre[0] + axis[0] * along + side[0] * across, y, centre[1] + axis[1] * along + side[1] * across)
      const ridgeA = at(-L, 0, eaves + rise)
      const ridgeB = at(L, 0, eaves + rise)
      for (const sign of [1, -1]) {
        const eA = at(-L, sign * W, eaves - drop)
        const eB = at(L, sign * W, eaves - drop)
        // Upward-facing slopes; pick the winding that makes the normal point up.
        const n = new THREE.Vector3().subVectors(eB, eA).cross(new THREE.Vector3().subVectors(ridgeA, eA))
        if (n.y >= 0) {
          tri(eA, eB, ridgeA, SNOW)
          tri(ridgeA, eB, ridgeB, SNOW)
        } else {
          tri(eA, ridgeA, eB, SNOW)
          tri(ridgeA, ridgeB, eB, SNOW)
        }
        if (detail) {
          // Thin fascia under the eave.
          const fA = at(-L, sign * W, eaves - drop - 0.25)
          const fB = at(L, sign * W, eaves - drop - 0.25)
          tri(fA, eA, fB, TRIM)
          tri(fB, eA, eB, TRIM)
          tri(fA, fB, eA, TRIM)
          tri(fB, eB, eA, TRIM)
        }
      }
      // Gable triangles at both ends, in the wall colour.
      for (const end of [-1, 1]) {
        const g0 = at(end * halfLength, -halfWidth, eaves)
        const g1 = at(end * halfLength, halfWidth, eaves)
        const top = at(end * halfLength, 0, eaves + rise)
        tri(g0, g1, top, wall)
        tri(g1, g0, top, wall)
      }
    } else {
      // Flat roof: snow slab on the footprint.
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z))
      const faces = THREE.ShapeUtils.triangulateShape(contour, [])
      const y = eaves + 0.35
      for (const [i, j, k] of faces) {
        const a = v3(ring[i][0], y, ring[i][1])
        const b = v3(ring[j][0], y, ring[j][1])
        const c = v3(ring[k][0], y, ring[k][1])
        const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
        if (n.y >= 0) tri(a, b, c, SNOW)
        else tri(a, c, b, SNOW)
      }
      if (detail) {
        for (let i = 0; i < ring.length; i++) {
          const [ax, az] = ring[i]
          const [bx, bz] = ring[(i + 1) % ring.length]
          tri(v3(ax, eaves, az), v3(ax, y, az), v3(bx, eaves, bz), TRIM)
          tri(v3(bx, eaves, bz), v3(ax, y, az), v3(bx, y, bz), TRIM)
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aWall', new THREE.Float32BufferAttribute(walls, 3))
  geometry.computeBoundingSphere()

  const material = new THREE.MeshLambertMaterial({ vertexColors: true })
  if (detail) {
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aWall;\nvarying vec3 vWall;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDist = -mvPosition.z;')
        .replace('varying vec3 vWall;', 'varying vec3 vWall;\nvarying float vCamDist;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWall;\nvarying float vCamDist;')
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
        float keep = smoothstep(2.0, 6.0, vCamDist);
        if (keep < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > keep) discard;`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
        if (vWall.z > 0.5) {
          // Windows: 1.4 m wide every 3.4 m, one row per 3 m storey, none in the foundation.
          vec2 cell = vec2(fract(vWall.x / 3.4), fract((vWall.y - 0.6) / 3.0));
          float pane = step(0.3, cell.x) * step(cell.x, 0.71) * step(0.3, cell.y) * step(cell.y, 0.78);
          pane *= step(1.4, vWall.y);
          float lit = step(0.82, fract(sin(dot(floor(vec2(vWall.x / 3.4, vWall.y / 3.0)), vec2(12.9898, 78.233))) * 43758.5453));
          vec3 glass = mix(vec3(0.16, 0.22, 0.3), vec3(1.0, 0.82, 0.5), lit * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, pane);
          // Horizontal board lines on the siding.
          diffuseColor.rgb *= 1.0 - 0.08 * step(0.92, fract(vWall.y / 0.3)) * (1.0 - pane);
        }`,
        )
    }
  }
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = detail ? 'buildings-near' : 'buildings-far'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
