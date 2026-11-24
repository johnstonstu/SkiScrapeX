import { describe, expect, it } from 'vitest'
import { FIXED_DT, PHYSICS, beginCrash, createSkiState, createSteadySlope, stepSkier } from '../src/sim'
import { applyWeather, weatherPreset } from '../src/render/weather'
import { createLighting, createSky, addSceneLights } from '../src/render/lighting'
import * as THREE from 'three'

const slope = createSteadySlope(15, { width: 800, depth: 1200 })

describe('crash feel', () => {
  it('keeps a fast crash down longer than a slow one', () => {
    const slow = createSkiState({ x: 400, z: 200 })
    const fast = createSkiState({ x: 400, z: 200 })
    beginCrash(slow, 3)
    beginCrash(fast, 22)
    expect(fast.crashed).toBeGreaterThan(slow.crashed)
    expect(fast.crashSpeed).toBe(22)
  })

  it('slides farther when entry speed is high', () => {
    const slow = createSkiState({ x: 400, z: 200, heading: 0 })
    const fast = createSkiState({ x: 400, z: 200, heading: 0 })
    for (const s of [slow, fast]) {
      s.y = slope.sampleTerrain(s.x, s.z)!.height
      s.vx = 0
      s.vz = 12
    }
    beginCrash(slow, 6)
    beginCrash(fast, 20)
    slow.vz = 6
    fast.vz = 20
    const z0Slow = slow.z
    const z0Fast = fast.z
    for (let t = 0; t < 1.2; t += FIXED_DT) {
      stepSkier(slow, { steer: 0, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
      stepSkier(fast, { steer: 0, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
    }
    expect(fast.z - z0Fast).toBeGreaterThan(slow.z - z0Slow)
  })

  it('ages the crash for tumble animation', () => {
    const s = createSkiState({ x: 400, z: 200, heading: 0 })
    s.y = slope.sampleTerrain(s.x, s.z)!.height
    beginCrash(s, 18)
    s.vz = 10
    for (let t = 0; t < 0.4; t += FIXED_DT) stepSkier(s, { steer: 0, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
    expect(s.crashAge).toBeGreaterThan(0.3)
    expect(s.mode).toBe('crashed')
  })

  it('clears washout hold when a crash begins', () => {
    const s = createSkiState({ x: 400, z: 200 })
    s.washoutHold = 0.5
    beginCrash(s, 16)
    expect(s.washoutHold).toBe(0)
    expect(s.crashAge).toBe(0)
    expect(PHYSICS.washoutCrashSpeed).toBeGreaterThan(10)
  })
})

describe('weather presets', () => {
  it('storm is denser and fogier than bluebird', () => {
    const clear = weatherPreset('clear')
    const storm = weatherPreset('storm')
    expect(storm.snowDensity).toBeGreaterThan(clear.snowDensity)
    expect(storm.fogFar).toBeLessThan(clear.fogFar)
    const scene = new THREE.Scene()
    const lighting = createLighting()
    const sun = addSceneLights(scene, lighting)
    const sky = createSky(lighting)
    applyWeather('storm', lighting, scene, sun, sky)
    expect(lighting.fogDensity).toBeGreaterThan(0.0002)
    expect(sun.intensity).toBeLessThan(1.2)
  })
})
