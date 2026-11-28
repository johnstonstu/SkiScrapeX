import * as THREE from 'three'
import { applyTextureBudget } from '../textureBudget'
import { createStaticBatch } from './mergeStatic'
import type { Peak, Run } from '../../world/resort'
import { pointAlong } from '../../world/resort'
import { gladeEntry } from '../../world/glades'

const SYMBOL: Record<string, { shape: 'circle' | 'square' | 'diamond' | 'double'; color: string }> = {
  novice: { shape: 'circle', color: '#2e9e4a' },
  easy: { shape: 'circle', color: '#2e9e4a' },
  intermediate: { shape: 'square', color: '#2266c4' },
  advanced: { shape: 'diamond', color: '#111' },
  expert: { shape: 'double', color: '#111' },
  freeride: { shape: 'double', color: '#111' },
}

/** Trail-head signs (name and difficulty) at the top of each named run, plus peak labels. */
export interface PlaceLabel {
  name: string
  x: number
  z: number
  /** Height to float the label at, metres in the local frame. */
  y: number
}

/** How far down its run a trail-head board stands, and how far to the skier's right, metres. */
const SIGN = { along: 6, aside: 9, facing: 8, crowd: 30, crowdedAlong: 34, apart: 12, step: 14, tries: 5 } as const

/**
 * Where each run's trail-head board stands: a few metres down the run on the
 * skier's right. Where several runs start together (the top of Quickdraw, a
 * fork), each board moves further down its own run, so the boards fan out with
 * the runs instead of standing in one clump, and no two boards stand within
 * `apart` metres (Stu, 2026-11-28: at the top "the signage can be fixed, there's
 * just a lot of overlapping things").
 */
export function trailSignSpots(runs: readonly Run[]): Map<string, { x: number; z: number; x0: number; z0: number; x1: number; z1: number }> {
  const heads: { name: string; line: [number, number][] }[] = []
  const seen = new Set<string>()
  for (const run of runs) {
    if (run.kind !== 'line' || !run.name || run.name === 'Unnamed run' || seen.has(run.name) || !run.parts[0] || run.parts[0].length < 2) continue
    seen.add(run.name)
    heads.push({ name: run.name, line: run.parts[0] })
  }
  const at = (line: [number, number][], along: number) => {
    const [x0, z0] = pointAlong(line, along)
    const [x1, z1] = pointAlong(line, along + SIGN.facing)
    const length = Math.hypot(x1 - x0, z1 - z0) || 1
    return { x: x0 - ((z1 - z0) / length) * SIGN.aside, z: z0 + ((x1 - x0) / length) * SIGN.aside, x0, z0, x1, z1 }
  }
  const spots = new Map<string, ReturnType<typeof at>>()
  for (const head of heads) {
    const [sx, sz] = head.line[0]
    const crowded = heads.some((other) => other !== head && Math.hypot(other.line[0][0] - sx, other.line[0][1] - sz) < SIGN.crowd)
    let along: number = crowded ? SIGN.crowdedAlong : SIGN.along
    let spot = at(head.line, along)
    for (let i = 0; i < SIGN.tries && [...spots.values()].some((o) => Math.hypot(o.x - spot.x, o.z - spot.z) < SIGN.apart); i++) {
      along += SIGN.step
      spot = at(head.line, along)
    }
    spots.set(head.name, spot)
  }
  return spots
}

