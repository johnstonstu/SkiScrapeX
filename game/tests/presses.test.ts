import { describe, expect, it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput, type SkiState } from '../src/sim'
import { newPressState, stepRail, type RailState } from '../src/sim/freestyle'
import type { Rail } from '../src/sim/rails'
import { buildParkOverlay, FEATURES, footprintOf, type PlacedFeature } from '../src/world/park'

const IDLE: SkiInput = { steer: 0, brake: 0, tuck: false }
const flat = createSteadySlope(0, { width: 400, depth: 400 })
const ground = flat.sampleTerrain(200, 100)!.height

function straightRail(kind: Rail['kind'], length: number): Rail {
  return {
    id: kind,
    kind,
    width: kind === 'box' ? 0.5 : 0.08,
    points: [
      { x: 200, y: ground + 0.8, z: 100 },
      { x: 200, y: ground + 0.8, z: 100 + length },
    ],
  }
}

function onRail(rail: Rail, speed: number, overrides: Partial<RailState> = {}): RailState {
  return { rail, s: 0.2, vs: speed, balance: 0, balanceRate: 0, style: '5050', headingOffset: 0, entrySpeed: speed, metres: 0, ...newPressState(true), ...overrides }
}

/** The same deterministic wobble the skier sim feeds the rail. */
const wobble = (t: number) => Math.sin(t * 7.3) * 0.9 + Math.sin(t * 13.1 + 1.7) * 0.6

/** Seconds until the rider falls off with no steering, or Infinity. */
function timeToFall(rail: Rail, pitch: number): number {
  const state = onRail(rail, 8)
  for (let t = 0; t < 10; t += FIXED_DT) {
    const outcome = stepRail(state, 0, FIXED_DT, wobble(t), pitch)
    if (outcome === 'fell') return t
    if (outcome === 'end') return Infinity
  }
  return Infinity
}

/** A skier standing on a rail, already captured. */
function skierOn(rail: RailState): SkiState {
  const s = createSkiState({ x: 200, z: 100, heading: rail.headingOffset })
  s.rail = rail
  s.grounded = true
  return s
}

/** Balance with a simple PD controller on the steer, as a player would. */
const balancing = (s: SkiState, pitch: number): SkiInput => {
  const b = s.rail?.balance ?? 0
  const rate = s.rail?.balanceRate ?? 0
  return { ...IDLE, pitch, steer: Math.max(-1, Math.min(1, -(1.5 * b + 0.4 * rate))) }
}

function rideToEnd(s: SkiState, input: (s: SkiState) => SkiInput): void {
  for (let t = 0; t < 6 && s.rail; t += FIXED_DT) stepSkier(s, input(s), flat.sampleTerrain, FIXED_DT)
}

