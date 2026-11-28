/**
 * Getting off a chair, with no rendering: the curved glide from the seat to
 * the ready spot, and where the camera stands to watch it. Yaws are travel
 * directions, (sin yaw, cos yaw) in x and z, as in app/liftExit.ts.
 *
 * The arrival is one move for the camera. It waits low on the snow behind
 * where the rider will end up, watches them come out of the station and hook
 * round to face the hill, and then only has to rise into the follow camera.
 * A free-ski session opens with one shot before that, riding with the chair.
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface CurvePoint {
  x: number
  z: number
  /** Direction of travel at this point. */
  yaw: number
}

/** A path from the seat to the ready spot; `at(k)` for k from 0 to 1, by distance. */
export interface UnloadPath {
  at: (k: number) => CurvePoint
  /** Metres along the path. */
  length: number
  /** Where it ends: the ready spot. */
  end: { x: number; z: number }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const smooth = (k: number) => k * k * (3 - 2 * k)

/** Straight out along `yaw`, pivoting to `face` over the last part: the way off when an arc does not fit. */
export function straightUnload(from: { x: number; z: number }, to: { x: number; z: number }, yaw: number, face: number): UnloadPath {
  const turn = wrap(face - yaw)
  return {
    length: Math.hypot(to.x - from.x, to.z - from.z),
    end: { x: to.x, z: to.z },
    at(k) {
      const settle = Math.max(0, (k - 0.55) / 0.45)
      return { x: from.x + (to.x - from.x) * k, z: from.z + (to.z - from.z) * k, yaw: yaw + turn * smooth(settle) }
    },
  }
}

/** Turn radii tried for the hook off the ramp, widest first, metres. */
const HOOK_RADII = [4.2, 3.2, 2.4]
/** Open snow wanted past the end of the hook, along the facing, metres. */
const HOOK_ROOM = 9

/**
 * A carved way off: straight down the ramp along `yaw`, then one round turn
 * to `face`, so the rider arrives already travelling the way they will ski
 * off instead of spinning on the spot. The turn starts early enough that it
 * goes no further from the station than `to` did, and ends to the side of
 * `to` (`end`), on the inside of the turn. `blocked` (buildings, trees)
 * tightens it; if no arc fits the straight glide is used.
 */
export function unloadPath(
  from: { x: number; z: number },
  to: { x: number; z: number },
  yaw: number,
  face: number,
  blocked: (x: number, z: number) => boolean = () => false,
): UnloadPath {
  const chord = Math.hypot(to.x - from.x, to.z - from.z)
  const turn = wrap(face - yaw)
  const angle = Math.abs(turn)
  // Nearly straight already: nothing to carve.
  if (angle < 0.25 || chord < 5) return straightUnload(from, to, yaw, face)
  const way = Math.sign(turn)
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  for (const radius of HOOK_RADII) {
    // The arc reaches furthest along the ramp a quarter turn in (or at its end, for less than that).
    const reach = radius * (angle > Math.PI / 2 ? 1 : Math.sin(angle))
    const straight = chord - reach
    if (straight < 3) continue
    const ax = from.x + fx * straight
    const az = from.z + fz * straight
    // Centre of the turn: beside the start of the arc, on the inside.
    const cx = ax + Math.sin(yaw + (way * Math.PI) / 2) * radius
    const cz = az + Math.cos(yaw + (way * Math.PI) / 2) * radius
    const length = straight + radius * angle
    const at = (k: number): CurvePoint => {
      const s = Math.min(1, Math.max(0, k)) * length
      if (s <= straight) return { x: from.x + fx * s, z: from.z + fz * s, yaw }
      const heading = yaw + way * ((s - straight) / radius)
      // On the circle, a quarter turn back from the heading as seen from the centre.
      return { x: cx + Math.sin(heading - (way * Math.PI) / 2) * radius, z: cz + Math.cos(heading - (way * Math.PI) / 2) * radius, yaw: heading }
    }
    const end = at(1)
    let clear = true
    for (let i = 0; i <= 12 && clear; i++) {
      const p = at((straight + ((length - straight) * i) / 12) / length)
      if (blocked(p.x, p.z)) clear = false
    }
    for (let d = 1.5; d <= HOOK_ROOM && clear; d += 1.5) if (blocked(end.x + Math.sin(face) * d, end.z + Math.cos(face) * d)) clear = false
    if (clear) return { at, length, end: { x: end.x, z: end.z } }
  }
  return straightUnload(from, to, yaw, face)
}

/** Seconds the glide off the chair takes, from how far it goes. */
export function unloadSeconds(path: UnloadPath): number {
  return Math.min(3.8, Math.max(2.2, path.length / 3.6))
}

/** How far along the path the rider is at `k` (0 to 1 of the time): quick off the ramp, easing to a glide. */
export function unloadProgress(k: number): number {
  const c = Math.min(1, Math.max(0, k))
  // Starts near the chair's speed and ends at a walking glide, with no stop.
  return c * (1.4 - 0.4 * c)
}

export interface Shot {
  position: Point3
  look: Point3
}

/** Lenses for the arrival shots, degrees of vertical field of view: longer than the follow camera's, so the rider fills the frame. */
export const SHOT_FOV = { chair: 40, ground: 38 } as const

/**
 * The ground shot's lens for a rider `distance` metres away: long while they
 * are still in the station, opening as they come toward the camera, so they
 * stay about a third of the frame tall.
 */
export function groundLens(distance: number): number {
  const fov = (2 * Math.atan(3.1 / Math.max(1, distance)) * 180) / Math.PI
  return Math.min(SHOT_FOV.ground, Math.max(20, fov))
}

/**
 * Opening shot, riding with the chair: ahead of the rider and off to the
 * outside of the line, looking back at them with the valley behind. `t` is
 * seconds into the shot; the camera drifts in a little as it runs.
 */
export function chairShot(rider: Point3, yaw: number, t: number, side: 1 | -1): Shot {
  const drift = 1 - Math.exp(-t * 0.45)
  const ahead = 5.6 - 1.2 * drift
  const aside = (3.1 - 0.8 * drift) * side
  const fx = Math.sin(yaw)
  const fz = Math.cos(yaw)
  // Right of the direction of travel.
  const rx = -Math.cos(yaw)
  const rz = Math.sin(yaw)
  return {
    position: { x: rider.x + fx * ahead + rx * aside, y: rider.y + 1.05 + 0.25 * drift, z: rider.z + fz * ahead + rz * aside },
    look: { x: rider.x + rx * aside * 0.12, y: rider.y + 0.75, z: rider.z + rz * aside * 0.12 },
  }
}

/**
 * Where the camera waits for the rider at the top: behind the spot they will
 * stop at (so the follow camera is one short rise away), low on the snow and
 * a little to one side, clear of buildings and trees.
 */
export function groundShotPosition(
  spot: { x: number; z: number },
  face: number,
  from: { x: number; z: number },
  heightAt: (x: number, z: number) => number | null,
  blocked: (x: number, z: number) => boolean,
): Point3 {
  const fx = Math.sin(face)
  const fz = Math.cos(face)
  const rx = -Math.cos(face)
  const rz = Math.sin(face)
  // Stand toward the station's side of the spot: the rider comes round the outside of the turn into the frame.
  const stationSide = (from.x - spot.x) * rx + (from.z - spot.z) * rz
  const prefer = stationSide > 0 ? 1 : -1
  let best: Point3 | null = null
  for (const back of [8.2, 7, 5.8, 4.6]) {
    for (const aside of [3.6 * prefer, -3.6 * prefer, 0]) {
      const x = spot.x - fx * back + rx * aside
      const z = spot.z - fz * back + rz * aside
      const ground = heightAt(x, z)
      if (ground === null || blocked(x, z)) continue
      best = { x, y: ground + 1.35, z }
      break
    }
    if (best) break
  }
  if (best) return best
  const ground = heightAt(spot.x, spot.z) ?? 0
  return { x: spot.x - fx * 4, y: ground + 1.6, z: spot.z - fz * 4 }
}
