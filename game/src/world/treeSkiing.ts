import { beginCrash, fallLineHeading, type SampleTerrain, type SkiState, type SurfaceSample } from '../sim'
import type { TrunkContact, TrunkIndex } from './forest'

const SKIER_RADIUS = 0.22
/**
 * Speed into the trunk (m/s) that takes the rider down: 8 m/s, about 29 km/h
 * square on (was 5.5 before 0.9.40, so most glade bumps were crashes). Guess.
 */
const HARD_HIT = 8
/** Below this speed into the trunk a contact just slides along it, with no knock. */
const BRUSH_MIN = 1.2
/** Share of the speed into the trunk that bounces the rider back off it. */
const BRUSH_BOUNCE = 0.2
/** Speed kept along the trunk, lost per m/s of impact (a 6 m/s knock keeps about 70%). */
const BRUSH_LOSS = 0.05
/** A crash gets up somewhere with this much clear line down the hill (falls back to 3.5 m). */
const CLEAR_LINE = 7

/**
 * A tree contact: `crash` takes the rider down, `brush` knocks them aside
 * (shoulder off the trunk, some speed lost), `slide` is a graze along it.
 */
export interface TreeHit {
  kind: 'crash' | 'brush' | 'slide'
  /** Speed into the trunk, m/s. */
  into: number
}

/**
 * Resolve one grounded sweep. A square hit above `HARD_HIT` crashes, unless
 * the rider just got up from a crash (`crashGrace`), so trees never knock
 * them down twice in a row.
 */
export function resolveTreeContact(
  state: SkiState, fromX: number, fromZ: number, trunks: TrunkIndex, terrain: SampleTerrain,
): TreeHit | null {
  if (!state.grounded || state.offMap || state.rail || state.crashed > 0) return null
  if (state.x === fromX && state.z === fromZ) return null
  const hit = trunks.sweep(fromX, fromZ, state.x, state.z, SKIER_RADIUS)
  if (!hit) return null
  const into = Math.max(0, -(state.vx * hit.nx + state.vz * hit.nz))
  const x = hit.x + hit.nx * 0.07
  const z = hit.z + hit.nz * 0.07
  const base = terrain(x, z)
  if (!base) return null

  if (into >= HARD_HIT && state.crashGrace <= 0) {
    const gap = recoveryGap(hit, base, trunks, terrain, CLEAR_LINE) ?? recoveryGap(hit, base, trunks, terrain, 3.5)
    state.x = gap?.x ?? x
    state.z = gap?.z ?? z
    state.y = gap?.height ?? base.height
    beginCrash(state, Math.max(into, Math.hypot(state.vx, state.vz)))
    state.vx = state.vy = state.vz = state.speed = 0
    state.air = null
    state.popCharge = state.windup = 0
    state.jumpHeld = false
    return { kind: 'crash', into }
  }

  state.x = x
  state.z = z
  state.y = base.height
  // Remove the velocity into the trunk, keeping the component that slides along it.
  state.vx += hit.nx * into
  state.vz += hit.nz * into
  const brush = into >= BRUSH_MIN
  if (brush) {
    // Shoulder off the trunk: lose some speed along it and bounce a little clear,
    // then point the skis where the rider is now going so the edge does not
    // carve straight back into the same tree.
    const keep = Math.max(0.35, 1 - BRUSH_LOSS * into)
    state.vx = state.vx * keep + hit.nx * into * BRUSH_BOUNCE
    state.vz = state.vz * keep + hit.nz * into * BRUSH_BOUNCE
    if (Math.hypot(state.vx, state.vz) > 0.5) {
      state.heading = Math.atan2(-state.vx, state.vz) + (state.ridingSwitch ? Math.PI : 0)
      state.edgeAngle *= 0.3
    }
  }
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
  return { kind: brush ? 'brush' : 'slide', into }
}

function recoveryGap(hit: TrunkContact, ground: SurfaceSample, trunks: TrunkIndex, terrain: SampleTerrain, clear: number) {
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
    const endX = x - Math.sin(fall) * clear, endZ = z + Math.cos(fall) * clear
    if (terrain(endX, endZ) && !trunks.sweep(x, z, endX, endZ, SKIER_RADIUS + 0.1)) return { x, z, height: snow.height }
  }
  return null
}
