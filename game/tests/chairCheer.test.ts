import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { canSee, cheerSize } from '../src/app/chairCheer'
import { planCheer, shoutCurves, type CheerVoice } from '../src/player/sfx/crowd'
import { chairSeats, createLiftView, sampleRide } from '../src/render/scenery/liftView'
import type { Lift } from '../src/world/resort'

const dice = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 2 ** 32
}
const air = (points: number, grade: 'perfect' | 'clean' | 'sketchy' | 'crash' = 'clean', airTime = 1) => ({ kind: 'air' as const, grade, points, airTime, railMetres: 0 })

describe('who cheers what', () => {
  it('ignores a hop, whoops at a jump, and saves the whole chair for a big trick', () => {
    expect(cheerSize(air(40, 'clean', 0.55))).toBeNull()
    expect(cheerSize(air(130))).toBe('small')
    expect(cheerSize(air(560))).toBe('medium')
    expect(cheerSize(air(1400, 'perfect', 1.8))).toBe('big')
  })
  it('gives a sketchy landing one whoop at most and a crash out of the air a wince', () => {
    expect(cheerSize(air(700, 'sketchy'))).toBe('small')
    expect(cheerSize(air(0, 'crash', 1.2))).toBe('ooh')
    expect(cheerSize(air(0, 'crash', 0.3))).toBeNull()
  })
  it('cheers a long clean rail, not a slip', () => {
    expect(cheerSize({ kind: 'rail', grade: 'clean', points: 200, airTime: 0, railMetres: 8 })).toBe('small')
    expect(cheerSize({ kind: 'rail', grade: 'sketchy', points: 60, airTime: 0, railMetres: 8 })).toBeNull()
  })
  it('riders face up the line: they see a skier ahead of the chair, not one well behind it', () => {
    expect(canSee({ dx: 0, dz: -40, facingX: 0, facingZ: -1 })).toBe(true)
    expect(canSee({ dx: 6, dz: 5, facingX: 0, facingZ: -1 })).toBe(true)
    expect(canSee({ dx: 0, dz: 40, facingX: 0, facingZ: -1 })).toBe(false)
  })
})

describe('the cheer itself', () => {
  it('uses no more voices than there are riders, and grows with the trick', () => {
    for (let seed = 1; seed < 40; seed++) {
      expect(planCheer('big', 1, dice(seed)).voices).toHaveLength(1)
      expect(planCheer('small', 4, dice(seed)).voices).toHaveLength(1)
      expect(planCheer('medium', 2, dice(seed)).voices).toHaveLength(2)
      expect(planCheer('medium', 4, dice(seed)).voices.length).toBeLessThanOrEqual(3)
      expect(planCheer('big', 2, dice(seed)).voices).toHaveLength(2)
      const big = planCheer('big', 4, dice(seed))
      expect(big.voices).toHaveLength(4)
      expect(big.claps.length).toBeGreaterThanOrEqual(2)
      expect(big.seconds).toBeLessThan(3.6)
      const wince = planCheer('ooh', 3, dice(seed))
      expect(wince.voices.every((v) => v.shout === 'ooh')).toBe(true)
      expect(wince.claps).toHaveLength(0)
    }
  })
  it('starts after a beat, as people do', () => {
    const plan = planCheer('medium', 2, dice(9))
    expect(Math.min(...plan.voices.map((v) => v.delay))).toBeGreaterThan(0.15)
  })

  const voice = (shout: CheerVoice['shout'], pitch: number): CheerVoice => ({ shout, delay: 0, seconds: 0.9, pitch, tract: 1, level: 0.6 })
  const at = (curve: Float32Array, u: number) => curve[Math.round(u * (curve.length - 1))]
  it('a whoop swoops up, holds, and falls away', () => {
    const c = shoutCurves(voice('woo', 900), dice(3))
    expect(at(c.pitch, 0)).toBeLessThan(620)
    expect(at(c.pitch, 0.4)).toBeGreaterThan(860)
    expect(at(c.pitch, 1)).toBeLessThan(700)
  })
  it('a yeww slides from "ee" to "oo" as the pitch drops', () => {
    const c = shoutCurves(voice('yeww', 420), dice(3))
    expect(at(c.f2, 0.02)).toBeGreaterThan(2000)
    expect(at(c.f2, 0.8)).toBeLessThan(1100)
    expect(at(c.pitch, 1)).toBeLessThan(at(c.pitch, 0.15) * 0.75)
  })
  it('a wince only sinks', () => {
    const c = shoutCurves(voice('ooh', 220), dice(3))
    expect(at(c.pitch, 0.5)).toBeLessThan(at(c.pitch, 0.05))
    expect(at(c.pitch, 1)).toBeLessThan(at(c.pitch, 0.5))
  })
  it('keeps every curve finite, in order and silent at both ends', () => {
    for (const shout of ['woo', 'yeww', 'yeah', 'ooh'] as const) {
      for (const pitch of [200, 500, 1100]) {
        const c = shoutCurves(voice(shout, pitch), dice(pitch))
        for (let i = 0; i < c.pitch.length; i++) {
          expect(Number.isFinite(c.pitch[i]) && c.pitch[i] > 60).toBe(true)
          expect(c.f1[i]).toBeGreaterThanOrEqual(c.pitch[i])
          expect(c.f2[i]).toBeGreaterThan(c.f1[i])
          expect(c.f3[i]).toBeGreaterThan(c.f2[i])
          expect(c.f3[i]).toBeLessThan(6000)
          expect(c.amp[i]).toBeGreaterThanOrEqual(0)
          expect(c.amp[i]).toBeLessThanOrEqual(1)
        }
        expect(c.amp[0]).toBe(0)
        expect(c.amp[c.amp.length - 1]).toBe(0)
      }
    }
  })
})

