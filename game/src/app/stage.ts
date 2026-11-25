import type * as THREE from 'three'
import type { Slope, SkiEnv } from '../sim'
import type { World } from '../world/loadWorld'
import type { TrunkIndex } from '../world/forest'
import type { indexBuildings } from '../world/buildings'
import type { Lift } from '../world/resort'
import type { ParkOverlay } from '../world/park'
import type { SnowMaterial } from '../fx'
import type { RidePath } from '../render/scenery/liftView'

/** What the frame loop needs from either the Apex world or a test slope. */
import type { createStamper } from '../world/snowDeform'
import type { createSnowPatchView } from '../render/terrain/snowPatchView'
export interface Stage {
  slope: Slope
  world: World | null
  trunks: TrunkIndex | null
  buildings: ReturnType<typeof indexBuildings> | null
  snow: SnowMaterial | null
  advanceLifts?: (dt: number, fastLift?: string) => void
  ride: ((lift: Lift) => RidePath | null) | null
  /** Put a chair at `s` metres up a lift's ride. */
  alignChair?: (lift: Lift, s: number) => void
  /** Park features, for the approach-speed hint. */
  features: () => ParkOverlay['features']
  env: SkiEnv
  /** Deformable snow: imprints from the skis, and the patch that draws them (Medium and up). */
  snowDeform?: { stamper: ReturnType<typeof createStamper>; patch: ReturnType<typeof createSnowPatchView> }
  /** Per-frame scenery update around the camera. */
  update(camera: THREE.Vector3): void
  /** One line for the info overlay. */
  describe(): string
  dispose?(): void
}
