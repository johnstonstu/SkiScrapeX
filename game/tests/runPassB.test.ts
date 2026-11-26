import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadApexWorld } from './apexWorld'
import { buildGladeField, GLADES, GLADE_THINNING, gladeRuns } from '../src/world/glades'
import { indexTrunks, plantForest, type Forest } from '../src/world/forest'
import { BUMPS, buildMoguls } from '../src/world/moguls'
import { surfaceAt, SurfaceId } from '../src/world/surface'
import { nearestOnPolyline, pointAlong, pointInRing, polylineLength, runHalfWidth, type Run } from '../src/world/resort'
import { fencePosts, summitFence, toothTuskSignpost } from '../src/world/landmarks'
import { hitTrail } from '../src/ui/trailMap'
import { RUN_STYLE } from '../src/world/corrections'

/**
 * Run pass B from the Apex research handoff (docs/workplan.md): thinned
 * glades, moguls and chop on the runs the footage shows them on, grooming
 * states, and the summit landmarks. Checked on the real Apex data.
 */
const DATA = 'public/data/'
const hasData = existsSync(`${DATA}features.json`) && existsSync(`${DATA}heights.f32`) && existsSync(`${DATA}canopy-cover.u8`)

/** Trees per hectare inside `inside` over a 2.5 m sample grid of the box. */
function density(forest: Forest, box: [number, number, number, number], inside: (x: number, z: number) => boolean) {
  let trees = 0, cells = 0
  for (const chunk of forest.chunks) for (const t of chunk.trees) if (t.x >= box[0] && t.x <= box[2] && t.z >= box[1] && t.z <= box[3] && inside(t.x, t.z)) trees++
  for (let z = box[1]; z <= box[3]; z += 2.5) for (let x = box[0]; x <= box[2]; x += 2.5) if (inside(x, z)) cells++
  return cells ? trees / ((cells * 6.25) / 10000) : 0
}

/** Distance from a point to a ring's edge. */
const edgeDistance = (x: number, z: number, ring: [number, number][]) => Math.sqrt(nearestOnPolyline(x, z, [...ring, ring[0]]).distanceSq)

