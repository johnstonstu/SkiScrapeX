/**
 * Snow surface parameters the ski model reads under the skis. The world
 * layer decides which preset applies where (from the surface mask and
 * canopy); the sim blends between them over time so crossing a run edge
 * does not pop.
 */
export type SurfaceKind = 'groomed' | 'powder' | 'ice' | 'park' | 'forest' | 'rock'

export interface SurfaceParams {
  kind: SurfaceKind
  /** Base sliding friction coefficient. */
  mu: number
  /** Most lateral acceleration the snow lets an edge hold, in g. */
  latMax: number
  /** Largest edge angle the surface rewards, degrees. */
  maxEdgeDeg: number
  /** Loose snow depth available to sink into, metres (0 on packed snow). */
  depth: number
  /** Speed at which dynamic lift halves the static sink, m/s. */
  vPlane: number
  /** 0..1 tendency to chatter when the edge is near its grip limit. */
  chatter: number
  /**
   * Grip ratio (asked over held) past which a hammered edge washes out. Since
   * 0.9.40 this is per snow: a groomer holds a hard edge, ice lets go early,
   * and deep snow never washes out (it plows instead), so linked turns feel
   * the same everywhere and only hammering the edge tells the snows apart. Guesses.
   */
  washoutRatio: number
}

export const SURFACES: Record<SurfaceKind, SurfaceParams> = {
  groomed: { kind: 'groomed', mu: 0.035, latMax: 2.6, maxEdgeDeg: 60, depth: 0, vPlane: 7, chatter: 0.25, washoutRatio: 4.5 },
  ice: { kind: 'ice', mu: 0.025, latMax: 1.2, maxEdgeDeg: 45, depth: 0, vPlane: 7, chatter: 1, washoutRatio: 2.2 },
  park: { kind: 'park', mu: 0.03, latMax: 2.3, maxEdgeDeg: 50, depth: 0, vPlane: 7, chatter: 0.3, washoutRatio: 4 },
  // Deeper pack; planing starts around mid-20s km/h so slow turns stay sunk (Steep).
  powder: { kind: 'powder', mu: 0.038, latMax: 1.25, maxEdgeDeg: 38, depth: 0.4, vPlane: 6.5, chatter: 0, washoutRatio: 99 },
  forest: { kind: 'forest', mu: 0.05, latMax: 1.15, maxEdgeDeg: 38, depth: 0.24, vPlane: 6, chatter: 0, washoutRatio: 99 },
  // Thin, wind-stripped cover over rock: grabby and slow, edges skitter.
  rock: { kind: 'rock', mu: 0.11, latMax: 1.3, maxEdgeDeg: 40, depth: 0, vPlane: 7, chatter: 0.85, washoutRatio: 2.4 },
}

export type SampleSurface = (x: number, z: number) => SurfaceParams

export const groomedEverywhere: SampleSurface = () => SURFACES.groomed

/** Move `current` toward `target` by `t` (0..1), field by field. The kind follows the target. */
export function blendSurface(current: SurfaceParams, target: SurfaceParams, t: number): SurfaceParams {
  const mix = (a: number, b: number) => a + (b - a) * t
  return {
    kind: target.kind,
    mu: mix(current.mu, target.mu),
    latMax: mix(current.latMax, target.latMax),
    maxEdgeDeg: mix(current.maxEdgeDeg, target.maxEdgeDeg),
    depth: mix(current.depth, target.depth),
    vPlane: mix(current.vPlane, target.vPlane),
    chatter: mix(current.chatter, target.chatter),
    washoutRatio: mix(current.washoutRatio, target.washoutRatio),
  }
}
