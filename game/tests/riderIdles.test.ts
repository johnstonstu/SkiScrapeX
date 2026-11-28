import { describe, expect, it } from 'vitest'
import { IDLE_MOVES, createIdlePlayer } from '../src/render/rider/idles'

/** A fixed pseudo-random stream so the picks are repeatable. */
const stream = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647

describe('idle moves', () => {
  it('every move starts and ends at rest, so it blends in and out of the standing pose', () => {
    for (const move of IDLE_MOVES) {
      const player = createIdlePlayer()
      for (const t of [0, move.duration - 1e-3]) {
        player.play(move.kind)
        const pose = player.step(t, { active: true, sitting: move.sitting && !move.standing, boarding: move.boardOnly === true, riding: move.riding })
        const size = Math.abs(pose.headX) + Math.abs(pose.headY) + Math.abs(pose.headZ) + Math.abs(pose.spineX) + Math.abs(pose.spineZ) +
          Math.abs(pose.sway) + pose.hop + Math.abs(pose.crouch) + (pose.hands[0]?.w ?? 0) + (pose.hands[1]?.w ?? 0)
        expect(size, `${move.kind} at ${t.toFixed(2)}`).toBeLessThan(0.02)
      }
    }
  })

  it('riding only gets the small head and shoulder moves, and any input fades them out', () => {
    const player = createIdlePlayer(stream(7))
    const seen = new Set<string>()
    for (let f = 0; f < 60 * 120; f++) {
      const pose = player.step(1 / 60, { active: true, sitting: false, boarding: false, riding: true })
      if (!pose.kind) continue
      seen.add(pose.kind)
      expect(pose.hands[0]).toBeNull()
      expect(pose.hands[1]).toBeNull()
      expect(pose.crouch + pose.hop + pose.skiLift[0] + pose.skiLift[1]).toBe(0)
    }
    expect([...seen].sort()).toEqual(['glanceLeft', 'glanceRight', 'shoulders'])
    // Mid-glance, the player turns: it is gone within a quarter second.
    player.play('glanceLeft')
    player.step(0.7, { active: true, sitting: false, boarding: false, riding: true })
    let pose = player.step(0, { active: true, sitting: false, boarding: false, riding: true })
    expect(Math.abs(pose.headY)).toBeGreaterThan(0.5)
    for (let f = 0; f < 16; f++) pose = player.step(1 / 60, { active: false, sitting: false, boarding: false })
    expect(Math.abs(pose.headY)).toBe(0)
  })

  it('a riding move never carries over into the standing pose', () => {
    const player = createIdlePlayer(stream(3))
    let pose = player.step(0, { active: true, sitting: false, boarding: false, riding: true })
    for (let f = 0; f < 60 * 30 && !pose.kind; f++) pose = player.step(1 / 60, { active: true, sitting: false, boarding: false, riding: true })
    expect(pose.kind).not.toBeNull()
    for (let f = 0; f < 20; f++) pose = player.step(1 / 60, { active: true, sitting: false, boarding: false })
    expect(pose.kind).toBeNull()
  })

  it('standing skiers and snowboarders draw from their own sets', () => {
    for (const boarding of [false, true]) {
      const player = createIdlePlayer(stream(11))
      const seen = new Set<string>()
      for (let f = 0; f < 60 * 900; f++) {
        const pose = player.step(1 / 60, { active: true, sitting: false, boarding })
        if (pose.kind) seen.add(pose.kind)
      }
      for (const move of IDLE_MOVES) {
        const allowed = move.standing && !(move.skisOnly && boarding) && !(move.boardOnly && !boarding)
        if (!allowed) expect(seen.has(move.kind), move.kind).toBe(false)
      }
      expect(seen.size).toBeGreaterThan(12)
    }
  })
})