describe.skipIf(!hasData)('run pass B: glades', () => {
  const world = hasData ? loadApexWorld() : null!
  const plant = (runs: Run[]) => plantForest(world.grid, { ...world.resort, runs }, world.surface, world.canopy, { originElevation: 1600 })
  const withGlades = hasData ? plant(world.resort.runs) : null!
  const withoutGlades = hasData ? plant(world.resort.runs.filter((run) => !run.glade)) : null!

  it('thins every glade well below the same ground unthinned and below the forest round it', () => {
    for (const glade of GLADES) {
      const xs = glade.ring.map((p) => p[0]), zs = glade.ring.map((p) => p[1])
      const box: [number, number, number, number] = [Math.min(...xs) - 30, Math.min(...zs) - 30, Math.max(...xs) + 30, Math.max(...zs) + 30]
      const inside = (x: number, z: number) => pointInRing(x, z, glade.ring) && edgeDistance(x, z, glade.ring) > 3
      // The band 6 to 30 m outside the glade, off the runs, is the forest it sits in.
      const around = (x: number, z: number) => !pointInRing(x, z, glade.ring) && edgeDistance(x, z, glade.ring) > 6 && world.surface.runNameAt(x, z) === 'Off-piste'
      const thinned = density(withGlades, box, inside)
      const unthinned = density(withoutGlades, box, inside)
      const outside = density(withGlades, box, around)
      // Lanes take about 44% of the ground and the clumps keep 72% of theirs, so about
      // 40% of the trees should stay (0.56 × 0.72). Allow up to 55% for the spacing rule
      // filling some of the room the removed trees leave.
      expect(thinned / unthinned, `${glade.name}: ${thinned.toFixed(0)} vs ${unthinned.toFixed(0)} trees/ha unthinned`).toBeLessThan(0.55)
      expect(thinned / unthinned, glade.name).toBeGreaterThan(0.25)
      expect(thinned, `${glade.name}: ${thinned.toFixed(0)} inside vs ${outside.toFixed(0)} trees/ha around`).toBeLessThan(outside * 0.8)
    }
  }, 180000)

  it('leaves the forest outside the glades exactly as it was', () => {
    const away = (x: number, z: number) => GLADES.every((g) => !pointInRing(x, z, g.ring) && edgeDistance(x, z, g.ring) > 4)
    const keyOf = (forest: Forest) => forest.chunks.flatMap((c) => c.trees).filter((t) => away(t.x, t.z)).map((t) => `${t.x.toFixed(2)},${t.z.toFixed(2)},${t.height.toFixed(2)}`).sort()
    const a = keyOf(withGlades), b = keyOf(withoutGlades)
    expect(a.length).toBeGreaterThan(10000)
    expect(a).toEqual(b)
  }, 60000)

  it('opens skiable lanes down the fall line', () => {
    const trunks = { thinned: indexTrunks(withGlades), unthinned: indexTrunks(withoutGlades) }
    const field = buildGladeField(world.resort.runs, world.grid)
    for (const glade of GLADES) {
      // Start points on a 6 m grid inside the glade (in a lane, away from the edge);
      // ski 30 m straight down the fall line with a 0.4 m skier radius.
      const xs = glade.ring.map((p) => p[0]), zs = glade.ring.map((p) => p[1])
      const clear = { thinned: 0, unthinned: 0 }
      let starts = 0
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 6) {
        for (let x = Math.min(...xs); x < Math.max(...xs); x += 6) {
          if (!pointInRing(x, z, glade.ring) || edgeDistance(x, z, glade.ring) < 12 || !field.inLane(x, z)) continue
          const ground = world.grid.sampleTerrain(x, z)
          if (!ground) continue
          const lean = Math.hypot(ground.normal.x, ground.normal.z) || 1
          const ex = x + (ground.normal.x / lean) * 30, ez = z + (ground.normal.z / lean) * 30
          if (!pointInRing(ex, ez, glade.ring)) continue
          starts++
          if (!trunks.thinned.sweep(x, z, ex, ez, 0.4)) clear.thinned++
          if (!trunks.unthinned.sweep(x, z, ex, ez, 0.4)) clear.unthinned++
        }
      }
      expect(starts, glade.name).toBeGreaterThan(10)
      // The lane wanders at most `wander` metres over its wavelength, so a straight 30 m line
      // can drift out of a narrow stretch; most should still run clear.
      expect(clear.thinned / starts, `${glade.name}: ${clear.thinned}/${starts} lanes clear`).toBeGreaterThan(0.6)
      expect(clear.thinned, glade.name).toBeGreaterThan(clear.unthinned)
    }
    expect(GLADE_THINNING.lane * GLADE_THINNING.spacing).toBeGreaterThan(6)
  })

  it('names the glades under the skier (HUD) and on the map', () => {
    for (const glade of GLADES) {
      let named = 0, total = 0
      for (let i = 0; i < 400; i++) {
        const x = glade.ring[0][0] + (Math.max(...glade.ring.map((p) => p[0])) - Math.min(...glade.ring.map((p) => p[0]))) * ((i * 0.618) % 1) * (Math.sign(Math.max(...glade.ring.map((p) => p[0])) - glade.ring[0][0]) || 1)
        const z = Math.min(...glade.ring.map((p) => p[1])) + (Math.max(...glade.ring.map((p) => p[1])) - Math.min(...glade.ring.map((p) => p[1]))) * ((i * 0.381) % 1)
        // Off the raster's 2.5 m texel edge.
        if (!pointInRing(x, z, glade.ring) || edgeDistance(x, z, glade.ring) < 3) continue
        total++
        const name = world.surface.runNameAt(x, z)
        if (name === glade.name) named++
        else expect(name, `${glade.name} at ${x.toFixed(0)},${z.toFixed(0)}`).not.toBe('Off-piste')
      }
      expect(total, glade.name).toBeGreaterThan(20)
      // Runs through a glade keep their own name; the rest of the glade is the glade.
      expect(named / total, glade.name).toBeGreaterThan(0.5)
      const run = gladeRuns().find((r) => r.name === glade.name)!
      const [cx, cz] = glade.ring.reduce(([a, b], [x, z]) => [a + x / glade.ring.length, b + z / glade.ring.length], [0, 0])
      const inner = pointInRing(cx, cz, glade.ring) ? [cx, cz] : findInside(glade.ring)
      const hit = hitTrail(inner[0], inner[1], [run], [], 1)
      expect(hit?.kind === 'run' && hit.run.name, glade.name).toBe(glade.name)
    }
  })
})

