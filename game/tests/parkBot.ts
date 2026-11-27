import { FIXED_DT, SURFACES, createSkiState, stepSkier, type SkiInput, type SkiState, type SkiEnv } from '../src/sim'
import { buildParkOverlay, dropInSpawn, jumpOutcome, placeFeatures, type ParkSite, type PlacedFeature } from '../src/world/park'
import type { ApexWorld } from './apexWorld'
import { createParkPace } from '../src/app/parkPace'

export interface Hit { feature: PlacedFeature; lip: number; outcome: string | null; grade: string | null }

/**
 * A park bot: drop in at the top of a park and ride it hands-off (no
 * steering, no tuck or brake) with the park assist, as a player who just
 * points it down the main line. Optionally pops at each lip.
 */
export function rideMainLine(world: ApexWorld, site: ParkSite, layout = site.layout, opts: { pop?: boolean; seconds?: number; pace?: number } = {}) {
  const features = placeFeatures(site, layout, world.grid.heightAt)
  const overlay = buildParkOverlay(features, world.grid.sampleTerrain, world.grid.heightAt)
  const env: SkiEnv = { rails: overlay.rails, sampleSurface: () => SURFACES.park }
  const spawn = dropInSpawn(site)
  const s = createSkiState(spawn)
  const g = overlay.sampleTerrain(s.x, s.z)!
  s.y = g.height
  // As createSkier does for a rolling spawn.
  const fwd = { x: -Math.sin(s.heading), z: Math.cos(s.heading) }
  const slopeY = -(g.normal.x * fwd.x + g.normal.z * fwd.z) / g.normal.y
  const len = Math.hypot(fwd.x, slopeY, fwd.z)
  s.vx = (fwd.x / len) * spawn.speed; s.vy = (slopeY / len) * spawn.speed; s.vz = (fwd.z / len) * spawn.speed; s.speed = spawn.speed
  const axis = site.featureLine!
  const [ax, az] = axis[0]
  const dx = axis[1][0] - ax, dz = axis[1][1] - az
  const L = Math.hypot(dx, dz)
  const main = features.filter((f) => f.lane === 0)
  const hits: Hit[] = []
  let crashes = 0, maxDrift = 0, minKmh = Infinity, rails = 0
  const pace = createParkPace()
  let lastSeq = 0
  const input: SkiInput = { steer: 0, brake: 0, tuck: false }
  let t = 0
  for (; t < (opts.seconds ?? 120); t += FIXED_DT) {
    const along = ((s.x - ax) * dx + (s.z - az) * dz) / L
    if (along > L - 3) break
    maxDrift = Math.max(maxDrift, Math.abs((-(s.x - ax) * dz + (s.z - az) * dx) / L))
    if (t > 1) minKmh = Math.min(minKmh, s.speed * 3.6)
    // Pop: hold jump on the ramp, let go at the lip.
    if (opts.pop) {
      const next = main.find((f) => f.lip && ((f.lip.x - s.x) * f.dirX + (f.lip.z - s.z) * f.dirZ) > 0 && ((f.lip.x - s.x) * f.dirX + (f.lip.z - s.z) * f.dirZ) < 6)
      input.jump = Boolean(next) && s.grounded
    }
    stepSkier(s, input, overlay.sampleTerrain, FIXED_DT, env)
    pace.step(s, input, features, overlay.rails, FIXED_DT, opts.pace ?? 1)
    const landed = pace.takeLanding()
    if (landed && landed.feature.lane === 0) hits.push({ feature: landed.feature, lip: landed.lipSpeed * 3.6, outcome: landed.outcome, grade: null })
    if (s.rail) rails++
    if (s.trick && s.trick.seq !== lastSeq) {
      lastSeq = s.trick.seq
      if (s.trick.kind === 'air' && hits.length) hits[hits.length - 1].grade = s.trick.grade
      if (s.trick.grade === 'crash') crashes++
    }
  }
  return { features, main, hits, crashes, maxDrift, minKmh, rails, time: t, end: s }
}

export function fmtRide(name: string, r: ReturnType<typeof rideMainLine>) {
  const lines = r.hits.map((h) => `  ${h.feature.spec.label.padEnd(22)} lip ${h.lip.toFixed(0)} km/h window ${(h.feature.window![0] * 3.6).toFixed(0)}-${(h.feature.window![1] * 3.6).toFixed(0)} ${h.outcome} ${h.grade}`)
  return `${name}: main ${r.main.map((f) => f.spec.kind[0]).join('')} jumps hit ${r.hits.length}/${r.main.filter((f) => f.lip).length} rails ${r.rails} crashes ${r.crashes} drift ${r.maxDrift.toFixed(1)} m min ${r.minKmh.toFixed(0)} km/h time ${r.time.toFixed(1)}s\n${lines.join('\n')}`
}
