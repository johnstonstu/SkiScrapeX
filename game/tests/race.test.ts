import { describe, expect, it } from 'vitest'
import { createSkiState } from '../src/sim'
import { COUNTDOWN, PUSH_WINDOW, TIGHT_METRES, aimGate, assistSteer, createStartGate, gateAim, gradeGate, kick } from '../src/app/race'
import { createGhostRecorder, ghostAt } from '../src/app/ghost'
import type { Gate } from '../src/world/challenges'

const DT = 1 / 60
/** Step the start gate for `seconds` with the push button up, collecting events. */
function wait(gate: ReturnType<typeof createStartGate>, seconds: number) {
  const events: string[] = []
  let hold = true
  for (let t = 0; t < seconds - 1e-9; t += DT) {
    const r = gate.step(DT, false)
    hold = r.hold
    if (r.event) events.push(r.event)
  }
  return { events, hold }
}

describe('start gate', () => {
  it('holds the racer through 3, 2, 1, then opens at GO', () => {
    const gate = createStartGate()
    expect(gate.count).toBe(3)
    const first = wait(gate, 1.5)
    expect(first.hold).toBe(true)
    expect(gate.count).toBe(2)
    const rest = wait(gate, COUNTDOWN - 1.5 + DT)
    expect(rest.events).toEqual(['go'])
    expect(rest.hold).toBe(false)
    expect(gate.open).toBe(true)
  })

  it('a push just after GO is a fast start; a late push is not', () => {
    const fast = createStartGate()
    wait(fast, COUNTDOWN + DT)
    expect(fast.step(DT, true).event).toBe('fastStart')
    const late = createStartGate()
    wait(late, COUNTDOWN + PUSH_WINDOW + 0.1)
    expect(late.step(DT, true).event).toBeNull()
  })

  it('a push before GO is a false start and the count begins again', () => {
    const gate = createStartGate()
    wait(gate, 2.5)
    const r = gate.step(DT, true)
    expect(r.event).toBe('falseStart')
    expect(r.hold).toBe(true)
    expect(gate.count).toBe(3)
    gate.step(DT, false)
    expect(wait(gate, 2.5).hold).toBe(true)
  })

  it('a button still held from the menu does not count as a push', () => {
    const gate = createStartGate()
    // Held down from the first frame: never an edge, so no false start.
    for (let t = 0; t < 1; t += DT) expect(gate.step(DT, true).event).toBeNull()
  })
})

// A gate due south, set 2.5 m to the left of the line (side 1 puts it at +lateral), poles 4 m either side.
const gate: Gate = { x: 0, z: 10, dirX: 0, dirZ: 1, side: 1, s: 10, halfWidth: 4 }

describe('gate grades', () => {
  it('a carved pass near the turning pole is tight, further out is clean, a skid is a skid', () => {
    // The turning pole is the one nearer the line: lateral -4 for a side 1 gate.
    expect(gradeGate(gate, -3.2, 0.05, 2.5).grade).toBe('tight')
    expect(gradeGate(gate, -4 + TIGHT_METRES + 0.2, 0.05, 2.5).grade).toBe('clean')
    expect(gradeGate(gate, 3.5, 0.05, 2.5).grade).toBe('clean')
    expect(gradeGate(gate, -3.2, 0.5, 2.5).grade).toBe('skid')
    // Gates on the line (downhill) have no turning pole.
    expect(gradeGate(gate, -3.9, 0.05, 0).grade).toBe('clean')
  })

  it('aims just inside the turning pole, and leads to the next gate near a pass', () => {
    const [ax, az] = gateAim(gate, 2.5)
    // Lateral is along (dirZ, -dirX) = (1, 0): the aim sits at x = -2.8, inside the -4 pole.
    expect(ax).toBeCloseTo(-2.8)
    expect(az).toBeCloseTo(10)
    const next: Gate = { ...gate, z: 24, s: 24, side: -1 }
    expect(aimGate([gate, next], 0, 0)).toBe(gate)
    expect(aimGate([gate, next], 0, 7)).toBe(next)
    // Nothing within range: no help.
    expect(aimGate([{ ...gate, s: 80 }], 0, 0)).toBeNull()
  })
})

describe('racing line assist', () => {
  it('pulls a committed turn toward the ideal steer', () => {
    expect(assistSteer(1, 0.3)).toBeCloseTo(1 + 0.6 * (0.3 - 1))
    expect(assistSteer(-1, -0.2)).toBeGreaterThan(-1)
  })
  it('leaves the player alone steering the other way or not at all', () => {
    expect(assistSteer(-1, 0.4)).toBe(-1)
    expect(assistSteer(0, 0.8)).toBe(0)
  })
})

describe('speed kicks and the ghost', () => {
  it('a kick adds speed along the direction of travel', () => {
    const s = createSkiState({ x: 0, z: 0, heading: 0 })
    s.vx = 3
    s.vz = 4
    kick(s, 1)
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(6)
    expect(s.vx / s.vz).toBeCloseTo(0.75)
  })

  it('records every 0.1 s of race clock and replays between samples', () => {
    const recorder = createGhostRecorder()
    for (let t = 0; t <= 1.001; t += DT) recorder.add(t, { x: t * 10, y: 0, z: 0, heading: 0 })
    const track = recorder.track()
    expect(track.samples.length / 4).toBe(11)
    expect(ghostAt(track, 0.55)!.x).toBeCloseTo(5.5, 0)
    expect(ghostAt(track, 5)).toBeNull()
  })
})
