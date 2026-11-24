import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createSkiState } from '../src/sim'
import { createGearDrops } from '../src/player/gearDrops'

describe('hard-crash gear pickups', () => {
  it('spawns world gear on a hard crash gather and clears when skied over', () => {
    const scene = new THREE.Scene()
    const drops = createGearDrops(scene)
    const state = createSkiState({ x: 0, z: 0, heading: 0 })
    state.crashed = 0.5
    state.crashSpeed = 16
    state.crashHeading = 0
    state.crashAge = 1
    const heightAt = () => 10

    drops.update(state, heightAt, false, 0.016)
    expect(state.missingSkis).toBe(true)
    expect(state.missingPoles).toBe(true)
    expect(scene.getObjectByName('gear-drops')?.children.length).toBeGreaterThan(0)

    // Still crashed: pickups wait until get-up.
    drops.update(state, heightAt, false, 0.5)
    expect(state.missingSkis).toBe(true)

    state.crashed = 0
    state.x = 10
    state.z = 10
    // Failsafe collect after long enough away from the pile.
    for (let i = 0; i < 20; i++) drops.update(state, heightAt, false, 1)
    expect(state.missingSkis).toBe(false)
    expect(state.missingPoles).toBe(false)
    expect(scene.getObjectByName('gear-drops')?.children.length).toBe(0)
  })

  it('leaves soft crashes as visual-only (no world drops)', () => {
    const scene = new THREE.Scene()
    const drops = createGearDrops(scene)
    const state = createSkiState()
    state.crashed = 0.4
    state.crashSpeed = 6
    drops.update(state, () => 10, false, 0.016)
    expect(state.missingSkis).toBe(false)
    expect(scene.getObjectByName('gear-drops')?.children.length).toBe(0)
  })
})
