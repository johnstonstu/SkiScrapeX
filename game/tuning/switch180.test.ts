/**
 * Hop 180 probe, part of `npm run tune` (not CI). A rider rolls down a steady pitch, forward or
 * switch, and plays "jump plus a direction" the way a hand does it on keys: a tap or a short
 * hold, with the direction pressed a little early, together, or a little late.
 *
 * Columns: did the stance flip (the point of the move), did the rider stay up, seconds in the
 * air, km/h kept, and how far the line of travel moved (degrees).
 */
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../src/sim'
import { rampKeySteer } from '../src/player/keySteer'

const deg = (r: number) => (r * 180) / Math.PI
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

interface Play { hold: number; dirLead: number; dirTrail: number }

export function hop(pitch: number, kmh: number, startSwitch: boolean, play: Play, dir = 1) {
  const slope = createSteadySlope(pitch, { width: 6000, depth: 6000 })
  const s = createSkiState({ x: 3000, z: 200, heading: startSwitch ? Math.PI : 0 })
  s.y = slope.sampleTerrain(s.x, s.z)!.height
  s.vy = -Math.sin((pitch * Math.PI) / 180) * (kmh / 3.6)
  s.vz = Math.cos((pitch * Math.PI) / 180) * (kmh / 3.6)
  s.speed = kmh / 3.6
  s.ridingSwitch = startSwitch
  const frame = 1 / 60
  let key = 0, want = 0, air = 0, crashed = false
  const jumpAt = 1, jumpEnd = jumpAt + play.hold
  const dirFrom = jumpAt - play.dirLead, dirTo = jumpEnd + play.dirTrail
  let travel0 = 0, speed0 = 0
  for (let t = 0; t < 4; t += frame) {
    const next = t >= dirFrom && t < dirTo ? dir : 0
    const ramp = rampKeySteer(key, want, next !== want ? [{ t: 0, want: next }] : [], 0, frame * 1000, 11, 10)
    key = ramp.value
    want = next
    const input: SkiInput = { steer: ramp.mean, directionalSteering: ramp.mean !== 0, brake: 0, tuck: false, jump: t >= jumpAt && t < jumpEnd }
    if (Math.abs(t - (dirFrom - 0.2)) < frame / 2) { travel0 = Math.atan2(-s.vx, s.vz); speed0 = s.speed }
    for (let k = 0; k < 2; k++) {
      stepSkier(s, input, slope.sampleTerrain, FIXED_DT)
      if (!s.grounded) air += FIXED_DT
      if (s.crashed > 0) crashed = true
    }
    if (t > jumpEnd + 0.05 && s.grounded && t > jumpEnd + 0.9) break
  }
  return {
    flipped: s.ridingSwitch !== startSwitch,
    crashed,
    air,
    kept: s.speed / Math.max(speed0, 0.01),
    moved: deg(wrap(Math.atan2(-s.vx, s.vz) - travel0)),
    trick: s.trick?.name ?? '',
    grade: s.trick?.grade ?? '',
  }
}

const PLAYS: [string, Play][] = [
  ['tap, together', { hold: 0.08, dirLead: 0, dirTrail: 0.05 }],
  ['tap, dir early', { hold: 0.08, dirLead: 0.15, dirTrail: 0 }],
  ['tap, dir let go early', { hold: 0.1, dirLead: 0.15, dirTrail: -0.08 }],
  ['tap, dir late', { hold: 0.08, dirLead: -0.12, dirTrail: 0.15 }],
  ['short hold 0.2', { hold: 0.2, dirLead: 0, dirTrail: 0.05 }],
  ['full crouch 0.45', { hold: 0.45, dirLead: 0, dirTrail: 0.05 }],
  ['full crouch, dir held on', { hold: 0.45, dirLead: 0.3, dirTrail: 0.6 }],
]

it('hop 180 table', () => {
  const out: string[] = ['']
  for (const startSwitch of [true, false]) {
    for (const [pitch, kmh] of [[6, 15], [12, 35], [20, 60], [28, 80]]) {
      out.push(`${startSwitch ? 'SWITCH' : 'FORWARD'} start, ${pitch} deg pitch, ${kmh} km/h`)
      for (const [name, play] of PLAYS) {
        const r = hop(pitch, kmh, startSwitch, play)
        out.push(
          `  ${name.padEnd(26)} ${r.flipped ? 'flipped' : 'no flip'}  ${r.crashed ? 'CRASH' : 'up   '}  air ${r.air.toFixed(2)} s  kept ${(r.kept * 100).toFixed(0).padStart(3)}%  line ${r.moved.toFixed(0).padStart(4)} deg  ${r.trick} ${r.grade}`,
        )
      }
    }
  }
  process.stdout.write(out.join('\n') + '\n')
})
