/**
 * Input parity probe, part of `npm run tune` (not CI). The same held-turn
 * patterns played through each input path (keyboard ramp, gamepad stick,
 * touch stick) on steady pitches, for skis and the board, so the three can
 * be compared on one table. A "hold" is a full press of one direction; the
 * linked pattern swaps every `HOLD` seconds.
 *
 * Columns: avg km/h, share of time skidding (skid >= 0.3), the most the skis
 * pointed off the fall line (90 is straight across, past it is uphill),
 * seconds pointing uphill (> 95°), seconds at a near stop (< 5 km/h after
 * the first 3 s), and whether the rider ended up riding switch (backwards).
 */
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, fallLineHeading, stepSkier, type SkiEnv, type SkiInput } from '../src/sim'
import { rampKeySteer } from '../src/player/keySteer'

const deg = (r: number) => (r * 180) / Math.PI
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const HOLD = Number(process.env.HOLD ?? 1.2)

type Device = 'key' | 'pad' | 'touch'
type Pattern = 'linked' | 'hold'

/** What each device hands the sim for a wanted direction (-1, 0, 1), at 60 fps. */
function device(kind: Device) {
  let value = 0
  let want = 0
  return (next: number, dt: number): Pick<SkiInput, 'steer' | 'directionalSteering'> => {
    if (kind === 'key') {
      const changes = next !== want ? [{ t: 0, want: next }] : []
      const ramp = rampKeySteer(value, want, changes, 0, dt * 1000, 11, 10)
      value = ramp.value
      want = next
      return { steer: ramp.mean, directionalSteering: ramp.mean !== 0 }
    }
    // A thumb on a stick: full deflection takes a few frames, and a phone stick is a drag.
    const rate = kind === 'pad' ? 12 : 8
    value += Math.max(-rate * dt, Math.min(rate * dt, next - value))
    return { steer: value, directionalSteering: false }
  }
}

function ride(pitch: number, kind: Device, pattern: Pattern, ski: SkiEnv['ski']) {
  const slope = createSteadySlope(pitch, { width: 6000, depth: 6000 })
  const s = createSkiState({ x: 3000, z: 200, heading: 0 })
  s.y = slope.sampleTerrain(s.x, s.z)!.height
  // Rolling at 20 km/h straight down, as after a push or a short straight run.
  s.vy = -Math.sin(pitch * Math.PI / 180) * 20 / 3.6
  s.vz = Math.cos(pitch * Math.PI / 180) * 20 / 3.6
  const input = device(kind)
  const env: SkiEnv = { ski }
  const frame = 1 / 60
  let washouts = 0, wasWash = false, skid = 0, uphill = 0, slow = 0, maxOff = 0, speedSum = 0, t = 0, switched = false
  for (; t < 12; t += frame) {
    const want = t < 1 ? 0 : pattern === 'hold' ? 1 : Math.floor((t - 1) / HOLD) % 2 === 0 ? 1 : -1
    const steer = input(want, frame)
    for (let k = 0; k < 2; k++) stepSkier(s, { ...steer, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT, env)
    const fall = fallLineHeading(slope.sampleTerrain(s.x, s.z)!.normal) ?? 0
    const off = Math.abs(deg(wrap(s.heading + (s.ridingSwitch ? Math.PI : 0) - fall)))
    maxOff = Math.max(maxOff, off)
    if (off > 95) uphill += frame
    if (s.skid >= 0.3) skid += frame
    if (t > 3 && s.speed < 5 / 3.6) slow += frame
    if (s.ridingSwitch) switched = true
    if (s.washout > 0 && !wasWash) washouts++
    wasWash = s.washout > 0
    speedSum += s.speed * frame
  }
  return `${(speedSum / t * 3.6).toFixed(0).padStart(3)} km/h  skid ${(skid / t * 100).toFixed(0).padStart(3)}%  off ${maxOff.toFixed(0).padStart(3)}°  uphill ${uphill.toFixed(1).padStart(4)}s  slow ${slow.toFixed(1).padStart(4)}s  washouts ${washouts}${switched ? '  SWITCH' : ''}`
}

it('input parity', () => {
  const rows: string[] = []
  for (const [name, ski] of [['skis', undefined], ['board', { sidecutRadius: 8, floatScale: 1.35 }]] as const) {
    for (const pattern of ['linked', 'hold'] as Pattern[]) for (const pitch of [6, 12, 20, 30]) {
      for (const kind of ['key', 'pad', 'touch'] as Device[]) {
        rows.push(`${name.padEnd(5)} ${pattern.padEnd(6)} ${String(pitch).padStart(2)}° ${kind.padEnd(5)} ${ride(pitch, kind, pattern, ski)}`)
      }
    }
  }
  process.stdout.write(rows.join("\n") + "\n")
}, 120000)

it('steady camera through held linked turns', async () => {
  const { followHeading } = await import('../src/player/camera')
  const rows: string[] = []
  for (const pitch of [12, 20, 30]) for (const hold of [1.2, 2.5]) {
    const slope = createSteadySlope(pitch, { width: 6000, depth: 6000 })
    const s = createSkiState({ x: 3000, z: 200, heading: 0 })
    s.y = slope.sampleTerrain(s.x, s.z)!.height
    s.vz = 20 / 3.6
    const input = device('pad')
    let cam = 0, camMax = 0, travelMax = 0, offSum = 0, n = 0
    for (let t = 0; t < 14; t += 1 / 60) {
      const want = t < 1 ? 0 : Math.floor((t - 1) / hold) % 2 === 0 ? 1 : -1
      const steer = input(want, 1 / 60)
      for (let k = 0; k < 2; k++) stepSkier(s, { ...steer, brake: 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
      cam = followHeading('steady', s, slope.sampleTerrain, cam, 1 / 60)
      if (t > 4) {
        camMax = Math.max(camMax, Math.abs(deg(cam)))
        travelMax = Math.max(travelMax, Math.abs(deg(Math.atan2(-s.vx, s.vz))))
        offSum += Math.abs(deg(cam)); n++
      }
    }
    rows.push(`${String(pitch).padStart(2)}° hold ${hold}s  travel peak ${travelMax.toFixed(0)}°  camera peak ${camMax.toFixed(0)}°  camera mean off fall line ${(offSum / n).toFixed(0)}°`)
  }
  process.stdout.write(rows.join('\n') + '\n')
})
