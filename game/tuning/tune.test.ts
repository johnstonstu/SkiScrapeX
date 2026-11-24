/**
 * Tuning harness, not part of CI: `npm run tune`. Needs public/data.
 * Bots ski real Apex runs, open powder and every park layout, and print
 * speeds, chatter, washouts and landing grades so constants can be tuned
 * against numbers instead of guesses.
 */
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { loadDiskGrid } from '../tests/diskGrid'
import { resortFromFeatures, pickableRuns, courseForRun, polylineLength, type Point2 } from '../src/world/resort'
import { buildMoguls } from '../src/world/moguls'
import { buildSurface, type Canopy } from '../src/world/surface'
import { createSurfaceSampler } from '../src/world/snow'
import { buildParkOverlay, LAYOUTS, parkSitesFromLines, placeFeatures } from '../src/world/park'
import { FIXED_DT, createSkiState, stepSkier, type SkiEnv, type SkiState, type SampleTerrain } from '../src/sim'

const DATA = 'public/data/'
const grid = loadDiskGrid(DATA)
console.log(grid.detail ? `Terrain: 2 m detail over 5 m` : 'Terrain: 5 m')
const cover = readFileSync(`${DATA}canopy-cover.u8`)
const height = readFileSync(`${DATA}canopy-height.u8`)
const canopy: Canopy = { cover: Float32Array.from(cover, (b) => b / 255), height: Float32Array.from(height, (b) => b / 4) }
const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
const sites = parkSitesFromLines(resort.parks)
const surface = buildSurface(grid, resort, 2.5, sites.map((s) => ({ line: s.line, halfWidth: 16 })))
const { sampleTerrain, onMogul } = buildMoguls(grid, resort.runs, surface)
const sampleSurface = createSurfaceSampler(grid, surface, canopy, { onMogul })

const turnModel = process.env.TURN_MODEL === 'wide' ? 'wide' : 'classic'

interface Stats { time: number; maxKmh: number; avgKmh: number; chatter: number; washouts: number; crashes: number; offMap: boolean; reached: boolean; grades: Record<string, number>; sink: number }

/** Steer toward a point 25 m ahead on the line; brake above `maxSpeed`. */
function follow(line: Point2[], terrain: SampleTerrain, env: SkiEnv, maxSpeed: number, seconds = 600, pop?: (s: SkiState) => boolean): Stats {
  const [x0, z0] = line[0]
  const [x1, z1] = line[Math.min(3, line.length - 1)]
  const s = createSkiState({ x: x0, z: z0, heading: Math.atan2(-(x1 - x0), z1 - z0) })
  s.y = terrain(x0, z0)!.height
  const stats: Stats = { time: 0, maxKmh: 0, avgKmh: 0, chatter: 0, washouts: 0, crashes: 0, offMap: false, reached: false, grades: {}, sink: 0 }
  let lastSeq = 0
  let wasWashout = false
  let speedSum = 0
  const end = line[line.length - 1]
  for (let t = 0; t < seconds; t += FIXED_DT) {
    let nearest = 0
    let best = Infinity
    line.forEach(([x, z], i) => {
      const d = (x - s.x) ** 2 + (z - s.z) ** 2
      if (d < best) ((best = d), (nearest = i))
    })
    let k = nearest
    for (let ahead = 0; k < line.length - 1 && ahead < 25; k++) ahead += Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])
    const want = Math.atan2(-(line[k][0] - s.x), line[k][1] - s.z)
    const error = Math.atan2(Math.sin(want - s.heading), Math.cos(want - s.heading))
    const steer = s.grounded ? Math.max(-1, Math.min(1, error * 2.5)) : 0
    stepSkier(s, { steer, brake: s.speed > maxSpeed ? 0.7 : 0, tuck: s.speed < maxSpeed * 0.7, jump: pop?.(s) ?? false }, terrain, FIXED_DT, env)
    stats.maxKmh = Math.max(stats.maxKmh, s.speed * 3.6)
    speedSum += s.speed * FIXED_DT
    if (s.chatter > 0.1) stats.chatter += FIXED_DT
    if (s.washout > 0 && !wasWashout) stats.washouts++
    wasWashout = s.washout > 0
    stats.sink = Math.max(stats.sink, s.sink)
    if (s.trick && s.trick.seq !== lastSeq) {
      lastSeq = s.trick.seq
      stats.grades[s.trick.grade] = (stats.grades[s.trick.grade] ?? 0) + 1
      if (s.trick.grade === 'crash') stats.crashes++
    }
    if (s.offMap) { stats.offMap = true; break }
    stats.time = t
    if (Math.hypot(end[0] - s.x, end[1] - s.z) < 15) { stats.reached = true; break }
  }
  stats.avgKmh = (speedSum / Math.max(stats.time, 1)) * 3.6
  return stats
}

