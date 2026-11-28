/**
 * Rider lab (`rider.html`): the skier model in a row of poses on flat snow,
 * for reviewing the model and animation without skiing to find each pose.
 * `?anim` plays the poses over time instead of freezing them. `?clip` marks
 * cloth cutting into another body part in red (see riderClipping.ts).
 * `?sim` instead runs the real ski sim through linked turns on a steady
 * slope behind the follow camera (`pitch`, `period` seconds per turn pair,
 * `cap` km/h; `amp` scales the steer; `action=tour` loops through turns, a
 * tuck, a stop, a push off, an ollie, a crash and the get-up). `window.__step(frames)` advances it frame by frame, for
 * reviewing turn transitions. `cam=back|front|side` puts a close camera on
 * the rider instead of the follow camera.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FIXED_DT, beginCrash, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../sim'
import { createCameraRig } from '../player/camera'
import { createSkierView } from '../render/rider/skierView'
import { createClipCheck, type ClipCheck } from '../render/rider/riderClipping'
import { LAB_POSES, stepLabPose } from './riderPoses'
import type { IdleKind } from '../render/rider/idles'
import { addSceneLights, createLighting } from '../render/lighting'
import { DEFAULT_OUTFIT, readOutfit, SKI_MODELS } from '../ui/riderPanel'

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
for (const key of ['jacketStyle', 'pantsStyle', 'gloves', 'headwear', 'jacket', 'pants', 'helmet', 'skis', 'gaiter', 'model', 'jacketAccent', 'skiGraphic', 'skiAccent', 'backpack'] as const) {
  const value = params.get(key)
  if (!value) continue
  const word = ['jacketStyle', 'pantsStyle', 'gloves', 'headwear', 'model', 'skiGraphic'].includes(key)
  ;(outfit as unknown as Record<string, string | boolean>)[key] = key === 'backpack' ? value === 'true' : word ? value : `#${value}`
}
// `?pose=tuck,carve-left` shows only those poses (label slugs), for close-ups.
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const wanted = params.get('pose')?.split(',').map(slug)
const boarding = outfit.model === 'snowboard'
const boardLabels: Readonly<Record<string, string>> = { 'Carve left': 'Heel-side', 'Carve right': 'Toe-side', 'Hockey stop': 'Edge stop' }
const shown = LAB_POSES
  .filter(({ label }) => !boarding || !['Snowplough', 'Pushing', 'Skating'].includes(label))
  .filter(({ label }) => !wanted || wanted.includes(slug(label)) ||
    (boarding && boardLabels[label] && wanted.includes(slug(boardLabels[label]))))
  .map((pose) => boarding && boardLabels[pose.label] ? { ...pose, label: boardLabels[pose.label] } : pose)
if (params.has('sim')) runSim()
else runPoses()

/** The row of posed riders. */
function runPoses() {
  const spacing = 2.1
  const riders = shown.map((pose, i) => {
    const view = createSkierView()
    view.setColours(outfit)
    view.object.traverse((o) => (o.castShadow = true))
    scene.add(view.object)
    // `?snow` starts the rider as after a crash in powder (it fades as it would in game).
    if (params.has('snow')) {
      view.snow.crash = 1
      view.snow.side.set(0.3, 0.35, 1).normalize()
      view.snow.legAmount = 1
      view.snow.legHeight = 0.4
    }
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

  const resize = () => {
    renderer.setSize(innerWidth, innerHeight, false)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  const animate = params.has('anim')
  // `?idle=beer` plays that idle move on every stopped rider (see render/rider/idles.ts);
  // `idlet` is how many seconds into it a still shows (with `anim` it loops).
  const idleKind = params.get('idle') as IdleKind | null
  let time = 0
  const step = (dt: number) => {
    time += dt
    for (const { pose, view, state } of riders) {
      if (idleKind && view.idles.current === null) view.idles.play(idleKind)
      stepLabPose(pose, state, view, time, dt)
    }
  }
  // Let the smoothing settle so a screenshot shows the held pose.
  const settle = idleKind ? Math.round(Number(params.get('idlet') ?? 3) * 60) : 180
  for (let i = 0; i < settle; i++) step(1 / 60)
  const clip = params.has('clip') ? createClipView(riders) : null
  let last = performance.now()
  let frame = 0
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (animate) step(dt)
    if (clip && (animate || frame % 30 === 0)) clip()
    frame++
    controls.update()
    renderer.render(scene, camera)
  })

}

/**
 * `?clip`: red points where one body part's cloth cuts into another (or into
 * the snow), and the worst depth under each pose label. Same check as
 * tests/riderClipping.test.ts, limited to the garments this rider wears.
 */
function createClipView(riders: { view: ReturnType<typeof createSkierView>; state: { grounded: boolean; rail: unknown } }[]) {
  const material = new THREE.PointsMaterial({ color: 0xff1a1a, size: 0.025, depthTest: false })
  const dots = new THREE.Points(new THREE.BufferGeometry(), material)
  dots.renderOrder = 10
  scene.add(dots)
  const checks: (ClipCheck | null)[] = riders.map(() => null)
  const labels = [...document.querySelectorAll<HTMLSpanElement>('#labels span')]
  const names = labels.map((span) => span.textContent ?? '')
  return () => {
    const points: THREE.Vector3[] = []
    riders.forEach(({ view, state }, i) => {
      if (!view.skinned) return
      checks[i] ??= createClipCheck(view)
      const worn = new Set<string>()
      view.object.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.visible) worn.add(o.name)
      })
      const report = checks[i]!.measure({ garments: worn, groundY: state.grounded && !state.rail ? 0 : null, points: 4000 })
      points.push(...report.points)
      const worst = report.hits[0]
      if (labels[i]) labels[i].textContent = worst ? `${names[i]} · ${(worst.depth * 100).toFixed(1)} cm ${worst.from}→${worst.into}` : `${names[i]} · clean`
    })
    dots.geometry.dispose()
    dots.geometry = new THREE.BufferGeometry().setFromPoints(points)
  }
}

