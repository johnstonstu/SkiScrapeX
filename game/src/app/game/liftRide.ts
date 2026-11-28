import * as THREE from 'three'
import type { createCameraRig } from '../../player/camera'
import type { createSkiAudio } from '../../player/audio'
import type { createHaptics } from '../../player/haptics'
import type { createSnowEffects } from '../../player/effects'
import type { Controls } from '../../player/input'
import type { SkierPose } from '../../render/rider/skierView'
import { sampleRide } from '../../render/scenery/liftView'
import { chooseCourse, nearestOnPolyline, type Lift } from '../../world/resort'
import type { getUi } from '../dom'
import { chooseExit } from '../liftExit'
import type { createCoach } from '../tutorial'
import type { GameState, Ride } from './state'
import { SHOT_FOV, chairShot, groundLens, groundShotPosition, unloadPath, unloadProgress, unloadSeconds } from './arrival'

export interface LiftRideDeps {
  ui: ReturnType<typeof getUi>
  rig: ReturnType<typeof createCameraRig>
  effects: ReturnType<typeof createSnowEffects>
  sound: ReturnType<typeof createSkiAudio>
  haptics: ReturnType<typeof createHaptics>
  coach: ReturnType<typeof createCoach>
  controls: Controls
  /** Back to free skiing (ends any challenge). */
  setFreeSki: () => void
  /** Put the skier at the course start; `keepCamera` eases from the arrival shot. */
  spawn: (keepCamera?: boolean) => void
  /** The opening film starts and ends: the screen clears for it and the HUD comes back after. */
  onOpening?: (on: boolean, lift: Lift | null) => void
}

/**
 * Lift rides: boarding, the ride itself (hold tuck to speed it up, Skip to
 * jump ahead), the arrival shot and stepping off at the top. While a ride runs
 * the physics is paused and `stepRide` moves the rider each frame.
 */
