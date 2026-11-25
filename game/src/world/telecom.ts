/**
 * Telecom towers on both peaks (Stu's 0.9.13 playtest). Apex Mountain, the
 * 2247 m peak 2.4 km south, is "cluttered with numerous telecommunications
 * installations" (stevensong.com, sonnybou.ca; game/research/apex-references.md).
 * Beaconsfield, the resort summit, has towers too, on the south side of the
 * summit where OSM maps two small untagged footprints. Positions only; the
 * meshes are in render/scenery/telecomView.ts.
 */

export type TelecomKind = 'lattice' | 'monopole' | 'cabinet'

export interface TelecomSite {
  kind: TelecomKind
  x: number
  z: number
  /** Ground under the footprint (lowest corner, so nothing floats), metres above the grid origin. */
  y: number
  /** Tower height, or cabinet height, metres. */
  height: number
  /** Yaw, radians. */
  yaw: number
}

type Plan = [TelecomKind, number, number, number][]

/** Highest point within `radius` metres of (x, z), on a `step` metre search grid. */
export function summitNear(heightAt: (x: number, z: number) => number, x: number, z: number, radius = 160, step = 10): { x: number; z: number; y: number } | null {
  let best: { x: number; z: number; y: number } | null = null
  for (let dz = -radius; dz <= radius; dz += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      if (dx * dx + dz * dz > radius * radius) continue
      const y = heightAt(x + dx, z + dz)
      if (Number.isFinite(y) && (!best || y > best.y)) best = { x: x + dx, z: z + dz, y }
    }
  }
  return best
}

/** Direction (radians) along which the ground stays highest 40 m out each way. */
function ridgeDirection(heightAt: (x: number, z: number) => number, x: number, z: number): number {
  let ridge = 0
  let best = -Infinity
  for (let a = 0; a < Math.PI; a += Math.PI / 12) {
    const h = heightAt(x + Math.cos(a) * 40, z + Math.sin(a) * 40) + heightAt(x - Math.cos(a) * 40, z - Math.sin(a) * 40)
    if (h > best) ((best = h), (ridge = a))
  }
  return ridge
}

function place(heightAt: (x: number, z: number) => number, x: number, z: number, yaw: number, plan: Plan): TelecomSite[] {
  const ux = Math.cos(yaw)
  const uz = Math.sin(yaw)
  const sites: TelecomSite[] = []
  for (const [kind, along, across, height] of plan) {
    const px = x + ux * along - uz * across
    const pz = z + uz * along + ux * across
    const reach = kind === 'cabinet' ? 1.6 : 2.5
    let y = Infinity
    for (const [cx, cz] of [[0, 0], [reach, reach], [-reach, reach], [reach, -reach], [-reach, -reach]]) {
      const h = heightAt(px + cx, pz + cz)
      if (Number.isFinite(h)) y = Math.min(y, h)
    }
    if (Number.isFinite(y)) sites.push({ kind, x: px, z: pz, y, height, yaw })
  }
  return sites
}

/** Apex Mountain: two lattice towers, a monopole and their cabinets along the summit ridge. */
export function apexMountainTowers(heightAt: (x: number, z: number) => number, peak: { x: number; z: number }): TelecomSite[] {
  const top = summitNear(heightAt, peak.x, peak.z)
  if (!top) return []
  return place(heightAt, top.x, top.z, ridgeDirection(heightAt, top.x, top.z), [
    ['lattice', 0, 0, 46],
    ['cabinet', 0, 9, 2.6],
    ['lattice', -38, -4, 32],
    ['cabinet', -38, 7, 2.4],
    ['monopole', 34, 3, 24],
    ['cabinet', 30, 10, 2.4],
  ])
}

/**
 * Beaconsfield summit: a lattice tower and a monopole on the two small OSM
 * footprints south of the Billy Goat Hut (way/171556521 and way/171556575),
 * each with an equipment cabinet rather than a building.
 */
export const BEACONSFIELD_TOWERS = [
  { kind: 'lattice' as const, x: 1515, z: 1595, height: 28 },
  { kind: 'monopole' as const, x: 1487, z: 1588, height: 20 },
]

export function beaconsfieldTowers(heightAt: (x: number, z: number) => number): TelecomSite[] {
  return BEACONSFIELD_TOWERS.flatMap((tower) =>
    place(heightAt, tower.x, tower.z, ridgeDirection(heightAt, tower.x, tower.z), [
      [tower.kind, 0, 0, tower.height],
      ['cabinet', 0, 5, 2.3],
    ]),
  )
}
