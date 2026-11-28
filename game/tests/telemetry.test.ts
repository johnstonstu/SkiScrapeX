import { describe, expect, it } from 'vitest'
import { BTN, FLAG, INPUT_COLS, SAMPLE_COLS, analyze, buildSession, report, type ChunkPayload, type SessionMeta, type TelemetryEvent } from '../src/telemetry/analyze'

const meta: SessionMeta = { format: 1, id: 'test', started: '2026-11-28T00:00:00.000Z', version: '0.0.0' }
type Sample = Partial<Record<(typeof SAMPLE_COLS)[number], number | null>>
/** One sample row from named values; everything else is a rider standing on a 15 degree groomer with the camera behind. */
const row = (values: Sample) => {
  const base: Sample = { fall: 0, pit: 15, flags: FLAG.grounded, camDist: 8, camUp: 3, camPitch: -12, fov: 58, sy: -0.2, clear: 2, fAvg: 16.7, fMax: 18 }
  return SAMPLE_COLS.map((name) => ({ ...base, ...values })[name] ?? 0)
}
const input = (values: Partial<Record<(typeof INPUT_COLS)[number], number>>) => INPUT_COLS.map((name) => values[name] ?? 0)

/** A session from a per-sample generator, 10 samples a second. */
function record(seconds: number, each: (t: number) => Sample, events: TelemetryEvent[] = [], inputs: number[][] = []) {
  const samples = []
  for (let step = 0; step <= seconds * 10; step++) samples.push(row({ t: step * 100, ...each(step / 10) }))
  const chunk: ChunkPayload = { s: samples, i: inputs, e: events, n: ['Main Street', "Kristi's Run"] }
  return analyze(buildSession(meta, [chunk]))
}

