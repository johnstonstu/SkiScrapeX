import * as THREE from 'three'
import { lowerAutoCap } from '../autoCap'
import { showGraphicsProblem } from '../graphicsFail'
import { QUALITY, lighterQuality, writeSettings, type QualityProfile, type Settings } from '../settings'

/**
 * The WebGL renderer, or a clear message when the browser will not give us
 * one. Chrome refuses new WebGL contexts for a while after its graphics
 * process crashes or resets repeatedly; only restarting the browser clears it.
 */
export function createRenderer(canvas: HTMLCanvasElement, antialias: boolean): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias, powerPreference: 'high-performance' })
  } catch (error) {
    showGraphicsProblem(
      '3D graphics are not available',
      'The browser would not start WebGL. If the game worked before, the browser has probably switched 3D off after a graphics crash: quit it completely and reopen it. ' +
        'Otherwise check that hardware acceleration is turned on in the browser settings.',
      false,
    )
    throw error
  }
}

/**
 * A lost WebGL context (the graphics chip reset, often from running out of
 * time or memory) leaves menus and sound working over a blank screen. Say so,
 * remember the level that was running so Auto starts lighter next time, and
 * offer a reload.
 */
export function watchForGpuReset(canvas: HTMLCanvasElement, quality: QualityProfile, settings: Settings) {
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lowerAutoCap(lighterQuality(quality.level))
    const next = lighterQuality(quality.level)
    const auto = settings.quality === 'auto'
    if (!auto && next !== quality.level) {
      settings.quality = next
      writeSettings(settings)
    }
    showGraphicsProblem(
      'The graphics chip reset',
      quality.level === 'low'
        ? 'This happened on Low graphics. Reload to try again; if it keeps happening, quit and reopen the browser.'
        : `Reload to continue on ${QUALITY[next].level[0].toUpperCase()}${QUALITY[next].level.slice(1)} graphics, which is lighter on this computer. You can change it back in Settings.`,
      true,
    )
  })
}

/** Materials compile with or without shadow code: after turning shadows on or off, recompile them. */
export function recompileMaterials(scene: THREE.Object3D) {
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material
    for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
  })
}

/**
 * Compile every material's program before the first frames, so the first sight
 * of a new material (park features, cliffs, gear, other skiers) does not stall a
 * frame mid-run. Capped at 4 s; a failure only costs the warm-up, not the game.
 */
export async function warmShaders(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  try {
    await Promise.race([renderer.compileAsync(scene, camera), new Promise((resolve) => setTimeout(resolve, 4000))])
  } catch (error) {
    console.warn('Shader warm-up failed; programs will compile on first use.', error)
  }
}

/** Resolves after the browser has painted the current DOM. */
export function nextPaint() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

/** Size the canvas and camera to the window. */
export function fitToWindow(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
  const width = window.innerWidth
  const height = window.innerHeight
  camera.aspect = width / Math.max(1, height)
  camera.updateProjectionMatrix()
  renderer.setSize(width, height, false)
}
