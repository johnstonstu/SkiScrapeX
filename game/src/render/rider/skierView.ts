import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PHYSICS, fallLineHeading, skiFrame, type SkiInput, type SkiState, type SurfaceSample } from '../../sim'

/** `ski` follows the sim; `sit` is on a chair; `stand` is upright on a surface lift. */
export type SkierPose = 'ski' | 'sit' | 'stand'

export interface RiderLook {
  jacket: string
  pants: string
  helmet: string
  skis: string
  model?: string
  /** Baggy freeride kit or a slimmer race fit. */
  fit?: 'baggy' | 'slim'
  headwear?: 'helmet' | 'beanie'
  /** Neck gaiter / face buff colour. */
  gaiter?: string
  /** Jacket yoke and hem colour; a darker jacket shade when unset. */
  jacketAccent?: string
  skiGraphic?: SkiGraphic
  skiAccent?: string
  backpack?: boolean
}

export type SkiGraphic = 'solid' | 'stripes' | 'chevron' | 'camo' | 'fade' | 'checker' | 'topo' | 'nugget'
/** The last two are rewards (see app/progress.ts UNLOCKS). */
export const SKI_GRAPHICS: SkiGraphic[] = ['solid', 'stripes', 'chevron', 'camo', 'fade', 'checker', 'topo', 'nugget']

