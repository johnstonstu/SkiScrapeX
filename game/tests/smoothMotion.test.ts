import { describe, expect, it } from 'vitest'
import {
  advance,
  blendState,
  createClock,
  createPoseHistory,
  createSkiState,
  createSkier,
  createSteadySlope,
  lerpAngle,
  renderAlpha,
  type SkiInput,
  type SkiState,
} from '../src/sim'

const IDLE: SkiInput = { steer: 0, brake: 0, tuck: false }

/** Per-frame distance the drawn skier moves over `seconds` at `fps`, with and without blending. */
function frameSteps(fps: number, seconds: number, smooth: boolean): number[] {
  const slope = createSteadySlope(20)
  const skier = createSkier(slope)
  const clock = createClock()
  clock.history = createPoseHistory()
  const out = createSkiState()
  const air = {} as NonNullable<SkiState['air']>
  // Let it reach a near-steady speed first.
  for (let i = 0; i < fps * 3; i++) advance(clock, skier, IDLE, slope.sampleTerrain, 1 / fps)
  const moves: number[] = []
  let last: { x: number; z: number } | null = null
  for (let i = 0; i < fps * seconds; i++) {
    advance(clock, skier, IDLE, slope.sampleTerrain, 1 / fps)
    const drawn = smooth ? blendState(clock.history, skier, renderAlpha(clock), out, air) : skier
    if (last) moves.push(Math.hypot(drawn.x - last.x, drawn.z - last.z))
    last = { x: drawn.x, z: drawn.z }
  }
  return moves
}

/** Largest change in per-frame move between neighbouring frames, relative to the mean move. */
function unevenness(moves: number[]): number {
  const mean = moves.reduce((a, b) => a + b, 0) / moves.length
  let worst = 0
  for (let i = 1; i < moves.length; i++) worst = Math.max(worst, Math.abs(moves[i] - moves.at(i - 1)!))
  return worst / mean
}

describe('smooth motion between physics steps', () => {
  it.each([75, 90, 144])('moves evenly at %i Hz where the raw steps judder', (fps) => {
    const raw = unevenness(frameSteps(fps, 2, false))
    const smooth = unevenness(frameSteps(fps, 2, true))
    expect(raw).toBeGreaterThan(0.3)
    expect(smooth).toBeLessThan(0.05)
  })

  it('draws the sim exactly at 60 Hz, where every frame is two whole steps', () => {
    expect(unevenness(frameSteps(60, 2, true))).toBeLessThan(0.02)
  })

  it('snaps to a skier moved outside the sim instead of sliding there', () => {
    const slope = createSteadySlope(20)
    const skier = createSkier(slope)
    const clock = createClock()
    clock.history = createPoseHistory()
    const out = createSkiState()
    const air = {} as NonNullable<SkiState['air']>
    for (let i = 0; i < 30; i++) advance(clock, skier, IDLE, slope.sampleTerrain, 1 / 90)
    skier.x += 500
    skier.z -= 200
    const drawn = blendState(clock.history, skier, renderAlpha(clock), out, air)
    expect(drawn.x).toBe(skier.x)
    expect(drawn.z).toBe(skier.z)
  })

  it('never changes the simulation itself', () => {
    const slope = createSteadySlope(20)
    const a = createSkier(slope)
    const b = createSkier(slope)
    const ca = createClock()
    const cb = createClock()
    cb.history = createPoseHistory()
    const steer: SkiInput = { steer: 0.6, brake: 0, tuck: false }
    for (let i = 0; i < 400; i++) {
      advance(ca, a, steer, slope.sampleTerrain, 1 / 144)
      advance(cb, b, steer, slope.sampleTerrain, 1 / 144)
    }
    expect(b.x).toBe(a.x)
    expect(b.z).toBe(a.z)
    expect(b.heading).toBe(a.heading)
  })

  it('blends headings the short way round', () => {
    expect(lerpAngle(3.1, -3.1, 0.5)).toBeCloseTo(Math.PI, 2)
    expect(lerpAngle(-0.2, 0.2, 0.5)).toBeCloseTo(0, 6)
  })
})
