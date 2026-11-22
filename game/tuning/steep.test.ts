/**
 * Steep-slope probe, not part of CI: `npm run tune`. Bots on planar groomed
 * slopes from 20° to 45° print how the ski model behaves where real skiers
 * control speed by finishing turns, hold a traverse on their uphill edges
 * and stop with a hockey stop.
 */
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput, type SkiState } from '../src/sim'

const PITCHES = [20, 30, 38, 45]
const kmh = (s: SkiState) => (Math.hypot(s.vx, s.vy, s.vz) * 3.6).toFixed(0)
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0)

function run(pitch: number, start: { heading: number; speed: number }, seconds: number, control: (s: SkiState, t: number) => SkiInput) {
  const slope = createSteadySlope(pitch, { width: 4000, depth: 4000, spawnX: 2000, spawnZ: 200 })
  const g = slope.sampleTerrain(2000, 200)!
  const s = createSkiState({ x: 2000, y: g.height, z: 200, heading: start.heading })
  // Velocity along the heading, on the slope.
  const fx = -Math.sin(start.heading), fz = Math.cos(start.heading)
  const fy = -(g.normal.x * fx + g.normal.z * fz) / g.normal.y
  const l = Math.hypot(fx, fy, fz)
  s.vx = (fx / l) * start.speed
  s.vy = (fy / l) * start.speed
  s.vz = (fz / l) * start.speed
  const trace: { t: number; s: SkiState }[] = []
  let maxSkid = 0
  const y0 = s.y
  const x0 = s.x
  for (let t = 0; t < seconds; t += FIXED_DT) {
    stepSkier(s, control(s, t), slope.sampleTerrain, FIXED_DT)
    maxSkid = Math.max(maxSkid, s.skid)
    if (Math.abs(t % 0.5) < FIXED_DT) trace.push({ t, s: { ...s } })
  }
  return { s, drop: y0 - s.y, across: s.x - x0, maxSkid, trace }
}

const idle: SkiInput = { steer: 0, brake: 0, tuck: false }

it('steep probe', () => {
  for (const pitch of PITCHES) {
    const lines: string[] = [`--- ${pitch}°`]
    // Traverse released: skis 75° off the fall line at 8 m/s, stick centered.
    const traverse = run(pitch, { heading: (75 * Math.PI) / 180, speed: 8 }, 3, () => idle)
    const slipAngle = traverse.s.heading - Math.atan2(-traverse.s.vx, traverse.s.vz)
    lines.push(`traverse, stick released: after 3 s ${kmh(traverse.s)} km/h, travel ${deg(slipAngle)}° below the skis' line, skid ${traverse.s.skid.toFixed(2)}, dropped ${traverse.drop.toFixed(1)} m, edge ${deg(traverse.s.edgeAngle)}°`)
    // Traverse held: same, holding the stick toward the hill (positive turns right, uphill when facing +x... use sign of heading).
    const held = run(pitch, { heading: (75 * Math.PI) / 180, speed: 8 }, 3, () => ({ steer: 0.75, brake: 0, tuck: false }))
    lines.push(`traverse, stick held 0.75: after 3 s ${kmh(held.s)} km/h, skid ${held.s.skid.toFixed(2)}, dropped ${held.drop.toFixed(1)} m, heading ${deg(held.s.heading)}°`)
    // Linked turns at two rhythms.
    for (const period of [1.0, 1.6, 2.4]) {
      const linked = run(pitch, { heading: 0, speed: 8 }, 24, (_s, t) => ({ steer: Math.sin((2 * Math.PI * t) / period) > 0 ? 1 : -1, brake: 0, tuck: false }))
      const speeds = linked.trace.filter((p) => p.t > 8).map((p) => Math.hypot(p.s.vx, p.s.vy, p.s.vz) * 3.6)
      const avg = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length)
      lines.push(`linked full turns every ${period / 2}s: settles ${avg.toFixed(0)} km/h (${Math.min(...speeds).toFixed(0)} to ${Math.max(...speeds).toFixed(0)}), peak skid ${linked.maxSkid.toFixed(2)}, mode ${linked.s.mode}, heading swing ${deg(Math.max(...linked.trace.filter((p) => p.t > 8).map((p) => Math.abs(p.s.heading))))}°`)
    }
    // Closed loop, like a player: turn until the skis are a set angle off the
    // fall line, then switch. Wider finishes should mean slower, steady skiing.
    for (const finish of [30, 50, 70, 85]) {
      let side = 1
      const loop = run(pitch, { heading: 0, speed: 8 }, 30, (st) => {
        const off = (st.heading * 180) / Math.PI
        if (side > 0 && off > finish) side = -1
        else if (side < 0 && off < -finish) side = 1
        return { steer: side, brake: 0, tuck: false }
      })
      const speeds = loop.trace.filter((p) => p.t > 10).map((p) => Math.hypot(p.s.vx, p.s.vy, p.s.vz) * 3.6)
      const avg = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length)
      lines.push(`player turns finishing ${finish}° off the fall line: ${avg.toFixed(0)} km/h (${Math.min(...speeds).toFixed(0)} to ${Math.max(...speeds).toFixed(0)}), peak skid ${loop.maxSkid.toFixed(2)}`)
    }
    // Turn to the traverse from straight down at 15 m/s.
    const turn = run(pitch, { heading: 0, speed: 15 }, 3, () => ({ steer: 1, brake: 0, tuck: false }))
    const half = turn.trace.find((p) => Math.abs(p.s.heading) > Math.PI / 4)
    lines.push(`full turn from fall line at 54 km/h: 45° off after ${half ? half.t.toFixed(1) : '>3'} s, after 3 s ${kmh(turn.s)} km/h heading ${deg(turn.s.heading)}° skid ${turn.s.skid.toFixed(2)} grip ratio ${turn.s.gripRatio.toFixed(2)} washouts? ${turn.s.washout > 0}`)
    // Hockey stop from 15 m/s.
    const stop = run(pitch, { heading: 0, speed: 15 }, 8, () => ({ steer: 0, brake: 1, tuck: false }))
    const stopped = stop.trace.find((p) => Math.hypot(p.s.vx, p.s.vy, p.s.vz) < 1)
    lines.push(`hockey stop from 54 km/h: ${stopped ? `stopped at ${stopped.t.toFixed(1)} s` : `still ${kmh(stop.s)} km/h after 8 s`}`)
    // Straight run.
    const straight = run(pitch, { heading: 0, speed: 0.5 }, 10, () => idle)
    lines.push(`straight run upright: ${kmh(straight.s)} km/h after 10 s`)
    console.log(lines.join('\n'))
  }
}, 60000)