export function createLiftRides(game: GameState, deps: LiftRideDeps) {
  const { ui, rig, effects, sound, haptics, coach, controls, setFreeSki, spawn, onOpening } = deps
  /** Seconds of ride left after Skip, so you arrive at the top and get off. */
  const SKIP_LEAD = 2.2
  /** Seconds of chair ride shown when a free-ski session starts. */
  const ARRIVAL_SECONDS = 5.6
  /** Metres from the top where the opening cuts from the chair to the snow. */
  const OPENING_CUT = 9.5
  const shotPos = new THREE.Vector3()
  const shotLook = new THREE.Vector3()
  const ridePoint = new THREE.Vector3()

  function startRide(lift: Lift, opening = false) {
    setFreeSki()
    if (!opening) coach.tip(
      'lift',
      'Lift ride',
      game.mobile ? 'Push the stick up to speed the ride up, or tap Skip to go straight to the top.' : controls.gamepad ? 'Hold the stick up to speed up, or press <kbd>B</kbd> to skip to the top.' : 'Hold <kbd>W</kbd> to speed up. Press <kbd>Enter</kbd> or select Skip to go to the top.',
    )
    const path = game.stage.ride?.(lift) ?? null
    if (!path) {
      finishRide(lift)
      return
    }
    game.ride = { lift, path, s: path.boardingDistance, unload: null }
    ui.title.textContent = `Riding ${lift.name}`
    ui.best.textContent = '–'
    ui.ride.hidden = false
    effects.clear()
    game.stage.snowDeform?.stamper.reset()
    sound.reset()
    haptics.reset()
    rig.snap()
  }

  /**
   * Free skiing starts at the top of Quickdraw: ride the last few seconds of the
   * chair into the top station and step off, so every session opens with the
   * arrival rather than a skier standing in the snow.
   */
  function arriveByChair() {
    const lift = game.stage.world?.resort.lifts.find((l) => /quickdraw/i.test(l.name))
    if (!lift || !game.stage.ride) return
    setFreeSki()
    // Lifts do not run behind the title screen: put a chair a few seconds from the top.
    game.stage.advanceLifts?.(0)
    const path = game.stage.ride(lift)
    if (!path) return
    const at = Math.max(0, path.total - path.speed * ARRIVAL_SECONDS)
    game.stage.alignChair?.(lift, at)
    startRide(lift, true)
    if (!game.ride) return
    game.ride.s = at
    game.ride.opening = { t: 0, cut: false }
    onOpening?.(true, lift)
    arrivalShot(game.ride)
    rig.snap()
  }

  /** Skip: jump to just before the top and ride in. A second press steps straight off. */
  function skipRide() {
    if (!game.ride) return
    // The press that chose Drop in (Enter held, or a double tap) must not also skip the film.
    if (game.ride.opening && game.ride.opening.t < 0.8) return
    if (game.ride.opening && !game.ride.unload) beginUnload(game.ride)
    if (!game.ride) return
    if (game.ride.unload) {
      // Straight to the ready spot, with a cut.
      const { lift, unload } = game.ride
      finishRide(lift, unload, true)
      return
    }
    const lead = game.ride.path.speed * SKIP_LEAD
    if (game.ride.s < game.ride.path.total - lead) {
      // Jump whole chair spacings so the rider is still sitting on a chair.
      const spacing = game.ride.path.spacing ?? 0
      const jump = game.ride.path.total - lead - game.ride.s
      game.ride.s += spacing > 0 ? Math.floor(jump / spacing) * spacing : jump
      rig.snap()
    } else beginUnload(game.ride)
  }

  /**
   * The end of the ride and the way off it (`chooseExit`): a spot past the
   * station with room to head off either way, facing down the fall line.
   */
  function exitPlan(current: Ride): NonNullable<Ride['exit']> {
    if (current.exit) return current.exit
    const from = new THREE.Vector3()
    const lineYaw = sampleRide(current.path, current.path.total, from)
    const line = current.lift.line
    const spot = chooseExit(from.x, from.z, lineYaw, {
      aerial: current.path.aerial,
      sample: game.stage.slope.sampleTerrain,
      blocked: (x, z) => Boolean(game.stage.buildings?.hit(x, z) || game.stage.trunks?.hit(x, z, 1.2)),
      lineDistanceSq: (x, z) => nearestOnPolyline(x, z, line).distanceSq,
    })
    const blocked = (x: number, z: number) => !game.stage.slope.sampleTerrain(x, z) || Boolean(game.stage.buildings?.hit(x, z) || game.stage.trunks?.hit(x, z, 1.2))
    // Chairs carve off the ramp round to the facing; the ready spot is where that turn ends.
    const path = current.path.aerial ? unloadPath(from, spot, spot.yaw, spot.face, blocked) : undefined
    current.exit = { from, yaw: spot.yaw, lineYaw, spot, path, stop: path?.end ?? { x: spot.x, z: spot.z } }
    return current.exit
  }

  /** Off the chair (or the T-bar) at the top: glide from the seat to the end of the ramp. */
  function beginUnload(current: Ride) {
    const { from, yaw, spot, path, stop } = exitPlan(current)
    const ground = game.stage.slope.sampleTerrain(stop.x, stop.z)
    if (!ground) {
      finishRide(current.lift)
      return
    }
    current.unload = { t: 0, from: from.clone(), to: new THREE.Vector3(stop.x, ground.height, stop.z), yaw, face: spot.face, path, seconds: path ? unloadSeconds(path) : undefined }
    ui.rideText.textContent = `Top of ${current.lift.name}`
  }

  /**
   * Arrival shot: the camera waits beside the top station's exit and watches the
   * rider come out and step off, instead of following through the terminal.
   */
  function arrivalShot(current: Ride) {
    const { from, yaw, spot, stop } = exitPlan(current)
    const aerial = current.path.aerial
    const remaining = current.path.total - current.s
    const opening = current.opening
    if (opening && !current.unload && remaining > OPENING_CUT) {
      // On the chair: the camera rides ahead on the outside of the line, looking back at the rider.
      const lineYaw = sampleRide(current.path, current.s, ridePoint)
      const shot = chairShot(game.skier, lineYaw, opening.t, chairSide(current, lineYaw))
      rig.holdShot(shotPos.set(shot.position.x, shot.position.y, shot.position.z), shotLook.set(shot.look.x, shot.look.y, shot.look.z), true, SHOT_FOV.chair)
      return
    }
    if (!opening && !current.unload && remaining > (aerial ? 30 : 8) && !rig.holding) {
      rig.releaseShot()
      return
    }
    const sample = game.stage.slope.sampleTerrain
    if (aerial) {
      // Low on the snow behind where the rider will stop: they come out of the station, hook round
      // to face the hill, and the follow camera is one short rise away.
      const at = groundShotPosition(stop, spot.face, from, (x, z) => sample(x, z)?.height ?? null, (x, z) => Boolean(game.stage.buildings?.hit(x, z) || game.stage.trunks?.hit(x, z, 1.6)))
      shotPos.set(at.x, at.y, at.z)
    } else {
      // Surface lifts: ahead of the exit, off to the left of the way out.
      const sx = Math.cos(yaw)
      const sz = -Math.sin(yaw)
      shotPos.set(from.x + Math.sin(yaw) * 9 - sx * 6, 0, from.z + Math.cos(yaw) * 9 - sz * 6)
      const ground = sample(shotPos.x, shotPos.z)?.height ?? from.y
      shotPos.y = Math.max(ground + 3.4, from.y + 1.6)
    }
    shotLook.set(game.skier.x, game.skier.y + 1.0, game.skier.z)
    // The opening cuts from the chair to the snow; a ride during play eases over.
    const cut = Boolean(opening && !opening.cut)
    if (opening) opening.cut = true
    rig.holdShot(shotPos, shotLook, cut, aerial ? groundLens(shotPos.distanceTo(shotLook)) : null)
  }

  /** Which side of the line the up-going chairs are clear on: away from the chairs coming back down. */
  function chairSide(current: Ride, lineYaw: number): 1 | -1 {
    const line = current.lift.line
    const rx = -Math.cos(lineYaw)
    const rz = Math.sin(lineYaw)
    const near = nearestOnPolyline(game.skier.x + rx * 2, game.skier.z + rz * 2, line).distanceSq
    const far = nearestOnPolyline(game.skier.x - rx * 2, game.skier.z - rz * 2, line).distanceSq
    return near > far ? -1 : 1
  }

  /**
   * Top of the lift: you are standing at the end of the unload ramp, free to
   * pick a way down. The course (for the HUD and run times) is the run that
   * starts nearest, as before.
   */
  function finishRide(lift: Lift, at?: { to: THREE.Vector3; yaw: number; face?: number }, cut = false) {
    const opening = Boolean(game.ride?.opening)
    game.ride = null
    ui.ride.hidden = true
    const world = game.stage.world
    if (world) game.course = chooseCourse(world.resort, world.grid.heightAt, lift.name, game.course?.startRun?.name ?? 'Grandfather')
    const face = at ? (at.face ?? at.yaw) : 0
    if (game.course && at) game.course = { ...game.course, spawn: { x: at.to.x, z: at.to.z, heading: Math.atan2(-Math.sin(face), Math.cos(face)) } }
    spawn(Boolean(at) && !cut)
    if (opening) onOpening?.(false, lift)
    if (at) {
      ui.title.textContent = `Top of ${lift.name}`
      // Facing down the fall line with a little way on, ready to turn either way.
      const glide = /t-?bar|platter|drag|carpet|rope_tow/i.test(lift.type) ? 0.6 : 2.1
      game.skier.vx = Math.sin(face) * glide
      game.skier.vz = Math.cos(face) * glide
      rig.releaseShot()
    }
  }

  /** Move the rider along the lift. Hold tuck to fast-forward. */
  function stepRide(dt: number, fast: boolean): SkierPose {
    const current = game.ride!
    if (current.opening) current.opening.t += dt
    if (current.unload) return stepUnload(current, current.unload, dt)
    const speed = current.path.speed * (fast ? 6 : 1)
    current.s += speed * dt
    const yaw = sampleRide(current.path, current.s, ridePoint)
    Object.assign(game.skier, {
      x: ridePoint.x + (current.path.aerial ? Math.cos(yaw) * 0.32 : 0),
      y: ridePoint.y,
      z: ridePoint.z - (current.path.aerial ? Math.sin(yaw) * 0.32 : 0),
      vx: Math.sin(yaw) * speed,
      vy: 0,
      vz: Math.cos(yaw) * speed,
      speed,
      heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)),
    })
    ui.rideText.textContent = `Riding ${current.lift.name} · ${Math.ceil(Math.max(0, current.path.total - current.s) / speed)} s${fast ? ' ▸▸' : game.mobile ? ' · push up to speed up' : ' · hold W to speed up'}`
    if (current.s >= current.path.total) beginUnload(current)
    return current.path.aerial ? 'sit' : 'stand'
  }

  /** Stand up off the seat and glide down the ramp, then hand over control. */
  function stepUnload(current: Ride, unload: NonNullable<Ride['unload']>, dt: number): SkierPose {
    unload.t += dt
    if (!current.path.aerial) return stepSurfaceUnload(current, unload)
    const path = unload.path!
    const seconds = unload.seconds ?? 2.2
    const k = Math.min(1, unload.t / seconds)
    const along = unloadProgress(k)
    const at = path.at(along)
    const ground = game.stage.slope.sampleTerrain(at.x, at.z)?.height ?? unload.to.y
    // The seat drops to the snow over the first few metres of the ramp.
    const drop = Math.min(1, along * 3.2)
    const y = Math.max(ground, unload.from.y + (ground - unload.from.y) * drop * drop * (3 - 2 * drop))
    const speed = (path.length / seconds) * (1.4 - 0.8 * k)
    Object.assign(game.skier, {
      x: at.x,
      y,
      z: at.z,
      vx: Math.sin(at.yaw) * speed,
      vy: 0,
      vz: Math.cos(at.yaw) * speed,
      speed,
      heading: Math.atan2(-Math.sin(at.yaw), Math.cos(at.yaw)),
    })
    if (k >= 1) finishRide(current.lift, unload)
    // Sitting until the skis touch, then standing: the rider view crossfades between them.
    return drop < 0.6 ? 'sit' : 'stand'
  }

  /**
   * T-bar and carpet: hold on to the top, let the bar go so it swings round the
   * bullwheel, and drift aside to a stop facing away from the lift, ready to
   * pick a way down.
   */
  function stepSurfaceUnload(current: Ride, unload: NonNullable<Ride['unload']>): SkierPose {
    const hold = 0.45
    const total = 2.1
    const lineYaw = current.exit?.lineYaw ?? unload.yaw
    const t = unload.t
    let x: number
    let z: number
    let yaw: number
    let speed: number
    if (t < hold) {
      // Still holding the bar: a last metre along the lift line.
      const k = t / hold
      x = unload.from.x + Math.sin(lineYaw) * k
      z = unload.from.z + Math.cos(lineYaw) * k
      yaw = lineYaw
      speed = current.path.speed
    } else {
      // Let go: carry on, curving aside, slowing to a stop.
      const k = Math.min(1, (t - hold) / (total - hold))
      const e = 1 - (1 - k) * (1 - k)
      const startX = unload.from.x + Math.sin(lineYaw)
      const startZ = unload.from.z + Math.cos(lineYaw)
      // Curve off the line, then round to face down the hill at the stop.
      const out = lineYaw + Math.atan2(Math.sin(unload.yaw - lineYaw), Math.cos(unload.yaw - lineYaw)) * Math.min(1, e * 1.6)
      const settle = Math.max(0, (e - 0.6) / 0.4)
      yaw = out + Math.atan2(Math.sin(unload.face - out), Math.cos(unload.face - out)) * settle * settle * (3 - 2 * settle)
      x = startX + (unload.to.x - startX) * e
      z = startZ + (unload.to.z - startZ) * e
      speed = current.path.speed * (1 - k) + 0.3 * k
    }
    const ground = game.stage.slope.sampleTerrain(x, z)?.height ?? unload.to.y
    Object.assign(game.skier, {
      x,
      y: ground,
      z,
      vx: Math.sin(yaw) * speed,
      vy: 0,
      vz: Math.cos(yaw) * speed,
      speed,
      heading: Math.atan2(-Math.sin(yaw), Math.cos(yaw)),
    })
    if (t >= total) finishRide(current.lift, { to: new THREE.Vector3(x, ground, z), yaw, face: unload.face })
    return t < hold ? 'stand' : 'ski'
  }

  return { startRide, arriveByChair, skipRide, arrivalShot, stepRide }
}

export type LiftRides = ReturnType<typeof createLiftRides>
