import * as THREE from 'three'
import type { TrickEvent } from '../../sim'
import { planCheer } from '../../player/sfx/crowd'
import type { PlacedSound } from '../../player/sfx/engine'
import type { SkiAudio } from '../../player/audio'
import { canSee, chairsCheering, cheerSize, CHEER_GAP, CHEER_RANGE } from '../chairCheer'
import type { GameState } from './state'

/**
 * People on the chairlift react to the player: land a jump or a trick where
 * riders on a chair can see it and they whoop and clap (or wince at a crash),
 * arms in the air. The sound stays on their chair, so it comes from up the
 * line ahead and passes overhead as you ski under them.
 */
export function createChairCrowd(game: GameState, sound: Pick<SkiAudio, 'chairCheer'>, camera: THREE.Camera) {
  const playing: { id: number; sound: PlacedSound | null; left: number }[] = []
  const at = new THREE.Vector3()
  let quiet = 0

  /** A world position as the camera hears it: metres right, up and behind. */
  const heard = (v: THREE.Vector3) => v.applyMatrix4(camera.matrixWorldInverse)

  return {
    onTrick(trick: TrickEvent) {
      const riders = game.stage.chairRiders
      const size = cheerSize(trick)
      if (!riders || !size || quiet > 0 || game.ride) return
      const { x, y, z } = game.skier
      const chairs = riders
        .near(x, y, z, CHEER_RANGE)
        .filter((chair) => canSee({ dx: x - chair.x, dz: z - chair.z, facingX: chair.facingX, facingZ: chair.facingZ }))
        .slice(0, chairsCheering(size))
      if (!chairs.length) return
      quiet = CHEER_GAP
      camera.updateMatrixWorld()
      for (const [i, chair] of chairs.entries()) {
        // The second chair is further off and joins in a touch late and smaller.
        const plan = planCheer(i === 0 ? size : 'small', chair.riders, Math.random)
        heard(at.set(chair.x, chair.y, chair.z))
        const placed = sound.chairCheer(plan, at.x, at.y, at.z)
        riders.cheer(chair.id, plan.seconds + 0.4, 0.2)
        playing.push({ id: chair.id, sound: placed, left: plan.seconds + 1 })
      }
    },
    /** Keep each cheer on its chair as the chair climbs and the camera moves. */
    update(dt: number) {
      quiet = Math.max(0, quiet - dt)
      for (let i = playing.length - 1; i >= 0; i--) {
        const cheer = playing[i]
        cheer.left -= dt
        if (cheer.left <= 0 || !game.stage.chairRiders?.seat(cheer.id, at)) {
          playing.splice(i, 1)
          continue
        }
        heard(at)
        cheer.sound?.move(at.x, at.y, at.z)
      }
    },
  }
}