describe('rail presses', () => {
  it('pitch held from before the rail does not press until it is let go and held again', () => {
    const state = onRail(straightRail('rail', 20), 6, { pressArmed: false })
    for (let i = 0; i < 60; i++) stepRail(state, 0, FIXED_DT, 0, 1)
    expect(state.press).toBe('none')
    stepRail(state, 0, FIXED_DT, 0, 0)
    expect(state.pressArmed).toBe(true)
    for (let i = 0; i < 12; i++) stepRail(state, 0, FIXED_DT, 0, 1)
    expect(state.press).toBe('none') // still inside the 0.15 s delay
    for (let i = 0; i < 12; i++) stepRail(state, 0, FIXED_DT, 0, 1)
    expect(state.press).toBe('nose')
    for (let i = 0; i < 40; i++) stepRail(state, 0, FIXED_DT, 0, -1)
    expect(state.press).toBe('tail')
  })

  it('a balanced nose press across a 6 m rail is named and scores more than a 50-50', () => {
    const pressed = skierOn(onRail(straightRail('rail', 6), 5))
    rideToEnd(pressed, (s) => balancing(s, 1))
    const plain = skierOn(onRail(straightRail('rail', 6), 5))
    rideToEnd(plain, (s) => balancing(s, 0))
    expect(pressed.trick?.name).toBe('Nose Press 50-50 Rail')
    expect(plain.trick?.name).toBe('50-50 Rail')
    expect(pressed.trick!.points).toBeGreaterThan(plain.trick!.points)
  })

  it('a press falls off sooner than a 50-50, and a box press lasts longer than a rail press', () => {
    const rail = straightRail('rail', 100)
    const box = straightRail('box', 100)
    const plainRail = timeToFall(rail, 0)
    const pressRail = timeToFall(rail, 1)
    const pressBox = timeToFall(box, -1)
    expect(pressRail).toBeLessThan(plainRail)
    expect(pressBox).toBeGreaterThan(pressRail)
    expect(Number.isFinite(pressRail)).toBe(true)
  })

  it('popping off a press with the stick still held does not start a flip', () => {
    const s = skierOn(onRail(straightRail('rail', 20), 6))
    for (let t = 0; t < 0.6; t += FIXED_DT) stepSkier(s, balancing(s, 1), flat.sampleTerrain, FIXED_DT)
    expect(s.rail?.press).toBe('nose')
    for (let t = 0; t < 0.3; t += FIXED_DT) stepSkier(s, { ...balancing(s, 1), jump: true }, flat.sampleTerrain, FIXED_DT)
    stepSkier(s, { ...IDLE, pitch: 1 }, flat.sampleTerrain, FIXED_DT)
    expect(s.rail).toBeNull()
    let maxFlip = 0
    for (let t = 0; t < 2 && !s.grounded; t += FIXED_DT) {
      stepSkier(s, { ...IDLE, pitch: 1 }, flat.sampleTerrain, FIXED_DT)
      maxFlip = Math.max(maxFlip, Math.abs(s.air?.flip ?? 0))
    }
    expect(s.grounded).toBe(true)
    expect(maxFlip).toBeLessThan(0.05)
    expect(s.crashed).toBe(0)
  })

  it('forward is still a nose press when riding the rail switch', () => {
    const s = skierOn(onRail(straightRail('rail', 20), 6, { headingOffset: Math.PI }))
    s.ridingSwitch = true
    for (let t = 0; t < 0.4; t += FIXED_DT) stepSkier(s, balancing(s, 1), flat.sampleTerrain, FIXED_DT)
    expect(s.rail?.press).toBe('nose')
  })

  it('a skier braking (pitch back) into a box does not tail press until the stick comes back', () => {
    const slope = createSteadySlope(10, { width: 400, depth: 3000 })
    const heightAt = (x: number, z: number) => slope.sampleTerrain(x, z)?.height ?? Number.NaN
    const spec = FEATURES.box
    const placed: PlacedFeature = { spec, x: 200, z: 200, dirX: 0, dirZ: 1, footprint: footprintOf(spec), halfWidth: 5 }
    const park = buildParkOverlay([placed], slope.sampleTerrain, heightAt)
    const ride = (letGo: boolean) => {
      const s = createSkiState({ x: 200, z: 185, heading: 0 })
      s.y = park.sampleTerrain(200, 185)!.height
      s.vz = 6
      let pressed = false
      let caughtAt = -1
      for (let t = 0; t < 5; t += FIXED_DT) {
        if (s.rail && caughtAt < 0) caughtAt = t
        const released = letGo && caughtAt >= 0 && t - caughtAt < 0.05
        stepSkier(s, { ...IDLE, pitch: released ? 0 : -1 }, park.sampleTerrain, FIXED_DT, { rails: park.rails })
        if (s.rail?.press === 'tail') pressed = true
      }
      return { pressed, caught: caughtAt >= 0 }
    }
    const held = ride(false)
    expect(held.caught).toBe(true)
    expect(held.pressed).toBe(false)
    const reset = ride(true)
    expect(reset.caught).toBe(true)
    expect(reset.pressed).toBe(true)
  })
})

describe('pitch held at takeoff', () => {
  const slope = createSteadySlope(10, { width: 400, depth: 3000 })
  const heightAt = (x: number, z: number) => slope.sampleTerrain(x, z)?.height ?? Number.NaN
  const spec = FEATURES.kickerM
  const placed: PlacedFeature = { spec, x: 200, z: 200, dirX: 0, dirZ: 1, footprint: footprintOf(spec), halfWidth: 6 }
  const park = buildParkOverlay([placed], slope.sampleTerrain, heightAt)
  /** Ski off the medium kicker with no pop; `pitch(airTime)` is the stick. */
  const flight = (pitch: (airTime: number) => number) => {
    const s = createSkiState({ x: 200, z: 160, heading: 0 })
    s.y = park.sampleTerrain(200, 160)!.height
    s.vz = 9
    let air = 0
    let maxFlip = 0
    let flew = false
    for (let t = 0; t < 8; t += FIXED_DT) {
      if (!s.grounded) {
        flew = true
        air += FIXED_DT
      } else if (flew) break
      stepSkier(s, { ...IDLE, pitch: pitch(s.grounded ? -1 : air) }, park.sampleTerrain, FIXED_DT, { rails: park.rails })
      maxFlip = Math.max(maxFlip, Math.abs(s.air?.flip ?? 0))
    }
    return { flew, maxFlip }
  }

  it('braking (pitch back) off a lip without a pop does not backflip', () => {
    const held = flight(() => -1)
    expect(held.flew).toBe(true)
    expect(held.maxFlip).toBeLessThan(0.05)
  })

  it('letting go and pulling back in the air still flips', () => {
    const regrip = flight((air) => (air < 0 ? -1 : air < 0.1 ? 0 : -1))
    expect(regrip.flew).toBe(true)
    expect(regrip.maxFlip).toBeGreaterThan(1)
  })
})
