import * as THREE from 'three'
import type { Rail } from '../../sim'
import type { ParkOverlay, PlacedFeature } from '../../world/park'
import { label } from './signView'
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
  siteSigns: { name: string; layout: string; x: number; z: number }[],
) {
  const group = new THREE.Group()
  group.name = 'park'
  const disposables: { dispose(): void }[] = []
  const sprites: THREE.Sprite[] = []
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
    const geometry = featureGeometry(feature, overlay, baseHeight)
    if (geometry) {
      disposables.push(geometry)
      const mesh = new THREE.Mesh(geometry, snow)
      mesh.receiveShadow = true
      mesh.castShadow = true
      group.add(mesh)
    }
    const signX = feature.x - feature.dirZ * (feature.halfWidth + 3)
    const signZ = feature.z + feature.dirX * (feature.halfWidth + 3)
    const ground = baseHeight(signX, signZ)
    if (Number.isFinite(ground)) {
      const sprite = label(feature.spec.label, null, disposables)
      sprite.scale.multiplyScalar(0.7)
      sprites.push(sprite)
      sprite.position.set(signX, ground + 2.4, signZ)
      group.add(sprite)
    }
  }

  const metal = new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.85, roughness: 0.3 })
  const post = new THREE.MeshStandardMaterial({ color: 0x2b2f35, metalness: 0.4, roughness: 0.6 })
  const boxTop = new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.35 })
  const boxSide = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.6 })
  disposables.push(metal, post, boxTop, boxSide)
  for (const rail of overlay.rails) group.add(rail.kind === 'box' ? boxMesh(rail, baseHeight, boxTop, boxSide, disposables) : railMesh(rail, baseHeight, metal, post, disposables))

  for (const site of siteSigns) {
    const ground = baseHeight(site.x, site.z)
    if (!Number.isFinite(ground)) continue
    const sprite = label(`${site.name} · ${site.layout}`, null, disposables)
    sprite.scale.multiplyScalar(1.6)
    sprite.position.set(site.x, ground + 4.5, site.z)
    group.add(sprite)
  }

  return {
    object: group,
    /** Hide signs the camera is about to pass through. */
    update(camera: THREE.Vector3) {
      for (const sprite of sprites) sprite.visible = sprite.position.distanceToSquared(camera) > 7 * 7
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

function featureGeometry(f: PlacedFeature, overlay: ParkOverlay, baseHeight: (x: number, z: number) => number) {
  const step = 0.4
  const us = Math.ceil((f.footprint + 2) / step)
  const vs = Math.ceil((f.halfWidth * 2) / step)
  const positions: number[] = []
  const heights: number[] = []
  for (let i = 0; i <= us; i++) {
    for (let j = 0; j <= vs; j++) {
      const u = -1 + i * step
      const v = -f.halfWidth + j * step
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
