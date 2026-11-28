import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { rideMainLine } from './parkBot'
import { buildMoguls } from '../src/world/moguls'
import { createSurfaceSampler } from '../src/world/snow'
import { approachAim, parkSitesFromLines } from '../src/world/park'
import { FIXED_DT, createSkiState, fallLineHeading, stepSkier, type SampleTerrain, type SkiState } from '../src/sim'
import { createFollowCamera, followHeading, type FollowFrame } from '../src/player/followCamera'

/**
 * Stu (2026-11-28): on mogul runs the camera sits too close to the ground,
 * you cannot see in front of you and it is snappy; park jumps need a pass on
 * the way in and on landing. These run the follow camera's framing against a
 * bot on the real mountain and measure what he described.
 */
const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)
const FRAME = 1 / 60
const HALF_FOV = 29

type Rig = (state: SkiState, terrain: SampleTerrain, dt: number, snap: boolean, aim: Parameters<ReturnType<typeof createFollowCamera>['step']>[3]['aim']) => FollowFrame

/** The 0.9.56 follow camera, kept here as the yardstick the new framing is measured against. */
function legacyRig(): Rig {
  const f: FollowFrame = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0 }
  let heading = 0, lookHeight = 0
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return (state, terrain, dt, snap, aim) => {
    heading = followHeading('steady', state, terrain, heading, snap ? Infinity : dt)
    const back = 7.2 + Math.min(4, state.speed * 0.08)
    const height = 2.6 + Math.min(1.5, state.speed * 0.03)
    const dx = state.x + Math.sin(heading) * back, dz = state.z - Math.cos(heading) * back
    let dy = state.y + height
    const under = terrain(dx, dz)
    if (under) dy = Math.max(dy, under.height + 1.4)
    const k = snap ? 1 : 1 - Math.exp(-6 * dt)
    f.x += (dx - f.x) * k; f.y += (dy - f.y) * k; f.z += (dz - f.z) * k
    f.lookX = state.x - Math.sin(heading) * 8; f.lookZ = state.z + Math.cos(heading) * 8
    const ahead = terrain(f.lookX, f.lookZ), here = terrain(state.x, state.z)
    const drop = ahead && here ? clamp((ahead.height - here.height) * 0.55, -3.2, 2) : 0
    lookHeight = snap ? drop : lookHeight + (drop - lookHeight) * (1 - Math.exp(-4 * dt))
    f.lookY = state.y + 1.1 + lookHeight
    if (aim && state.grounded && !state.rail && state.crashed <= 0) {
      f.lookX += (aim.x - f.lookX) * (aim.strength ?? 0.16); f.lookZ += (aim.z - f.lookZ) * (aim.strength ?? 0.16)
    }
    return f
  }
}

function newRig(lift = 0): Rig {
  const cam = createFollowCamera()
  return (state, terrain, dt, snap, aim) => cam.step(state, terrain, dt, { style: 'steady', aim, snap, lift })
}

interface Sample { seen?: boolean; onto?: number; t: number; camY: number; pitch: number; yaw: number; clear: number; graze: number; grounded: boolean; air: number; landOff: number | null; riderOff: number }

const smoothHeight = (terrain: SampleTerrain, x: number, z: number) => {
  const s = terrain(x, z)
  return s ? s.height - (s.mogulHeight ?? 0) : NaN
}

/** Angle (deg) of a point below the view axis, in the camera's vertical plane. */
function below(f: FollowFrame, x: number, y: number, z: number) {
  const pitch = Math.atan2(f.lookY - f.y, Math.hypot(f.lookX - f.x, f.lookZ - f.z))
  return (pitch - Math.atan2(y - f.y, Math.hypot(x - f.x, z - f.z))) * 57.2958
}