function findInside(ring: [number, number][]): [number, number] {
  for (let i = 1; i < ring.length - 1; i++) {
    const x = (ring[0][0] + ring[i][0] + ring[i + 1][0]) / 3, z = (ring[0][1] + ring[i][1] + ring[i + 1][1]) / 3
    if (pointInRing(x, z, ring)) return [x, z]
  }
  throw new Error('no inside point')
}

describe.skipIf(!hasData)('run pass B: moguls, chop and grooming', () => {
  const world = hasData ? loadApexWorld() : null!
  const runs = (name: string) => world.resort.runs.filter((run) => run.name === name && run.kind === 'line')
  /** The bumps a run gets on its own (shared ground with another bump run is left out), and their peak rise along it. */
  const onRun = (name: string) => {
    const own = buildMoguls(world.grid, runs(name), world.surface)
    const lines = runs(name).flatMap((run) => run.parts.map((line) => ({ line, half: runHalfWidth(run) })))
    const bumps = own.bumps
    let peak = 0
    for (const { line } of lines) {
      for (let d = 0; d < polylineLength(line); d += 0.5) {
        const [x, z] = pointAlong(line, d)
        for (const side of [-4.5, -2.25, 0, 2.25, 4.5]) peak = Math.max(peak, own.sampleTerrain(x + side, z)?.mogulHeight ?? 0)
      }
    }
    const length = lines.reduce((n, { line }) => n + polylineLength(line), 0)
    return { bumps, peak, perHundred: (bumps.length / length) * 100 }
  }

  it('builds mogul fields on Sunbowl, Make My Day, Old Mill, Gunbarrel and K2', () => {
    for (const name of ['Sunbowl', 'Make My Day', 'Old Mill', 'Gunbarrel', 'K2', 'West Bank']) {
      expect(runs(name).length, name).toBeGreaterThan(0)
      const { bumps, peak, perHundred } = onRun(name)
      const mean = bumps.reduce((n, b) => n + b.height, 0) / bumps.length
      // A mogul field: a row about every 5 m, three or more lanes, crests half a metre and up.
      expect(perHundred, `${name}: ${perHundred.toFixed(1)} bumps per 100 m`).toBeGreaterThan(30)
      expect(mean, name).toBeGreaterThan(0.6)
      expect(peak, `${name}: highest rise ${peak.toFixed(2)} m`).toBeGreaterThan(0.75)
    }
    // Wide bowls get more lanes than the narrow corridors.
    expect(onRun('Sunbowl').perHundred).toBeGreaterThan(onRun('Make My Day').perHundred * 1.5)
  })

  it('gives Crusher and Hanks low chop, and leaves groomers smooth', () => {
    for (const name of ['Crusher', 'Hanks']) {
      const { bumps, peak, perHundred } = onRun(name)
      expect(perHundred, name).toBeGreaterThan(30)
      // Chop: bumps you feel (over 0.15 m) but well short of a mogul field's crests.
      for (const bump of bumps) {
        expect(bump.height, name).toBeGreaterThan(0.15)
        expect(bump.height, name).toBeLessThan(BUMPS.mogul.height - BUMPS.mogul.heightVary)
      }
      expect(peak, name).toBeGreaterThan(0.15)
      expect(peak, name).toBeLessThan(0.5)
    }
    for (const name of ["Grandfather's Trail", 'Juniper', 'Okanagan Run']) {
      expect(onRun(name).bumps.length, name).toBe(0)
    }
  })

  it('draws no corduroy on the ungroomed runs and packed snow on Grandmother\'s', () => {
    const along = (name: string, visit: (x: number, z: number) => void) => {
      for (const run of runs(name)) for (const line of run.parts) for (let d = 10; d < polylineLength(line) - 10; d += 5) visit(...pointAlong(line, d))
    }
    const share = (name: string, test: (x: number, z: number) => boolean) => {
      let hits = 0, total = 0
      along(name, (x, z) => ((total++), test(x, z) && hits++))
      return total ? hits / total : 0
    }
    const texel = (x: number, z: number) => (Math.floor(z / world.surface.texel) * world.surface.width + Math.floor(x / world.surface.texel)) * 4
    const corduroy = (x: number, z: number) => surfaceAt(world.surface, x, z) === SurfaceId.groomed && world.surface.mask[texel(x, z) + 2] === 0
    // The shader draws corduroy only on groomed texels without the packed flag (blue channel).
    for (const name of ['Crusher', 'Hanks', 'Sunbowl', 'Make My Day', 'Old Mill', 'K2']) {
      expect(share(name, corduroy), name).toBeLessThan(0.1)
      expect(runs(name).every((run) => !run.groomed), name).toBe(true)
    }
    // Grandmother's: groomed physics (packed snow), flagged so the shader leaves the corduroy off.
    expect(share("Grandmother's Trail", (x, z) => surfaceAt(world.surface, x, z) === SurfaceId.groomed)).toBeGreaterThan(0.7)
    expect(share("Grandmother's Trail", corduroy)).toBeLessThan(0.15)
    // A real groomer keeps its corduroy.
    expect(share("Grandfather's Trail", corduroy)).toBeGreaterThan(0.7)
    expect(RUN_STYLE["Grandmother's Trail"].packed).toBe(true)
  })
})

