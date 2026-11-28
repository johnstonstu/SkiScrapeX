import type * as THREE from 'three'
import type { Slope, SkiEnv } from '../sim'
import type { World } from '../world/loadWorld'
import type { TrunkIndex } from '../world/forest'
import type { indexBuildings } from '../world/buildings'
import type { Lift } from '../world/resort'
import type { ParkOverlay } from '../world/park'
import type { SnowMaterial } from '../fx'
import type { ChairRiders, RidePath } from '../render/scenery/liftView'

/** What the frame loop needs from either the Apex world or a test slope. */
import type { createStamper } from '../world/snowDeform'
import type { createSnowPatchView } from '../render/terrain/snowPatchView'
export interface Stage {
  slope: Slope
  world: World | null
  trunks: TrunkIndex | null
  buildings: ReturnType<typeof indexBuildings> | null
  snow: SnowMaterial | null
  /** `riding`: the chair the player is on, which carries nobody else. */
  advanceLifts?: (dt: number, fastLift?: string, riding?: { liftId: string; s: number } | null) => void
  /** People riding the chairlifts, who cheer a landing they can see. */
  chairRiders?: {
    /** Occupied chairs on the way up within `range` metres of a point, nearest first. */
    near(x: number, y: number, z: number, range: number): ChairRiders[]
    /** Where one of those chairs is now; false once it has reached the top. */
    seat(id: number, out: THREE.Vector3): boolean
    /** Its riders throw their arms up. */
    cheer(id: number, seconds: number, delay?: number): void
  }
  ride: ((lift: Lift) => RidePath | null) | null
  /** Put a chair at `s` metres up a lift's ride. */
  alignChair?: (lift: Lift, s: number) => void
  /** Park features, for the approach-speed hint. */
  features: () => ParkOverlay['features']
  env: SkiEnv
  /** Deformable snow: imprints from the skis, and the patch that draws them (Medium and up). */
  snowDeform?: { stamper: ReturnType<typeof createStamper>; patch: ReturnType<typeof createSnowPatchView> }
  /** Lay an event's own terrain (the mogul comp's bumps) over the ground while it runs; null removes it. */
  setEventTerrain?(layer: ((base: NonNullable<ReturnType<Slope['sampleTerrain']>>, x: number, z: number) => NonNullable<ReturnType<Slope['sampleTerrain']>>) | null): void
  /** Groom a race track while its event runs: its moguls go flat and its snow rides as groomed. Null puts them back. */
  setRaceTrack?(track: { line: readonly [number, number][]; halfWidth: number } | null): void
  /** Use a park layout for an event without saving it (null puts the player's layout back). */
  eventLayout?(siteName: string, layout: string | null): void
  /** Per-frame scenery update around the camera. */
  update(camera: THREE.Vector3): void
  /** One line for the info overlay. */
  describe(): string
  dispose?(): void
}
