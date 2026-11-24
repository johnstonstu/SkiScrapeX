import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Rail } from '../../sim'
import type { ParkOverlay, PlacedFeature } from '../../world/park'
import { SnowMaterial } from '../../fx'
import type { Lighting } from '../lighting'

/**
 * Meshes for terrain-park features: snow shapes sampled from the overlay,
 * rails as metal tubes on posts, boxes as plastic-topped slabs, and a sign
 * at each feature with its name and design speed.
 */
export function createParkView(
  overlay: ParkOverlay,
  baseHeight: (x: number, z: number) => number,
  lighting: Lighting,
  siteSigns: { name: string; layout: string; x: number; z: number; yaw: number }[],
  meshStep = 0.4,
) {
  const group = new THREE.Group()
  group.name = 'park'
  const disposables: { dispose(): void }[] = []
  const boards: THREE.Group[] = []
  const face = new THREE.PlaneGeometry(1, 1)
  const signPost = new THREE.BoxGeometry(0.057, 1, 0.11)
  const left = signPost.clone().translate(-0.37, 0, 0)
  const right = signPost.translate(0.37, 0, 0)
  const frame = mergeGeometries([left, right])!
  left.dispose()
  right.dispose()
  const backing = new THREE.BoxGeometry(1, 1, 0.08)
  const timber = new THREE.MeshLambertMaterial({ color: 0x47372d })
  disposables.push(face, frame, backing, timber)
  const addSign = (name: string, detail: string, tone: string, x: number, z: number, yaw: number, entrance = false) => {
    const ground = baseHeight(x, z)
    if (!Number.isFinite(ground)) return
    const texture = parkSignTexture(name, detail, tone)
    const paint = new THREE.MeshBasicMaterial({ map: texture })
    const width = entrance ? 4.2 : 2.15
    const height = entrance ? 1 : 0.55
    const rise = entrance ? 2.15 : 1.2
    const board = new THREE.Group()
    board.position.set(x, ground, z)
    board.rotation.y = yaw
    const posts = new THREE.Mesh(frame, timber)
    posts.position.y = rise / 2
    posts.scale.set(width, rise, 1)
    const back = new THREE.Mesh(backing, timber)
    back.position.y = rise
    back.scale.set(width + 0.04, height + 0.04, 1)
    const panel = new THREE.Mesh(face, paint)
    panel.position.set(0, rise, 0.06)
    panel.scale.set(width, height, 1)
    board.add(posts, back, panel)
    group.add(board)
    boards.push(board)
    disposables.push(texture, paint)
  }
  // Shaped park snow: groomed look, and no rock on the steep side walls.
  const snow = new SnowMaterial({
    sunDirection: lighting.sunDirection,
    sunColor: lighting.sunColor,
    skyColor: lighting.skyColor,
    groundColor: lighting.groundColor,
    fogColor: lighting.fogColor,
    fogDensity: lighting.fogDensity,
    corduroyDepth: 0.006,
  })
  snow.setSlopeBlend(80, 89, false)
  disposables.push(snow)

  for (const feature of overlay.features) {
    const geometry = featureGeometry(feature, overlay, baseHeight, meshStep)
    if (geometry) {
      disposables.push(geometry)
      const mesh = new THREE.Mesh(geometry, snow)
      mesh.receiveShadow = true
      mesh.castShadow = true
      group.add(mesh)
    }
    const signX = feature.x - feature.dirZ * (feature.halfWidth + 3)
    const signZ = feature.z + feature.dirX * (feature.halfWidth + 3)
    const [name, speed] = feature.spec.label.split(' · ')
    const slide = feature.spec.kind === 'box' || feature.spec.kind.toLowerCase().includes('rail')
    addSign(name, speed ?? (slide ? 'Pop on · balance · pop off' : 'Absorb the crest'), slide ? '#96dfd7' : '#ffdc69',
      signX, signZ, Math.atan2(-feature.dirX, -feature.dirZ))
  }

  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.85, roughness: 0.3 })
  const post = new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.4, roughness: 0.6 })
  const boxTop = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.35 })
  const boxSide = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.6 })
  disposables.push(metal, post, boxTop, boxSide)
  for (const rail of overlay.rails) group.add(rail.kind === 'box' ? boxMesh(rail, baseHeight, boxTop, boxSide, disposables) : railMesh(rail, baseHeight, metal, post, disposables))

  for (const site of siteSigns) {
    addSign(site.name, site.layout, '#ffdc69', site.x, site.z, site.yaw, true)
  }

  return {
    object: group,
    /** Near-course signage stays in the scene without drawing the whole run at once. */
    update(camera: THREE.Vector3) {
      for (const board of boards) board.visible = board.position.distanceToSquared(camera) < 105 ** 2
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

function parkSignTexture(name: string, detail: string, tone: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#0e2c3c'
  ctx.fillRect(0, 0, 512, 128)
  ctx.fillStyle = tone
  ctx.fillRect(0, 0, 13, 128)
  ctx.strokeStyle = '#7da2ae'
  ctx.strokeRect(19, 6, 487, 116)
  ctx.fillStyle = '#eff9fb'
  ctx.font = '750 40px system-ui'
  ctx.fillText(name, 31, 55, 457)
  ctx.fillStyle = tone
  ctx.font = '650 24px system-ui'
  ctx.fillText(detail, 32, 99, 455)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function featureGeometry(f: PlacedFeature, overlay: ParkOverlay, baseHeight: (x: number, z: number) => number, step: number) {
  const us = Math.ceil((f.footprint + 2) / step)
  const vs = Math.ceil((f.halfWidth * 2) / step)
  const positions: number[] = []
  const heights: number[] = []
  for (let i = 0; i <= us; i++) {
    for (let j = 0; j <= vs; j++) {
      const u = -1 + i * (f.footprint + 2) / us
      const v = -f.halfWidth + j * f.halfWidth * 2 / vs
      const x = f.x + f.dirX * u - f.dirZ * v
      const z = f.z + f.dirZ * u + f.dirX * v
      const o = overlay.heightAt(x, z)
      const base = baseHeight(x, z)
      heights.push(o)
      positions.push(x, (Number.isFinite(base) ? base : 0) + o + 0.03, z)
    }
  }
  const indices: number[] = []
  const row = vs + 1
  for (let i = 0; i < us; i++) {
    for (let j = 0; j < vs; j++) {
      const a = i * row + j
      const b = a + 1
      const c = a + row
      const d = c + 1
      if (Math.max(heights[a], heights[b], heights[c], heights[d]) < 0.02) continue
      indices.push(a, b, c, b, d, c)
    }
  }
  if (!indices.length) return null
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  // Face up: check the first triangle's winding.
  const p = (k: number) => new THREE.Vector3(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2])
  const n = new THREE.Vector3().subVectors(p(indices[1]), p(indices[0])).cross(new THREE.Vector3().subVectors(p(indices[2]), p(indices[0])))
  if (n.y < 0) for (let k = 0; k < indices.length; k += 3) [indices[k + 1], indices[k + 2]] = [indices[k + 2], indices[k + 1]]
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function railMesh(
  rail: Rail,
  baseHeight: (x: number, z: number) => number,
  metal: THREE.Material,
  postMaterial: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  const points = rail.points.map((p) => new THREE.Vector3(p.x, p.y - 0.04, p.z))
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.05), points.length * 2, 0.045, 8)
  disposables.push(tube)
  const mesh = new THREE.Mesh(tube, metal)
  mesh.castShadow = true
  group.add(mesh)
  const postGeometry = new THREE.CylinderGeometry(0.04, 0.05, 1, 6)
  disposables.push(postGeometry)
  for (let i = 0; i < points.length; i += 4) addPost(group, points[i], baseHeight, postGeometry, postMaterial)
  addPost(group, points[points.length - 1], baseHeight, postGeometry, postMaterial)
  return group
}

function addPost(group: THREE.Group, top: THREE.Vector3, baseHeight: (x: number, z: number) => number, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const ground = baseHeight(top.x, top.z)
  if (!Number.isFinite(ground)) return
  const height = Math.max(0.1, top.y - ground + 0.3)
  const post = new THREE.Mesh(geometry, material)
  post.scale.y = height
  post.position.set(top.x, ground - 0.3 + height / 2, top.z)
  post.castShadow = true
  group.add(post)
}

function boxMesh(
  rail: Rail,
  baseHeight: (x: number, z: number) => number,
  top: THREE.Material,
  side: THREE.Material,
  disposables: { dispose(): void }[],
): THREE.Group {
  const group = new THREE.Group()
  for (let i = 1; i < rail.points.length; i++) {
    const a = rail.points[i - 1]
    const b = rail.points[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
    const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    const ground = Math.min(baseHeight(a.x, a.z), baseHeight(b.x, b.z))
    const depth = Math.max(0.2, mid.y - ground + 0.3)
    const slab = new THREE.BoxGeometry(rail.width, depth, length + 0.02)
    disposables.push(slab)
    const body = new THREE.Mesh(slab, [side, side, top, side, side, side])
    body.position.set(mid.x, mid.y - depth / 2, mid.z)
    body.lookAt(b.x, b.y - depth / 2, b.z)
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)
  }
  return group
}