export function createSignView(
  runs: Run[],
  peaks: Peak[],
  heightAt: (x: number, z: number) => number,
  places: PlaceLabel[] = [],
) {
  const group = new THREE.Group()
  group.name = 'signs'
  const postGeometry = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6)
  postGeometry.translate(0, 1.3, 0)
  const postMaterial = new THREE.MeshLambertMaterial({ color: 0x6b5138 })
  const disposables: { dispose(): void }[] = [postGeometry, postMaterial]
  const labels: THREE.Sprite[] = []
  const trailLabels = new Set<THREE.Sprite>()
  const seen = new Set<string>()
  const timber = new THREE.MeshLambertMaterial({ color: 0x5d4330 })
  const boardBack = new THREE.MeshLambertMaterial({ color: 0x7a5a3e })
  const boardParts = {
    timber,
    boardBack,
    post: new THREE.BoxGeometry(0.12, 2.7, 0.12).translate(0, 1.35, 0),
    cap: new THREE.BoxGeometry(2.5, 0.1, 0.32).translate(0, 2.72, 0),
    panel: new THREE.PlaneGeometry(2.2, 0.55),
  }
  disposables.push(timber, boardBack, boardParts.post, boardParts.cap, boardParts.panel)
  // Posts, caps and board backs of every sign merge into two meshes; only the
  // painted faces (one texture each) stay separate, and hide when far away.
  const batch = createStaticBatch()
  const faces: THREE.Mesh[] = []

  const spots = trailSignSpots(runs)
  for (const run of runs) {
    if (run.kind !== 'line' || !run.name || run.name === 'Unnamed run' || seen.has(run.name)) continue
    seen.add(run.name)
    const spot = spots.get(run.name)
    if (!spot) continue
    const { x, z, x0, z0, x1, z1 } = spot
    const ground = heightAt(x, z)
    if (!Number.isFinite(ground)) continue
    // A timber trail-head board facing skiers coming down from above.
    const face = trailBoard(run.name, SYMBOL[run.difficulty ?? ''] ?? null, boardParts, disposables, batch, new THREE.Vector3(x, ground - 0.15, z), Math.atan2(-(x1 - x0), -(z1 - z0)))
    group.add(face)
    faces.push(face)
    const sprite = label(run.name, SYMBOL[run.difficulty ?? ''] ?? null, disposables)
    sprite.position.set(x, ground + 3.0, z)
    group.add(sprite)
    labels.push(sprite)
    trailLabels.add(sprite)
  }
  // Glades: the same board at the top of each glade, facing skiers dropping in.
  for (const run of runs) {
    if (run.kind !== 'area' || !run.glade || seen.has(run.name)) continue
    const entry = gladeEntry(run.parts[0], heightAt)
    if (!entry) continue
    seen.add(run.name)
    const { x, z, ground, yaw } = entry
    const face = trailBoard(run.name, SYMBOL[run.difficulty ?? ''] ?? null, boardParts, disposables, batch, new THREE.Vector3(x, ground - 0.15, z), yaw)
    group.add(face)
    faces.push(face)
    const sprite = label(run.name, SYMBOL[run.difficulty ?? ''] ?? null, disposables)
    sprite.position.set(x, ground + 3.0, z)
    group.add(sprite)
    labels.push(sprite)
    trailLabels.add(sprite)
  }
  // Village place names: timber board at the doorline (same kit as trail heads),
  // with the floating label for distance. Faces the approach from +Z by default.
  for (const place of places) {
    const ground = heightAt(place.x, place.z)
    if (Number.isFinite(ground)) {
      const face = trailBoard(
        place.name,
        null,
        boardParts,
        disposables,
        batch,
        new THREE.Vector3(place.x, ground - 0.15, place.z),
        0,
      )
      group.add(face)
      faces.push(face)
    }
  }
  for (const mesh of batch.build()) {
    disposables.push(mesh.geometry)
    group.add(mesh)
  }
  // Peak names read from afar; standing on the summit they hang overhead behind the HUD.
  const peakLabels: THREE.Sprite[] = []
  for (const peak of peaks) {
    const ground = heightAt(peak.x, peak.z)
    if (!Number.isFinite(ground)) continue
    const sprite = label(peak.ele ? `${peak.name} · ${Math.round(peak.ele)} m` : peak.name, null, disposables)
    sprite.scale.multiplyScalar(2.5)
    sprite.position.set(peak.x, ground + 12, peak.z)
    group.add(sprite)
    peakLabels.push(sprite)
  }

  for (const place of places) {
    const sprite = label(place.name, null, disposables)
    sprite.scale.multiplyScalar(1.4)
    sprite.position.set(place.x, place.y, place.z)
    group.add(sprite)
    labels.push(sprite)
  }

  return {
    object: group,
    /** Hide trail signs far from the camera so they do not clutter the view. */
    update(camera: THREE.Vector3) {
      for (const sprite of labels) {
        const d = sprite.position.distanceToSquared(camera)
        // Trail heads: the board is readable up close, so the floating label only helps from afar.
        sprite.visible = d < 260 * 260 && d > (trailLabels.has(sprite) ? 60 * 60 : 7 * 7)
      }
      for (const sprite of peakLabels) {
        const dx = sprite.position.x - camera.x
        const dz = sprite.position.z - camera.z
        sprite.visible = dx * dx + dz * dz > 150 * 150
      }
      // Painted faces only up close: past 250 m they are a few pixels and the label takes over.
      for (const face of faces) face.visible = face.position.distanceToSquared(camera) < 250 * 250
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

/**
 * Two timber posts, a cap rail and a painted board with the run's symbol and
 * name, standing at `at` facing `yaw`. The timber and the board back go into
 * the shared batch; the painted face (its own texture) is returned.
 */
function trailBoard(
  text: string,
  symbol: { shape: string; color: string } | null,
  parts: { timber: THREE.Material; boardBack: THREE.Material; post: THREE.BufferGeometry; cap: THREE.BufferGeometry; panel: THREE.BufferGeometry },
  disposables: { dispose(): void }[],
  batch: ReturnType<typeof createStaticBatch>,
  at: THREE.Vector3,
  yaw: number,
): THREE.Mesh {
  const local = new THREE.Object3D()
  for (const x of [-1.05, 1.05]) {
    local.position.set(x, 0, 0)
    batch.add(parts.post, parts.timber, batch.matrix(at, yaw, local))
  }
  batch.add(parts.cap, parts.timber, batch.matrix(at, yaw))
  local.position.set(0, 2.25, 0.06)
  local.rotation.y = Math.PI
  batch.add(parts.panel, parts.boardBack, batch.matrix(at, yaw, local))
  const texture = new THREE.CanvasTexture(signCanvas(text, symbol))
  texture.colorSpace = THREE.SRGBColorSpace
  applyTextureBudget(texture)
  const face = new THREE.MeshLambertMaterial({ map: texture })
  disposables.push(texture, face)
  const front = new THREE.Mesh(parts.panel, face)
  local.position.set(0, 2.25, 0.07)
  local.rotation.y = 0
  front.applyMatrix4(batch.matrix(at, yaw, local))
  front.castShadow = true
  return front
}

export function label(
  text: string,
  symbol: { shape: string; color: string } | null,
  disposables: { dispose(): void }[],
): THREE.Sprite {
  const texture = new THREE.CanvasTexture(signCanvas(text, symbol))
  texture.colorSpace = THREE.SRGBColorSpace
  applyTextureBudget(texture)
  const material = new THREE.SpriteMaterial({ map: texture, fog: true })
  disposables.push(texture, material)
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(4, 1, 1)
  return sprite
}

/** The painted sign face: a cream board with a dark border, the difficulty symbol and the name. */
function signCanvas(text: string, symbol: { shape: string; color: string } | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = canvas.getContext('2d')!
  g.fillStyle = '#f4efe2'
  g.strokeStyle = '#3b2e26'
  g.lineWidth = 8
  g.beginPath()
  g.roundRect(4, 4, 504, 120, 14)
  g.fill()
  g.stroke()
  let left = 28
  if (symbol) {
    g.fillStyle = symbol.color
    const cy = 64
    if (symbol.shape === 'circle') {
      g.beginPath()
      g.arc(left + 30, cy, 30, 0, Math.PI * 2)
      g.fill()
    } else if (symbol.shape === 'square') {
      g.fillRect(left, cy - 30, 60, 60)
    } else {
      const diamonds = symbol.shape === 'double' ? 2 : 1
      for (let i = 0; i < diamonds; i++) {
        const cx = left + 30 + i * 42
        g.beginPath()
        g.moveTo(cx, cy - 34)
        g.lineTo(cx + 26, cy)
        g.lineTo(cx, cy + 34)
        g.lineTo(cx - 26, cy)
        g.closePath()
        g.fill()
      }
      left += (diamonds - 1) * 42
    }
    left += 78
  }
  g.fillStyle = '#1f2a33'
  let size = 54
  g.font = `700 ${size}px system-ui, sans-serif`
  while (g.measureText(text).width > 512 - left - 24 && size > 26) {
    size -= 2
    g.font = `700 ${size}px system-ui, sans-serif`
  }
  g.textBaseline = 'middle'
  g.fillText(text, left, 66)
  return canvas
}