function measure(f: FollowFrame, state: SkiState, terrain: SampleTerrain, t: number, land: { x: number; y: number; z: number } | null): Sample {
  const planar = Math.hypot(state.vx, state.vz) || 1
  // The snow 12 m ahead of the rider along the travel line: how steeply the camera looks onto it.
  const ax = state.x + (state.vx / planar) * 12, az = state.z + (state.vz / planar) * 12
  const ay = smoothHeight(terrain, ax, az), ay2 = smoothHeight(terrain, ax + (state.vx / planar) * 2, az + (state.vz / planar) * 2)
  const slope = Math.atan2(ay2 - ay, 2)
  const ray = Math.atan2(ay - f.y, Math.hypot(ax - f.x, az - f.z))
  return {
    t,
    camY: f.y,
    pitch: Math.atan2(f.lookY - f.y, Math.hypot(f.lookX - f.x, f.lookZ - f.z)) * 57.2958,
    yaw: Math.atan2(-(f.lookX - f.x), f.lookZ - f.z) * 57.2958,
    clear: f.y - smoothHeight(terrain, f.x, f.z),
    graze: (slope - ray) * 57.2958,
    grounded: state.grounded,
    air: state.grounded ? 0 : state.y - (terrain(state.x, state.z)?.height ?? state.y),
    landOff: land ? below(f, land.x, land.y, land.z) : null,
    riderOff: below(f, state.x, state.y + 0.9, state.z),
  }
}

/** Nothing between the camera and a point: the terrain stays under the line between them. */
function sightline(terrain: SampleTerrain, f: FollowFrame, x: number, y: number, z: number) {
  for (let i = 1; i < 40; i++) {
    const k = i / 40
    const ground = terrain(f.x + (x - f.x) * k, f.z + (z - f.z) * k)
    if (ground && ground.height > f.y + (y - f.y) * k) return false
  }
  return true
}

/** RMS of a series with its half-second moving average taken off: the bob and twitch, not the drift. */
function jitter(values: number[]) {
  const half = 15
  let sum = 0, n = 0
  for (let i = half; i < values.length - half; i++) {
    let mean = 0
    for (let j = i - half; j <= i + half; j++) mean += values[j]
    mean /= 2 * half + 1
    sum += (values[i] - mean) ** 2
    n++
  }
  return Math.sqrt(sum / Math.max(1, n))
}
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
const unwrap = (v: number[]) => v.map((a, i) => (i ? (v[i] = v[i - 1] + Math.atan2(Math.sin((a - v[i - 1]) / 57.2958), Math.cos((a - v[i - 1]) / 57.2958)) * 57.2958) : a))

