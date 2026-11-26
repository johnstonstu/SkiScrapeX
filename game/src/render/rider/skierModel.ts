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
import { applyTextureBudget } from '../textureBudget'
import { makeBoardBoot, makeSkiBoot } from './riderBoot'
import { jacketGeometry, fabricWeave } from './riderCloth'
import { ClothPhysics } from './clothPhysics'
import type { RiderSnow } from './riderSnow'
import { createRiderSkin, loadRiderAsset, type GarmentColours, type GloveStyle, type Headwear, type JacketStyle, type PantsStyle, type RiderSkin } from './riderSkin'

/** Binding centres and boot yaw in the snowboard's local frame. */
export const BOARD_BINDINGS = [
  { z: 0.26, yaw: -Math.PI / 2 + Math.PI / 12 },
  { z: -0.26, yaw: -Math.PI / 2 },
] as const
export const BOARD_BOOT_HEIGHT = 0.025

export interface RiderLook {
  jacket: string
  pants: string
  helmet: string
  skis: string
  model?: string
  /** Baggy freeride kit or a slimmer race fit. */
  fit?: 'baggy' | 'slim'
  headwear?: Headwear
  jacketStyle?: JacketStyle
  pantsStyle?: PantsStyle
  gloves?: GloveStyle
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
  applyTextureBudget(texture)
  return texture
}

/** Wrap the goggles around the cheeks, with a raised bridge and rounded ends. */
function goggleShield(top: number, bottom: number, height: number, arc: number, mirror = false) {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, 24, 3, true, -arc, arc * 2)
  const vertices = geometry.getAttribute('position')
  const colours: number[] = []
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i)
    const bridge = Math.exp(-((x / 0.024) ** 2))
    const temple = Math.min(1, Math.abs(x) / 0.11) ** 6
    vertices.setXYZ(i, x, y * (1 - temple * 0.23) + bridge * Math.max(0, -y) * 0.42, z * 1.08)
    const light = 0.87 + (y / height + 0.5) * 0.13
    colours.push(light, light, light)
  }
  geometry.computeVertexNormals()
  if (mirror) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  return geometry
}

export const THIGH_LENGTH = 0.43
export const SHIN_LENGTH = 0.42
export const UPPER_ARM = 0.29
export const FORE_ARM = 0.27
/** Hip sockets: how far the thighs hang below the hips bone. */
export const HIP_SOCKET_DROP = 0.06
/** Ankle point in a ski's space (the boot's pivot). */
export const ANKLE_IN_SKI = new THREE.Vector3(0, 0.2, -0.01)
/** Spine (lower back) origin above the hips, and chest origin above the spine. */
export const SPINE_Y = 0.07
export const CHEST_Y = 0.26

export interface Leg {
  ski: THREE.Group
  thigh: THREE.Bone
  knee: THREE.Bone
  upper: THREE.Mesh
  shin: THREE.Mesh
  side: number
}

export interface Arm {
  side: number
  shoulder: THREE.Bone
  elbow: THREE.Bone
  hand: THREE.Bone
  pole: THREE.Group
  sleeve: THREE.Mesh
}

export type RiderRig = ReturnType<typeof buildRider>

/**
 * Bind pose for the skinned body (tools/blender/build_rider.py builds the
 * mesh around the same joints): legs straight and a little apart, arms in an
 * A-pose so the sleeves clear the torso. Rotations are about Z, per side
 * (+1 left, -1 right).
 */
export const REST_HIP_HEIGHT = 1.14
export const REST_ARM_SPREAD = 0.6
export const REST_LEG_SPREAD = 0.06

