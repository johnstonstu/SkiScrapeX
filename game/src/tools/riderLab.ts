/**
 * Rider lab (`rider.html`): the skier model in a row of poses on flat snow,
 * for reviewing the model and animation without skiing to find each pose.
 * `?anim` plays the poses over time instead of freezing them.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createSkiState, newPressState, type RailPress, type SkiInput, type SkiState } from '../sim'
import { createSkierView } from '../render/rider/skierView'
import { addSceneLights, createLighting } from '../render/lighting'
import { DEFAULT_OUTFIT, readOutfit } from '../ui/riderPanel'

interface Pose {
  label: string
  setup: (s: SkiState, t: number) => SkiInput
}

const idle: SkiInput = { steer: 0, brake: 0, tuck: false }
const POSES: Pose[] = [
  { label: 'Standing', setup: (s) => ((s.speed = 0), idle) },
  { label: 'Cruising', setup: (s) => ((s.speed = 10), idle) },
  { label: 'Carve left', setup: (s) => ((s.speed = 14), (s.edgeAngle = -0.75), (s.carveRadius = 10), (s.carveLoad = 2.2), { ...idle, steer: -1 }) },
  { label: 'Carve right', setup: (s) => ((s.speed = 14), (s.edgeAngle = 0.75), (s.carveRadius = 10), (s.carveLoad = 2.2), { ...idle, steer: 1 }) },
  {
    label: 'Linked turns',
    setup: (s, t) => {
      s.speed = 12
      s.edgeAngle = Math.sin(t * 2.6) * 0.75
      s.carveRadius = 11
      s.carveLoad = 1 + 0.9 * Math.abs(Math.sin(t * 2.6))
      return { ...idle, steer: Math.sign(s.edgeAngle) }
    },
  },
  { label: 'Tuck', setup: (s) => ((s.speed = 20), { ...idle, tuck: true }) },
  { label: 'Snowplough', setup: (s) => ((s.speed = 3), { ...idle, brake: 1 }) },
  { label: 'Pushing', setup: (s) => ((s.speed = 0.8), { ...idle, tuck: true }) },
  { label: 'Skating', setup: (s) => ((s.speed = 2.5), { ...idle, tuck: true }) },
  { label: 'Hockey stop', setup: (s) => ((s.speed = 8), (s.edgeAngle = 0.7), { ...idle, brake: 1 }) },
  {
    label: 'Mute grab',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'mute', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return idle
    },
  },
  {
    label: 'Japan',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'japan', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return idle
    },
  },
  {
    label: 'Truck driver',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'truck', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return idle
    },
  },
  {
    label: 'Rail slide',
    setup: (s, t) => {
      s.speed = 5
      const rail = { kind: 'rail', points: [[0, 0, 0], [0, 0, 5]] } as unknown as import('../sim').Rail
      s.rail = { rail, s: 1, vs: 5, balance: Math.sin(t * 1.7) * 0.6, balanceRate: 0, style: 'slide', headingOffset: Math.PI / 2, entrySpeed: 5, metres: 1, ...newPressState(true) }
      return idle
    },
  },
  ...(['nose', 'tail'] as RailPress[]).map((press) => ({
    label: press === 'nose' ? 'Nose press' : 'Tail press',
    setup: (s: SkiState, t: number) => {
      s.speed = 5
      const rail = { kind: 'rail', points: [[0, 0, 0], [0, 0, 5]] } as unknown as import('../sim').Rail
      s.rail = { rail, s: 1, vs: 5, balance: Math.sin(t * 1.7) * 0.4, balanceRate: 0, style: '5050', headingOffset: 0, entrySpeed: 5, metres: 1, ...newPressState(true), press, pressTime: 1 }
      return idle
    },
  })),
]

const params = new URLSearchParams(location.search)
const canvas = document.querySelector<HTMLCanvasElement>('#view')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
const scene = new THREE.Scene()
scene.background = new THREE.Color('#c9d8e4')
const lighting = createLighting()
const sun = addSceneLights(scene, lighting)
scene.fog = null
sun.shadow.camera.left = sun.shadow.camera.bottom = -12
sun.shadow.camera.right = sun.shadow.camera.top = 12
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.normalBias = 0.02
const snow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#f4f7fa', roughness: 0.9 }))
snow.rotation.x = -Math.PI / 2
snow.receiveShadow = true
scene.add(snow)

const outfit = params.has('default') ? { ...DEFAULT_OUTFIT } : readOutfit()
for (const key of ['fit', 'headwear', 'jacket', 'pants', 'helmet', 'skis', 'gaiter', 'model', 'jacketAccent', 'skiGraphic', 'skiAccent', 'backpack'] as const) {
  const value = params.get(key)
  if (!value) continue
  const word = ['fit', 'headwear', 'model', 'skiGraphic'].includes(key)
  ;(outfit as unknown as Record<string, string | boolean>)[key] = key === 'backpack' ? value === 'true' : word ? value : `#${value}`
}
// `?pose=tuck,carve-left` shows only those poses (label slugs), for close-ups.
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const wanted = params.get('pose')?.split(',').map(slug)
const shown = wanted ? POSES.filter((p) => wanted.includes(slug(p.label))) : POSES
const spacing = 2.1
const riders = shown.map((pose, i) => {
  const view = createSkierView()
  view.setColours(outfit)
  view.object.traverse((o) => (o.castShadow = true))
  scene.add(view.object)
  const state = createSkiState({ x: (i - (shown.length - 1) / 2) * spacing, y: 0, z: 0, heading: (Number(params.get('h') ?? 0) * Math.PI) / 180 })
  return { pose, view, state }
})
document.querySelector('#labels')!.innerHTML = shown.map((p) => `<span>${p.label}</span>`).join('')

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200)
camera.position.set(Number(params.get('cx') ?? 0), Number(params.get('cy') ?? 2.4), Number(params.get('cz') ?? Math.max(6, shown.length * 1.2)))
const controls = new OrbitControls(camera, canvas)
controls.target.set(Number(params.get('tx') ?? 0), Number(params.get('ty') ?? 0.9), 0)
controls.update()
sun.target.position.set(0, 0, 0)
sun.position.copy(lighting.sunDirection).multiplyScalar(40)

const ground = { height: 0, normal: { x: 0, y: 1, z: 0 } }
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

const animate = params.has('anim')
let time = 0
const step = (dt: number) => {
  time += dt
  for (const { pose, view, state } of riders) {
    state.time = time
    const input = pose.setup(state, time)
    state.mode = state.grounded ? 'carving' : 'air'
    state.y = state.rail ? 0.5 : state.grounded ? 0 : 0.7
    view.update(state, input, state.grounded ? ground : null, 'ski', dt)
  }
}
// Let the smoothing settle so a screenshot shows the held pose.
for (let i = 0; i < 180; i++) step(1 / 60)
let last = performance.now()
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (animate) step(dt)
  controls.update()
  renderer.render(scene, camera)
})
