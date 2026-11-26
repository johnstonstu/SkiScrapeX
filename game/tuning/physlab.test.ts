/**
 * Physics lab: the numbers the 2026-11-25 playtest measured, so a tuning
 * change can be judged before and after. Straight tuck speeds by pitch,
 * hockey stops by speed and pitch, and a keyboard tap at speed.
 *
 *   PHYSLAB_OUT=path/to/out.md npm run tune -- physlab
 *
 * writes a Markdown report (default: the OS temp folder).
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput, type SkiState } from '../src/sim'

const kmh = (s: SkiState) => Math.hypot(s.vx, s.vy, s.vz) * 3.6

/** A skier on a steady slope, facing down it at `speed` m/s. */
function start(pitch: number, speed: number) {
  const slope = createSteadySlope(pitch, { width: 4000, depth: 8000, spawnX: 2000, spawnZ: 200 })
  const g = slope.sampleTerrain(2000, 200)!
  const s = createSkiState({ x: 2000, y: g.height, z: 200, heading: 0 })
  const fy = -g.normal.z / g.normal.y
  const l = Math.hypot(fy, 1)
  s.vy = (fy / l) * speed
  s.vz = (1 / l) * speed
  return { s, sample: slope.sampleTerrain }
}

function straight(pitch: number): string {
  const { s, sample } = start(pitch, 0)
  const at: Record<number, number> = {}
  for (let t = 0; t <= 90 + 1e-9; t += FIXED_DT) {
    stepSkier(s, { steer: 0, brake: 0, tuck: true }, sample, FIXED_DT)
    for (const mark of [5, 10, 20, 90]) if (Math.abs(t - mark) < FIXED_DT / 2) at[mark] = kmh(s)
  }
  return `| ${pitch}° | ${at[5].toFixed(0)} | ${at[10].toFixed(0)} | ${at[20].toFixed(0)} | ${at[90].toFixed(0)} |`
}

function stop(pitch: number, fromKmh: number): string {
  // Run straight at speed for a beat, then a full hockey stop.
  const { s, sample } = start(pitch, fromKmh / 3.6)
  const x0 = s.x, z0 = s.z
  let t = 0
  while (kmh(s) > 1 && t < 15) {
    stepSkier(s, { steer: 0, brake: 1, tuck: false }, sample, FIXED_DT)
    t += FIXED_DT
  }
  const distance = Math.hypot(s.x - x0, s.z - z0)
  const decel = fromKmh / 3.6 / t / 9.81
  return `| ${fromKmh} km/h | ${pitch}° | ${t < 15 ? t.toFixed(2) + ' s' : 'no stop'} | ${distance.toFixed(1)} m | ${decel.toFixed(2)} g |`
}

function tap(pitch: number, fromKmh: number, holdSeconds: number): string {
  const { s, sample } = start(pitch, fromKmh / 3.6)
  const h0 = s.heading
  let peakEdge = 0, washouts = 0, minSpeed = Infinity
  for (let t = 0; t < 2; t += FIXED_DT) {
    const input: SkiInput = { steer: t < holdSeconds ? 1 : 0, brake: 0, tuck: false, directionalSteering: true }
    stepSkier(s, input, sample, FIXED_DT)
    peakEdge = Math.max(peakEdge, Math.abs(s.edgeAngle))
    if (s.washout > 0) washouts++
    minSpeed = Math.min(minSpeed, kmh(s))
  }
  const turned = ((s.heading - h0) * 180) / Math.PI
  return `| ${(holdSeconds * 1000).toFixed(0)} ms | ${fromKmh} km/h | ${((peakEdge * 180) / Math.PI).toFixed(1)}° | ${turned.toFixed(1)}° | ${(washouts * FIXED_DT).toFixed(2)} s | ${minSpeed.toFixed(0)} km/h |`
}

it('physics lab report', () => {
  const lines = [
    '## Straight tuck from rest',
    '| Pitch | 5 s | 10 s | 20 s | 90 s (terminal) |',
    '|---|---|---|---|---|',
    ...[15, 20, 25, 30].map(straight),
    '',
    '## Hockey stop',
    '| From | Pitch | Time | Distance | Mean decel |',
    '|---|---|---|---|---|',
    ...[50, 80].flatMap((v) => [10, 20, 30].map((p) => stop(p, v))),
    '',
    '## Keyboard tap (full stick, then released), 20° pitch',
    '| Held | Speed | Peak edge | Heading change after 2 s | Washout time | Lowest speed |',
    '|---|---|---|---|---|---|',
    ...[70, 100].flatMap((v) => [0.05, 0.2, 0.5].map((h) => tap(20, v, h))),
  ]
  const out = process.env.PHYSLAB_OUT ?? join(tmpdir(), 'skiscrapex-physlab.md')
  writeFileSync(out, lines.join('\n') + '\n')
})
