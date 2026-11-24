import * as THREE from 'three'
import { createSkiState, type SkiInput } from '../sim'
import { createSkierView } from '../render/rider/skierView'
import type { Outfit } from './riderPanel'

const idle: SkiInput = { steer: 0, brake: 0, tuck: false }

/** Small lit preview of the current outfit for the Rider & gear menu. */
export function createRiderPreview(host: HTMLElement) {
  const canvas = document.createElement('canvas')
  canvas.className = 'rider-preview-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40)
  camera.position.set(1.55, 1.35, 3.4)
  camera.lookAt(0, 0.95, 0)

  const hemi = new THREE.HemisphereLight(0xd7ecff, 0x3a4a3a, 1.15)
  const key = new THREE.DirectionalLight(0xfff2d8, 1.35)
  key.position.set(2.2, 4.5, 1.4)
  const fill = new THREE.DirectionalLight(0x9eb8ff, 0.45)
  fill.position.set(-2.5, 1.5, -1.2)
  scene.add(hemi, key, fill)

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 48),
    new THREE.MeshStandardMaterial({ color: 0xe8f2f7, roughness: 0.95, metalness: 0.02 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const view = createSkierView()
  scene.add(view.object)
  const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
  state.speed = 4
  state.grounded = true
  const groundSample = { height: 0, normal: { x: 0, y: 1, z: 0 } }

  let spinning = true
  let frame = 0
  let running = false
  let last = 0

  const resize = () => {
    const width = Math.max(180, host.clientWidth || 320)
    const height = Math.max(220, host.clientHeight || 360)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    renderer.setPixelRatio(ratio)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  const tick = (now: number) => {
    if (!running) return
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016)
    last = now
    frame += dt
    if (spinning) view.object.rotation.y = frame * 0.45
    state.edgeAngle = Math.sin(frame * 1.1) * 0.18
    view.update(state, idle, groundSample, undefined, dt)
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }

  resize()

  return {
    setOutfit(outfit: Outfit) {
      view.setColours(outfit)
    },
    setSpinning(on: boolean) {
      spinning = on
    },
    start() {
      if (running) return
      running = true
      last = performance.now()
      resize()
      requestAnimationFrame(tick)
    },
    stop() {
      running = false
    },
    resize,
    dispose() {
      running = false
      renderer.dispose()
      canvas.remove()
    },
  }
}
