/**
 * The rider's meshes and rig: skis or board, body, outfit and poles, in
 * metres. Animation lives in skierView.ts; this file only builds the parts
 * and recolours them.
 *
 * Hierarchy: root (on the snow, ski frame: +X left, +Y up, +Z forward) holds
 * the skis, the board and `body`, a pivot at the snow that inclines into the
 * turn. body → hips → legs (two-bone IK to the boots) and spine → chest, a
 * two-part back that rounds in a tuck and angulates in a turn. The chest
 * carries the head and arms (IK to hand targets); poles aim from the hand.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

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

export const THIGH_LENGTH = 0.43
export const SHIN_LENGTH = 0.42
export const UPPER_ARM = 0.29
export const FORE_ARM = 0.27
/** Ankle point in a ski's space (the boot's pivot). */
export const ANKLE_IN_SKI = new THREE.Vector3(0, 0.2, -0.01)
/** Spine (lower back) origin above the hips, and chest origin above the spine. */
export const SPINE_Y = 0.07
export const CHEST_Y = 0.26

export interface Leg {
  ski: THREE.Group
  thigh: THREE.Group
  knee: THREE.Group
  upper: THREE.Mesh
  shin: THREE.Mesh
  side: number
}

export interface Arm {
  side: number
  shoulder: THREE.Group
  elbow: THREE.Group
  hand: THREE.Group
  pole: THREE.Group
  sleeve: THREE.Mesh
}

export type RiderRig = ReturnType<typeof buildRider>

