import { describe, it } from 'vitest'
import { appendFileSync, writeFileSync } from 'node:fs'
writeFileSync('/tmp/parkscore.txt', '')
const log = (m: unknown) => appendFileSync('/tmp/parkscore.txt', (typeof m === 'string' ? m : JSON.stringify(m)) + '\n')
import { loadApexWorld } from '../tests/apexWorld'
import { FIXED_DT, SURFACES, createSkiState, stepSkier, type SkiInput, type SkiEnv, type GrabKind } from '../src/sim'
import { buildParkOverlay, dropInSpawn, placeFeatures, parkSitesFromLines } from '../src/world/park'
import { createParkPace } from '../src/app/parkPace'
import { addToCombo } from '../src/app/tricks'
import { parkTargets } from '../src/world/challenges'

type Plan = (i: number) => { grab?: GrabKind; steer?: number; pitch?: number }
const PERSONAS: Record<string, Plan> = {
  'same grab': () => ({ grab: 'mute' }),
  'four grabs': (i) => ({ grab: (['mute', 'tail', 'nose', 'japan'] as GrabKind[])[i % 4] }),
  'grabs + 360s': (i) => ({ grab: (['mute', 'tail', 'nose', 'japan'] as GrabKind[])[i % 4], steer: i % 2 ? 1 : 0 }),
  'spins flips grabs': (i) => ({ grab: (['mute', 'tail', 'nose', 'japan', 'truck'] as GrabKind[])[i % 5], steer: i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0, pitch: i % 3 === 2 ? -1 : 0 }),
}

describe('park scores by persona', () => {
  it('prints', () => {
    const world = loadApexWorld()
    const sites = parkSitesFromLines(world.resort.parks, world.grid.heightAt)
    for (const site of sites) {
      const features = placeFeatures(site, site.layout, world.grid.heightAt)
      const overlay = buildParkOverlay(features, world.grid.sampleTerrain, world.grid.heightAt)
      const env: SkiEnv = { rails: overlay.rails, sampleSurface: () => SURFACES.park }
      const t = parkTargets(site.layout)
      const out: string[] = []
      for (const [name, plan] of Object.entries(PERSONAS)) {
        const spawn = dropInSpawn(site)
        const s = createSkiState(spawn)
        const g = overlay.sampleTerrain(s.x, s.z)!
        s.y = g.height
        const fwd = { x: -Math.sin(s.heading), z: Math.cos(s.heading) }
        s.vx = fwd.x * spawn.speed!; s.vz = fwd.z * spawn.speed!; s.speed = spawn.speed!
        const axis = site.featureLine!
        const [ax, az] = axis[0]
        const dx = axis[1][0] - ax, dz = axis[1][1] - az
        const L = Math.hypot(dx, dz)
        const main = features.filter((f) => f.lane === 0)
        const pace = createParkPace()
        const input: SkiInput = { steer: 0, brake: 0, tuck: false }
        const combo = { tricks: [] as string[], counted: 0, multiplier: 1, points: 0 }
        let lastSeq = 0, airs = 0, wasAir = false, flat = 0, crashes = 0
        const names: string[] = []
        for (let time = 0; time < 120; time += FIXED_DT) {
          const along = ((s.x - ax) * dx + (s.z - az) * dz) / L
          if (along > L - 3) break
          const next = main.find((f) => f.lip && ((f.lip.x - s.x) * f.dirX + (f.lip.z - s.z) * f.dirZ) > 0 && ((f.lip.x - s.x) * f.dirX + (f.lip.z - s.z) * f.dirZ) < 6)
          const air = !s.grounded && !s.rail
          if (air && !wasAir) airs++
          wasAir = air
          const p = plan(airs - 1)
          input.jump = Boolean(next) && s.grounded
          input.grab = air; input.grabKind = p.grab
          input.steer = air ? p.steer ?? 0 : 0
          input.pitch = air ? p.pitch ?? 0 : 0
          stepSkier(s, input, overlay.sampleTerrain, FIXED_DT, env)
          pace.step(s, input, features, overlay.rails, FIXED_DT, 1)
          const landed = pace.takeLanding()
          if (s.trick && s.trick.seq !== lastSeq) {
            lastSeq = s.trick.seq
            if (s.trick.grade === 'crash') { crashes++; combo.tricks = []; combo.counted = 0; combo.points = 0; combo.multiplier = 1; continue }
            const sweet = s.trick.kind === 'air' && landed?.outcome === 'sweet'
            const pts = Math.round(s.trick.points * (sweet ? 1.25 : 1))
            flat += addToCombo(combo, s.trick.name, pts)
            names.push(`${s.trick.name}(${s.trick.grade[0]}${pts})`)
          }
        }
        out.push(`  ${name.padEnd(18)} one combo ${String(combo.points * combo.multiplier).padStart(6)} x${combo.multiplier}  no combo ${String(flat).padStart(5)}  crashes ${crashes}  ${names.join(' ')}`)
      }
      log(`${site.name} [${site.layout}] targets ${t.bronze}/${t.silver}/${t.gold}\n${out.join('\n')}`)
    }
  })
})
