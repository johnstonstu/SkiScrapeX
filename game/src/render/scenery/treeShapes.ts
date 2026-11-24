import * as THREE from 'three'

/**
 * Low-poly tree shapes, unit height, base at y = 0, vertex coloured. Indexed
 * by `Species` in world/forest.ts: spruce, fir, pine, snag, krummholz, ghost.
 */
export function treeShapes(): THREE.BufferGeometry[] {
  return [spruce(), fir(), pine(), snag(), krummholz(), ghost()]
}

/** Close-range trees on Low keep their trunk and species silhouette with fewer branches. */
export function compactTreeShapes(): THREE.BufferGeometry[] {
  return [
    compactConifer(0.2, 0.19, 4, 0.7),
    compactConifer(0.17, 0.11, 5, 0.88),
    compactConifer(0.56, 0.11, 3, 0.35),
    snag(),
    compactConifer(0.11, 0.27, 3, 0.78),
    compactConifer(0.13, 0.18, 4, 1),
  ]
}

/** One distant stand-in for every species: stacked cones (`tiers` of them, 3 by default). */
export function distantTree(tiers = 3, trunk = false): THREE.BufferGeometry {
  const b = new Builder()
  // Greyer-green needles + brighter snow so aerial forest reads frosted, not dark.
  const needles = new THREE.Color('#3d6a5c')
  const snow = new THREE.Color('#c5d8de')
  if (trunk) b.trunk(0.016, 0.008, 0, 0.26, BARK, 4)
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers
    const y = tiers === 1 ? 0.12 : 0.18 + t * 0.8
    const r = 0.18 * (1 - t * 0.94)
    const top = tiers === 1 ? 1 : Math.min(1, y + 0.8 / tiers + 0.13)
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + tier * 2.4
      const s = Math.PI / 4
      b.tri(b.p(0, 0, top), b.p(a + s, r, y), b.p(a - s, r, y), needles, snow, snow)
    }
  }
  return b.build()
}

const NEEDLES = new THREE.Color('#294d42')
const TIPS = new THREE.Color('#487260')
const BARK = new THREE.Color('#58483d')
const PINE_BARK = new THREE.Color('#7a5a44')
const SNAG_BARK = new THREE.Color('#9a958c')
const SNOW = new THREE.Color('#d4e2ec')
const RIME = new THREE.Color('#eef3f7')
const FROST = new THREE.Color('#879e9d')

function compactConifer(base: number, width: number, tiers: number, snowiness: number): THREE.BufferGeometry {
  const b = new Builder()
  b.trunk(0.016, 0.007, 0, base + 0.15, BARK, 4)
  for (let tier = 0; tier < tiers; tier++) {
    const blend = tier / tiers
    const y = base + blend * (0.93 - base)
    const radius = width * (1 - blend * 0.88)
    const top = Math.min(1, y + (1 - base) / tiers + 0.12)
    b.whorl(y, radius, 3, top, tier * 1.87, snowiness)
  }
  return b.build()
}

class Builder {
  vertices: number[] = []
  colors: number[] = []
  p(angle: number, radius: number, y: number, ox = 0, oz = 0) {
    return new THREE.Vector3(Math.cos(angle) * radius + ox, y, Math.sin(angle) * radius + oz)
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, ca: THREE.Color, cb = ca, cc = ca) {
    for (const [v, col] of [[a, ca], [b, cb], [c, cc]] as const) {
      this.vertices.push(v.x, v.y, v.z)
      this.colors.push(col.r, col.g, col.b)
    }
  }
  trunk(r0: number, r1: number, y0: number, y1: number, color: THREE.Color, sides = 5, ox = 0, oz = 0, lean = 0) {
    for (let i = 0; i < sides; i++) {
      const a = (i * Math.PI * 2) / sides
      const b = ((i + 1) * Math.PI * 2) / sides
      const top = (ang: number) => this.p(ang, r1, y1, ox + lean, oz)
      this.tri(this.p(a, r0, y0, ox, oz), top(a), this.p(b, r0, y0, ox, oz), color)
      this.tri(this.p(b, r0, y0, ox, oz), top(a), top(b), color)
    }
  }
  /** A whorl of drooping, snow-topped branches. `snowiness` 0..1. */
  whorl(y: number, radius: number, branches: number, crownY: number, twist: number, snowiness: number, only?: (a: number) => boolean) {
    const crown = this.p(0, 0, crownY)
    for (let i = 0; i < branches; i++) {
      const a = (i * Math.PI * 2) / branches + twist
      if (only && !only(a)) continue
      const spread = Math.PI / branches
      const length = radius * (0.93 + 0.12 * Math.sin(2.7 * i + twist * 3))
      const tip = this.p(a, length, y - length * 0.22)
      const load = 0.5 + 0.5 * Math.sin(2.2 * i + 3.1 * twist)
      const coating = load + snowiness - 0.5 > 0.48 ? SNOW : load + snowiness - 0.5 > 0.2 ? FROST : TIPS
      const snowyTip = this.p(a, length * (0.48 + 0.34 * load), y + 0.028)
      const left = this.p(a - spread, length * 0.55, y + 0.035)
      const right = this.p(a + spread, length * 0.55, y + 0.035)
      this.tri(crown, right, snowyTip, coating)
      this.tri(crown, snowyTip, left, coating)
      this.tri(left, snowyTip, tip, TIPS)
      this.tri(snowyTip, right, tip, NEEDLES)
      this.tri(left, tip, right, NEEDLES)
    }
  }
  /** Rough blob (low icosahedron-like) for rime and pine tufts. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, top: THREE.Color, bottom: THREE.Color, seed: number) {
    const ring = 6
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < ring; i++) {
      const a = (i * Math.PI * 2) / ring + seed
      const k = 1 + 0.18 * Math.sin(seed * 7 + i * 2.3)
      pts.push(new THREE.Vector3(cx + Math.cos(a) * rx * k, cy, cz + Math.sin(a) * rx * k))
    }
    const up = new THREE.Vector3(cx, cy + ry, cz)
    const down = new THREE.Vector3(cx, cy - ry * 0.55, cz)
    for (let i = 0; i < ring; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % ring]
      this.tri(up, b, a, top)
      this.tri(down, a, b, bottom)
    }
  }
  build() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    g.computeVertexNormals()
    return g
  }
}

/** Engelmann spruce: broad, layered, moderately snowy. */
function spruce() {
  const b = new Builder()
  b.trunk(0.012, 0.008, 0, 0.35, BARK)
  const tiers = 6
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers
    const y = 0.18 + t * 0.8
    b.whorl(y, 0.18 * (1 - t * 0.94), 7, Math.min(1, y + 0.8 / tiers + 0.13), tier * 2.4, 0.68)
  }
  return b.build()
}

