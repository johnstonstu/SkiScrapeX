import * as THREE from 'three'
import type { Peak, Run } from '../../world/resort'
import { pointAlong } from '../../world/resort'

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
  const seen = new Set<string>()

  for (const run of runs) {
    if (run.kind !== 'line' || !run.name || run.name === 'Unnamed run' || seen.has(run.name)) continue
    seen.add(run.name)
    const line = run.parts[0]
    const [x0, z0] = pointAlong(line, 6)
    const [x1, z1] = pointAlong(line, 14)
    const length = Math.hypot(x1 - x0, z1 - z0) || 1
    // Stand the sign at skier's-right edge of the run, a few metres in.
    const x = x0 - ((z1 - z0) / length) * 9
    const z = z0 + ((x1 - x0) / length) * 9
    const ground = heightAt(x, z)
    if (!Number.isFinite(ground)) continue
    const post = new THREE.Mesh(postGeometry, postMaterial)
    post.position.set(x, ground - 0.2, z)
    group.add(post)
    const sprite = label(run.name, SYMBOL[run.difficulty ?? ''] ?? null, disposables)
    sprite.position.set(x, ground + 3.0, z)
    group.add(sprite)
    labels.push(sprite)
  }
  for (const peak of peaks) {
    const ground = heightAt(peak.x, peak.z)
    if (!Number.isFinite(ground)) continue
    const sprite = label(peak.ele ? `${peak.name} · ${Math.round(peak.ele)} m` : peak.name, null, disposables)
    sprite.scale.multiplyScalar(2.5)
    sprite.position.set(peak.x, ground + 12, peak.z)
    group.add(sprite)
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
        sprite.visible = d < 260 * 260 && d > 7 * 7
      }
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

export function label(
  text: string,
  symbol: { shape: string; color: string } | null,
  disposables: { dispose(): void }[],
): THREE.Sprite {
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
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const material = new THREE.SpriteMaterial({ map: texture, fog: true })
  disposables.push(texture, material)
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(4, 1, 1)
  return sprite
}