/** Linked turns on the real sim, seen from the follow camera. */
function runSim() {
  const pitch = Number(params.get('pitch') ?? 18)
  const period = Number(params.get('period') ?? 2.4)
  const action = params.get('action')
  const steerAmp = Number(params.get('amp') ?? 1)
  /** Seconds in one `action=tour` loop. */
  const TOUR = 29
  const env = { ski: SKI_MODELS[outfit.model] ?? SKI_MODELS.allMountain }
  const capKmh = Number(params.get('cap') ?? 45)
  const slope = createSteadySlope(pitch, { width: 4000, depth: 8000 })
  const height = (x: number, z: number) => slope.sampleTerrain(x, z)?.height ?? 0
  // A tilted checker plane so the motion reads.
  const tex = document.createElement('canvas')
  tex.width = tex.height = 64
  const g = tex.getContext('2d')!
  g.fillStyle = '#f4f7fa'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#dfe7ee'
  g.fillRect(0, 0, 32, 32)
  g.fillRect(32, 32, 32, 32)
  const map = new THREE.CanvasTexture(tex)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  // A patch of the slope that follows the rider in 10 m steps (one checker period). One
  // quad over the whole slope lost centimetres of depth precision a few kilometres from
  // the origin, enough to swallow a board lying flat on the snow.
  const PATCH = 600
  map.repeat.set(PATCH / 10, PATCH / 10)
  const plane = new THREE.PlaneGeometry(PATCH, PATCH, 1, 1)
  plane.rotateX(-Math.PI / 2)
  const pos = plane.attributes.position
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(2000 + pos.getX(i), 4000 + pos.getZ(i)) - height(2000, 4000))
  plane.computeVertexNormals()
  const followPatch = (x: number, z: number) => {
    const cx = Math.round(x / 10) * 10
    const cz = Math.round(z / 10) * 10
    snow.position.set(cx, height(cx, cz), cz)
  }
  snow.geometry.dispose()
  snow.geometry = plane
  snow.rotation.set(0, 0, 0)
  ;(snow.material as THREE.MeshStandardMaterial).map = map
  const view = createSkierView()
  view.setColours(outfit)
  view.object.traverse((o) => (o.castShadow = true))
  scene.add(view.object)
  const state = createSkiState({ x: 2000, z: 100, heading: 0 })
  state.y = height(2000, 100)
  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? 58), 1, 0.25, 3000)
  const rig = createCameraRig(camera, canvas)
  rig.setStyle(params.get('style') === 'tight' ? 'tight' : 'steady')
  rig.setFov(Number(params.get('fov') ?? 58))
  const note = document.querySelector('#note')!
  // `?cam=back|front|side` (and `dist` metres) swaps the follow camera for a close one.
  const closeCam = params.get('cam')
  const camDist = Number(params.get('dist') ?? 3.2)
  let time = 0
  let acc = 0
  const step = () => {
    time += 1 / 60
    const steer = time < 3 ? 0 : (Math.sin(((time - 3) * Math.PI * 2) / period) > 0 ? 1 : -1) * steerAmp
    const cycle = time % 5
    const jump = action === 'ollie' && cycle > 3.2 && cycle < 3.55
    const grab = action === 'ollie' && cycle >= 3.55 && cycle < 3.84
    let input: SkiInput = {
      steer: action === 'ollie' ? 0 : steer,
      brake: state.speed * 3.6 > capKmh ? 0.5 : 0,
      tuck: action === 'tuck',
      jump,
      grab,
      grabKind: grab ? 'mute' : undefined,
    }
    if (action === 'tour') {
      // One of everything, on a loop: turns, a tuck, a hockey stop held to a standstill,
      // a push off, an ollie with a grab, a hard landing-speed crash and the get-up.
      const t = time % TOUR
      const turn = (Math.sin((t * Math.PI * 2) / period) > 0 ? 1 : -1) * steerAmp
      const hop = t > 20.6 && t < 20.95
      const air = t >= 20.95 && t < 21.3
      input = {
        steer: t > 2 && t < 7.5 ? turn : t > 22.2 && t < 23.6 ? turn : 0,
        brake: t > 10.5 && t < 14 ? 1 : 0,
        tuck: (t > 7.8 && t < 10.3) || (t > 14.6 && t < 17.5),
        jump: hop,
        grab: air,
        grabKind: air ? 'mute' : undefined,
      }
      if (t > 24 && t - 1 / 60 <= 24 && state.crashed <= 0) beginCrash(state)
    }
    if (action === 'crash') {
      // A crash at speed every ten seconds: the tumble, the slide and the get-up.
      const t = time % 10
      input = { steer: t > 3.4 && t < 4 ? 1 : 0, brake: 0, tuck: false }
      if (t > 4 && t - 1 / 60 <= 4 && state.crashed <= 0) beginCrash(state)
    }
    for (acc += 1 / 60; acc >= FIXED_DT; acc -= FIXED_DT) stepSkier(state, input, slope.sampleTerrain, FIXED_DT, env)
    const ground = slope.sampleTerrain(state.x, state.z)
    view.update(state, input, ground, 'ski', 1 / 60)
    rig.update(state, slope.sampleTerrain, 1 / 60)
    if (closeCam) {
      // A close camera fixed to the travel direction, for judging the pose.
      const h = Math.hypot(state.vx, state.vz)
      const fx = h > 0.5 ? state.vx / h : -Math.sin(state.heading)
      const fz = h > 0.5 ? state.vz / h : Math.cos(state.heading)
      const [along, across] = closeCam === 'front' ? [1, 0] : closeCam === 'side' ? [0, 1] : [-1, 0]
      camera.position.set(state.x + (fx * along - fz * across) * camDist, state.y + 1.1, state.z + (fz * along + fx * across) * camDist)
      camera.lookAt(state.x, state.y + 0.75, state.z)
    }
    followPatch(state.x, state.z)
    sun.position.set(state.x, state.y, state.z).addScaledVector(lighting.sunDirection, 40)
    sun.target.position.set(state.x, state.y, state.z)
    sun.target.updateMatrixWorld()
    const phase = state.air ? (input.grab && state.air.grab ? 'grab' : 'air') : state.popCharge > 0 ? 'loading pop' : input.tuck ? 'tuck' : 'ground'
    note.textContent = `${phase} · t ${time.toFixed(2)} · ${(state.speed * 3.6).toFixed(0)} km/h · steer ${input.steer > 0 ? 'R' : input.steer < 0 ? 'L' : '-'} · edge ${((state.edgeAngle * 180) / Math.PI).toFixed(0)}° · skid ${state.skid.toFixed(2)}`
  }
  const resizeSim = () => {
    renderer.setSize(innerWidth, innerHeight, false)
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resizeSim)
  resizeSim()
  ;(window as unknown as { __step: (n: number) => void }).__step = (n: number) => {
    for (let i = 0; i < n; i++) step()
    renderer.render(scene, camera)
  }
  if (!params.has('paused')) renderer.setAnimationLoop(() => {
    step()
    renderer.render(scene, camera)
  })
}
