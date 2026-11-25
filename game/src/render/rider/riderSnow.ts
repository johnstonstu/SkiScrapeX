/**
 * Snow that sticks to the rider's clothes. A crash packs snow on (more the
 * faster the fall, on the side that hit), and skiing deep powder cakes the
 * legs from the boots up. Both fade: crash snow over about a minute, faster
 * at speed as the wind takes it; leg snow once the rider is back on firm snow.
 */
import * as THREE from 'three'

export interface SnowInput {
  crashed: number
  crashSpeed: number
  crashHeading: number
  heading: number
  sink: number
  speed: number
  grounded: boolean
}

/** Sink (m) that counts as skiing in powder deep enough to coat the legs. */
const POWDER_SINK = 0.05

export class RiderSnow {
  /** 0..1 crash snow left on the clothes. */
  crash = 0
  /** Which side of the body hit the snow, in the rider's rest frame (+X left, +Z forward). */
  readonly side = new THREE.Vector3(0, 0, 1)
  /** Leg snow: height above the boot tops (m) and how much is left (0..1). */
  legHeight = 0
  legAmount = 0
  private wasCrashed = false

  step(s: SnowInput, dt: number) {
    const crashed = s.crashed > 0
    if (crashed && !this.wasCrashed) {
      // The fall packs snow on in one go; the faster it was, the more.
      this.crash = Math.min(1, this.crash + 0.45 + Math.min(0.5, s.crashSpeed / 25))
      const rel = s.crashHeading - s.heading
      this.side.set(Math.sin(rel) * 0.9, 0.35, Math.cos(rel)).normalize()
      // A fall in powder buries the legs too.
      if (s.sink > POWDER_SINK) {
        this.legAmount = 1
        this.legHeight = Math.max(this.legHeight, 0.45)
      }
    }
    this.wasCrashed = crashed
    if (crashed) this.crash = Math.min(1, this.crash + dt * 0.25)
    else this.crash = Math.max(0, this.crash - dt * (1 / 80 + s.speed * 0.0005))

    if (s.grounded && s.sink > POWDER_SINK && !crashed) {
      // Snow builds up the shins with depth and speed (spray), quickly.
      const target = Math.min(0.55, s.sink * 1.6 + s.speed * 0.012)
      this.legHeight += Math.max(0, target - this.legHeight) * Math.min(1, dt * 2)
      this.legAmount = Math.min(1, this.legAmount + dt * 1.5)
    } else {
      this.legAmount = Math.max(0, this.legAmount - dt / 25)
      if (this.legAmount === 0) this.legHeight = 0
    }
  }
}