export function buildRider() {
  const root = new THREE.Group()
  /** Every named joint, so skinned meshes from the GLB can bind by name. */
  const bones: Record<string, THREE.Bone> = {}
  const bone = (name: string) => {
    const b = new THREE.Bone()
    b.name = name
    bones[name] = b
    return b
  }
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
    lens: new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.12, metalness: 0.15, emissive: 0x6a2a00, vertexColors: true }),
    frame: m(0x15181c, 0.6),
    gaiter: m(0x59606b, 0.95),
    glove: m(0x15181c, 0.8),
    boot: m(0xc7d0d8, 0.42),
    bootAccent: m(0x2c3138, 0.45),
    boardBoot: m(0x46505a, 0.84),
    strap: m(0x8f1c20, 0.8),
    vent: m(0x15181c, 0.5),
    buckle: m(0x9aa3ad, 0.3, 0.8),
    pole: m(0xb9c2cb, 0.3, 0.8),
  }
  for (const fabric of [mat.jacket, mat.jacketPanel, mat.pants, mat.pantsPatch, mat.gaiter]) {
    fabric.bumpMap = fabricWeave
    fabric.bumpScale = 0.0023
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
    const geometry = new THREE.LatheGeometry(points, 16)
    if (material === mat.jacket || material === mat.pants) {
      const p = geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
        const t = THREE.MathUtils.clamp(-y / length, 0, 1)
        const angle = Math.atan2(x, z)
        const fold = Math.sin(t * 18 + Math.cos(angle * 2) * 1.4) * Math.sin(Math.PI * t) * 0.045
        p.setXYZ(i, x * (1 + fold), y, z * (0.93 + fold))
      }
      geometry.computeVertexNormals()
    }
    return new THREE.Mesh(geometry, material)
  }
  const rounded = (w: number, h: number, d: number, r: number, material: THREE.Material) =>
    new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material)
  const sphere = (r: number, material: THREE.Material, w = 16, h = 12) => new THREE.Mesh(new THREE.SphereGeometry(r, w, h), material)

  // ---- Skis -----------------------------------------------------------------
  const blades: THREE.Group[] = []
  const makeSki = (side: number) => {
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
    const binding = rounded(0.078, 0.042, 0.29, 0.01, mat.trim)
    binding.position.set(0, 0.032, 0.014)
    const heel = rounded(0.086, 0.065, 0.062, 0.016, mat.skiBase)
    heel.position.set(0, 0.051, -0.151)
    const toe = rounded(0.09, 0.051, 0.058, 0.014, mat.skiBase)
    toe.position.set(0, 0.049, 0.181)
    ski.add(blade, binding, heel, toe, makeSkiBoot(mat, side))
    blades.push(blade)
    return ski
  }
  const skis = [makeSki(1), makeSki(-1)] // 0 left (+X), 1 right
  root.add(...skis)

  // ---- Snowboard --------------------------------------------------------------
  const boardGroup = new THREE.Group()
  boardGroup.name = 'snowboard'
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
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.attributes.position
    const uv = geometry.attributes.uv
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + 0.14) / 0.28, (position.getZ(i) + half) / (2 * half))
    const deck = new THREE.Mesh(geometry, mat.skiTop)
    const base = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.4), mat.skiBase)
    base.rotation.x = Math.PI / 2
    base.position.y = -0.001
    boardGroup.add(deck, base)
    for (const { z, yaw } of BOARD_BINDINGS) {
      const boot = makeBoardBoot(mat)
      boot.position.set(0, BOARD_BOOT_HEIGHT, z)
      boot.rotation.y = yaw
      boardGroup.add(boot)
    }
    boardGroup.visible = false
    root.add(boardGroup)
  }

  // ---- Body -----------------------------------------------------------------
  const body = new THREE.Group()
  root.add(body)
  const hips = bone('hips')
  body.add(hips)
  const pelvis = rounded(0.36, 0.24, 0.27, 0.1, mat.pants)
  pelvis.position.y = -0.02
  const seat = sphere(0.15, mat.pants, 12, 8)
  seat.position.set(0, -0.07, -0.025)
  seat.scale.set(1.2, 0.85, 0.72)
  hips.add(pelvis, seat)

  const legs: Leg[] = skis.map((ski, index) => {
    const side = index === 0 ? 1 : -1
    const thigh = bone(`thigh_${side === 1 ? 'L' : 'R'}`)
    thigh.position.set(side * 0.11, -HIP_SOCKET_DROP, 0)
    const upper = limb(0.1, 0.088, THIGH_LENGTH, mat.pants, 0.014)
    const knee = bone(`shin_${side === 1 ? 'L' : 'R'}`)
    knee.position.y = -THIGH_LENGTH
    const joint = sphere(0.088, mat.pants, 12, 8)
    // Articulated knee panel: a flat, shaped patch rather than a lump.
    const patch = sphere(0.08, mat.pantsPatch, 16, 12)
    patch.position.set(0, -0.016, 0.063)
    patch.scale.set(0.86, 1.12, 0.45)
    const pocket = rounded(0.03, 0.13, 0.11, 0.012, mat.pantsPatch)
    pocket.position.set(side * 0.095, -0.22, 0.01)
    upper.add(pocket)
    // Pants run over the boot cuff and flare at the hem.
    const shin = limb(0.088, 0.091, SHIN_LENGTH - 0.035, mat.pants, 0.008, 0.017)
    knee.add(joint, patch, shin)
    thigh.add(upper, knee)
    hips.add(thigh)
    return { ski, thigh, knee, upper, shin, side }
  })

  // Lower back: the jacket's waist and hem. Chest: shoulders, yoke, hood and pack.
  const spine = bone('spine')
  spine.position.y = SPINE_Y
  hips.add(spine)
  const chest = bone('chest')
  chest.position.y = CHEST_Y
  spine.add(chest)
  // Leaf bones for cloth that swings on its own: the hem front and back, the
  // hood, hoodie drawstrings, the backpack and a beanie pom (added with the head).
  const hemFront = bone('hem_F')
  hemFront.position.set(0, -0.1, 0.13)
  const hemBack = bone('hem_B')
  hemBack.position.set(0, -0.1, -0.13)
  spine.add(hemFront, hemBack)
  const hoodBone = bone('hood')
  hoodBone.position.set(0, 0.54 - CHEST_Y, -0.1)
  const packBone = bone('pack')
  packBone.position.set(0, 0.3 - CHEST_Y, -0.17)
  const cords = [1, -1].map((s) => {
    const cord = bone(`cord_${s === 1 ? 'L' : 'R'}`)
    cord.position.set(s * 0.045, 0.56 - CHEST_Y, 0.15)
    return cord
  })
  chest.add(hoodBone, packBone, ...cords)

  const jacket = new THREE.SkinnedMesh(jacketGeometry(true).geometry, mat.jacket)
  jacket.name = 'jacket-hem'
  spine.add(jacket)
  root.updateMatrixWorld(true)
  jacket.bind(new THREE.Skeleton([spine, chest]))
  const hemBand = new THREE.Mesh(new THREE.CylinderGeometry(0.204, 0.191, 0.03, 24, 1, true), mat.jacketPanel)
  hemBand.scale.z = 0.735
  hemBand.position.y = -0.17
  const lowerZip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.4, 0.012), mat.trim)
  lowerZip.position.set(0, 0.06, 0.152)
  const pocket = rounded(0.12, 0.1, 0.02, 0.01, mat.jacketPanel)
  pocket.position.set(0.09, 0.08, 0.148)
  pocket.rotation.y = 0.25
  spine.add(hemBand, lowerZip, pocket)

  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.226, 0.13, 20, 1, true), mat.jacketPanel)
  yoke.scale.z = 0.735
  yoke.position.y = 0.42 - CHEST_Y
  const upperZip = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.36, 0.012), mat.trim)
  upperZip.position.set(0, 0.38 - CHEST_Y, 0.16)
  const chestPocket = rounded(0.1, 0.08, 0.02, 0.01, mat.jacketPanel)
  chestPocket.position.set(-0.1, 0.36 - CHEST_Y, 0.158)
  chestPocket.rotation.y = -0.3
  const hood = sphere(0.108, mat.jacket, 20, 12)
  const hoodPitch = -0.4
  hood.name = 'folded-hood'
  hood.position.set(0, 0.52 - CHEST_Y, -0.119)
  hood.rotation.x = hoodPitch
  hood.scale.set(1.22, 0.58, 0.65)
  const hoodFold = sphere(0.07, mat.jacketPanel, 16, 8)
  hoodFold.position.set(0, 0.069, -0.069)
  hoodFold.scale.set(1.05, 0.27, 0.41)
  hood.add(hoodFold)
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.08, 16, 1, true), mat.jacketPanel)
  collar.position.y = 0.585 - CHEST_Y
  chest.add(yoke, upperZip, chestPocket, hood, collar)

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
  // The pack hangs off its own bone so it can bounce; parts stay in chest space.
  backpack.position.set(0, CHEST_Y - 0.3, 0.17)
  packBone.add(backpack)

  const head = bone('head')
  head.position.y = 0.62 - CHEST_Y
  chest.add(head)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 12), mat.gaiter)
  neck.position.y = 0.02
  const skull = sphere(0.105, mat.skin)
  skull.position.y = 0.135
  skull.scale.set(0.92, 1.08, 1)
  // Gaiter pulled up over the nose to just under the goggles, with a nose bump.
  const buff = new THREE.Group()
  const buffShell = new THREE.Mesh(new THREE.LatheGeometry(
    [[0.001, -0.03], [0.08, -0.03], [0.086, 0.03], [0.097, 0.07], [0.1, 0.095], [0.094, 0.108], [0.05, 0.112], [0.001, 0.113]].map(([r, y]) => new THREE.Vector2(r, y)), 18), mat.gaiter)
  buffShell.scale.set(0.97, 1, 1.07)
  // Nose and cheeks show between the gaiter and the goggles.
  const nose = sphere(0.022, mat.skin, 10, 8)
  nose.position.set(0, 0.112, 0.1)
  nose.scale.set(0.75, 1.1, 0.9)
  buff.add(buffShell, nose)
  // Helmet: an open-faced dome, a back and side shell that drops over the ears, vents and ear pads.
  const helmet = new THREE.Group()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.47), mat.helmet)
  dome.scale.set(1, 0.98, 1.1)
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 6, Math.PI * 1.5 - 1.65, 3.3, Math.PI * 0.46, Math.PI * 0.27), mat.helmet)
  back.scale.set(1, 0.98, 1.1)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.008, 5, 28, Math.PI * 1.05), mat.vent)
  rim.rotation.set(Math.PI / 2, 0, Math.PI * 1.5 - Math.PI * 0.525)
  rim.position.y = -0.044
  rim.scale.set(1, 1.1, 1)
  const ears = [1, -1].map((s) => {
    const ear = sphere(0.045, mat.frame, 10, 8)
    ear.position.set(s * 0.126, -0.035, -0.012)
    ear.scale.set(0.35, 1, 0.95)
    return ear
  })
  const vents = [-0.045, 0, 0.045].map((x) => {
    const vent = rounded(0.022, 0.012, 0.075, 0.005, mat.vent)
    vent.position.set(x, 0.127 * Math.sqrt(1 - (x / 0.13) ** 2) - 0.004, -0.005)
    vent.rotation.z = -Math.asin(x / 0.13)
    return vent
  })
  helmet.add(dome, back, rim, ...ears, ...vents)
  helmet.position.y = 0.165
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
  // Cylindrical goggles wrapping the face at eye level: foam frame, mirrored lens, strap round the back.
  const goggles = new THREE.Group()
  const gFrame = new THREE.Mesh(goggleShield(0.121, 0.117, 0.068, 1.15), mat.frame)
  const lens = new THREE.Mesh(goggleShield(0.125, 0.121, 0.052, 1.02, true), mat.lens)
  const gStrap = new THREE.Mesh(new THREE.CylinderGeometry(0.136, 0.136, 0.036, 24, 1, true, 1.1, Math.PI * 2 - 2.2), mat.strap)
  gStrap.scale.set(1, 1, 1.1)
  goggles.add(gFrame, lens, gStrap)
  goggles.position.y = 0.155
  const pomBone = bone('pom')
  pomBone.position.y = 0.3
  head.add(pomBone)
  for (const part of [gFrame, lens, gStrap]) (part.material as THREE.Material).side = THREE.DoubleSide
  head.add(neck, skull, buff, helmet, beanie, goggles)
  const eye = new THREE.Object3D()
  eye.position.set(0, 0.16, 0.14)
  head.add(eye)

  const shoulderCaps: THREE.Mesh[] = []
  const arms: Arm[] = [1, -1].map((side) => {
    const shoulder = bone(`upperarm_${side === 1 ? 'L' : 'R'}`)
    shoulder.position.set(side * 0.215, 0.47 - CHEST_Y, -0.01)
    // Rounded deltoid so the sleeve meets the jacket without a seam gap.
    const cap = sphere(0.088, mat.jacket, 12, 8)
    cap.position.set(side * 0.215, 0.47 - CHEST_Y, -0.01)
    cap.scale.set(1, 0.95, 0.9)
    chest.add(cap)
    shoulderCaps.push(cap)
    const sleeve = limb(0.08, 0.068, UPPER_ARM, mat.jacket, 0.012)
    const elbow = bone(`forearm_${side === 1 ? 'L' : 'R'}`)
    elbow.position.y = -UPPER_ARM
    const elbowJoint = sphere(0.068, mat.jacket, 10, 8)
    const fore = limb(0.068, 0.066, FORE_ARM - 0.06, mat.jacket, 0.006, 0.014)
    const hand = bone(`hand_${side === 1 ? 'L' : 'R'}`)
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
    backpack, jacket, yoke, hemBand, lowerZip, upperZip, pocket, chestPocket, hood, collar,
    neck, skull, buff, helmet, beanie, goggles, ...shoulderCaps,
  ]

  let firstPerson = false
  let boarding = false

  // The code-built body is the fallback; once rider.glb loads, skinned garments replace it.
  const poles = new Set<THREE.Object3D>(arms.map((arm) => arm.pole))
  const proceduralBody: THREE.Mesh[] = []
  const collect = (object: THREE.Object3D) => {
    if (poles.has(object) || object === backpack) return
    if ((object as THREE.Mesh).isMesh) proceduralBody.push(object as THREE.Mesh)
    for (const child of object.children) collect(child)
  }
  collect(hips)
  /** Run `fn` with the skeleton in the bind pose, then put the current pose back. */
  const withRestPose = (fn: () => void) => {
    const all = [body, ...Object.values(bones)]
    const saved = all.map((o) => [o.position.clone(), o.quaternion.clone(), o.scale.clone()] as const)
    body.position.set(0, 0, 0)
    body.quaternion.identity()
    for (const b of Object.values(bones)) {
      b.quaternion.identity()
      b.scale.set(1, 1, 1)
    }
    hips.position.set(0, REST_HIP_HEIGHT, 0)
    for (const leg of legs) leg.thigh.rotation.set(0, 0, leg.side * REST_LEG_SPREAD)
    for (const arm of arms) arm.shoulder.rotation.set(0, 0, arm.side * REST_ARM_SPREAD)
    root.updateMatrixWorld(true)
    try {
      fn()
    } finally {
      all.forEach((o, i) => {
        o.position.copy(saved[i][0])
        o.quaternion.copy(saved[i][1])
        o.scale.copy(saved[i][2])
      })
      root.updateMatrixWorld(true)
    }
  }

  let skin: RiderSkin | null = null
  /** Kept so a skin that loads later starts with the current wind and snow. */
  let lastWeather: { time: number; wind: number; snow: RiderSnow } | null = null
  const down = new THREE.Vector3(0, -1, 0)
  const cloth = new ClothPhysics([
    // Hem panels: stiff-ish fabric, limited so they cannot swing through the legs.
    { bone: hemFront, axis: down, follow: 0.55, maxAngle: 0.75, hz: 1.6, zeta: 0.35, drag: 0.5, flutter: 0.08 },
    { bone: hemBack, axis: down, follow: 0.65, maxAngle: 0.9, hz: 1.5, zeta: 0.3, drag: 0.6, flutter: 0.1 },
    { bone: hoodBone, axis: down, follow: 0.18, maxAngle: 0.35, hz: 1.8, zeta: 0.4, drag: 0.3 },
    ...cords.map((bone) => ({ bone, axis: down, follow: 0.9, maxAngle: 1.3, hz: 1.2, zeta: 0.18, drag: 0.9, flutter: 0.25 })),
    { bone: pomBone, axis: new THREE.Vector3(0, 1, 0), follow: 0.55, maxAngle: 0.8, hz: 2.2, zeta: 0.25, drag: 0.4, upright: true },
  ])
  let lastLook: RiderLook | null = null
  const hideProcedural = () => {
    if (skin) for (const part of proceduralBody) part.visible = false
  }
  const applySkin = (look: RiderLook) => {
    if (!skin) return
    const accent = look.jacketAccent ?? '#' + new THREE.Color(look.jacket).multiplyScalar(0.6).getHexString()
    const pantsPatch = '#' + new THREE.Color(look.pants).multiplyScalar(0.72).getHexString()
    const dark = '#1b1f24'
    const colours: Record<string, GarmentColours> = {
      jacket: { base: look.jacket, accent, trim: dark },
      pants: { base: look.pants, accent: pantsPatch, trim: dark },
      gloves: { base: '#17191d', accent, trim: '#4b5058' },
      gloves_pipe: { base: '#2b2f36', accent: '#7a6450', trim: dark },
      head_face: { base: look.gaiter ?? '#59606b', accent: '#e2b08a', trim: '#3b2a20' },
      head_goggles: { base: '#15181c', accent: '#15181c', trim: accent },
      head_helmet: { base: look.helmet, accent: look.helmet, trim: '#15181c' },
      head_beanie: { base: look.helmet, accent, trim: dark },
      head_cap: { base: look.helmet, accent, trim: accent },
    }
    skin.apply({
      jacket: look.jacketStyle ?? 'shell',
      pants: look.pantsStyle ?? (look.fit === 'slim' ? 'slim' : 'baggy'),
      gloves: look.gloves ?? 'mitt',
      headwear: look.headwear ?? 'helmet',
    }, colours)
    hideProcedural()
  }

  const rigApi = {
    root, mat, skis, blades, boardGroup, body, hips, spine, chest, head, eye, legs, arms, bones,
    withRestPose,
    poseCloth(side: number, back: number) {
      jacket.morphTargetInfluences![0] = side / 0.1
      jacket.morphTargetInfluences![1] = back / 0.1
      hemBand.position.x = side * 0.72
      hemBand.position.z = back * 0.72
      hood.rotation.x = hoodPitch + back * 2
      hood.rotation.y = side * 2
    },
    /** Swing the skinned body's loose cloth; call before posing, `applyCloth` after. */
    stepCloth(acceleration: THREE.Vector3, velocity: THREE.Vector3, dt: number) {
      cloth.step(acceleration, velocity, dt)
    },
    /** Wind (0..1), time and snow for the skinned garments; does nothing on the code-built rider. */
    setWeather(time: number, wind: number, snow: RiderSnow) {
      lastWeather = { time, wind, snow }
      if (!skin) return
      const w = skin.weather
      w.uTime.value = time
      w.uWind.value = wind
      w.uSnowCrash.value = snow.crash
      w.uSnowSide.value.copy(snow.side)
      w.uSnowLegHeight.value = snow.legHeight
      w.uSnowLegAmount.value = snow.legAmount
    },
    /** The pack bounces with vertical acceleration (metres of give, from a spring). */
    bouncePack(bounce: number) {
      packBone.position.y = 0.3 - CHEST_Y + bounce * 0.4
      packBone.rotation.x = -bounce * 3
    },
    /** After the body is posed: point the cloth bones along their swing. */
    applyCloth() {
      root.updateMatrixWorld(true)
      cloth.apply()
    },
    get boarding() {
      return boarding
    },
    /** True once the skinned body from rider.glb has replaced the code-built one. */
    get skinned() {
      return skin !== null
    },
    /** Load rider.glb and swap it in; the code-built body stays if loading fails. */
    loadSkin() {
      return loadRiderAsset().then((asset) => {
        skin = createRiderSkin(asset, root, bones, withRestPose)
        skin.setFirstPerson(firstPerson)
        if (lastLook) applySkin(lastLook)
        if (lastWeather) rigApi.setWeather(lastWeather.time, lastWeather.wind, lastWeather.snow)
        hideProcedural()
      })
    },
    setFirstPerson(on: boolean) {
      firstPerson = on
      for (const part of hideInFirstPerson) part.visible = !on
      if (!on) {
        backpack.visible = Boolean(backpack.userData.on)
        helmet.visible = !beanie.userData.on
        beanie.visible = Boolean(beanie.userData.on)
      }
      skin?.setFirstPerson(on)
      hideProcedural()
    },
    get firstPerson() {
      return firstPerson
    },
    setColours(look: RiderLook) {
      lastLook = look
      mat.jacket.color.set(look.jacket)
      if (look.jacketAccent) mat.jacketPanel.color.set(look.jacketAccent)
      else mat.jacketPanel.color.copy(mat.jacket.color).multiplyScalar(0.6)
      mat.strap.color.copy(mat.jacketPanel.color)
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
      const baggy = (look.pantsStyle ?? look.fit ?? 'baggy') === 'baggy'
      const shape = jacketGeometry(baggy)
      jacket.geometry.dispose()
      jacket.geometry = shape.geometry
      jacket.updateMorphTargets()
      hemBand.position.y = shape.hem + 0.027
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
      for (const ski of skis) ski.visible = !boarding
      for (const arm of arms) arm.pole.visible = !boarding
      for (const blade of blades) {
        const width = look.model === 'powder' ? 1.26 : look.model === 'park' ? 1.06 : 1
        blade.scale.set(width, 1, look.model === 'park' ? 0.94 : 1)
      }
      applySkin(look)
    },
  }
  return rigApi
}