describe.skipIf(!hasData)('run pass B: landmarks', () => {
  const world = hasData ? loadApexWorld() : null!

  it('fences the summit rollovers without crossing a run or a lift line', () => {
    const quickdraw = world.resort.lifts.find((l) => /quick\s*draw/i.test(l.name))!
    const lines = world.resort.lifts.map((l) => l.line)
    const fences = summitFence(world.grid, quickdraw.top, world.resort.runs, lines, runHalfWidth)
    const posts = fences.flatMap((line) => fencePosts(line))
    // Enough fence to read as a landmark from the top: tens of metres, not a token post.
    const length = fences.reduce((n, line) => n + polylineLength(line), 0)
    expect(length).toBeGreaterThan(40)
    expect(posts.length).toBeGreaterThan(15)
    for (const [x, z] of fences.flat()) {
      // On the summit plateau, within the search ring round the lift top.
      const r = Math.hypot(x - quickdraw.top[0], z - quickdraw.top[1])
      expect(r).toBeGreaterThan(20)
      expect(r).toBeLessThan(130)
      for (const run of world.resort.runs.filter((run) => run.kind === 'line')) {
        for (const part of run.parts) expect(nearestOnPolyline(x, z, part).distanceSq, run.name).toBeGreaterThan(runHalfWidth(run) ** 2)
      }
      for (const line of lines) expect(nearestOnPolyline(x, z, line).distanceSq).toBeGreaterThan(14 ** 2)
    }
  })

  it('stands the Tooth/Tusk signpost just above the run, facing back up the slope', () => {
    const run = world.resort.runs.find((r) => r.name === 'Tooth Tusk')!
    const sign = toothTuskSignpost(run, world.grid)!
    expect(sign).not.toBeNull()
    expect([sign.left, sign.right]).toEqual(['TOOTH', 'TUSK'])
    const [x0, z0] = run.parts[0][0]
    expect(Math.hypot(sign.x - x0, sign.z - z0)).toBeLessThan(8)
    expect(world.grid.heightAt(sign.x, sign.z)).toBeGreaterThan(world.grid.heightAt(x0, z0))
    // The boards face uphill: the direction they face climbs.
    const ahead = world.grid.heightAt(sign.x + Math.sin(sign.yaw) * 6, sign.z + Math.cos(sign.yaw) * 6)
    expect(ahead).toBeGreaterThan(world.grid.heightAt(sign.x, sign.z))
  })
})

describe('run pass B: padded lift towers', () => {
  it('has orange or yellow pads on the chairlift towers in lifts.glb', () => {
    const bytes = readFileSync(new URL('../public/models/scenery/lifts.glb', import.meta.url))
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
      nodes: { name?: string; children?: number[]; mesh?: number }[]
      scenes: { nodes: number[] }[]
      meshes: { primitives: { material?: number }[] }[]
      materials: { name?: string }[]
    }
    const materialsUnder = (root: string) => {
      const names = new Set<string>()
      const visit = (i: number) => {
        const node = gltf.nodes[i]
        if (node.mesh !== undefined) for (const p of gltf.meshes[node.mesh].primitives) if (p.material !== undefined) names.add(gltf.materials[p.material].name ?? '')
        node.children?.forEach(visit)
      }
      visit(gltf.scenes[0].nodes.find((i) => gltf.nodes[i].name === root)!)
      return [...names]
    }
    // Footage: Quickdraw towers with orange pads, Stock's with yellow (run sheets: Juniper, Lucky Strike, Sluice Box).
    expect(materialsUnder('qd_tower')).toContain('pad_orange')
    expect(materialsUnder('st_tower')).toContain('pad_yellow')
  })
})
