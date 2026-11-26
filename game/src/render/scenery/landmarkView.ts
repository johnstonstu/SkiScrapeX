import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fencePosts, type FenceLine, type Signpost } from '../../world/landmarks'

const FENCE_ORANGE = new THREE.Color(0xe8641e)
const POST_DARK = new THREE.Color(0x4a3a2c)
const WIRE_GREY = new THREE.Color(0x6d6a66)
const WOOD = new THREE.Color(0x7a5a3e)
const WOOD_DARK = new THREE.Color(0x5d4330)
const SNOW = new THREE.Color(0xf2f5f8)

/** Fence height above the snow and slat size, metres. */
const FENCE_HEIGHT = 1.25
const SLAT_WIDTH = 0.06
const SLAT_GAP = 0.1

/**
 * Summit snow fence and the Tooth/Tusk signpost. Everything solid is one
 * vertex-coloured mesh (one draw call); the sign lettering is a second mesh
 * on a small canvas texture.
 */
export function createLandmarkView(fences: FenceLine[], signpost: Signpost | null, heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group()
  group.name = 'landmarks'
  const parts: THREE.BufferGeometry[] = []
  const ground = (x: number, z: number) => {
    const h = heightAt(x, z)
    return Number.isFinite(h) ? h : 0
  }
  const box = (size: [number, number, number], at: [number, number, number], yaw: number, color: THREE.Color, tilt = 0) => {
    const geometry = new THREE.BoxGeometry(...size)
    geometry.rotateZ(tilt)
    geometry.rotateY(yaw)
    geometry.translate(...at)
    paint(geometry, color)
    parts.push(geometry)
  }

  for (const line of fences) {
    const posts = fencePosts(line)
    for (let i = 0; i < posts.length; i++) {
      const [x, z] = posts[i]
      const y = ground(x, z)
      const next = posts[Math.min(posts.length - 1, i + 1)]
      const prev = posts[Math.max(0, i - 1)]
      const yaw = Math.atan2(next[0] - prev[0], next[1] - prev[1])
      // Posts lean a little, as snow-fence stakes do.
      box([0.08, FENCE_HEIGHT + 0.5, 0.08], [x, y + (FENCE_HEIGHT + 0.5) / 2 - 0.25, z], yaw, POST_DARK, 0.04 * Math.sin(i * 2.3))
      if (i === 0) continue
      // Vertical orange slats wired between this post and the last, following the ground.
      const [px, pz] = posts[i - 1]
      const span = Math.hypot(x - px, z - pz)
      const segmentYaw = Math.atan2(x - px, z - pz)
      const count = Math.max(1, Math.floor(span / (SLAT_WIDTH + SLAT_GAP)))
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count
        const sx = px + (x - px) * t, sz = pz + (z - pz) * t
        const height = FENCE_HEIGHT * (0.94 + 0.06 * Math.sin(k * 1.7 + i))
        box([0.015, height, SLAT_WIDTH], [sx, ground(sx, sz) + height / 2 - 0.1, sz], segmentYaw, FENCE_ORANGE)
      }
      // Two twisted wires carry the slats; snow banks against the foot of the fence.
      for (const h of [0.25, FENCE_HEIGHT - 0.2]) {
        const mx = (px + x) / 2, mz = (pz + z) / 2
        box([0.025, 0.025, span], [mx, ground(mx, mz) + h, mz], segmentYaw, WIRE_GREY)
      }
      const mx = (px + x) / 2, mz = (pz + z) / 2
      box([0.5, 0.22, span], [mx, ground(mx, mz) + 0.04, mz], segmentYaw, SNOW)
    }
  }

  const fenceParts = parts.length
  let lettering: THREE.Mesh | null = null
  const disposables: { dispose(): void }[] = []
  if (signpost) {
    const { x, z, yaw } = signpost
    const y = ground(x, z)
    // A squared timber post with a snow cap, and two arrow boards: left and right as the
    // skier sees them looking down the run (local -X is their left).
    box([0.16, 2.9, 0.16], [x, y + 1.3, z], yaw, WOOD_DARK)
    box([0.22, 0.12, 0.22], [x, y + 2.81, z], yaw, SNOW)
    const boards: THREE.BufferGeometry[] = []
    const atlas = signAtlas(signpost.left, signpost.right)
    disposables.push(atlas)
    for (const [side, row, height] of [[-1, 0, 2.3], [1, 1, 1.9]] as const) {
      const local = new THREE.Vector3(side * 0.62, height, 0.1)
      const at = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      // Board body: a plank with a pointed end.
      box([1.15, 0.3, 0.05], [x + at.x, y + at.y, z + at.z], yaw, WOOD)
      const face = arrowFace(side, row)
      face.rotateY(yaw)
      face.translate(x + at.x + Math.sin(yaw) * 0.03, y + at.y, z + at.z + Math.cos(yaw) * 0.03)
      boards.push(face)
    }
    const material = new THREE.MeshLambertMaterial({ map: atlas })
    const geometry = mergeGeometries(boards)!
    for (const board of boards) board.dispose()
    lettering = new THREE.Mesh(geometry, material)
    lettering.castShadow = false
    lettering.receiveShadow = true
    disposables.push(geometry, material)
    group.add(lettering)
  }

  // One mesh per site (summit fence, signpost), so each is culled on its own.
  const solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true })
  disposables.push(solidMaterial)
  for (const [name, site] of [['summit-fence', parts.slice(0, fenceParts)], ['tooth-tusk-signpost', parts.slice(fenceParts)]] as const) {
    if (!site.length) continue
    const geometry = mergeGeometries(site)!
    for (const part of site) part.dispose()
    const mesh = new THREE.Mesh(geometry, solidMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = name
    disposables.push(geometry)
    group.add(mesh)
  }

  // The signpost is a few metres of timber: only drawn within 250 m.
  const signMeshes = group.children.filter((child) => child === lettering || child.name === 'tooth-tusk-signpost')
  return {
    object: group,
    update(camera: { x: number; z: number }) {
      if (!signpost) return
      const near = (signpost.x - camera.x) ** 2 + (signpost.z - camera.z) ** 2 < 250 * 250
      for (const mesh of signMeshes) mesh.visible = near
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

function paint(geometry: THREE.BufferGeometry, color: THREE.Color): void {
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // BoxGeometry is indexed with uv; mergeGeometries needs matching attributes, so drop uv.
  geometry.deleteAttribute('uv')
}

/**
 * The painted face of one arrow board: a pentagon pointing toward `side`
 * (local -X or +X), facing local +Z, textured from row `row` of the atlas.
 */
function arrowFace(side: -1 | 1, row: 0 | 1): THREE.BufferGeometry {
  const w = 0.56, h = 0.14, tip = 0.14
  // Outline from the blunt end round to the tip, in board space (x along the board).
  const outline: [number, number][] = [[-w, -h], [w - tip, -h], [w, 0], [w - tip, h], [-w, h]].map(([px, py]) => [px * side, py])
  const positions: number[] = []
  const uvs: number[] = []
  const v0 = row === 0 ? 0.5 : 0
  for (const [px, py] of outline) {
    positions.push(px, py, 0)
    // Lettering reads left to right whichever way the board points.
    uvs.push((px + w) / (2 * w), v0 + ((py + h) / (2 * h)) * 0.5)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  // Fan from the first point; wound to face +Z for either side.
  const indices = side > 0 ? [0, 1, 2, 0, 2, 3, 0, 3, 4] : [0, 2, 1, 0, 3, 2, 0, 4, 3]
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Two rows of routed lettering on weathered timber: top row `top`, bottom row `bottom`. */
function signAtlas(top: string, bottom: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')!
  for (const [row, word] of [[0, top], [1, bottom]] as const) {
    const y = row * 128
    context.fillStyle = '#8a6646'
    context.fillRect(0, y, 512, 128)
    // Grain.
    context.strokeStyle = 'rgba(60, 40, 25, 0.25)'
    for (let k = 0; k < 9; k++) {
      context.beginPath()
      context.moveTo(0, y + 10 + k * 13)
      context.bezierCurveTo(170, y + 6 + k * 13, 340, y + 16 + k * 13, 512, y + 10 + k * 13)
      context.stroke()
    }
    context.fillStyle = '#f4efe6'
    context.font = 'bold 84px Georgia, serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(word, 256, y + 66)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