describe.skipIf(!hasData)('follow camera on mogul runs', () => {
  const world = hasData ? loadApexWorld() : null!
  const moguls = hasData ? buildMoguls(world.grid, world.resort.runs, world.surface) : null!
  const sampleSurface = hasData ? createSurfaceSampler(world.grid, world.surface, world.canopy, { onMogul: moguls.onMogul }) : null!

  /** Short linked turns down the bumps, braking over `maxSpeed`: what a player does on a mogul run. */
  function ski(at: [number, number, number], maxSpeed: number, rig: Rig, seconds = 16) {
    const terrain = moguls.sampleTerrain
    const s = createSkiState({ x: at[0], z: at[1], heading: (at[2] * Math.PI) / 180 })
    s.y = terrain(s.x, s.z)!.height
    const samples: Sample[] = []
    let frames = 0, bumpTime = 0
    for (let t = 0, step = 0; t < seconds; t += FIXED_DT, step++) {
      const fall = fallLineHeading(world.grid.sampleTerrain(s.x, s.z)!.normal) ?? s.heading
      const want = fall + (t < 1.5 ? 0 : Math.floor((t - 1.5) / 0.8) % 2 ? 0.55 : -0.55)
      const steer = Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading)) * 3))
      stepSkier(s, { steer, brake: s.grounded && s.speed > maxSpeed ? 0.7 : 0, tuck: false }, terrain, FIXED_DT, { sampleSurface })
      if (step % 2) continue
      const f = rig(s, terrain, FRAME, frames++ === 0, null)
      if ((terrain(s.x, s.z)?.mogulHeight ?? 0) > 0.07) bumpTime += FRAME
      if (t > 4) samples.push(measure(f, s, terrain, t, null))
    }
    if (process.env.CAM_TRACE && String(at) === process.env.CAM_TRACE) process.stdout.write(samples.filter((q) => q.t > 8 && q.t < 11).filter((_, i) => i % 3 === 0).map((q) => `${q.t.toFixed(2)} camY ${q.camY.toFixed(2)} pitch ${q.pitch.toFixed(1)} clear ${q.clear.toFixed(2)} air ${q.air.toFixed(2)} g${q.grounded ? 1 : 0}`).join('\n') + '\n')
    return { samples, bumpShare: bumpTime / seconds, end: s }
  }
  const report = (name: string, r: ReturnType<typeof ski>) => {
    const c = r.samples.map((s) => s.clear), g = r.samples.map((s) => s.graze)
    const line = `${name}: clearance mean ${mean(c).toFixed(2)} min ${Math.min(...c).toFixed(2)} m | looks onto the snow 12 m ahead at ${mean(g).toFixed(1)}° (min ${Math.min(...g).toFixed(1)}°) | bob ${(jitter(r.samples.map((s) => s.camY)) * 100).toFixed(1)} cm, pitch twitch ${jitter(r.samples.map((s) => s.pitch)).toFixed(2)}°, yaw twitch ${jitter(unwrap(r.samples.map((s) => s.yaw))).toFixed(2)}° | rider ${mean(r.samples.map((s) => s.riderOff)).toFixed(1)}° below centre | on bumps ${(r.bumpShare * 100).toFixed(0)}% end ${(r.end.speed * 3.6).toFixed(0)} km/h`
    process.stdout.write(line + '\n')
    return { clear: mean(c), minClear: Math.min(...c), graze: mean(g), bob: jitter(r.samples.map((s) => s.camY)), pitch: jitter(r.samples.map((s) => s.pitch)), yaw: jitter(unwrap(r.samples.map((s) => s.yaw))), rider: r.samples.map((s) => s.riderOff) }
  }

  for (const [name, at, maxSpeed] of [["Kristi's Run (25°)", [2073, 879, -111], 12], ['Gunbarrel (38°)', [1111, 1079, -179], 11], ['West Bank (25°)', [1780, 1488, -123], 12]] as const) {
    it(`${name}: higher, looking onto the bumps ahead, and steadier than 0.9.56`, () => {
      const before = report(`${name} 0.9.56`, ski([...at], maxSpeed, legacyRig()))
      const after = report(`${name} now   `, ski([...at], maxSpeed, newRig()))
      expect(after.clear).toBeGreaterThan(before.clear + 1.2)
      expect(after.minClear).toBeGreaterThan(2.2)
      expect(after.graze).toBeGreaterThan(before.graze + 3)
      // Bob and twitch: what is left once the half-second trend is taken off. Yaw is the turns themselves, so it only must not get worse.
      expect(after.bob).toBeLessThan(before.bob * 0.8)
      expect(after.pitch).toBeLessThan(before.pitch * 0.5)
      expect(after.yaw).toBeLessThan(before.yaw * 1.1)
      // The rider stays in the picture, below the middle.
      expect(Math.max(...after.rider)).toBeLessThan(HALF_FOV - 5)
      expect(Math.min(...after.rider)).toBeGreaterThan(0)
    })
  }
})

