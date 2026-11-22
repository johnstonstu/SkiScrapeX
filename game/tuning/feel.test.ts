/**
 * Feel probes, part of `npm run tune` (not CI): kicker flights at set lip
 * speeds with and without a pop timed at the lip, ski and path response to a
 * held turn, and how far the follow camera trails the skis. LIP=-2 LAND=1
 * env vars offset every kicker's lip and landing angles for experiments.
 */
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier, type SkiInput } from '../src/sim'
import { buildParkOverlay, FEATURES, footprintOf, type PlacedFeature } from '../src/world/park'

const IDLE: SkiInput = { steer: 0, brake: 0, tuck: false }
const deg = (r: number) => (r * 180) / Math.PI

it('jumps', () => {
  const slope = createSteadySlope(12, { width: 400, depth: 3000 })
  const heightAt = (x: number, z: number) => slope.sampleTerrain(x, z)?.height ?? Number.NaN
  const rows: string[] = []
  const LIP = Number(process.env.LIP ?? 0), LAND = Number(process.env.LAND ?? 0)
  for (const id of ['kickerS', 'kickerM', 'kickerL', 'kickerXL']) {
    const spec = { ...FEATURES[id], lipDeg: FEATURES[id].lipDeg! + LIP, landingDeg: FEATURES[id].landingDeg! + LAND }
    const placed: PlacedFeature = { spec, x: 200, z: 400, dirX: 0, dirZ: 1, footprint: footprintOf(spec), halfWidth: 5 }
    const park = buildParkOverlay([placed], slope.sampleTerrain, heightAt)
    for (const kmh of [20, 25, 30, 35, 40, 45, 50, 55]) { let lipZ = 0; for (const pop of [false, true]) {
      const s = createSkiState({ x: 200, z: 360, heading: 0 })
      s.y = park.sampleTerrain(200, 360)!.height
      s.vz = kmh / 3.6
      let flew = false, t0 = 0, y0 = 0, z0 = 0, top = -1e9, vLip = 0, t = 0, vy0 = 0
      for (; t < 12; t += FIXED_DT) {
        if (!flew && s.z < 395) { const v = Math.hypot(s.vx, s.vy, s.vz); const k = kmh / 3.6 / v; s.vx *= k; s.vy *= k; s.vz *= k }
        const charging = pop && !flew && s.z > lipZ - 8 && s.z < lipZ - 0.05 * s.vz
        stepSkier(s, { ...IDLE, jump: charging }, park.sampleTerrain, FIXED_DT)
        if (!s.grounded && !flew && s.z > 395) { flew = true; t0 = t; y0 = s.y; z0 = s.z; vLip = Math.hypot(s.vx, s.vy, s.vz) * 3.6; vy0 = s.vy }
        if (flew) top = Math.max(top, s.y - y0)
        if (flew && s.grounded) break
      }
      if (!pop) lipZ = z0
      const ground = heightAt(200, z0)
      rows.push(`${id.padEnd(9)} ${String(kmh).padStart(3)} km/h pop=${pop ? 'y' : 'n'}  lip ${vLip.toFixed(0)} km/h vy ${vy0.toFixed(1)}  air ${(t - t0).toFixed(2)} s  peak +${top.toFixed(2)} m (${(y0 + top - ground).toFixed(1)} over slope)  dist ${(s.z - z0).toFixed(1)} m  ${s.trick?.grade ?? '-'} efh ${(s.trick?.efh ?? 0).toFixed(2)}`)
    } }
  }
  console.log(rows.join('\n'))
})

it('turn response', () => {
  const slope = createSteadySlope(15, { width: 4000, depth: 40000 })
  const rows: string[] = []
  for (const v of [8, 15, 22]) for (const mode of ['key', 'stick']) {
    const s = createSkiState({ x: 2000, z: 100, heading: 0 })
    s.y = slope.sampleTerrain(2000, 100)!.height
    s.vz = v
    let key = 0
    const marks: Record<string, number> = {}
    for (let t = 0; t < 2; t += FIXED_DT) {
      key = Math.min(1, key + 8 * FIXED_DT)
      const steer = mode === 'key' ? key : 1
      stepSkier(s, { ...IDLE, steer, directionalSteering: mode === 'key' }, slope.sampleTerrain, FIXED_DT)
      const h = Math.abs(deg(s.heading)), tr = Math.abs(deg(Math.atan2(-s.vx, s.vz)))
      for (const a of [10, 30, 60]) {
        if (h >= a && marks[`h${a}`] === undefined) marks[`h${a}`] = t
        if (tr >= a && marks[`p${a}`] === undefined) marks[`p${a}`] = t
      }
    }
    const f = (k: string) => (marks[k] === undefined ? '  -  ' : marks[k].toFixed(2))
    rows.push(`${v} m/s ${mode.padEnd(5)} skis 10/30/60°: ${f('h10')} ${f('h30')} ${f('h60')} s   path 10/30/60°: ${f('p10')} ${f('p30')} ${f('p60')} s`)
  }
  console.log(rows.join('\n'))
})

it('camera lag', () => {
  const blend = (c: number, g: number, a: number) => c + Math.atan2(Math.sin(g - c), Math.cos(g - c)) * a
  const slope = createSteadySlope(15, { width: 4000, depth: 40000 })
  const rows: string[] = []
  for (const [w, rate] of [[0.6, 3.2], [0.3, 7]]) for (const v of [10, 18]) {
    const s = createSkiState({ x: 2000, z: 100, heading: 0 })
    s.y = slope.sampleTerrain(2000, 100)!.height
    s.vz = v
    let key = 0, cam = 0
    const marks: Record<string, number> = {}
    const dt = 1 / 60
    for (let t = 0; t < 2; t += dt) {
      key = Math.min(1, key + 8 * dt)
      for (let k = 0; k < 2; k++) stepSkier(s, { ...IDLE, steer: key, directionalSteering: true }, slope.sampleTerrain, FIXED_DT)
      const travel = Math.atan2(-s.vx, s.vz)
      cam = blend(cam, blend(s.heading, travel, w), 1 - Math.exp(-rate * dt))
      for (const a of [10, 30]) {
        if (Math.abs(deg(s.heading)) >= a && marks[`s${a}`] === undefined) marks[`s${a}`] = t
        if (Math.abs(deg(cam)) >= a && marks[`c${a}`] === undefined) marks[`c${a}`] = t
      }
    }
    rows.push(`travel ${w} rate ${rate} @${v} m/s  skis 10/30°: ${marks.s10?.toFixed(2)} ${marks.s30?.toFixed(2)}  camera 10/30°: ${marks.c10?.toFixed(2)} ${marks.c30?.toFixed(2)}`)
  }
  console.log(rows.join('\n'))
})