const fmt = (st: Stats) =>
  `${st.reached ? 'done' : st.offMap ? 'OFF' : 'stuck'} ${st.time.toFixed(0)}s max ${st.maxKmh.toFixed(0)} avg ${st.avgKmh.toFixed(0)} km/h chatter ${st.chatter.toFixed(1)}s washouts ${st.washouts} crashes ${st.crashes} sink ${st.sink.toFixed(2)} grades ${JSON.stringify(st.grades)}`

it('runs', () => {
  const env: SkiEnv = { turnModel, sampleSurface }
  for (const run of pickableRuns(resort).filter((r) => ['Grandfather\'s Trail', 'Okanagan Run', 'Ridge Run', 'Gunbarrel', 'The Great Wall', 'Kristi\'s', 'Make My Day', 'Juniper'].includes(r.name))) {
    const line = run.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
    for (const cap of [12, 18]) console.log(run.name.padEnd(22), run.difficulty?.padEnd(13), `cap ${cap}`, fmt(follow(line, sampleTerrain, env, cap)))
  }
}, 120000)

it('powder', () => {
  const env: SkiEnv = { turnModel, sampleSurface }
  // Straight down the fall line from open off-piste spots at several pitches.
  for (const [x, z] of [[600, 1700], [1000, 1300], [2700, 1500], [2200, 1200]] as Point2[]) {
    const s = createSkiState({ x, z, heading: 0 })
    const g = sampleTerrain(x, z)!
    s.heading = Math.atan2(-g.normal.x, g.normal.z)
    s.y = g.height
    let maxSink = 0
    for (let t = 0; t < 12; t += FIXED_DT) {
      stepSkier(s, { steer: 0, brake: 0, tuck: false }, sampleTerrain, FIXED_DT, env)
      maxSink = Math.max(maxSink, s.sink)
      if (s.offMap) break
    }
    console.log(`powder @${x},${z} pitch ${((s.pitch * 180) / Math.PI).toFixed(0)}° surface ${s.surface.kind} speed ${(s.speed * 3.6).toFixed(0)} km/h sink ${s.sink.toFixed(2)} (max ${maxSink.toFixed(2)})`)
  }
}, 60000)

it('parks', () => {
  const site = sites.find((s) => s.name === 'Claim Jumper')!
  for (const layout of LAYOUTS) {
    const overlay = buildParkOverlay(placeFeatures(site, layout.id), sampleTerrain, grid.heightAt)
    const env: SkiEnv = { turnModel, sampleSurface: createSurfaceSampler(grid, surface, canopy, { inPark: overlay.inside, onMogul }), rails: overlay.rails }
    for (const cap of [7, 9, 11]) console.log(`Claim Jumper ${layout.label.padEnd(12)} cap ${cap * 3.6} km/h`, fmt(follow(site.line, overlay.sampleTerrain, env, cap, 200)))
  }
}, 120000)

it.runIf(process.env.MEDALS)('medal calibration', () => {
  const env: SkiEnv = { turnModel, sampleSurface }
  const rows: string[] = []
  for (const run of pickableRuns(resort)) {
    const line = run.parts.reduce((a, b) => (polylineLength(b) > polylineLength(a) ? b : a))
    const length = polylineLength(line)
    const drop = grid.heightAt(line[0][0], line[0][1]) - grid.heightAt(line[line.length - 1][0], line[line.length - 1][1])
    const cells = [12, 16, 22].map((cap) => {
      const st = follow(line, sampleTerrain, env, cap, 400)
      return `${cap}:${st.reached ? st.time.toFixed(0) : 'x'}${st.crashes ? 'c' : ''}${st.washouts ? 'w' + st.washouts : ''}`
    })
    rows.push(`${run.name.padEnd(24)} ${String(run.difficulty).padEnd(12)} len ${length.toFixed(0).padStart(5)} drop ${drop.toFixed(0).padStart(4)} ${cells.join('  ')}`)
  }
  console.log(rows.join('\n'))
}, 600000)