describe.skipIf(!hasData)('follow camera on park jumps', () => {
  const world = hasData ? loadApexWorld() : null!

  function ride(name: string, rig: Rig) {
    const site = parkSitesFromLines(world.resort.parks, world.grid.heightAt).find((p) => p.name === name)!
    const samples: Sample[] = []
    let step = 0, frames = 0, t = 0
    let land: { x: number; y: number; z: number } | null = null
    const pending: { sample: Sample; f: FollowFrame }[] = []
    let wasGrounded = true
    rideMainLine(world, site, site.layout, {
      seconds: 60,
      onStep: (s, terrain, features) => {
        t += FIXED_DT
        if (step++ % 2) return
        const planar = Math.hypot(s.vx, s.vz)
        const hint = s.grounded && planar > 3 ? approachAim(features, [], s.x, s.z, s.vx / planar, s.vz / planar, 40) : null
        const f = rig(s, terrain, FRAME, frames++ === 0, hint ? { x: hint.x, z: hint.z, strength: 0.14, distance: hint.distance, jump: hint.kind === 'jump' } : null)
        const sample = measure(f, s, terrain, t, null)
        samples.push(sample)
        // Where each air comes down, looked back at from every frame of that air.
        if (!s.grounded) pending.push({ sample, f: { ...f } })
        if (s.grounded && !wasGrounded) {
          land = { x: s.x, y: s.y, z: s.z }
          for (const p of pending) {
            p.sample.landOff = below(p.f, land.x, land.y, land.z)
            p.sample.seen = sightline(terrain, p.f, land.x, land.y + 0.3, land.z)
            // How steeply the camera looks onto the landing: 0 when it is hidden, a few degrees when it is a sliver.
            const dx = s.vx / planar, dz = s.vz / planar
            const slope = Math.atan2(terrain(land.x + dx * 1.5, land.z + dz * 1.5)!.height - terrain(land.x - dx * 1.5, land.z - dz * 1.5)!.height, 3)
            const ray = Math.atan2(land.y - p.f.y, Math.hypot(land.x - p.f.x, land.z - p.f.z))
            p.sample.onto = p.sample.seen ? Math.max(0, (slope - ray) * 57.2958) : 0
          }
          pending.length = 0
        }
        wasGrounded = s.grounded
      },
    })
    if (process.env.CAM_TRACE === name) process.stdout.write(samples.filter((_, i) => i % 6 === 0).map((q) => `${q.t.toFixed(1)} camY ${q.camY.toFixed(1)} pitch ${q.pitch.toFixed(1)} clear ${q.clear.toFixed(1)} air ${q.air.toFixed(1)} rider ${q.riderOff.toFixed(0)} land ${q.landOff?.toFixed(0) ?? '-'}`).join('\n') + '\n')
    return samples
  }
  /** Each air longer than `min` seconds, as a slice of samples. */
  const airs = (samples: Sample[], min = 0.5) => {
    const out: Sample[][] = []
    let run: Sample[] = []
    for (const s of samples) {
      if (!s.grounded) run.push(s)
      else {
        if (run.length * FRAME > min) out.push(run)
        run = []
      }
    }
    return out
  }
  const report = (name: string, samples: Sample[]) => {
    const jumps = airs(samples)
    // A third of the way through each air: is the landing in the picture, and how far from the middle?
    const landAt = jumps.map((j) => j[Math.floor(j.length / 3)].landOff ?? 0)
    const early = jumps.map((j) => j[Math.min(j.length - 1, 12)].landOff ?? 0)
    const twitch = jitter(samples.map((s) => s.pitch))
    // How much of each air the landing spot is in sight (not behind the deck or the knuckle).
    const seen = jumps.map((j) => j.filter((q) => q.seen).length / j.length)
    const onto = jumps.map((j) => mean(j.map((q) => q.onto ?? 0)))
    const clear = Math.min(...samples.map((s) => s.clear))
    process.stdout.write(`${name}: ${jumps.length} airs (${jumps.map((j) => (j.length * FRAME).toFixed(1)).join(', ')} s) | landing below centre 0.2 s after the lip ${early.map((v) => v.toFixed(0)).join(', ')}°, a third in ${landAt.map((v) => v.toFixed(0)).join(', ')}° | landing in sight ${seen.map((v) => (v * 100).toFixed(0)).join(', ')}% of the air, looked onto at ${onto.map((v) => v.toFixed(1)).join(', ')}° | pitch twitch ${twitch.toFixed(2)}° bob ${(jitter(samples.map((s) => s.camY)) * 100).toFixed(1)} cm | min clearance ${clear.toFixed(2)} m | rider max ${Math.max(...samples.map((s) => s.riderOff)).toFixed(0)}° min ${Math.min(...samples.map((s) => s.riderOff)).toFixed(0)}°\n`)
    return { jumps, landAt, early, twitch, clear, seen, onto, rider: samples.map((s) => s.riderOff) }
  }

  for (const name of ['Claim Jumper', 'Okanagan Park', 'Aerial Site']) {
    it(`${name}: the landing is in the picture through each air`, () => {
      const before = report(`${name} 0.9.56`, ride(name, legacyRig()))
      const after = report(`${name} now   `, ride(name, newRig()))
      expect(after.jumps.length).toBe(before.jumps.length)
      expect(after.jumps.length).toBeGreaterThan(0)
      // The landing sits inside the bottom of the frame, with room to spare, a third of the way through every air.
      for (const off of after.landAt) expect(off).toBeLessThan(HALF_FOV - 6)
      expect(mean(after.landAt)).toBeLessThan(mean(before.landAt))
      // It looks down onto the landing instead of along the deck (0.9.56 saw it edge-on, behind the knuckle).
      expect(mean(after.onto)).toBeGreaterThan(mean(before.onto) + 1.5)
      // The lift and the tilt toward the landing are deliberate moves; past those it is no twitchier than before.
      expect(after.twitch).toBeLessThan(before.twitch * 1.2)
      expect(after.clear).toBeGreaterThan(2)
      expect(Math.max(...after.rider)).toBeLessThan(HALF_FOV - 4)
      expect(Math.min(...after.rider)).toBeGreaterThan(-HALF_FOV + 8)
    })
  }
})
