import type { SfxScene } from '../player/sfx/mix'
import type { Stage } from './stage'

/**
 * Where the rider is, for the background sound layers: how close the village
 * and the nearest lift station are, how many trees stand around, and how high
 * and exposed the ground is. Pure geometry from the stage, sampled a few times
 * a second.
 */
export function createSoundScene(stage: Stage) {
  const resort = stage.world?.resort
  const buildings = (resort?.buildings ?? [])
    .filter((b) => b.points.length > 2)
    .map((b) => ({ x: b.points.reduce((sum, p) => sum + p.x, 0) / b.points.length, z: b.points.reduce((sum, p) => sum + p.z, 0) / b.points.length }))
  const stations = (resort?.lifts ?? []).flatMap((lift) => [lift.bottom, lift.top])
  const heightAt = (x: number, z: number) => stage.slope.sampleTerrain(x, z)?.height
  const stationHeights = stations.map(([x, z]) => heightAt(x, z)).filter((h): h is number => h !== undefined)
  const low = stationHeights.length ? Math.min(...stationHeights) : 0
  const high = stationHeights.length ? Math.max(...stationHeights) : 1
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  const RING: readonly [number, number][] = [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14], [24, 24], [-24, 24], [24, -24], [-24, -24]]
  let forest = 0

  return {
    /** `wind` is the weather wind's strength, 0..1. Call a few times a second; `dt` since the last call. */
    sample(x: number, y: number, z: number, wind: number, dt: number): SfxScene {
      // Buildings within about 150 m, weighted by distance: one hut is not a village.
      let near = 0
      for (const b of buildings) near += clamp01(1 - Math.hypot(b.x - x, b.z - z) / 150)
      let station = 0
      for (const [sx, sz] of stations) station = Math.max(station, clamp01(1 - (Math.hypot(sx - x, sz - z) - 8) / 70))
      let trees = 0
      if (stage.trunks) for (const [dx, dz] of RING) if (stage.trunks.hit(x + dx, z + dz, 7)) trees++
      // Smoothed, so skiing through a gap in the trees does not switch the forest off.
      forest += (clamp01(trees / 5) - forest) * Math.min(1, dt * 1.5)
      const heightShare = high > low ? clamp01((y - low) / (high - low)) : 0
      return {
        village: clamp01(near / 4),
        station,
        forest,
        alpine: clamp01((heightShare - 0.5) / 0.35) * (1 - forest),
        wind: clamp01(wind),
      }
    },
  }
}