/** Subalpine fir: a narrow spire with many short, snow-loaded tiers. */
function fir() {
  const b = new Builder()
  b.trunk(0.01, 0.007, 0, 0.25, BARK)
  const tiers = 9
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers
    const y = 0.1 + t * 0.86
    b.whorl(y, 0.105 * (1 - t * 0.9), 6, Math.min(1, y + 0.86 / tiers + 0.08), tier * 1.9, 0.92)
  }
  return b.build()
}

/** Lodgepole pine: tall bare trunk, a few dead stubs, tufted crown in the top third. */
function pine() {
  const b = new Builder()
  b.trunk(0.009, 0.004, 0, 0.92, PINE_BARK, 6)
  for (let i = 0; i < 5; i++) {
    const a = i * 2.1
    const y = 0.25 + i * 0.07
    b.tri(b.p(a, 0.006, y), b.p(a, 0.05, y - 0.02), b.p(a + 0.3, 0.006, y + 0.02), SNAG_BARK)
  }
  const tufts = 7
  for (let i = 0; i < tufts; i++) {
    const t = i / tufts
    const y = 0.6 + t * 0.36
    const a = i * 2.39
    const r = 0.055 * (1 - t * 0.5)
    b.blob(Math.cos(a) * r, y, Math.sin(a) * r, 0.06 * (1 - t * 0.4), 0.05, i % 2 ? SNOW : FROST, NEEDLES, i)
  }
  b.blob(0, 0.95, 0, 0.035, 0.06, SNOW, NEEDLES, 9)
  return b.build()
}

/** Standing dead snag: grey trunk, broken top, stubby branches holding a little snow. */
function snag() {
  const b = new Builder()
  b.trunk(0.012, 0.004, 0, 0.82, SNAG_BARK, 5, 0, 0, 0.015)
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4
    const y = 0.3 + i * 0.055
    const len = 0.09 * (1 - i / 12)
    const base = b.p(a, 0.007, y)
    const tip = b.p(a, len, y - 0.01)
    b.tri(base, tip, b.p(a + 0.5, 0.007, y + 0.015), SNAG_BARK)
    b.tri(base, b.p(a, len * 0.8, y + 0.005), tip, SNOW)
  }
  return b.build()
}

/** Krummholz: low, wide and wind-flagged, branches only on the leeward side up high. */
function krummholz() {
  const b = new Builder()
  b.trunk(0.03, 0.02, 0, 0.2, BARK, 5, 0, 0, 0.03)
  const tiers = 4
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / tiers
    const y = 0.15 + t * 0.7
    const leeward = tier >= 2 ? (a: number) => Math.cos(a) > -0.2 : undefined
    b.whorl(y, 0.34 * (1 - t * 0.6), 8, Math.min(1, y + 0.3), tier * 2.1, 0.82, leeward)
  }
  return b.build()
}

/** Snow ghost: a fir buried in rime, a stack of white lumps. */
function ghost() {
  const b = new Builder()
  // Overlapping, lopsided lumps that taper to a crooked tip.
  const lumps = 13
  for (let i = 0; i < lumps; i++) {
    const t = i / lumps
    const y = 0.08 + t * 0.84
    const r = 0.15 * (1 - t * 0.78) * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.7)))
    const lean = 0.03 * t * t
    for (let j = 0; j < (t < 0.6 ? 2 : 1); j++) {
      const a = i * 2.3 + j * 3.1
      const off = j ? r * 0.45 : 0.015
      b.blob(Math.cos(a) * off + lean, y + j * 0.03, Math.sin(a) * off, r * (j ? 0.7 : 1), 0.11 * (1 - t * 0.35), RIME, SNOW, i * 1.3 + j)
    }
  }
  // A few dark needles showing through near the bottom.
  b.whorl(0.1, 0.14, 5, 0.2, 0.7, 1)
  return b.build()
}
