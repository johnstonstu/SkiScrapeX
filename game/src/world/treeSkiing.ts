import { beginCrash, fallLineHeading, type SampleTerrain, type SkiState, type SurfaceSample } from '../sim'
import type { TrunkContact, TrunkIndex } from './forest'

const SKIER_RADIUS = 0.22
const HARD_HIT = 5.5

/** Resolve one grounded sweep. Return the normal impact speed for a wipeout. */
export function resolveTreeContact(
  state: SkiState, fromX: number, fromZ: number, trunks: TrunkIndex, terrain: SampleTerrain,
): number | null {
  if (!state.grounded || state.offMap || state.rail || state.crashed > 0) return null
  if (state.x === fromX && state.z === fromZ) return null
  const hit = trunks.sweep(fromX, fromZ, state.x, state.z, SKIER_RADIUS)
  if (!hit) return null
  const into = Math.max(0, -(state.vx * hit.nx + state.vz * hit.nz))
  const x = hit.x + hit.nx * 0.07
  const z = hit.z + hit.nz * 0.07
  const base = terrain(x, z)
  if (!base) return null

  if (into >= HARD_HIT) {
    const gap = recoveryGap(hit, base, trunks, terrain)
    state.x = gap?.x ?? x
    state.z = gap?.z ?? z
    state.y = gap?.height ?? base.height
    beginCrash(state, Math.max(into, Math.hypot(state.vx, state.vz)))
    state.vx = state.vy = state.vz = state.speed = 0
    state.air = null
    state.popCharge = state.windup = 0
    state.jumpHeld = false
    return into
  }

  state.x = x
  state.z = z
  state.y = base.height
  // Remove the velocity into the trunk, keeping the component that slides along it.
  state.vx += hit.nx * into
  state.vz += hit.nz * into
  // A slow, square contact can bleed all tangential speed. Give the rider a
  // small step toward a clear side so the fall line does not pin them in place.
  if (into > 0 && Math.hypot(state.vx, state.vz) < 0.6) {
    const tx = -hit.nz, tz = hit.nx
    const side = tx * base.normal.x + tz * base.normal.z >= 0 ? 1 : -1
    for (const direction of [side, -side]) {
      const stepX = x + tx * direction * 0.75, stepZ = z + tz * direction * 0.75
      if (!terrain(stepX, stepZ) || trunks.sweep(x, z, stepX, stepZ, SKIER_RADIUS)) continue
      state.vx = tx * direction * 0.8 + hit.nx * 0.18
      state.vz = tz * direction * 0.8 + hit.nz * 0.18
      break
    }
  }
  state.vy = -(base.normal.x * state.vx + base.normal.z * state.vz) / Math.max(0.15, base.normal.y)
  state.speed = Math.hypot(state.vx, state.vy, state.vz)
  return null
}

function recoveryGap(hit: TrunkContact, ground: SurfaceSample, trunks: TrunkIndex, terrain: SampleTerrain) {
  // Look to either side of the impact, with enough room to get moving downhill.
  const heading = fallLineHeading(ground.normal) ?? 0
  const dx = -Math.sin(heading), dz = Math.cos(heading)
  const side = -hit.nz * dx + hit.nx * dz >= 0 ? 1 : -1
  for (const offset of [1.45, -1.45, 2.1, -2.1, 0]) {
    const x = hit.x + hit.nx * 0.44 - hit.nz * offset * side
    const z = hit.z + hit.nz * 0.44 + hit.nx * offset * side
    const snow = terrain(x, z)
    if (!snow || trunks.hit(x, z, SKIER_RADIUS + 0.1)) continue
    const fall = fallLineHeading(snow.normal) ?? heading
    const endX = x - Math.sin(fall) * 3.5, endZ = z + Math.cos(fall) * 3.5
    if (terrain(endX, endZ) && !trunks.sweep(x, z, endX, endZ, SKIER_RADIUS + 0.1)) return { x, z, height: snow.height }
  }
  return null
}