describe('riders on the chairs', () => {
  it('leaves most chairs empty, seats people together, and rarely fills a chair', () => {
    let occupied = 0, full = 0, total = 0
    for (let lap = 0; lap < 40; lap++) {
      for (let chair = 0; chair < 79; chair++) {
        const mask = chairSeats(0, chair, lap, 4)
        total++
        if (!mask) continue
        occupied++
        if (mask === 0b1111) full++
        // Taken seats are next to each other, from one end of the bench.
        expect([0b1, 0b11, 0b111, 0b1111, 0b1000, 0b1100, 0b1110]).toContain(mask)
      }
    }
    expect(occupied / total).toBeGreaterThan(0.3)
    expect(occupied / total).toBeLessThan(0.5)
    expect(full / occupied).toBeLessThan(0.15)
    expect(chairSeats(1, 5, 0, 3)).toBeLessThan(8)
  })
  it('changes who is on a chair each trip up', () => {
    const laps = new Set(Array.from({ length: 12 }, (_, lap) => chairSeats(0, 11, lap, 4)))
    expect(laps.size).toBeGreaterThan(1)
  })

  const lift: Lift = {
    id: 'q', name: 'Quickdraw', type: 'chair_lift', seats: 4,
    bottom: [0, 0], top: [0, -600], line: [[0, 0], [0, -600]],
    towers: [[0, -100], [0, -200], [0, -300], [0, -400], [0, -500]],
  } as Lift
  const heightAt = (_x: number, z: number) => -z * 0.3

  it('finds occupied chairs on the way up, follows one, and keeps the player\'s own chair clear', () => {
    const view = createLiftView([lift], heightAt)
    view.update(1)
    const all = view.ridersNear(0, 90, -300, 1000)
    expect(all.length).toBeGreaterThan(3)
    for (const chair of all) {
      expect(chair.riders).toBeGreaterThan(0)
      // Going up: facing the top, on the up side of the line, 6 m or more above the snow.
      expect(chair.facingZ).toBeLessThan(-0.9)
      expect(chair.y - heightAt(chair.x, chair.z)).toBeGreaterThan(1.5)
    }
    const nearest = view.ridersNear(0, 90, -300, 1000)[0]
    const before = new THREE.Vector3(), after = new THREE.Vector3()
    expect(view.chairSeat(nearest.id, before)).toBe(true)
    expect(before.distanceTo(new THREE.Vector3(nearest.x, nearest.y, nearest.z))).toBeLessThan(0.01)
    view.update(2)
    expect(view.chairSeat(nearest.id, after)).toBe(true)
    // Two seconds at 5 m/s up the line.
    expect(before.distanceTo(after)).toBeGreaterThan(8)
    expect(after.z).toBeLessThan(before.z)
    // Ride that chair: nobody shares it.
    const path = view.ride('q')!
    const probe = new THREE.Vector3()
    let s = 0
    while (s < path.total && (sampleRide(path, s, probe), probe.z) > after.z) s += 0.25
    view.update(0, undefined, { liftId: 'q', s })
    expect(view.ridersNear(0, 90, -300, 1000).some((chair) => chair.id === nearest.id)).toBe(false)
    // Long after it has gone over the top, the name no longer points at a chair.
    view.update(0)
    for (let i = 0; i < 200; i++) view.update(2)
    expect(view.chairSeat(nearest.id, after)).toBe(false)
    view.dispose()
  })
})
