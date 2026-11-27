/**
 * Tree-skiing probe, part of `npm run tune` (not CI). A rider holds linked
 * turns down a 20° glade of random trunks (about one per 30 m², at least
 * 2.7 m apart) at several speed caps, and counts crashes, brush-offs and
 * repeat crashes (another crash within 4 s of getting up).
 */
import { it } from 'vitest'
import { FIXED_DT, createSkiState, createSteadySlope, stepSkier } from '../src/sim'
import { indexTrunks, makeRandom, type Tree } from '../src/world/forest'
import { resolveTreeContact } from '../src/world/treeSkiing'

const DENSITY = Number(process.env.TREES ?? 9000)

it('tree glade', () => {
  const slope = createSteadySlope(20, { width: 400, depth: 3000 })
  const random = makeRandom(7)
  const trees: Tree[] = []
  for (let i = 0; i < 200000 && trees.length < DENSITY; i++) {
    const x = 100 + random() * 200, z = 100 + random() * 2600
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 2.7 ** 2)) continue
    trees.push({ x, z, y: 0, height: 14, rotation: 0, tone: 1, species: 0 as Tree['species'] })
  }
  const trunks = indexTrunks({ chunkSize: 3000, count: trees.length, source: 'canopy', chunks: [{ cx: 0, cz: 0, trees }] })
  const rows: string[] = []
  for (const style of ['turns', 'straight']) for (const cap of [15, 25, 35, 50]) {
    const s = createSkiState({ x: 200, z: 110, heading: 0 })
    s.y = slope.sampleTerrain(s.x, s.z)!.height
    let crashes = 0, repeats = 0, brushes = 0, upAt = -99, wasCrashed = false, t = 0
    for (; t < 90 && s.z < 2650; t += FIXED_DT) {
      const steer = style === 'straight' ? 0 : Math.floor(t / 1.1) % 2 === 0 ? 1 : -1
      const fromX = s.x, fromZ = s.z
      stepSkier(s, { steer, brake: s.speed * 3.6 > cap ? 1 : 0, tuck: false }, slope.sampleTerrain, FIXED_DT)
      const hit = resolveTreeContact(s, fromX, fromZ, trunks, slope.sampleTerrain)
      if (hit?.kind === 'crash') { crashes++; if (t - upAt < 4) repeats++ }
      else if (hit?.kind === 'brush') brushes++
      if (wasCrashed && s.crashed <= 0) upAt = t
      wasCrashed = s.crashed > 0
    }
    rows.push(`${style.padEnd(8)} cap ${String(cap).padStart(2)} km/h  ${t.toFixed(0).padStart(3)} s  crashes ${crashes}  repeat ${repeats}  brushes ${brushes}  reached ${s.z >= 2650}`)
  }
  process.stdout.write(rows.join('\n') + '\n')
}, 120000)