/** Top-sheet pattern, painted along the ski (v = tail to tip) on a canvas. */
function skiGraphicTexture(graphic: SkiGraphic, base: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 512
  const g = canvas.getContext('2d')!
  g.fillStyle = base
  g.fillRect(0, 0, 64, 512)
  g.fillStyle = accent
  switch (graphic) {
    case 'stripes':
      for (let y = 40; y < 512; y += 70) g.fillRect(0, y, 64, 18)
      g.fillRect(26, 0, 12, 512)
      break
    case 'chevron':
      for (let y = 30; y < 512; y += 60) {
        g.beginPath()
        g.moveTo(0, y + 26); g.lineTo(32, y); g.lineTo(64, y + 26); g.lineTo(64, y + 40); g.lineTo(32, y + 14); g.lineTo(0, y + 40)
        g.fill()
      }
      break
    case 'camo': {
      let seed = 11
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 46; i++) {
        g.globalAlpha = 0.55 + rnd() * 0.45
        g.beginPath()
        g.ellipse(rnd() * 64, rnd() * 512, 6 + rnd() * 16, 10 + rnd() * 30, rnd() * 3, 0, Math.PI * 2)
        g.fill()
      }
      g.globalAlpha = 1
      break
    }
    case 'fade': {
      const grad = g.createLinearGradient(0, 0, 0, 512)
      grad.addColorStop(0, base)
      grad.addColorStop(1, accent)
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 512)
      break
    }
    case 'checker':
      for (let y = 0; y < 512; y += 32) for (let x = (y / 32) % 2 ? 0 : 32; x < 64; x += 64) g.fillRect(x, y, 32, 32)
      break
    case 'topo': {
      // Contour lines of a made-up hill.
      g.strokeStyle = accent
      g.lineWidth = 2.5
      for (let r = 14; r < 420; r += 22) {
        g.beginPath()
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
          const wobble = 1 + 0.18 * Math.sin(a * 3 + r * 0.05) + 0.08 * Math.sin(a * 7 - r * 0.11)
          const x = 32 + Math.cos(a) * r * 0.35 * wobble
          const y = 300 + Math.sin(a) * r * wobble
          if (a === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
      break
    }
    case 'nugget': {
      // Gold flecks over the base, denser toward the tip.
      let seed = 1851
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 260; i++) {
        const cx = rnd() * 64
        const cy = 512 * Math.sqrt(rnd())
        const size = 1.5 + rnd() * 3.5
        g.fillStyle = i % 3 ? '#f0bf3a' : '#ffe58a'
        g.beginPath()
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2
          const r = size * (0.6 + rnd() * 0.6)
          if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
          else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        }
        g.fill()
      }
      break
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/**
 * Stylised freeskier in metres, built from lathe-turned tapered parts.
 *
 * Hierarchy: root (on the snow, ski frame: +X left, +Y up, +Z forward) holds
 * the skis and `body`, a pivot at the snow that tilts into the turn by the
 * inclination the carve needs. body → hips → legs (two-bone IK to the boots)
 * and torso (forward bend, angulation, counter-rotation) → head and arms (IK
 * to hand targets). Poles aim from the hand at a tip target.
 */
export function createSkierView(): {
  object: THREE.Group
  update: (state: SkiState, input: SkiInput, ground: SurfaceSample | null, pose?: SkierPose, dt?: number) => void
  /** Point between the eyes, for the first-person camera. */
  eye: THREE.Object3D
  /** Hide the head and torso so a first-person camera sees only hands, poles and skis. */
  setFirstPerson: (on: boolean) => void
  setColours: (look: RiderLook) => void
} {
  const root = new THREE.Group()
  const m = (color: number | string, roughness = 0.75, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
  const mat = {
    skiBase: m(0x1d2a36, 0.35, 0.2),
    skiTop: m(0xffc21a, 0.4),
    skiEdge: m(0x9aa3ad, 0.25, 0.9),
    jacket: m(0xd42a2f, 0.82),
    jacketPanel: m(0x8f1c20, 0.85),
    trim: m(0x1b1f24, 0.7),
    pants: m(0x27313f, 0.9),
    pantsPatch: m(0x1a212b, 0.9),
    skin: m(0xe2b08a, 0.7),
    helmet: m(0xf2f5f8, 0.3, 0.05),
    lens: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.12, metalness: 0.15, emissive: 0x6a2a00 }),
    frame: m(0x15181c, 0.6),
    gaiter: m(0x59606b, 0.95),
    glove: m(0x15181c, 0.8),
    boot: m(0xeceff2, 0.35),
    buckle: m(0x9aa3ad, 0.3, 0.8),
    pole: m(0xb9c2cb, 0.3, 0.8),
  }

  /** A limb turned on a lathe, hanging down -Y from its joint: radius r0 at the top to r1 at the bottom. */
  const limb = (r0: number, r1: number, length: number, material: THREE.Material, bulge = 0, flare = 0) => {
    const points: THREE.Vector2[] = []
    const steps = 10
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      let r = r0 + (r1 - r0) * t + bulge * Math.sin(Math.PI * t) + flare * Math.max(0, (t - 0.75) / 0.25) ** 2
      // Round the ends.
      if (i === 0 || i === steps) r *= 0.82
      points.push(new THREE.Vector2(r, -t * length))
    }
    points.unshift(new THREE.Vector2(0.001, r0 * 0.4))
    points.push(new THREE.Vector2(0.001, -length - r1 * 0.35))
    points.reverse()
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(points, 14), material)
    return mesh
  }
  const rounded = (w: number, h: number, d: number, r: number, material: THREE.Material) =>
    new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material)
  const sphere = (r: number, material: THREE.Material, w = 16, h = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), material)

  // ---- Skis -----------------------------------------------------------------
  const blades: THREE.Group[] = []
  const makeSki = () => {
    const ski = new THREE.Group()
    const sections = [
      [-0.87, 0.032, 0.065], [-0.82, 0.057, 0.035], [-0.66, 0.059, 0.010],
      [-0.32, 0.052, 0.011], [0.04, 0.046, 0.016], [0.37, 0.052, 0.010],
      [0.66, 0.064, 0.010], [0.80, 0.067, 0.028], [0.90, 0.056, 0.074], [0.96, 0.025, 0.108],
    ]
    const vertices: number[] = []
    const indices: number[] = []
    const uvs: number[] = []
    for (const [z, halfWidth, y] of sections) {
      vertices.push(-halfWidth, y, z, halfWidth, y, z, -halfWidth, y - 0.018, z, halfWidth, y - 0.018, z)
      const v = (z + 0.87) / 1.83
      uvs.push(0, v, 1, v, 0, v, 1, v)
    }
    const geometry = new THREE.BufferGeometry()
    for (let i = 0; i < sections.length - 1; i++) {
      const a = i * 4, b = a + 4
      indices.push(a, b, b + 1, a, b + 1, a + 1)
    }
    geometry.addGroup(0, 6, 1)
    geometry.addGroup(6, indices.length - 12, 0)
    geometry.addGroup(indices.length - 6, 6, 1)
    const edges = indices.length
    for (let i = 0; i < sections.length - 1; i++) {
      const a = i * 4, b = a + 4
      indices.push(a, a + 2, b, b, a + 2, b + 2, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3, a + 2, a + 3, b + 3, a + 2, b + 3, b + 2)
    }
    const end = vertices.length / 3 - 4
    indices.push(0, 1, 3, 0, 3, 2, end, end + 3, end + 1, end, end + 2, end + 3)
    geometry.addGroup(edges, indices.length - edges, 2)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const blade = new THREE.Group()
    blade.add(new THREE.Mesh(geometry, [mat.skiTop, mat.skiBase, mat.skiEdge]))
    const binding = rounded(0.09, 0.04, 0.36, 0.01, mat.trim)
    binding.position.set(0, 0.03, 0.02)
    const heel = rounded(0.085, 0.07, 0.07, 0.018, mat.skiBase)
    heel.position.set(0, 0.06, -0.15)
    const toe = rounded(0.095, 0.05, 0.08, 0.018, mat.buckle)
    toe.position.set(0, 0.05, 0.19)
    // Boot shell: sole, toe box and a cuff that the pants cover.
    const sole = rounded(0.115, 0.05, 0.32, 0.02, mat.trim)
    sole.position.set(0, 0.075, 0.02)
    const shell = rounded(0.118, 0.13, 0.27, 0.045, mat.boot)
    shell.position.set(0, 0.15, 0.04)
    const cuff = rounded(0.12, 0.11, 0.14, 0.04, mat.boot)
    cuff.position.set(0, 0.24, -0.03)
    cuff.rotation.x = -0.25
    ski.add(blade, binding, heel, toe, sole, shell, cuff)
    for (const [y, z] of [[0.19, 0.13]]) {
      const clip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.014, 0.035), mat.buckle)
      clip.position.set(0, y, z)
      ski.add(clip)
    }
    blades.push(blade)
    return ski
  }
  const skis = [makeSki(), makeSki()] // 0 left (+X), 1 right
  root.add(...skis)

  // ---- Body -----------------------------------------------------------------
  const body = new THREE.Group()
  root.add(body)
  const hips = new THREE.Group()
  body.add(hips)
  const pelvis = rounded(0.36, 0.22, 0.26, 0.09, mat.pants)
  pelvis.position.y = -0.02
  hips.add(pelvis)

  const thighLength = 0.43
  const shinLength = 0.42
  const ankleInSki = new THREE.Vector3(0, 0.2, -0.01)
  const legs = skis.map((ski, index) => {
    const side = index === 0 ? 1 : -1
    const thigh = new THREE.Group()
    thigh.position.set(side * 0.11, -0.06, 0)
    const upper = limb(0.1, 0.088, thighLength, mat.pants, 0.012)
    const knee = new THREE.Group()
    knee.position.y = -thighLength
    const patch = sphere(0.075, mat.pantsPatch, 10, 8)
    patch.position.set(0, 0.01, 0.04)
    patch.scale.set(1.05, 1.1, 0.6)
    // Pants run over the boot cuff and flare at the hem.
    const shin = limb(0.088, 0.104, shinLength + 0.01, mat.pants, 0.006, 0.026)
    knee.add(patch, shin)
    thigh.add(upper, knee)
    hips.add(thigh)
    return { ski, thigh, knee, upper, shin, side }
  })

  const torso = new THREE.Group()
  torso.position.y = 0.07
  hips.add(torso)
  // Long, loose shell: hem below the hips, roomy chest, dropped shoulders.
  const shellProfile = (baggy: boolean) => {
    const k = baggy ? 1.06 : 0.94
    const hem = baggy ? -0.2 : -0.08
    return [
      new THREE.Vector2(0.001, hem - 0.01), new THREE.Vector2(0.2 * k, hem), new THREE.Vector2(0.215 * k, hem + 0.06),
      new THREE.Vector2(0.205 * k, 0.12), new THREE.Vector2(0.21 * k, 0.3), new THREE.Vector2(0.225 * k, 0.42),
      new THREE.Vector2(0.2 * k, 0.5), new THREE.Vector2(0.12, 0.56), new THREE.Vector2(0.09, 0.6), new THREE.Vector2(0.001, 0.6),
    ]
  }
  const jacketShell = new THREE.Mesh(new THREE.LatheGeometry(shellProfile(true), 18), mat.jacket)
  jacketShell.scale.z = 0.72
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.22, 0.14, 18, 1, true), mat.jacketPanel)
  yoke.scale.z = 0.735
  yoke.position.y = 0.42
  const hemBand = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.215, 0.05, 18, 1, true), mat.jacketPanel)
  hemBand.scale.z = 0.735
  hemBand.position.y = -0.17
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.66, 0.012), mat.trim)
  zip.position.set(0, 0.2, 0.158)
  const pocket = rounded(0.12, 0.1, 0.02, 0.01, mat.jacketPanel)
  pocket.position.set(0.09, 0.3, 0.15)
  pocket.rotation.y = 0.25
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.055, 8, 16, Math.PI * 1.2), mat.jacket)
  hood.position.set(0, 0.56, -0.07)
  hood.rotation.set(Math.PI / 2 + 0.5, 0, Math.PI * 0.4 + Math.PI)
  torso.add(jacketShell, yoke, hemBand, zip, pocket, hood)
  // Small freeride pack: body, lid, straps over the shoulders.
  const backpack = new THREE.Group()
  const packBody = rounded(0.28, 0.4, 0.14, 0.05, mat.trim)
  packBody.position.set(0, 0.28, -0.2)
  const packLid = rounded(0.26, 0.1, 0.15, 0.04, mat.jacketPanel)
  packLid.position.set(0, 0.48, -0.2)
  backpack.add(packBody, packLid)
  for (const sx of [-0.11, 0.11]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.02), mat.trim)
    strap.position.set(sx, 0.33, 0.15)
    backpack.add(strap)
  }
  backpack.visible = false
  torso.add(backpack)

  const head = new THREE.Group()
  head.position.y = 0.62
  torso.add(head)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 12), mat.gaiter)
  neck.position.y = 0.02
  const skull = sphere(0.105, mat.skin)
  skull.position.y = 0.13
  skull.scale.set(0.95, 1.05, 1)
  const buff = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), mat.gaiter)
  buff.position.y = 0.135
  buff.scale.set(1.02, 1.15, 1.06)
  const helmet = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.138, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), mat.helmet)
  dome.scale.set(1, 0.95, 1.12)
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.012, 6, 24, Math.PI * 0.9), mat.helmet)
  brim.rotation.set(Math.PI / 2, 0, Math.PI * 0.05)
  brim.position.set(0, 0.012, 0.01)
  brim.scale.set(1, 1.18, 1)
  const ears = [1, -1].map((s) => {
    const ear = sphere(0.05, mat.frame, 10, 8)
    ear.position.set(s * 0.12, -0.03, -0.005)
    ear.scale.set(0.45, 1, 1)
    return ear
  })
  helmet.add(dome, brim, ...ears)
  helmet.position.y = 0.155
  const beanie = new THREE.Group()
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat.helmet)
  cap.scale.set(1, 1.15, 1.05)
  const cuffBand = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.122, 0.05, 18, 1, true), mat.helmet)
  cuffBand.position.y = 0.005
  const pom = sphere(0.045, mat.jacketPanel, 10, 8)
  pom.position.y = 0.14
  beanie.add(cap, cuffBand, pom)
  beanie.position.y = 0.155
  beanie.visible = false
  // Big frameless goggles and strap.
  const goggles = new THREE.Group()
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 8, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.36, Math.PI * 0.26), mat.lens)
  lens.scale.set(1, 1, 0.92)
  const gFrame = new THREE.Mesh(new THREE.SphereGeometry(0.146, 20, 8, Math.PI / 2 - 1.0, 2.0, Math.PI * 0.345, Math.PI * 0.31), mat.frame)
  gFrame.scale.set(1, 1, 0.9)
  const gStrap = new THREE.Mesh(new THREE.TorusGeometry(0.143, 0.014, 6, 28), mat.frame)
  gStrap.rotation.x = Math.PI / 2
  gStrap.scale.set(1, 1.12, 1)
  goggles.add(gFrame, lens, gStrap)
  goggles.position.y = 0.17
  head.add(neck, skull, buff, helmet, beanie, goggles)
  const eye = new THREE.Object3D()
  eye.position.set(0, 0.16, 0.14)
  head.add(eye)
  const hideInFirstPerson: THREE.Object3D[] = [backpack, jacketShell, yoke, hemBand, zip, pocket, hood, neck, skull, buff, helmet, beanie, goggles]

  const upperArm = 0.29
  const foreArm = 0.27
  const arms = [1, -1].map((side) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 0.22, 0.47, -0.01)
    const sleeve = limb(0.078, 0.066, upperArm, mat.jacket, 0.01)
    const elbow = new THREE.Group()
    elbow.position.y = -upperArm
    const fore = limb(0.066, 0.064, foreArm - 0.06, mat.jacket, 0.006, 0.012)
    const hand = new THREE.Group()
    hand.position.y = -foreArm
    const mitt = rounded(0.085, 0.11, 0.095, 0.038, mat.glove)
    mitt.position.y = -0.03
    const thumb = limb(0.022, 0.02, 0.045, mat.glove)
    thumb.position.set(-side * 0.04, -0.005, 0.035)
    thumb.rotation.z = -side * 0.7
    const pole = new THREE.Group()
    pole.position.y = -0.04
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 1.12, 6), mat.pole)
    shaft.position.y = -0.52
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.016, 0.15, 8), mat.trim)
    grip.position.y = 0.02
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 10), mat.trim)
    basket.position.y = -1.0
    pole.add(shaft, grip, basket)
    hand.add(mitt, thumb, pole)
    elbow.add(fore, hand)
    shoulder.add(sleeve, elbow)
    torso.add(shoulder)
    return { side, shoulder, elbow, hand, pole }
  })

  // ---- Working state --------------------------------------------------------
  const down = new THREE.Vector3(0, -1, 0)
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const v3 = new THREE.Vector3()
  const hint = new THREE.Vector3()
  const qInv = new THREE.Quaternion()
  const basis = new THREE.Matrix4()
  const ax = new THREE.Vector3()
  const ay = new THREE.Vector3()
  const az = new THREE.Vector3()
  const qBase = new THREE.Quaternion()
  const qFlip = new THREE.Quaternion()
  const xAxis = new THREE.Vector3(1, 0, 0)
  const centre = new THREE.Vector3(0, 0.9, 0)
  const offsetA = new THREE.Vector3()
  const offsetB = new THREE.Vector3()

  let firstPerson = false
  let incline = 0
  let crouch = 0.3
  let counter = 0
  let grabBlend = 0
  let lastGrab: string | null = null
  let tuckBlend = 0
  let brakeBlend = 0
  let airBlend = 0
  let wasAir = false
  let land = 0
  let plant = 0
  let plantSide = 1
  let lastEdgeSign = 0
  let ridePhase = 0
  let switchLook = 0
  let spinLead = 0
  let railBlend = 0
  let wasRail = false
  let railEntry = 0
  let entryTurn = 0
  let lastHeading = 0
  let railLook = 0
  const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)

  /**
   * Two-bone IK. `target` is in the parent space of `upper`. Bones hang
   * down -Y at rest; `bendHint` (same space) is where the middle joint points.
   */
  const solve = (upper: THREE.Object3D, lower: THREE.Object3D, target: THREE.Vector3, l1: number, l2: number, bendHint: THREE.Vector3) => {
    const to = v1.copy(target).sub(upper.position)
    const d = THREE.MathUtils.clamp(to.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    const dir = to.normalize()
    const bend = hint.copy(bendHint).addScaledVector(dir, -bendHint.dot(dir))
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1)
    bend.normalize()
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
    const mid = v2.copy(dir).multiplyScalar(a).addScaledVector(bend, h)
    upper.quaternion.setFromUnitVectors(down, v3.copy(mid).normalize())
    const rest = v3.copy(dir).multiplyScalar(d).sub(mid)
    qInv.copy(upper.quaternion).invert()
    lower.quaternion.setFromUnitVectors(down, rest.applyQuaternion(qInv).normalize())
  }

  /** Root-space point to the local space of `object` (root's matrices must be current). */
  const rootToLocal = (object: THREE.Object3D, point: THREE.Vector3, out: THREE.Vector3) =>
    object.worldToLocal(root.localToWorld(out.copy(point)))

  const ankle = new THREE.Vector3()
  const kneeHint = new THREE.Vector3()
  const hipsInverse = new THREE.Matrix4()
  const fitLegs = () => {
    root.updateMatrixWorld(true)
    hipsInverse.copy(hips.matrixWorld).invert()
    for (const leg of legs) {
      ankle.copy(ankleInSki).applyQuaternion(leg.ski.quaternion).add(leg.ski.position)
      rootToLocal(hips, ankle, ankle)
      // Knees point over the ski tips.
      kneeHint.set(0, 0, 1).applyQuaternion(leg.ski.quaternion).transformDirection(root.matrixWorld).transformDirection(hipsInverse)
      solve(leg.thigh, leg.knee, ankle, thighLength, shinLength, kneeHint)
    }
  }

  const handTarget = new THREE.Vector3()
  const elbowHint = new THREE.Vector3()
  const tip = new THREE.Vector3()
  const handWorld = new THREE.Vector3()
  /** Hand target in torso space (or root space when `inRoot`), pole tip in root space. */
  const placeArm = (index: number, hand: THREE.Vector3, poleTip: THREE.Vector3, inRoot = false) => {
    const arm = arms[index]
    if (inRoot) {
      root.updateMatrixWorld(true)
      rootToLocal(torso, hand, handTarget)
    } else handTarget.copy(hand)
    // Elbows point back and out.
    elbowHint.set(arm.side * 0.6, -0.2, -1)
    solve(arm.shoulder, arm.elbow, handTarget, upperArm, foreArm, elbowHint)
    arm.hand.quaternion.identity()
    // Pole: from the grip toward the tip target.
    root.updateMatrixWorld(true)
    arm.hand.getWorldPosition(handWorld)
    root.localToWorld(tip.copy(poleTip))
    tip.sub(handWorld)
    if (tip.lengthSq() < 1e-6) tip.set(0, -1, 0)
    arm.hand.getWorldQuaternion(qInv).invert()
    arm.pole.quaternion.setFromUnitVectors(down, tip.applyQuaternion(qInv).normalize())
  }

  return {
    object: root,
    eye,
    setFirstPerson(on) {
      firstPerson = on
      for (const part of hideInFirstPerson) part.visible = !on
      if (!on) {
        backpack.visible = Boolean(backpack.userData.on)
        helmet.visible = !beanie.userData.on
        beanie.visible = Boolean(beanie.userData.on)
      }
    },
    setColours(look) {
      mat.jacket.color.set(look.jacket)
      if (look.jacketAccent) mat.jacketPanel.color.set(look.jacketAccent)
      else mat.jacketPanel.color.copy(mat.jacket.color).multiplyScalar(0.6)
      backpack.userData.on = Boolean(look.backpack)
      backpack.visible = !firstPerson && backpack.userData.on
      mat.pants.color.set(look.pants)
      mat.pantsPatch.color.copy(mat.pants.color).multiplyScalar(0.72)
      mat.helmet.color.set(look.helmet)
      const graphic = look.skiGraphic ?? 'solid'
      mat.skiTop.map?.dispose()
      if (graphic === 'solid') {
        mat.skiTop.map = null
        mat.skiTop.color.set(look.skis)
      } else {
        mat.skiTop.map = skiGraphicTexture(graphic, look.skis, look.skiAccent ?? '#1b1f24')
        mat.skiTop.color.set(0xffffff)
      }
      mat.skiTop.needsUpdate = true
      mat.gaiter.color.set(look.gaiter ?? '#59606b')
      const baggy = (look.fit ?? 'baggy') === 'baggy'
      jacketShell.geometry.dispose()
      jacketShell.geometry = new THREE.LatheGeometry(shellProfile(baggy), 18)
      hemBand.position.y = baggy ? -0.17 : -0.05
      for (const leg of legs) {
        const k = baggy ? 1.12 : 0.9
        leg.upper.scale.set(k, 1, k)
        leg.shin.scale.set(k, 1, k)
      }
      for (const arm of arms) arm.shoulder.children[0].scale.set(baggy ? 1.1 : 0.92, 1, baggy ? 1.1 : 0.92)
      beanie.userData.on = look.headwear === 'beanie'
      beanie.visible = !firstPerson && beanie.userData.on
      helmet.visible = !firstPerson && !beanie.userData.on
      // Beanie riders still wear goggles; the strap sits on the knit.
      for (const blade of blades) {
        const width = look.model === 'powder' ? 1.26 : look.model === 'park' ? 1.06 : 1
        blade.scale.set(width, 1, look.model === 'park' ? 0.94 : 1)
      }
    },
    update(state, input, ground, pose = 'ski', dt = 1 / 60) {
      const up = ground && pose === 'ski' ? ground.normal : { x: 0, y: 1, z: 0 }
      const frame = skiFrame(state.heading, up)
      basis.makeBasis(
        ax.set(-frame.side.x, -frame.side.y, -frame.side.z),
        ay.set(frame.up.x, frame.up.y, frame.up.z),
        az.set(frame.forward.x, frame.forward.y, frame.forward.z),
      )
      qBase.setFromRotationMatrix(basis)
      root.quaternion.copy(qBase)
      root.position.set(state.x, state.y - (pose === 'ski' ? state.sink * 0.85 : 0), state.z)
      const air = pose === 'ski' ? state.air : null
      // Rail entry: a short pop while the skis swing from the approach line to the rail.
      const onRail = pose === 'ski' && Boolean(state.rail)
      if (onRail && !wasRail) {
        railEntry = 1
        entryTurn = Math.atan2(Math.sin(lastHeading - state.heading), Math.cos(lastHeading - state.heading))
      }
      wasRail = onRail
      lastHeading = state.heading
      railEntry = Math.max(0, railEntry - dt / 0.2)
      if (railEntry > 0) {
        qFlip.setFromAxisAngle(ay.set(0, 1, 0), entryTurn * railEntry * railEntry)
        root.quaternion.multiply(qFlip)
        root.position.y += Math.sin(railEntry * Math.PI) * 0.28
      }
      // A cork tilts the spin axis: pitch the body as it spins and it corkscrews.
      const tilt = air ? air.flip + air.cork * 1.05 : 0
      if (air && Math.abs(tilt) > 1e-3) {
        qFlip.setFromAxisAngle(xAxis, tilt)
        root.quaternion.multiply(qFlip)
        offsetA.copy(centre).applyQuaternion(qBase)
        offsetB.copy(centre).applyQuaternion(root.quaternion)
        root.position.add(offsetA).sub(offsetB)
      }
      for (const ski of skis) ski.rotation.set(0, 0, 0)
      body.rotation.set(0, 0, 0)
      torso.rotation.set(0, 0, 0)
      head.rotation.set(0, 0, 0)

      if (pose === 'sit') {
        ridePhase += dt * 1.55
        const swing = Math.sin(ridePhase) * 0.045
        hips.position.set(0, 0.5, 0)
        hips.rotation.set(0, 0, 0)
        torso.rotation.x = -0.12
        skis[0].position.set(0.14, -0.16, 0.44 + swing)
        skis[1].position.set(-0.14, -0.16, 0.44 - swing)
        skis[0].rotation.x = -0.07 - swing
        skis[1].rotation.x = -0.07 + swing
        fitLegs()
        placeArm(0, v1.set(0.2, 0.05, 0.32).clone(), new THREE.Vector3(0.3, 0.2, 1.2))
        placeArm(1, v1.set(-0.2, 0.05, 0.32).clone(), new THREE.Vector3(-0.3, 0.2, 1.2))
        return
      }
      if (pose === 'ski' && state.crashed > 0) {
        hips.position.set(0, 0.22, 0)
        hips.rotation.set(0, 0, 1.35)
        torso.rotation.x = 0.4
        skis[0].position.set(0.55, 0.04, 0.18)
        skis[1].position.set(0.48, 0.04, -0.13)
        skis[0].rotation.set(0, 0.4, 0.85)
        skis[1].rotation.set(0, -0.3, 0.55)
        fitLegs()
        placeArm(0, new THREE.Vector3(0.45, 0.25, 0.1), new THREE.Vector3(0.9, 0, 0.6))
        placeArm(1, new THREE.Vector3(-0.35, 0.35, 0.3), new THREE.Vector3(-0.2, 0, 1.2))
        return
      }

      // ---- Read the sim ----
      const skiing = pose === 'ski' && state.grounded && !state.rail && !air
      const stance = state.ridingSwitch ? -1 : 1
      const speed = state.speed
      const tucked = skiing && input.tuck && speed >= PHYSICS.skateMaxSpeed
      const braking = skiing && input.brake > 0.2 && speed > 1
      const charging = skiing && state.popCharge > 0
      const edge = skiing ? state.edgeAngle * stance : 0
      // Inclination the carve needs: tan(lean) = lateral g (ski-coach balance).
      const lateralG = skiing && Number.isFinite(state.carveRadius) ? Math.sqrt(Math.max(0, state.carveLoad ** 2 - 1)) : 0
      // Scaled and capped: full race inclination reads as falling at game camera distances.
      const wantIncline = skiing ? Math.sign(edge) * Math.min(0.72, Math.max(Math.atan(lateralG) * 0.72, Math.abs(edge) * 0.35)) : 0
      incline += (wantIncline - incline) * ease(8, dt)

      // Pole plant on each edge change: the new turn's inside hand.
      const edgeSign = Math.abs(edge) > 0.12 ? Math.sign(edge) : 0
      if (skiing && edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign && speed > 3) {
        plant = 1
        plantSide = edgeSign > 0 ? -1 : 1 // right turn: right hand (index 1, side -1)
      }
      if (edgeSign !== 0) lastEdgeSign = edgeSign
      plant = Math.max(0, plant - dt / 0.42)

      // Landing absorb.
      if (wasAir && !air && pose === 'ski') land = Math.min(1, 0.45 + Math.abs(state.vy) * 0.06)
      wasAir = Boolean(air)
      land = Math.max(0, land - dt / 0.4)

      const grabbing = Boolean(air?.grab)
      if (air?.grab) lastGrab = air.grab
      grabBlend += ((grabbing ? 1 : 0) - grabBlend) * ease(14, dt)
      tuckBlend += ((tucked ? 1 : 0) - tuckBlend) * ease(7, dt)
      brakeBlend += ((braking ? 1 : 0) - brakeBlend) * ease(9, dt)
      airBlend += ((air ? 1 : 0) - airBlend) * ease(10, dt)
      spinLead += ((air ? Math.max(-1, Math.min(1, air.spinRate / 8)) : 0) - spinLead) * ease(6, dt)
      switchLook += ((state.ridingSwitch && skiing ? 1 : 0) - switchLook) * ease(4, dt)
      const rail = pose === 'ski' ? state.rail : null
      railBlend += ((rail ? 1 : 0) - railBlend) * ease(12, dt)
      // On a slide the skis are across the rail: look down it, the way you are going.
      const wantLook = rail && rail.style === 'slide' ? -Math.sign(rail.vs || 1) * Math.sign(Math.sin(rail.headingOffset) || 1) * 1.1 : 0
      railLook += (wantLook - railLook) * ease(8, dt)

      // Counter-rotation: the upper body keeps facing down the fall line.
      let wantCounter = 0
      if (skiing && ground && speed > 1.5) {
        const fall = fallLineHeading(ground.normal)
        if (fall !== null) {
          const off = Math.atan2(Math.sin(state.heading - fall), Math.cos(state.heading - fall))
          wantCounter = Math.max(-1.1, Math.min(1.1, off * (braking ? 0.7 : 0.4)))
        }
      }
      counter += (wantCounter - counter) * ease(6, dt)

      // Athletic base flex, plus terrain absorption, edging, tuck and pop.
      const pumping = skiing && input.tuck && !tucked ? Math.sin(state.time * 6.2) : 0
      let wantCrouch = pose === 'stand' ? 0.12 : speed < 0.5 && skiing ? 0.22 : 0.34
      wantCrouch += Math.abs(incline) * 0.32 + (skiing ? Math.min(0.2, state.sink * 0.5) : 0)
      wantCrouch = Math.max(wantCrouch, tuckBlend * 1, brakeBlend * 0.55, charging ? 0.45 + state.popCharge * 0.45 : 0)
      wantCrouch = Math.max(wantCrouch, airBlend * (0.42 + grabBlend * 0.45), land, railBlend * 0.42)
      crouch += (Math.min(1.05, wantCrouch) - crouch) * ease(12, dt)

      // ---- Skis ----
      const halfStance = 0.13 + brakeBlend * 0.03 - railBlend * 0.04
      const lead = incline * 0.12 + pumping * 0.06
      // Skis drift under the outside of the turn so the body can incline.
      const shift = -Math.sin(incline) * 0.32
      skis[0].position.set(halfStance + shift + Math.max(0, pumping) * 0.05, 0.03, 0.04 - lead)
      skis[1].position.set(-halfStance + shift - Math.max(0, -pumping) * 0.05, 0.03, 0.04 + lead)
      const edgeVisual = pose === 'ski' && !air ? edge * 0.9 : 0
      for (const ski of skis) ski.rotation.z = edgeVisual
      if (air) {
        // Legs come up under the body; grabs pull them further.
        const lift = 0.18 + grabBlend * 0.22
        for (const ski of skis) {
          ski.position.y += lift
          ski.position.z += 0.05
        }
        const g = grabBlend
        switch (lastGrab) {
          case 'mute':
            skis[0].rotation.y = 0.18 * g
            skis[1].rotation.y = 0.18 * g
            break
          case 'japan':
            for (const ski of skis) ski.rotation.set(0.4 * g, 0.3 * g, 0)
            skis[0].position.z -= 0.2 * g
            skis[1].position.z -= 0.2 * g
            break
          case 'nose':
            for (const ski of skis) ski.rotation.x = -0.45 * g
            break
          case 'tail':
            for (const ski of skis) ski.rotation.x = 0.4 * g
            break
          case 'safety':
          case 'critical':
            skis[1].rotation.z = -0.2 * g
            break
          case 'truck':
            for (const ski of skis) ski.rotation.x = -0.25 * g
            skis[0].position.x += 0.06 * g
            skis[1].position.x -= 0.06 * g
            break
        }
      }

      // ---- Body ----
      // On a rail the body sways with the sim's balance.
      body.rotation.z = incline + (rail ? rail.balance * 0.32 : 0)
      const kneeFold = 0.15 + crouch * 1.25
      const hipHeight = 0.97 - (thighLength + shinLength) * (1 - Math.cos(kneeFold * 0.55)) * 1.05 - crouch * 0.06
      hips.position.set(0, Math.max(0.42, hipHeight), -0.05 - crouch * 0.1)
      hips.rotation.set(0, counter * 0.35, 0)
      // Torso folds over the knees; angulation brings the shoulders back toward level.
      torso.rotation.order = 'YXZ'
      torso.rotation.x = 0.12 + crouch * 0.72 + tuckBlend * 0.25
      torso.rotation.z = -incline * 0.55
      torso.rotation.y = counter * 0.65 + spinLead * 0.5 + switchLook * 0.25 + railLook * 0.55
      // Head stays level and looks where the skier is going.
      head.rotation.order = 'YXZ'
      head.rotation.x = -torso.rotation.x * 0.75
      head.rotation.z = -(incline + torso.rotation.z) * 0.6
      head.rotation.y = -counter * 0.3 + spinLead * 0.4 + switchLook * stance * 1.15 * (state.heading > 0 ? 1 : -1) + railLook * 0.4

      fitLegs()

      // ---- Arms ----
      const breathe = speed < 0.5 && skiing ? Math.sin(state.time * 1.6) * 0.01 : 0
      for (let i = 0; i < 2; i++) {
        const side = arms[i].side
        const inside = Math.sign(incline) === -side ? 1 : 0 // left hand (side 1) is inside on a left turn (incline < 0)
        const planting = plantSide === side ? plant : 0
        const stroke = pumping * side
        // Hands forward, a little wide and low, in front of the hips.
        const hand = v1.set(side * 0.28, 0.2 + breathe + inside * Math.abs(incline) * 0.1, 0.42 + inside * 0.06)
        hand.z += Math.sin(planting * Math.PI) * 0.12 + stroke * 0.12
        hand.x += side * Math.sin(planting * Math.PI) * 0.06
        hand.lerp(v2.set(side * 0.1, 0.3, 0.5), tuckBlend)
        hand.lerp(v2.set(side * 0.38, 0.22, 0.25), brakeBlend * 0.7)
        hand.lerp(v2.set(side * 0.55, 0.35, 0.15), airBlend * (1 - grabBlend))
        // Arms out for balance on a rail; the low side reaches further.
        if (rail) hand.lerp(v2.set(side * (0.62 + Math.max(0, side * rail.balance) * 0.12), 0.42 - side * rail.balance * 0.1, 0.12), railBlend)
        if (firstPerson) {
          // Raise the hands into the first-person view.
          hand.y += 0.36 * (1 - tuckBlend)
          hand.z += 0.16
        }
        const handLocal = hand.clone()
        // Pole tip: trailing behind, planted on a plant, tucked under the arm in a tuck.
        const tipTarget = v3.set(side * 0.42, 0.18, -0.6)
        if (speed < 0.5 && skiing) tipTarget.set(side * 0.55, 0, 0.15)
        if (planting > 0) tipTarget.lerp(v2.set(side * 0.5, -0.02, 0.85 - (1 - planting) * 1.1), Math.sin(Math.min(1, planting * 1.6) * Math.PI * 0.5))
        tipTarget.lerp(v2.set(side * 0.25, 0.9, -1.1), tuckBlend)
        tipTarget.lerp(v2.set(side * 0.9, 0.3, -0.5), Math.max(airBlend, railBlend))
        if (pumping !== 0) tipTarget.lerp(v2.set(side * 0.45, 0, -0.2 - stroke * 0.3), 0.8)
        placeArm(i, handLocal, tipTarget.clone())
      }
      if (grabBlend > 0.02 && air) {
        // Reach a real point on a ski: the hand follows the ski it grabs.
        const grab = lastGrab
        const reachFor = (handIndex: number, skiIndex: number, along: number, sideOffset: number) => {
          const target = v1.set(sideOffset, 0.06, along).applyQuaternion(skis[skiIndex].quaternion).add(skis[skiIndex].position)
          root.updateMatrixWorld(true)
          const current = root.worldToLocal(arms[handIndex].hand.getWorldPosition(v2))
          target.lerp(current, 1 - grabBlend)
          placeArm(handIndex, target.clone(), v3.set(arms[handIndex].side * 0.9, 0.5, -0.6).clone(), true)
        }
        if (grab === 'truck') {
          // Truck driver: both hands on both tips, like a steering wheel.
          reachFor(0, 0, 0.42, 0)
          reachFor(1, 1, 0.42, 0)
        } else {
          const handIndex = grab === 'mute' || grab === 'japan' || grab === 'nose' ? 0 : 1
          const skiIndex = grab === 'mute' || grab === 'safety' ? 1 : grab === 'critical' ? 0 : grab === 'japan' ? 1 : handIndex
          const along = grab === 'nose' ? 0.72 : grab === 'tail' ? -0.62 : grab === 'japan' ? 0.32 : 0.22
          const sideOffset = grab === 'safety' ? -0.07 : grab === 'critical' ? 0.07 : 0
          reachFor(handIndex, skiIndex, along, sideOffset)
        }
      }
    },
  }
}
