/**
 * Deformable snow around the player: a height offset field (metres, negative
 * where skis cut a trench, positive where the displaced snow piles into a
 * berm) in a window that follows the skier. Only snow the player has touched
 * is stored, so it stays cheap. The renderer draws it as real geometry
 * (render/terrain/snowPatchView.ts) and the sim reads it back so packed snow
 * is shallower and faster (world/snow.ts). Three.js free.
 */
export interface SnowDeform {
  /** Window size in metres and texels per side. */
  readonly size: number
  readonly n: number
  readonly texel: number
  /** World position of texel (0, 0)'s corner. */
  originX: number
  originZ: number
  /** Offsets in metres, row-major, rows run +Z. */
  readonly values: Float32Array
  /** Rows changed since `takeDirty`, or a full refresh. */
  takeDirty(): { full: boolean; min: number; max: number } | null
  /** Keep (x, z) well inside the window, sliding stored snow with it. */
  recentre(x: number, z: number): void
  /** Cut a trench `depth` deep and `halfWidth` wide from (x0, z0) to (x1, z1), with berms either side. */
  carve(x0: number, z0: number, x1: number, z1: number, halfWidth: number, depth: number, berm: number, bermWidth: number): void
  /** Bilinear offset at a world position (0 outside the window). */
  at(x: number, z: number): number
  clear(): void
}

/** Encoding for an 8-bit texture: offsets from -DEFORM_RANGE.low to +DEFORM_RANGE.high metres. */
export const DEFORM_RANGE = { low: 0.75, high: 0.25 } as const

export function createSnowDeform(size = 48, texel = 0.08): SnowDeform {
  const n = Math.round(size / texel)
  const values = new Float32Array(n * n)
  const scratch = new Float32Array(n * n)
  let dirtyMin = Infinity
  let dirtyMax = -Infinity
  let full = true
  let placed = false

  const field: SnowDeform = {
    size,
    n,
    texel,
    originX: 0,
    originZ: 0,
    values,
    takeDirty() {
      if (!full && dirtyMax < dirtyMin) return null
      const result = { full, min: dirtyMin, max: dirtyMax }
      full = false
      dirtyMin = Infinity
      dirtyMax = -Infinity
      return result
    },
    recentre(x, z) {
      const nextX = Math.round((x - size / 2) / texel) * texel
      const nextZ = Math.round((z - size / 2) / texel) * texel
      if (!placed) {
        placed = true
        field.originX = nextX
        field.originZ = nextZ
        values.fill(0)
        full = true
        return
      }
      const margin = size * 0.25
      if (x > field.originX + margin && x < field.originX + size - margin && z > field.originZ + margin && z < field.originZ + size - margin) return
      const dx = Math.round((nextX - field.originX) / texel)
      const dz = Math.round((nextZ - field.originZ) / texel)
      scratch.fill(0)
      if (Math.abs(dx) < n && Math.abs(dz) < n) {
        for (let row = 0; row < n; row++) {
          const src = row + dz
          if (src < 0 || src >= n) continue
          const from = Math.max(0, dx)
          const to = Math.min(n, n + dx)
          scratch.set(values.subarray(src * n + from, src * n + to), row * n + from - dx)
        }
      }
      values.set(scratch)
      field.originX = nextX
      field.originZ = nextZ
      full = true
    },
    carve(x0, z0, x1, z1, halfWidth, depth, berm, bermWidth) {
      if (!placed || depth <= 0) return
      const reach = halfWidth + bermWidth
      const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - reach - field.originX) / texel))
      const c1 = Math.min(n - 1, Math.ceil((Math.max(x0, x1) + reach - field.originX) / texel))
      const r0 = Math.max(0, Math.floor((Math.min(z0, z1) - reach - field.originZ) / texel))
      const r1 = Math.min(n - 1, Math.ceil((Math.max(z0, z1) + reach - field.originZ) / texel))
      if (c1 < c0 || r1 < r0) return
      const sx = x1 - x0
      const sz = z1 - z0
      const lengthSq = sx * sx + sz * sz
      for (let row = r0; row <= r1; row++) {
        const pz = field.originZ + (row + 0.5) * texel
        for (let col = c0; col <= c1; col++) {
          const px = field.originX + (col + 0.5) * texel
          const t = lengthSq > 1e-9 ? Math.max(0, Math.min(1, ((px - x0) * sx + (pz - z0) * sz) / lengthSq)) : 0
          const d = Math.hypot(px - (x0 + sx * t), pz - (z0 + sz * t))
          if (d >= reach) continue
          const i = row * n + col
          if (d < halfWidth) {
            // Flat floor with soft walls, so the edge is smooth at 8 cm texels.
            const w = Math.max(0, Math.min(1, (d - halfWidth * 0.45) / (halfWidth * 0.55)))
            const cut = -depth * (1 - w * w * (3 - 2 * w))
            if (cut < values[i]) values[i] = cut
          } else if (values[i] > -0.01) {
            // Berm: only on snow that is not already part of another trench.
            const rise = berm * Math.sin(Math.PI * ((d - halfWidth) / bermWidth))
            if (rise > values[i]) values[i] = Math.min(DEFORM_RANGE.high, rise)
          }
        }
      }
      if (r0 < dirtyMin) dirtyMin = r0
      if (r1 > dirtyMax) dirtyMax = r1
    },
    at(x, z) {
      const gx = (x - field.originX) / texel - 0.5
      const gz = (z - field.originZ) / texel - 0.5
      if (!placed || gx < 0 || gz < 0 || gx >= n - 1 || gz >= n - 1) return 0
      const c = Math.floor(gx)
      const r = Math.floor(gz)
      const fx = gx - c
      const fz = gz - r
      const i = r * n + c
      const top = values[i] + (values[i + 1] - values[i]) * fx
      const bottom = values[i + n] + (values[i + n + 1] - values[i + n]) * fx
      return top + (bottom - top) * fz
    },
    clear() {
      values.fill(0)
      full = true
    },
  }
  return field
}

