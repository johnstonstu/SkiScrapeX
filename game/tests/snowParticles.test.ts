import { describe, expect, it } from 'vitest'
import { InstancedBufferGeometry, Vector3 } from 'three'
import { SnowPuff } from '../src/fx/particles/SnowPuff'
import { SnowSpray } from '../src/fx/particles/SnowSpray'
import { SpeedStreaks } from '../src/fx/particles/SpeedStreaks'

const at = new Vector3(0, 0, 0)
const moving = new Vector3(0, 0, 12)

describe('snow spray', () => {
  it('draws one instance per live flake and never more than the pool', () => {
    const spray = new SnowSpray({ maxParticles: 64 })
    for (let i = 0; i < 60; i += 1) {
      spray.update(1 / 60, [{ position: at, velocity: moving, skid: 1, carving: 0, grounded: true, powder: 1, impact: 1 }])
    }
    expect(spray.alive).toBeGreaterThan(0)
    expect(spray.alive).toBeLessThanOrEqual(64)
    expect((spray.object.geometry as InstancedBufferGeometry).instanceCount).toBe(spray.alive)
    spray.clear()
    expect((spray.object.geometry as InstancedBufferGeometry).instanceCount).toBe(0)
  })

  it('throws more spray on a hard edge than a shallow one', () => {
    const count = (carving: number) => {
      const spray = new SnowSpray({ maxParticles: 2048 })
      for (let i = 0; i < 30; i += 1) {
        spray.update(1 / 60, [{ position: at, velocity: moving, skid: 0, carving, lateral: new Vector3(1, 0, 0), grounded: true }])
      }
      return spray.alive
    }
    expect(count(1)).toBeGreaterThan(count(0.1) * 2)
  })
})

describe('powder clouds', () => {
  it('blooms a burst, recycles the oldest cloud when full, and fades out', () => {
    const puffs = new SnowPuff({ maxPuffs: 8 })
    puffs.burst(at, moving, { count: 6, size: 0.5, spread: 2, rise: 1, life: 1 })
    puffs.update(1 / 60)
    expect(puffs.alive).toBe(6)
    puffs.burst(at, moving, { count: 6, size: 0.5, spread: 2, rise: 1, life: 1 })
    puffs.update(1 / 60)
    expect(puffs.alive).toBe(8)
    expect((puffs.object.geometry as InstancedBufferGeometry).instanceCount).toBe(8)
    for (let i = 0; i < 120; i += 1) puffs.update(1 / 60)
    expect(puffs.alive).toBe(0)
    expect(puffs.object.visible).toBe(false)
  })

  it('leaves a plume at the trail rate', () => {
    const puffs = new SnowPuff({ maxPuffs: 64 })
    for (let i = 0; i < 30; i += 1) {
      puffs.trail(1 / 60, at, moving, 10, 0.4, 0.3)
      puffs.update(1 / 60)
    }
    // Half a second at 10 per second.
    expect(puffs.alive).toBeGreaterThanOrEqual(4)
    expect(puffs.alive).toBeLessThanOrEqual(6)
  })

  it('does nothing while disabled', () => {
    const puffs = new SnowPuff({ maxPuffs: 16 })
    puffs.setEnabled(false)
    puffs.burst(at, moving, { count: 6, size: 0.5, spread: 2, rise: 1, life: 1 })
    puffs.update(1 / 60)
    expect(puffs.alive).toBe(0)
  })
})

describe('speed streaks', () => {
  it('ease in at speed and back out when slow', () => {
    const streaks = new SpeedStreaks({ count: 32 })
    streaks.update(1 / 60, at, moving, 1)
    expect(streaks.level).toBeLessThan(0.1)
    for (let i = 0; i < 120; i += 1) streaks.update(1 / 60, at, moving, 1)
    expect(streaks.level).toBeGreaterThan(0.95)
    expect(streaks.object.visible).toBe(true)
    for (let i = 0; i < 120; i += 1) streaks.update(1 / 60, at, moving, 0)
    expect(streaks.object.visible).toBe(false)
  })
})
