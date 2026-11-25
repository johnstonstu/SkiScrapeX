/**
 * Loose cloth and gear on the skinned rider: the jacket hem, hood, hoodie
 * drawstrings and beanie pom. Each hangs from a bone and swings toward the
 * apparent gravity the rider feels (gravity minus the body's acceleration)
 * plus air drag, through a damped spring so it lags and overshoots.
 *
 * That one rule covers the cases that matter: hanging straight down in a
 * tuck, swinging forward on a hard stop, floating up in the air (apparent
 * gravity is near zero in free fall, so drag from falling lifts it) and
 * streaming back at speed.
 */
import * as THREE from 'three'
import { Spring } from './spring'

export interface DangleSpec {
  bone: THREE.Bone
  /** The bone's hanging direction in its parent's space at rest ((0,-1,0) for a hem; (0,1,0) for a pom). */
  axis: THREE.Vector3
  /** 1 hangs fully with the force, 0 stays rigid with the parent (stiff fabric is in between). */
  follow: number
  /** Largest swing from rest, radians, so a hem cannot pass through the legs. */
  maxAngle: number
  /** Swing frequency (Hz) and damping ratio: light things are quicker and less damped. */
  hz: number
  zeta: number
  /** How strongly air drag pushes it compared with gravity. */
  drag: number
  /** Points away from the force instead of along it (a pom stands up). */
  upright?: boolean
  /** Ripple added at speed, radians. */
  flutter?: number
}

const GRAVITY = new THREE.Vector3(0, -9.81, 0)

class Dangle {
  readonly x = new Spring()
  readonly y = new Spring()
  readonly z = new Spring()
  readonly dir = new THREE.Vector3()
  started = false
  constructor(readonly spec: DangleSpec) {}
}

export class ClothPhysics {
  private readonly dangles: Dangle[]
  private readonly force = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly local = new THREE.Vector3()
  private readonly parentInverse = new THREE.Quaternion()
  private readonly swing = new THREE.Quaternion()
  private readonly identity = new THREE.Quaternion()
  private readonly flutterAxis = new THREE.Vector3(1, 0, 0)
  private readonly ripple = new THREE.Quaternion()
  private time = 0
  private speed = 0

  constructor(specs: DangleSpec[]) {
    this.dangles = specs.map((spec) => new Dangle(spec))
  }

  /**
   * Advance with the body's world acceleration and velocity (m/s², m/s).
   * Call once per frame before posing; `apply` afterwards.
   */
  step(acceleration: THREE.Vector3, velocity: THREE.Vector3, dt: number) {
    this.time += dt
    this.speed = velocity.length()
    for (const d of this.dangles) {
      const { spec } = d
      // Apparent gravity, and drag from the air streaming past.
      this.force.copy(GRAVITY).sub(acceleration).addScaledVector(velocity, -spec.drag * Math.min(1, this.speed / 8))
      if (this.force.lengthSq() < 1e-6) this.force.set(0, -1, 0)
      this.target.copy(this.force).normalize()
      if (spec.upright) this.target.negate()
      if (!d.started) {
        d.x.x = this.target.x
        d.y.x = this.target.y
        d.z.x = this.target.z
        d.started = true
      }
      d.dir.set(
        d.x.step(this.target.x, dt, spec.hz, spec.zeta),
        d.y.step(this.target.y, dt, spec.hz, spec.zeta),
        d.z.step(this.target.z, dt, spec.hz, spec.zeta),
      )
      if (d.dir.lengthSq() < 1e-8) d.dir.copy(this.target)
      d.dir.normalize()
    }
  }

  /** Point each bone along its swung direction. The skeleton's world matrices must be current. */
  apply() {
    const wind = Math.min(1, this.speed / 20)
    for (const d of this.dangles) {
      const { spec } = d
      spec.bone.parent!.getWorldQuaternion(this.parentInverse).invert()
      this.local.copy(d.dir).applyQuaternion(this.parentInverse)
      this.swing.setFromUnitVectors(spec.axis, this.local)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(this.swing.w)))
      const limit = angle > spec.maxAngle ? spec.maxAngle / angle : 1
      this.swing.slerp(this.identity, 1 - spec.follow * limit)
      if (spec.flutter) {
        // Fast, small ripple at speed about a sideways axis.
        const ripple = spec.flutter * wind * (Math.sin(this.time * 19 + spec.axis.y) * 0.6 + Math.sin(this.time * 31) * 0.4)
        this.swing.multiply(this.ripple.setFromAxisAngle(this.flutterAxis, ripple))
      }
      spec.bone.quaternion.copy(this.swing)
    }
  }
}