export function buildRider() {
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
      if (i === 0 || i === steps) r *= 0.82
      points.push(new THREE.Vector2(r, -t * length))
    }
    points.unshift(new THREE.Vector2(0.001, r0 * 0.4))
    points.push(new THREE.Vector2(0.001, -length - r1 * 0.35))
    points.reverse()
    return new THREE.Mesh(new THREE.LatheGeometry(points, 14), material)
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
    // Boot: sole, shell with a toe box, a cuff the pants cover, and buckles on the toe box.
    const sole = rounded(0.115, 0.05, 0.32, 0.02, mat.trim)
    sole.position.set(0, 0.075, 0.02)
    const shell = rounded(0.118, 0.13, 0.27, 0.045, mat.boot)
    shell.position.set(0, 0.15, 0.04)
    const cuff = rounded(0.12, 0.11, 0.14, 0.04, mat.boot)
    cuff.position.set(0, 0.24, -0.02)
    cuff.rotation.x = -0.25
    ski.add(blade, binding, heel, toe, sole, shell, cuff)
    ski.userData.skiOnly = [blade, binding, heel, toe]
    for (const [y, z, w] of [[0.19, 0.13, 0.13], [0.215, 0.07, 0.126]]) {
      const clip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, 0.03), mat.buckle)
      clip.position.set(0, y, z)
      ski.add(clip)
    }
    blades.push(blade)
    return ski
  }
  const skis = [makeSki(), makeSki()] // 0 left (+X), 1 right
  root.add(...skis)

  // ---- Snowboard --------------------------------------------------------------
  const boardGroup = new THREE.Group()
  {
    const half = 0.78
    const outline = new THREE.Shape()
    const width = (z: number) => 0.125 + 0.012 * (Math.abs(z) / half) ** 2
    outline.moveTo(-width(-0.66), -0.66)
    for (let z = -0.66; z <= 0.66; z += 0.11) outline.lineTo(-width(z), z)
    outline.quadraticCurveTo(-0.13, half, 0, half)
    outline.quadraticCurveTo(0.13, half, width(0.66), 0.66)
    for (let z = 0.66; z >= -0.66; z -= 0.11) outline.lineTo(width(z), z)
    outline.quadraticCurveTo(0.13, -half, 0, -half)
    outline.quadraticCurveTo(-0.13, -half, -width(-0.66), -0.66)
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 1, curveSegments: 8 })
    geometry.rotateX(Math.PI / 2)
    geometry.scale(1, -1, 1)
    geometry.computeVertexNormals()
    const position = geometry.attributes.position
    const uv = geometry.attributes.uv
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + 0.14) / 0.28, (position.getZ(i) + half) / (2 * half))
    const deck = new THREE.Mesh(geometry, mat.skiTop)
    const base = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.4), mat.skiBase)
    base.rotation.x = Math.PI / 2
    base.position.y = -0.001
    boardGroup.add(deck, base)
    for (const z of [0.26, -0.26]) {
      const binding = rounded(0.27, 0.05, 0.13, 0.02, mat.trim)
      binding.position.set(0, 0.035, z)
      const highback = rounded(0.2, 0.16, 0.025, 0.01, mat.trim)
      highback.position.set(0, 0.1, z - 0.07)
      boardGroup.add(binding, highback)
    }
    boardGroup.visible = false
    root.add(boardGroup)
  }

  // ---- Body -----------------------------------------------------------------
  const body = new THREE.Group()
  root.add(body)
  const hips = new THREE.Group()
  body.add(hips)
  const pelvis = rounded(0.36, 0.24, 0.27, 0.1, mat.pants)
  pelvis.position.y = -0.02
  const seat = sphere(0.15, mat.pants, 12, 8)
  seat.position.set(0, -0.07, -0.025)
  seat.scale.set(1.2, 0.85, 0.72)
  hips.add(pelvis, seat)

  const legs: Leg[] = skis.map((ski, index) => {
    const side = index === 0 ? 1 : -1
    const thigh = new THREE.Group()
    thigh.position.set(side * 0.11, -0.06, 0)
    const upper = limb(0.1, 0.088, THIGH_LENGTH, mat.pants, 0.014)
    const knee = new THREE.Group()
    knee.position.y = -THIGH_LENGTH
    const joint = sphere(0.088, mat.pants, 12, 8)
    const patch = sphere(0.075, mat.pantsPatch, 10, 8)
    patch.position.set(0, 0.01, 0.045)
    patch.scale.set(1.05, 1.1, 0.6)
    // Pants run over the boot cuff and flare at the hem.
    const shin = limb(0.088, 0.106, SHIN_LENGTH + 0.01, mat.pants, 0.006, 0.028)
    knee.add(joint, patch, shin)
    thigh.add(upper, knee)
    hips.add(thigh)
    return { ski, thigh, knee, upper, shin, side }
  })

  // Lower back: the jacket's waist and hem. Chest: shoulders, yoke, hood and pack.
  const spine = new THREE.Group()
  spine.position.y = SPINE_Y
  hips.add(spine)
  const chest = new THREE.Group()
  chest.position.y = CHEST_Y
  spine.add(chest)

  /** Jacket outline as (radius, height in spine space); the two halves overlap at the bend. */
  const shellPoints = (baggy: boolean) => {
    const k = baggy ? 1.06 : 0.94
    const hem = baggy ? -0.2 : -0.08
    return {
      // The hem curls in under itself like a cinched drawcord, so no flat base shows.
      lower: [
        [0.001, hem + 0.05], [0.15 * k, hem + 0.02], [0.185 * k, hem], [0.208 * k, hem + 0.05], [0.2 * k, 0.1], [0.195 * k, 0.2], [0.205 * k, 0.3], [0.001, 0.31],
      ],
      upper: [
        [0.001, 0.17], [0.2 * k, 0.18], [0.212 * k, 0.3], [0.228 * k, 0.4], [0.222 * k, 0.47], [0.19 * k, 0.53], [0.12, 0.575], [0.09, 0.6], [0.001, 0.6],
      ],
      hem,
    }
  }
  const lathe = (points: number[][], shift: number) =>
    new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y - shift)), 20)
  const lowerJacket = new THREE.Mesh(lathe(shellPoints(true).lower, 0), mat.jacket)
  lowerJacket.scale.z = 0.72
  const upperJacket = new THREE.Mesh(lathe(shellPoints(true).upper, CHEST_Y), mat.jacket)
  upperJacket.scale.z = 0.72
  const hemBand = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.2, 0.045, 20, 1, true), mat.jacketPanel)
  hemBand.scale.z = 0.735
  hemBand.position.y = -0.17
  const lowerZip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.4, 0.012), mat.trim)
  lowerZip.position.set(0, 0.06, 0.152)
  const pocket = rounded(0.12, 0.1, 0.02, 0.01, mat.jacketPanel)
  pocket.position.set(0.09, 0.08, 0.148)
  pocket.rotation.y = 0.25
  spine.add(lowerJacket, hemBand, lowerZip, pocket)

  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.226, 0.13, 20, 1, true), mat.jacketPanel)
  yoke.scale.z = 0.735
  yoke.position.y = 0.42 - CHEST_Y
  const upperZip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.36, 0.012), mat.trim)
  upperZip.position.set(0, 0.38 - CHEST_Y, 0.16)
  const chestPocket = rounded(0.1, 0.08, 0.02, 0.01, mat.jacketPanel)
  chestPocket.position.set(-0.1, 0.36 - CHEST_Y, 0.158)
  chestPocket.rotation.y = -0.3
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.058, 8, 18, Math.PI * 1.2), mat.jacket)
  hood.position.set(0, 0.56 - CHEST_Y, -0.075)
  hood.rotation.set(Math.PI / 2 + 0.5, 0, Math.PI * 0.4 + Math.PI)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.08, 16, 1, true), mat.jacketPanel)
  collar.position.y = 0.585 - CHEST_Y
  chest.add(upperJacket, yoke, upperZip, chestPocket, hood, collar)

  const backpack = new THREE.Group()
  const packBody = rounded(0.28, 0.4, 0.14, 0.05, mat.trim)
  packBody.position.set(0, 0.02, -0.2)
  const packLid = rounded(0.26, 0.1, 0.15, 0.04, mat.jacketPanel)
  packLid.position.set(0, 0.22, -0.2)
  backpack.add(packBody, packLid)
  for (const sx of [-0.11, 0.11]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.02), mat.trim)
    strap.position.set(sx, 0.07, 0.155)
    backpack.add(strap)
  }
  backpack.visible = false
  chest.add(backpack)

  const head = new THREE.Group()
  head.position.y = 0.62 - CHEST_Y
  chest.add(head)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 12), mat.gaiter)
  neck.position.y = 0.02
  const skull = sphere(0.108, mat.skin)
  skull.position.y = 0.13
  skull.scale.set(0.95, 1.05, 1)
  const buff = new THREE.Mesh(new THREE.SphereGeometry(0.113, 16, 10, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.48), mat.gaiter)
  buff.position.y = 0.135
  buff.scale.set(1.02, 1.15, 1.06)
  const helmet = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), mat.helmet)
  dome.scale.set(1, 0.95, 1.12)
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24, Math.PI * 0.9), mat.helmet)
  brim.rotation.set(Math.PI / 2, 0, Math.PI * 0.05)
  brim.position.set(0, 0.012, 0.01)
  brim.scale.set(1, 1.18, 1)
  const ears = [1, -1].map((s) => {
    const ear = sphere(0.05, mat.frame, 10, 8)
    ear.position.set(s * 0.122, -0.03, -0.005)
    ear.scale.set(0.45, 1, 1)
    return ear
  })
  helmet.add(dome, brim, ...ears)
  helmet.position.y = 0.155
  const beanie = new THREE.Group()
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat.helmet)
  cap.scale.set(1, 1.15, 1.05)
  const cuffBand = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.124, 0.05, 18, 1, true), mat.helmet)
  cuffBand.position.y = 0.005
  const pom = sphere(0.045, mat.jacketPanel, 10, 8)
  pom.position.y = 0.14
  beanie.add(cap, cuffBand, pom)
  beanie.position.y = 0.155
  beanie.visible = false
  const goggles = new THREE.Group()
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.152, 20, 8, Math.PI / 2 - 0.95, 1.9, Math.PI * 0.36, Math.PI * 0.26), mat.lens)
  lens.scale.set(1, 1, 0.92)
  const gFrame = new THREE.Mesh(new THREE.SphereGeometry(0.148, 20, 8, Math.PI / 2 - 1.0, 2.0, Math.PI * 0.345, Math.PI * 0.31), mat.frame)
  gFrame.scale.set(1, 1, 0.9)
  const gStrap = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.014, 6, 28), mat.frame)
  gStrap.rotation.x = Math.PI / 2
  gStrap.scale.set(1, 1.12, 1)
  goggles.add(gFrame, lens, gStrap)
  goggles.position.y = 0.17
  head.add(neck, skull, buff, helmet, beanie, goggles)
  const eye = new THREE.Object3D()
  eye.position.set(0, 0.16, 0.14)
  head.add(eye)

  const shoulderCaps: THREE.Mesh[] = []
  const arms: Arm[] = [1, -1].map((side) => {
    const shoulder = new THREE.Group()
    shoulder.position.set(side * 0.215, 0.47 - CHEST_Y, -0.01)
    // Rounded deltoid so the sleeve meets the jacket without a seam gap.
    const cap = sphere(0.088, mat.jacket, 12, 8)
    cap.position.set(side * 0.215, 0.47 - CHEST_Y, -0.01)
    cap.scale.set(1, 0.95, 0.9)
    chest.add(cap)
    shoulderCaps.push(cap)
    const sleeve = limb(0.08, 0.068, UPPER_ARM, mat.jacket, 0.012)
    const elbow = new THREE.Group()
    elbow.position.y = -UPPER_ARM
    const elbowJoint = sphere(0.068, mat.jacket, 10, 8)
    const fore = limb(0.068, 0.066, FORE_ARM - 0.06, mat.jacket, 0.006, 0.014)
    const hand = new THREE.Group()
    hand.position.y = -FORE_ARM
    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.05, 0.07, 10), mat.glove)
    gauntlet.position.y = 0.03
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
    const strapLoop = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 4, 10), mat.trim)
    strapLoop.position.set(0, 0.09, 0)
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 10), mat.trim)
    basket.position.y = -1.0
    pole.add(shaft, grip, strapLoop, basket)
    hand.add(gauntlet, mitt, thumb, pole)
    elbow.add(elbowJoint, fore, hand)
    shoulder.add(sleeve, elbow)
    chest.add(shoulder)
    return { side, shoulder, elbow, hand, pole, sleeve }
  })

  const hideInFirstPerson: THREE.Object3D[] = [
    backpack, lowerJacket, upperJacket, yoke, hemBand, lowerZip, upperZip, pocket, chestPocket, hood, collar,
    neck, skull, buff, helmet, beanie, goggles, ...shoulderCaps,
  ]

  let firstPerson = false
  let boarding = false

  return {
    root, mat, skis, blades, boardGroup, body, hips, spine, chest, head, eye, legs, arms,
    get boarding() {
      return boarding
    },
    setFirstPerson(on: boolean) {
      firstPerson = on
      for (const part of hideInFirstPerson) part.visible = !on
      if (!on) {
        backpack.visible = Boolean(backpack.userData.on)
        helmet.visible = !beanie.userData.on
        beanie.visible = Boolean(beanie.userData.on)
      }
    },
    get firstPerson() {
      return firstPerson
    },
    setColours(look: RiderLook) {
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
      const shape = shellPoints(baggy)
      lowerJacket.geometry.dispose()
      lowerJacket.geometry = lathe(shape.lower, 0)
      upperJacket.geometry.dispose()
      upperJacket.geometry = lathe(shape.upper, CHEST_Y)
      hemBand.position.y = shape.hem + 0.035
      hemBand.scale.set(baggy ? 1.06 : 0.94, 1, (baggy ? 1.06 : 0.94) * 0.735)
      for (const leg of legs) {
        const k = baggy ? 1.12 : 0.9
        leg.upper.scale.set(k, 1, k)
        leg.shin.scale.set(k, 1, k)
        ;(leg.knee.children[0] as THREE.Mesh).scale.setScalar(k)
      }
      for (const arm of arms) {
        const k = baggy ? 1.1 : 0.92
        arm.sleeve.scale.set(k, 1, k)
        ;(arm.elbow.children[0] as THREE.Mesh).scale.setScalar(k)
      }
      for (const cap of shoulderCaps) cap.scale.set(baggy ? 1.08 : 0.92, 0.95, baggy ? 0.98 : 0.84)
      beanie.userData.on = look.headwear === 'beanie'
      beanie.visible = !firstPerson && beanie.userData.on
      helmet.visible = !firstPerson && !beanie.userData.on
      boarding = look.model === 'snowboard'
      boardGroup.visible = boarding
      for (const ski of skis) for (const part of ski.userData.skiOnly as THREE.Object3D[]) part.visible = !boarding
      for (const arm of arms) arm.pole.visible = !boarding
      for (const blade of blades) {
        const width = look.model === 'powder' ? 1.26 : look.model === 'park' ? 1.06 : 1
        blade.scale.set(width, 1, look.model === 'park' ? 0.94 : 1)
      }
    },
  }
}
