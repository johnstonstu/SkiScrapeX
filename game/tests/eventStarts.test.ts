import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { loadApexWorld } from './apexWorld'
import { EVENTS, buildEventCourse, startFlatLength } from '../src/world/events'
import { launch } from '../src/app/raceDirector'
import { START_SPEED } from '../src/app/race'
import { createSkiState } from '../src/sim'

/** Stu (2026-11-27): events start at the top, but never from a flat standstill. */
describe('event starts', () => {
  it('measures the gentle ground before a course drops away', () => {
    const flatThenSteep = (x: number, z: number) => (z < 200 ? -z * 0.03 : -6 - (z - 200) * 0.3) + x * 0
    expect(startFlatLength([[0, 0], [0, 600]], flatThenSteep)).toBe(200)
    expect(startFlatLength([[0, 0], [0, 600]], (_x, z) => -z * 0.3)).toBe(0)
  })

  it('launches a racer down the course at GO, and leaves a faster one alone', () => {
    const event = { line: [[0, 0], [30, 40]] } as unknown as Parameters<typeof launch>[1]
    const s = createSkiState({ x: 0, z: 0, heading: 0 })
    launch(s, event, START_SPEED)
    expect(s.speed).toBeCloseTo(START_SPEED, 6)
    expect(s.vx / s.vz).toBeCloseTo(30 / 40, 6)
    s.vx = 0
    s.vz = 20
    s.speed = 20
    launch(s, event, START_SPEED)
    expect(s.vz).toBe(20)
  })

  const DATA = 'public/data/'
  const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`)
  it.skipIf(!hasData)('poles the Chute and the Downhill along the summit cat track, and the steep starts drop straight in', () => {
    const world = loadApexWorld()
    const flat = (id: string) => buildEventCourse(world.resort, EVENTS.find((d) => d.id === id)!, undefined, world.grid.heightAt).startFlat
    expect(flat('shoot-the-chute')).toBeGreaterThan(150)
    expect(flat('apex-downhill')).toBeGreaterThan(150)
    expect(flat('apex-slalom')).toBe(0)
    expect(flat('kristis-moguls')).toBe(0)
  })
})
