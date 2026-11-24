import type { ParkSite } from '../world/park'
import type { Point2, Resort, Run } from '../world/resort'
import { polylineLength } from '../world/resort'

export const RUN_COLOURS: Record<string, string> = {
  novice: '#3fbf5a',
  easy: '#3fbf5a',
  intermediate: '#2f7fe0',
  advanced: '#1a1a1a',
  expert: '#1a1a1a',
  freeride: '#e0782f',
}

export type TrailSelection =
  | { kind: 'run'; run: Run }
  | { kind: 'park'; site: ParkSite }
  | null

type WorldSize = { width: number; depth: number }

function distToSegment(px: number, pz: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-6) return Math.hypot(px - a[0], pz - a[1])
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / len2))
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz))
}

function distToParts(px: number, pz: number, parts: Point2[][]): number {
  let best = Infinity
  for (const part of parts) {
    for (let i = 1; i < part.length; i++) best = Math.min(best, distToSegment(px, pz, part[i - 1], part[i]))
  }
  return best
}

/** Nearest named run or park within a hit radius, for map clicks. */
export function hitTrail(
  x: number,
  z: number,
  runs: readonly Run[],
  parks: readonly ParkSite[],
  radius: number,
): TrailSelection {
  let best: TrailSelection = null
  let bestDist = radius
  for (const run of runs) {
    const distance = distToParts(x, z, run.parts)
    if (distance < bestDist) {
      bestDist = distance
      best = { kind: 'run', run }
    }
  }
  for (const site of parks) {
    const distance = distToParts(x, z, [site.line])
    if (distance < bestDist) {
      bestDist = distance
      best = { kind: 'park', site }
    }
  }
  return best
}

export function createTrailMap(
  canvas: HTMLCanvasElement,
  world: WorldSize & { resort: Resort; hillshade: string | null },
  options: {
    runs: readonly Run[]
    parks: readonly ParkSite[]
    onSelect: (selection: TrailSelection) => void
  },
) {
  const context = canvas.getContext('2d')!
  const background = document.createElement('canvas')
  const bg = background.getContext('2d')!
  let selection: TrailSelection = null
  let hover: TrailSelection = null
  let ratio = 1
  let scale = 1
  let cssW = 0
  let cssH = 0

  const layout = () => {
    const parent = canvas.parentElement
    const availW = Math.max(280, parent?.clientWidth || canvas.clientWidth || 480)
    const availH = Math.max(220, parent?.clientHeight || 360)
    scale = Math.min(availW / world.width, availH / world.depth)
    cssW = Math.round(world.width * scale)
    cssH = Math.round(world.depth * scale)
    ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.round(cssW * ratio))
    canvas.height = Math.max(1, Math.round(cssH * ratio))
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    background.width = canvas.width
    background.height = canvas.height
    paintBackground()
    paint()
  }

  const paintFeatures = (target: CanvasRenderingContext2D, selected: TrailSelection, soft = false) => {
    target.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
    target.lineCap = 'round'
    target.lineJoin = 'round'
    for (const run of world.resort.runs) {
      const active = selected?.kind === 'run' && selected.run.name === run.name
      const muted = soft && selected && !active
      target.strokeStyle = RUN_COLOURS[run.difficulty ?? ''] ?? '#5a6f80'
      target.fillStyle = target.strokeStyle
      target.globalAlpha = muted ? 0.28 : run.kind === 'area' ? 0.32 : 0.92
      target.lineWidth = active ? 28 : 14
      for (const part of run.parts) {
        target.beginPath()
        part.forEach(([x, z], i) => (i ? target.lineTo(x, z) : target.moveTo(x, z)))
        if (run.kind === 'area') target.fill()
        else target.stroke()
      }
      target.globalAlpha = 1
    }
    target.strokeStyle = '#d0302a'
    target.lineWidth = 9
    target.setLineDash([22, 14])
    target.globalAlpha = soft && selected?.kind === 'park' ? 0.35 : 0.95
    for (const lift of world.resort.lifts) {
      target.beginPath()
      lift.line.forEach(([x, z], i) => (i ? target.lineTo(x, z) : target.moveTo(x, z)))
      target.stroke()
    }
    target.setLineDash([])
    for (const site of options.parks) {
      const active = selected?.kind === 'park' && selected.site.id === site.id
      const muted = soft && selected && !active
      const mid = site.line[Math.floor(site.line.length / 2)] ?? site.line[0]
      if (!mid) continue
      target.globalAlpha = muted ? 0.3 : 1
      target.fillStyle = '#ff8a2a'
      target.strokeStyle = active ? '#ffdc69' : '#132637'
      target.lineWidth = (active ? 4 : 2) / scale
      target.beginPath()
      target.arc(mid[0], mid[1], (active ? 14 : 10) / scale, 0, Math.PI * 2)
      target.fill()
      target.stroke()
      target.strokeStyle = '#ff8a2a'
      target.lineWidth = active ? 18 : 11
      target.globalAlpha = muted ? 0.2 : 0.75
      target.beginPath()
      site.line.forEach(([x, z], i) => (i ? target.lineTo(x, z) : target.moveTo(x, z)))
      target.stroke()
      target.globalAlpha = 1
    }
  }

  const paintBackground = () => {
    bg.setTransform(1, 0, 0, 1, 0, 0)
    bg.fillStyle = '#d7e4ec'
    bg.fillRect(0, 0, background.width, background.height)
    if (world.hillshade) {
      const image = new Image()
      image.onload = () => {
        bg.setTransform(1, 0, 0, 1, 0, 0)
        bg.globalAlpha = 0.9
        bg.drawImage(image, 0, 0, background.width, background.height)
        bg.globalAlpha = 1
        paintFeatures(bg, null)
        paint()
      }
      image.src = world.hillshade
    }
    paintFeatures(bg, null)
  }

  const paint = () => {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(background, 0, 0)
    const focus = hover ?? selection
    if (focus) paintFeatures(context, focus, true)
  }

  const worldFromEvent = (event: PointerEvent): Point2 | null => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const x = ((event.clientX - rect.left) / rect.width) * world.width
    const z = ((event.clientY - rect.top) / rect.height) * world.depth
    return [x, z]
  }

  const radius = () => Math.max(28, Math.min(world.width, world.depth) * 0.035)

  canvas.addEventListener('pointermove', (event) => {
    const point = worldFromEvent(event)
    if (!point) return
    const next = hitTrail(point[0], point[1], options.runs, options.parks, radius())
    const same =
      (next === null && hover === null) ||
      (next?.kind === 'run' && hover?.kind === 'run' && next.run.name === hover.run.name) ||
      (next?.kind === 'park' && hover?.kind === 'park' && next.site.id === hover.site.id)
    if (same) return
    hover = next
    canvas.style.cursor = next ? 'pointer' : 'default'
    paint()
  })
  canvas.addEventListener('pointerleave', () => {
    if (!hover) return
    hover = null
    canvas.style.cursor = 'default'
    paint()
  })
  canvas.addEventListener('pointerdown', (event) => {
    const point = worldFromEvent(event)
    if (!point) return
    const next = hitTrail(point[0], point[1], options.runs, options.parks, radius())
    selection = next
    options.onSelect(next)
    paint()
  })

  layout()
  window.addEventListener('resize', layout)

  return {
    setSelection(next: TrailSelection) {
      selection = next
      hover = null
      paint()
    },
    resize: layout,
    dispose() {
      window.removeEventListener('resize', layout)
    },
    /** Useful for tests and detail copy. */
    runLength(run: Run) {
      return Math.max(...run.parts.map(polylineLength))
    },
  }
}
