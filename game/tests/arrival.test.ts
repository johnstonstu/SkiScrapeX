import { describe, expect, it } from 'vitest'
import { chairShot, groundShotPosition, straightUnload, unloadPath, unloadProgress, unloadSeconds } from '../src/app/game/arrival'
import { RIDERS, rideOf, riderOf, setRide, wearRider } from '../src/app/riders'
import { DEFAULT_OUTFIT } from '../src/ui/riderPanel'

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

describe('getting off the chair', () => {
  // Quickdraw's top: glide out west-south-west, then hook right round to face the front.
  const from = { x: 0, z: 0 }
  const yaw = -1.18
  const to = { x: Math.sin(yaw) * 12, z: Math.cos(yaw) * 12 }
  const face = 2.705

  it('goes straight down the ramp, then one round turn to the facing', () => {
    const path = unloadPath(from, to, yaw, face)
    const start = path.at(0)
    const end = path.at(1)
    expect(Math.hypot(start.x, start.z)).toBeLessThan(1e-6)
    expect(Math.hypot(end.x - path.end.x, end.z - path.end.z)).toBeLessThan(1e-6)
    expect(Math.abs(wrap(start.yaw - yaw))).toBeLessThan(0.01)
    expect(Math.abs(wrap(end.yaw - face))).toBeLessThan(0.01)
    // The first metres are dead straight (still on the ramp).
    expect(Math.abs(wrap(path.at(0.3).yaw - yaw))).toBeLessThan(1e-9)
    const whole = Math.abs(wrap(face - yaw))
    let last = start
    let turned = 0
    for (let i = 1; i <= 200; i++) {
      const next = path.at(i / 200)
      const step = Math.hypot(next.x - last.x, next.z - last.z)
      const swing = Math.abs(wrap(next.yaw - last.yaw))
      turned += swing
      // A carved turn: never tighter than a 2 m radius, never sideways.
      if (swing > 1e-9) expect(step / swing).toBeGreaterThan(2)
      expect((next.x - last.x) * Math.sin(last.yaw) + (next.z - last.z) * Math.cos(last.yaw)).toBeGreaterThan(0)
      // No further out along the ramp than the spot the exit was chosen for.
      expect(next.x * Math.sin(yaw) + next.z * Math.cos(yaw)).toBeLessThan(12.01)
      last = next
    }
    // It turns exactly as far as it needs to, with no wobble.
    expect(turned).toBeCloseTo(whole, 2)
    // The ready spot is beside the old one, on the inside of the turn.
    expect(Math.hypot(path.end.x - to.x, path.end.z - to.z)).toBeLessThan(9)
  })

  it('tightens, then goes straight, when the hook is blocked', () => {
    const open = unloadPath(from, to, yaw, face)
    // A wall 5 m to the inside of the ramp line: only a tighter hook fits.
    const inside = (x: number, z: number) => x * Math.sin(yaw - Math.PI / 2) + z * Math.cos(yaw - Math.PI / 2)
    const tight = unloadPath(from, to, yaw, face, (x, z) => inside(x, z) > 5.5)
    expect(tight.length).toBeLessThan(open.length)
    expect(inside(tight.end.x, tight.end.z)).toBeLessThanOrEqual(5.5)
    const walled = unloadPath(from, to, yaw, face, () => true)
    expect(walled.length).toBeCloseTo(straightUnload(from, to, yaw, face).length)
    expect(walled.end).toEqual(to)
    expect(Math.abs(wrap(walled.at(1).yaw - face))).toBeLessThan(0.01)
  })

  it('a straight exit stays straight', () => {
    const path = unloadPath(from, to, yaw, yaw + 0.1)
    const mid = path.at(0.5)
    expect(Math.hypot(mid.x - to.x / 2, mid.z - to.z / 2)).toBeLessThan(0.01)
  })

  it('comes off at about the chair speed and ends at a glide', () => {
    const path = unloadPath(from, to, yaw, face)
    const seconds = unloadSeconds(path)
    expect(seconds).toBeGreaterThanOrEqual(2.2)
    expect(seconds).toBeLessThanOrEqual(3.8)
    expect(unloadProgress(0)).toBe(0)
    expect(unloadProgress(1)).toBeCloseTo(1)
    const first = (unloadProgress(0.02) * path.length) / (0.02 * seconds)
    const last = ((1 - unloadProgress(0.98)) * path.length) / (0.02 * seconds)
    expect(first).toBeGreaterThan(4)
    expect(first).toBeLessThan(8)
    expect(last).toBeGreaterThan(1.5)
    expect(last).toBeLessThan(3.5)
  })

  it('the chair camera rides ahead on the chosen side, looking back at the rider', () => {
    const rider = { x: 100, y: 50, z: 200 }
    for (const side of [1, -1] as const) {
      const shot = chairShot(rider, yaw, 1, side)
      const ahead = (shot.position.x - rider.x) * Math.sin(yaw) + (shot.position.z - rider.z) * Math.cos(yaw)
      const right = (shot.position.x - rider.x) * -Math.cos(yaw) + (shot.position.z - rider.z) * Math.sin(yaw)
      expect(ahead).toBeGreaterThan(3.5)
      expect(Math.sign(right)).toBe(side)
      expect(Math.hypot(shot.look.x - rider.x, shot.look.z - rider.z)).toBeLessThan(1)
    }
  })

  it('the ground camera waits behind the ready spot, on the snow and out of walls', () => {
    const flat = () => 10
    const at = groundShotPosition(to, face, from, flat, () => false)
    const behind = (to.x - at.x) * Math.sin(face) + (to.z - at.z) * Math.cos(face)
    expect(behind).toBeGreaterThan(6)
    expect(at.y).toBeGreaterThan(10.5)
    expect(at.y).toBeLessThan(12.5)
    // A wall behind the spot: it comes in closer rather than standing in it.
    const wall = (x: number, z: number) => (to.x - x) * Math.sin(face) + (to.z - z) * Math.cos(face) > 6.5
    const near = groundShotPosition(to, face, from, flat, wall)
    expect(wall(near.x, near.z)).toBe(false)
  })
})

describe('starter riders', () => {
  it('each has a different look and the default outfit is the first one', () => {
    const looks = new Set(RIDERS.map((rider) => JSON.stringify(rider.look)))
    expect(looks.size).toBe(RIDERS.length)
    expect(riderOf({ ...DEFAULT_OUTFIT })?.id).toBe(RIDERS[0].id)
  })

  it('wearing a rider keeps skis or snowboard, and a hand-made look is nobody', () => {
    const outfit = { ...DEFAULT_OUTFIT, model: 'powder' as const }
    wearRider(outfit, RIDERS[2].look)
    expect(riderOf(outfit)?.id).toBe(RIDERS[2].id)
    expect(outfit.model).toBe('powder')
    expect(riderOf({ ...outfit, jacket: '#123456' })).toBeNull()
  })

  it('switching to the board and back returns the same skis', () => {
    const outfit = { ...DEFAULT_OUTFIT, model: 'powder' as 'powder' | 'snowboard' | 'allMountain' | 'park' }
    setRide(outfit, 'snowboard', 'powder')
    expect(rideOf(outfit)).toBe('snowboard')
    setRide(outfit, 'skis', 'powder')
    expect(outfit.model).toBe('powder')
    setRide(outfit, 'skis', 'park')
    expect(outfit.model).toBe('powder')
  })
})
