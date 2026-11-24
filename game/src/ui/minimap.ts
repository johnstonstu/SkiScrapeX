import type { SkiState } from '../sim'
import type { ParkSite } from '../world/park'
import type { Resort, Run } from '../world/resort'
import { hitTrail, trailLabel, type TrailSelection, RUN_COLOURS } from './trailMap'

/** North-up map of the crop: hillshade, runs by difficulty, lifts and the skier. */
export function createMinimap(
  canvas: HTMLCanvasElement,
  caption: HTMLElement,
  runNameAt: (x: number, z: number) => string,
  world: { width: number; depth: number; resort: Resort; hillshade: string | null },
  options?: {
    runs?: readonly Run[]
    parks?: readonly ParkSite[]
    onTrip?: (selection: Exclude<TrailSelection, null>) => void
  },
) {
  const size = 168
  const scale = size / Math.max(world.width, world.depth)
  const w = Math.round(world.width * scale)
  const h = Math.round(world.depth * scale)
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = w * ratio
  canvas.height = h * ratio
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const context = canvas.getContext('2d')!
  const background = document.createElement('canvas')
  background.width = canvas.width
  background.height = canvas.height
  const bg = background.getContext('2d')!
  const runs = options?.runs ?? world.resort.runs
  const parks = options?.parks ?? []
  let hover: TrailSelection = null

  const tip = document.createElement('div')
  tip.className = 'map-hover-tip map-hover-tip--hud'
  tip.hidden = true
  tip.setAttribute('aria-hidden', 'true')
  canvas.parentElement?.append(tip)

  const drawFeatures = () => {
    bg.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
    bg.lineCap = 'round'
    bg.lineJoin = 'round'
    for (const run of world.resort.runs) {
      bg.strokeStyle = RUN_COLOURS[run.difficulty ?? ''] ?? '#5a6f80'
      bg.fillStyle = bg.strokeStyle
      bg.lineWidth = 14
      for (const part of run.parts) {
        bg.beginPath()
        part.forEach(([x, z], i) => (i ? bg.lineTo(x, z) : bg.moveTo(x, z)))
        if (run.kind === 'area') {
          bg.globalAlpha = 0.35
          bg.fill()
          bg.globalAlpha = 1
        } else bg.stroke()
      }
    }
    bg.strokeStyle = '#d0302a'
    bg.lineWidth = 9
    bg.setLineDash([22, 14])
    for (const lift of world.resort.lifts) {
      bg.beginPath()
      lift.line.forEach(([x, z], i) => (i ? bg.lineTo(x, z) : bg.moveTo(x, z)))
      bg.stroke()
    }
    bg.setLineDash([])
  }

  bg.fillStyle = '#e8eef2'
  bg.fillRect(0, 0, background.width, background.height)
  if (world.hillshade) {
    const image = new Image()
    image.onload = () => {
      bg.setTransform(1, 0, 0, 1, 0, 0)
      bg.globalAlpha = 0.85
      bg.drawImage(image, 0, 0, background.width, background.height)
      bg.globalAlpha = 1
      drawFeatures()
    }
    image.src = world.hillshade
  }
  drawFeatures()

  const radius = () => Math.max(40, Math.min(world.width, world.depth) * 0.045)

  const worldFromEvent = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    return {
      x: ((event.clientX - rect.left) / rect.width) * world.width,
      z: ((event.clientY - rect.top) / rect.height) * world.depth,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }

  const placeTip = (clientX: number, clientY: number, label: string) => {
    if (!label) {
      tip.hidden = true
      tip.textContent = ''
      return
    }
    tip.hidden = false
    tip.textContent = label
    const parent = canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    tip.style.left = `${Math.min(rect.width - 8, Math.max(4, clientX - rect.left + 12))}px`
    tip.style.top = `${Math.min(rect.height - 8, Math.max(4, clientY - rect.top + 12))}px`
  }

  const onMove = (event: PointerEvent) => {
    const point = worldFromEvent(event)
    if (!point) return
    hover = hitTrail(point.x, point.z, runs, parks, radius())
    placeTip(point.clientX, point.clientY, trailLabel(hover))
    canvas.style.cursor = hover ? 'pointer' : 'default'
  }
  const onLeave = () => {
    hover = null
    tip.hidden = true
    tip.textContent = ''
    canvas.style.cursor = 'default'
  }
  const onDown = (event: PointerEvent) => {
    const point = worldFromEvent(event)
    if (!point) return
    const hit = hitTrail(point.x, point.z, runs, parks, radius())
    if (hit) options?.onTrip?.(hit)
  }
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('pointerdown', onDown)

  return {
    /** `view` (orbit camera and its target) names the place being looked at and draws a sight line to it. */
    draw(state: SkiState, liftName?: string, view?: { x: number; z: number; tx: number; tz: number }) {
      const location = view ? runNameAt(view.tx, view.tz) : liftName ?? runNameAt(state.x, state.z)
      if (!hover && caption.textContent !== location) caption.textContent = location
      if (hover) caption.textContent = trailLabel(hover)
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(background, 0, 0)
      context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
      if (hover) {
        context.save()
        context.globalAlpha = 0.55
        context.strokeStyle = '#ffdc3a'
        context.lineWidth = 22
        context.lineCap = 'round'
        context.lineJoin = 'round'
        if (hover.kind === 'run') {
          for (const part of hover.run.parts) {
            context.beginPath()
            part.forEach(([x, z], i) => (i ? context.lineTo(x, z) : context.moveTo(x, z)))
            context.stroke()
          }
        } else {
          context.beginPath()
          hover.site.line.forEach(([x, z], i) => (i ? context.lineTo(x, z) : context.moveTo(x, z)))
          context.stroke()
        }
        context.restore()
      }
      const r = 5 / scale
      context.save()
      context.translate(state.x, state.z)
      context.rotate(state.heading)
      context.fillStyle = '#ffdc3a'
      context.strokeStyle = '#132637'
      context.lineWidth = 1.5 / scale
      context.beginPath()
      context.moveTo(0, r * 1.6)
      context.lineTo(r, -r)
      context.lineTo(-r, -r)
      context.closePath()
      context.fill()
      context.stroke()
      context.restore()
      if (view) {
        // Camera dot, a dashed sight line and a ring on the point being looked at.
        context.strokeStyle = '#ffffff'
        context.fillStyle = '#ffffff'
        context.lineWidth = 1.5 / scale
        context.setLineDash([4 / scale, 3 / scale])
        context.beginPath()
        context.moveTo(view.x, view.z)
        context.lineTo(view.tx, view.tz)
        context.stroke()
        context.setLineDash([])
        context.beginPath()
        context.arc(view.tx, view.tz, 6 / scale, 0, Math.PI * 2)
        context.stroke()
        context.beginPath()
        context.arc(view.x, view.z, 3 / scale, 0, Math.PI * 2)
        context.fill()
      }
    },
    dispose() {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      tip.remove()
    },
  }
}