/** What one ski leaves in the snow, from the sim's view of it. */
export interface SkiImprint {
  x0: number
  z0: number
  x1: number
  z1: number
  /** How deep the ski rides in loose snow, metres. */
  sink: number
  /** Loose snow available at that spot, metres (0 on groomed and ice). */
  loose: number
  /** 0..1 sideways scrub. */
  skid: number
}

/**
 * Trench and berm for one ski. A carving ski cuts a narrow slot; a skidding
 * one shoves a wide swath aside and piles more snow beside it. Packed snow
 * still takes a faint groove so groomers show tracks too.
 */
export function imprint(field: SnowDeform, ski: SkiImprint, boardWidth = 0) {
  // Loose snow compresses behind the ski, so the track sits deeper than the planing depth.
  const depth = ski.loose > 0.02 ? Math.min(ski.loose, Math.max(ski.sink * 1.5, ski.loose * 0.5, 0.02)) : 0.012
  // A ski track is the ski plus the boot's spray: about 25 cm wide.
  const halfWidth = (boardWidth > 0 ? boardWidth / 2 + 0.04 : 0.13) + ski.skid * 0.32
  const berm = ski.loose > 0.02 ? depth * (0.32 + ski.skid * 0.5) : 0.004
  const bermWidth = 0.22 + depth * 0.6 + ski.skid * 0.25
  field.carve(ski.x0, ski.z0, ski.x1, ski.z1, halfWidth, depth, berm, bermWidth)
}

/**
 * Lays imprints into two fields. The one you see (`field`) takes them at once,
 * so the trench forms right under the skis. The one the sim reads (`packed`)
 * takes them a moment later: packed snow is shallower, so reading the skier's
 * own fresh track would make them ride up out of it.
 */
export function createStamper(field: SnowDeform, delay = 0.25) {
  const packed = createSnowDeform(field.size, field.texel)
  const queue: { due: number; ski: SkiImprint; boardWidth: number }[] = []
  let time = 0
  let last: { lx: number; lz: number; rx: number; rz: number } | null = null
  const lay = (ski: SkiImprint, boardWidth: number) => {
    imprint(field, ski, boardWidth)
    queue.push({ due: time + delay, ski, boardWidth })
  }
  return {
    field,
    packed,
    /**
     * Record this frame's skis. `side` is the skier's right on the ground, `stance` the
     * distance from the centre to each ski (0 for a board, which leaves one wide track).
     */
    push(s: { x: number; z: number; sideX: number; sideZ: number; stance: number; boardWidth: number; sink: number; loose: number; skid: number; grounded: boolean; crashed: boolean }) {
      field.recentre(s.x, s.z)
      packed.recentre(s.x, s.z)
      const lx = s.x - s.sideX * s.stance
      const lz = s.z - s.sideZ * s.stance
      const rx = s.x + s.sideX * s.stance
      const rz = s.z + s.sideZ * s.stance
      if (s.crashed && s.loose > 0.05) {
        lay({ x0: s.x, z0: s.z, x1: s.x, z1: s.z, sink: Math.min(0.35, s.loose), loose: s.loose, skid: 1 }, 0.6)
      } else if (s.grounded && last) {
        const base = { sink: s.sink, loose: s.loose, skid: s.skid }
        lay({ x0: last.lx, z0: last.lz, x1: lx, z1: lz, ...base }, s.boardWidth)
        if (s.stance > 0) lay({ x0: last.rx, z0: last.rz, x1: rx, z1: rz, ...base }, s.boardWidth)
      }
      last = s.grounded && !s.crashed ? { lx, lz, rx, rz } : null
    },
    /** Pack the snow the sim reads, once the skis have moved on. */
    step(dt: number) {
      time += dt
      let k = 0
      while (k < queue.length && queue[k].due <= time) {
        const entry = queue[k++]
        imprint(packed, entry.ski, entry.boardWidth)
      }
      if (k) queue.splice(0, k)
    },
    reset() {
      queue.length = 0
      last = null
      field.clear()
      packed.clear()
    },
  }
}