describe('telemetry analysis', () => {
  it('joins chunks in order, names included', () => {
    const session = buildSession(meta, [
      { s: [row({ t: 0 })], i: [], e: [{ t: 50, k: 'b' }], n: ['A'] },
      { s: [row({ t: 100, run: 1 })], i: [], e: [{ t: 20, k: 'a' }], n: ['B'] },
    ])
    expect(session.samples).toHaveLength(2)
    expect(session.names).toEqual(['A', 'B'])
    expect(session.events.map((event) => event.k)).toEqual(['a', 'b'])
  })

  it('finds a stall across the slope and tells it from a braked stop', () => {
    const a = record(40, (t) => {
      // Ski, drift to a stop across the hill at 8 s, pole off at 14 s; brake to a stop at 26 s.
      if (t < 8) return { spd: 12, x: t * 12 }
      if (t < 14) return { spd: 0.2, x: 96, hdg: Math.PI / 2, flags: FLAG.grounded | (t > 13 ? FLAG.poling : 0) }
      if (t < 24) return { spd: 10, x: 96 + (t - 14) * 10 }
      if (t < 26) return { spd: 6, x: 196 + (t - 24) * 6, brake: 1 }
      if (t < 30) return { spd: 0, x: 208, brake: 1 }
      return { spd: 9, x: 208 + (t - 30) * 9 }
    })
    expect(a.stalls.map((stall) => stall.cause)).toEqual(['across the slope', 'braked to a stop'])
    expect(a.stalls[0]).toMatchObject({ seconds: 5.9, offFallLineDeg: 90, exit: 'poled', run: 'Main Street' })
    expect(a.time.stalled).toBeCloseTo(9.8, 0)
    expect(a.findings.some((finding) => finding.area === 'stalls')).toBe(true)
  })

  it('does not call standing at the top after a lift a stall', () => {
    const a = record(20, (t) => (t < 5 ? { flags: FLAG.ride } : t < 12 ? { spd: 0 } : { spd: 9, x: (t - 12) * 9 }))
    expect(a.stalls).toHaveLength(1)
    expect(a.stalls[0].cause).toBe('not started yet')
    expect(a.time.stalled).toBe(0)
  })

  it('counts switch riding and the skis coming round', () => {
    const a = record(30, (t) => {
      // Lands switch at 5 s and stops at 7 s; at 15 s the skis swing 120 degrees off the line of travel for a second.
      if (t >= 5 && t < 7) return { spd: 8 - (t - 5) * 3, x: t * 8, flags: FLAG.grounded | FLAG.switch, hdg: Math.PI }
      if (t >= 7 && t < 9) return { spd: 0.1, x: 56 }
      if (t >= 15 && t < 16) return { spd: 11, x: t * 8, hdg: 2.1 }
      return { spd: 11, x: t * 8 }
    }, [{ t: 4950, k: 'trick', name: '180', grade: 'clean' }])
    expect(a.switches).toHaveLength(1)
    expect(a.switches[0]).toMatchObject({ from: '180', exit: 'stopped' })
    expect(a.spinOuts).toHaveLength(1)
    expect(a.spinOuts[0].maxSlipDeg).toBe(120)
  })

  it('flags the camera on bumps when the rider bounces and hides', () => {
    const a = record(60, (t) => {
      const bumps = t >= 30
      return { spd: 9, x: t * 9, run: bumps ? 1 : 0, bump: bumps ? 0.25 : 0.02, sy: bumps ? -0.2 + 0.3 * Math.sin(t * 9) : -0.2, camPitch: bumps ? -12 + 6 * Math.sin(t * 9) : -12, occl: bumps && Math.sin(t * 2) > 0.6 ? 1 : 0 }
    })
    const bumps = a.camera.slices.find((entry) => entry.label === 'Bumps and moguls')!
    const smooth = a.camera.slices.find((entry) => entry.label === 'Smooth snow')!
    expect(bumps.hidden).toBeGreaterThan(0.1)
    expect(bumps.bounce).toBeGreaterThan(smooth.bounce + 0.2)
    expect(a.findings.find((finding) => finding.area === 'camera')?.title).toMatch(/bumps and moguls/)
    expect(a.camera.worst[0].run).toBe("Kristi's Run")
  })

  it('reads the controller: the right stick, a dead button, brake caught in turns', () => {
    const inputs = [
      input({ t: 1000, lx: 0.9 }),
      input({ t: 5000, lx: 0.9, rx: 0.8 }),
      input({ t: 10000, lx: 0.9 }),
      input({ t: 11000, lx: 0.9, btn: 1 << 16 }),
      input({ t: 11100, lx: 0.9 }),
      input({ t: 12000, lx: 0.9, btn: 1 << 16 }),
      input({ t: 12100, lx: 0.9 }),
      input({ t: 13000, btn: 1 }),
      input({ t: 13600 }),
    ]
    const a = record(20, (t) => ({ spd: 10, x: t * 10, steer: 0.95, brake: t > 10 ? 1 : 0, ibtn: t < 4 ? BTN.tuck : 0 }), [{ t: 3000, k: 'key', code: 'KeyQ' }, { t: 3100, k: 'key', code: 'KeyQ' }, { t: 3200, k: 'key', code: 'KeyR' }], inputs)
    expect(a.controls.rightStickSeconds).toBe(5)
    expect(a.controls.buttons.find((button) => button.index === 16)).toMatchObject({ presses: 2, does: '' })
    expect(a.controls.jumpHolds).toMatchObject({ count: 1, medianSeconds: 0.6 })
    expect(a.controls.turnWithBrake).toBeGreaterThan(0.4)
    expect(a.controls.otherKeys).toEqual({ KeyQ: 2 })
    const titles = a.findings.map((finding) => finding.title).join('\n')
    expect(titles).toMatch(/right stick/)
    expect(titles).toMatch(/Home ×2/)
    expect(titles).toMatch(/Brake came on/)
  })

  it('sorts crashes by cause and writes a report', () => {
    const a = record(30, (t) => ({ spd: 10, x: t * 10, flags: FLAG.grounded | (t > 10 && t < 12 ? FLAG.crashed : 0) }), [
      { t: 9000, k: 'air', x: 90, z: 0, pop: 0.6, run: 'Main Street' },
      { t: 9990, k: 'land', dur: 0.9, spin: 360, flip: 0, grab: 'mute' },
      { t: 10000, k: 'crash', x: 100, z: 0, spd: 10, air: true },
      { t: 12000, k: 'up' },
      { t: 13000, k: 'action', a: 'reset' },
      { t: 20000, k: 'mark', x: 200, z: 0 },
    ])
    expect(a.crashes[0]).toMatchObject({ cause: 'landing', downSeconds: 2, resetAfter: true, run: 'Main Street' })
    expect(a.airs).toMatchObject({ count: 1, crashed: 1, withSpin: 1, withGrab: 1, charged: 1 })
    expect(a.resets[0].after).toBe('a crash (landing)')
    expect(a.marks).toHaveLength(1)
    const text = report(a)
    expect(text).toContain('## Findings')
    expect(text).toContain('Marked 1 moment')
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })
})
