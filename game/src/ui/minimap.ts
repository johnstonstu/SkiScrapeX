import type { SkiState } from '../sim'
import type { Resort } from '../world/resort'

const RUN_COLOURS: Record<string, string> = {
  novice: '#3fbf5a',
  easy: '#3fbf5a',
  intermediate: '#2f7fe0',
  advanced: '#1a1a1a',
  expert: '#1a1a1a',
  freeride: '#e0782f',
}

/** North-up map of the crop: hillshade, runs by difficulty, lifts and the skier. */
export function createMinimap(
  canvas: HTMLCanvasElement,
  caption: HTMLElement,
  runNameAt: (x: number, z: number) => string,
  world: { width: number; depth: number; resort: Resort; hillshade: string | null },
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

  return {
    draw(state: SkiState, liftName?: string) {
      const location = liftName ?? runNameAt(state.x, state.z)
      if (caption.textContent !== location) caption.textContent = location
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(background, 0, 0)
      context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
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
    },
  }
}
