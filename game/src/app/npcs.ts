/**
 * Other skiers on the hill. Each one skis a named run with the real ski
 * model, carving S-turns about the run line at its own pace, and starts a
 * new run near the player when it reaches the bottom or gets stuck. They
 * Soft collisions with the player: a bump or, at high closing speed, a crash.
 * They are only drawn up close.
 */
import * as THREE from 'three'
import { FIXED_DT, beginCrash, createSkiState, stepSkier, type SampleTerrain, type SkiEnv, type SkiInput, type SkiState } from '../sim'
import { createSkierView, SKI_GRAPHICS } from '../render/rider/skierView'
import { PALETTE } from '../ui/riderPanel'
import { headingFor, pointAlong, polylineLength, type Point2 } from '../world/resort'
import { makeRandom } from '../world/forest'

export interface Route {
  name: string
  line: Point2[]
  difficulty: string | null
}

interface Npc {
  state: SkiState
  input: SkiInput
  view: ReturnType<typeof createSkierView>
  route: Route
  length: number
  nearest: number
  /** m/s this skier holds. */
  cap: number
  /** Turn shape: metres per full S, and how far either side of the line. */
  wavelength: number
  amplitude: number
  travelled: number
  stuck: number
  /** Seconds spent far from the player; long enough and they move closer. */
  away: number
  accumulator: number
}

/** Beyond this the rider is not drawn or animated (physics still runs). */
const DRAW_DISTANCE = 380
const SKILL_CAP: Record<string, [number, number]> = {
  novice: [5, 8],
  easy: [7, 12],
  intermediate: [9, 15],
  advanced: [10, 17],
  expert: [11, 18],
}

export type NpcContact = { kind: 'bump' | 'wipeout' | 'nearMiss'; closing: number }

export function createNpcs(
  scene: THREE.Object3D,
  routes: Route[],
  terrain: SampleTerrain,
  env: SkiEnv,
  count: number,
  start: { x: number; z: number } | null = null,
  seed = 4242,
) {
  const random = makeRandom(seed)
  const usable = routes.filter((route) => polylineLength(route.line) > 150)
  const npcs: Npc[] = []
  const group = new THREE.Group()
  group.name = 'npcs'
  scene.add(group)
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]

  /** Prefer runs that pass within 600 m of the player, and spawn out of sight (150 m away) when possible. */
  const place = (npc: Npc, player: { x: number; z: number } | null) => {
    const near = player
      ? usable.filter((route) => route.line.some(([x, z], i) => i % 4 === 0 && Math.hypot(x - player.x, z - player.z) < 600))
      : []
    // Mostly greens and blues, like a real day on the hill.
    const pool = near.length ? near : usable
    const easyBias = pool.filter((route) => !['expert', 'freeride'].includes(route.difficulty ?? ''))
    const route = random() < 0.85 && easyBias.length ? pick(easyBias) : pick(pool)
    const length = polylineLength(route.line)
    let s = 0
    for (let attempt = 0; attempt < 6; attempt++) {
      s = length * random() * 0.7
      const [x, z] = pointAlong(route.line, s)
      if (!player || Math.hypot(x - player.x, z - player.z) > 150) break
    }
    const [x, z] = pointAlong(route.line, s)
    const [ax, az] = pointAlong(route.line, s + 8)
    const state = createSkiState({ x, z, heading: headingFor(ax - x, az - z) })
    const ground = terrain(x, z)
    if (ground) state.y = ground.height
    const [lo, hi] = SKILL_CAP[route.difficulty ?? 'intermediate'] ?? SKILL_CAP.intermediate
    Object.assign(npc, {
      state,
      route,
      length,
      nearest: 0,
      cap: lo + (hi - lo) * random(),
      wavelength: 24 + random() * 22,
      amplitude: 3 + random() * 5,
      travelled: 0,
      stuck: 0,
      away: 0,
      accumulator: 0,
    })
    npc.view.setColours({
      jacket: pick(PALETTE),
      jacketAccent: pick(PALETTE),
      pants: pick(PALETTE),
      helmet: pick(PALETTE),
      gaiter: pick(PALETTE),
      skis: pick(PALETTE),
      skiAccent: pick(PALETTE),
      skiGraphic: pick(SKI_GRAPHICS.slice(0, 6)),
      fit: random() < 0.6 ? 'baggy' : 'slim',
      headwear: random() < 0.75 ? 'helmet' : 'beanie',
      backpack: random() < 0.2,
      // About a quarter of the hill rides a board.
      model: random() < 0.25 ? 'snowboard' : 'allMountain',
    })
  }

  for (let i = 0; i < count && usable.length; i++) {
    const view = createSkierView()
    view.object.traverse((child) => (child.castShadow = true))
    group.add(view.object)
    const npc = { view, input: { steer: 0, brake: 0, tuck: false } } as Npc
    place(npc, start)
    npcs.push(npc)
  }

  const step = (npc: Npc) => {
    const { state, route } = npc
    const line = route.line
    let best = Infinity
    for (let i = npc.nearest, end = Math.min(line.length, npc.nearest + 12); i < end; i++) {
      const d = (line[i][0] - state.x) ** 2 + (line[i][1] - state.z) ** 2
      if (d < best) ((best = d), (npc.nearest = i))
    }
    // Aim 16 m ahead, swung either side of the line for round turns.
    let k = npc.nearest
    for (let ahead = 0; k < line.length - 1 && ahead < 16; k++) ahead += Math.hypot(line[k + 1][0] - line[k][0], line[k + 1][1] - line[k][1])
    const [px, pz] = line[k]
    const [qx, qz] = line[Math.max(0, k - 1)]
    const along = Math.hypot(px - qx, pz - qz) || 1
    const swing = npc.amplitude * Math.sin((npc.travelled / npc.wavelength) * Math.PI * 2)
    const tx = px + ((pz - qz) / along) * swing
    const tz = pz - ((px - qx) / along) * swing
    const want = headingFor(tx - state.x, tz - state.z)
    const error = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading))
    const input = npc.input
    input.steer = state.grounded ? Math.max(-1, Math.min(1, error * 2.2)) : 0
    input.brake = state.speed > npc.cap ? 0.6 : 0
    input.tuck = state.speed < npc.cap * 0.55
    stepSkier(state, input, terrain, FIXED_DT, env)
    npc.travelled += state.speed * FIXED_DT
  }

  let nearMissCooldown = 0

  return {
    group,
    /** Advance everyone by `dt`. `camera` decides who is drawn. */
    update(dt: number, camera: THREE.Vector3, player: SkiState): NpcContact[] {
      const contacts: NpcContact[] = []
      nearMissCooldown = Math.max(0, nearMissCooldown - dt)
      for (const npc of npcs) {
        npc.accumulator += Math.min(dt, 0.1)
        while (npc.accumulator >= FIXED_DT) {
          npc.accumulator -= FIXED_DT
          step(npc)
        }
        const { state } = npc
        const [ex, ez] = npc.route.line[npc.route.line.length - 1]
        npc.stuck = state.speed < 0.6 || state.mode === 'crashed' ? npc.stuck + dt : 0
        npc.away = Math.hypot(state.x - player.x, state.z - player.z) > 900 ? npc.away + dt : 0
        if (state.offMap || npc.stuck > 6 || npc.away > 20 || Math.hypot(ex - state.x, ez - state.z) < 15) {
          place(npc, player)
          continue
        }
        // Soft collision / wipeout when paths cross.
        if (player.crashed <= 0 && player.grounded && !player.rail && state.grounded && state.crashed <= 0) {
          const dx = state.x - player.x
          const dz = state.z - player.z
          const dist = Math.hypot(dx, dz)
          if (dist < 1.4 && dist > 1e-3) {
            const nx = dx / dist
            const nz = dz / dist
            const closing = (player.vx - state.vx) * nx + (player.vz - state.vz) * nz
            const push = (1.4 - dist) * 0.55
            player.x -= nx * push
            player.z -= nz * push
            state.x += nx * push * 0.65
            state.z += nz * push * 0.65
            // Only wipe out on a real hit; light brushes just bump both skiers.
            if (closing > 8.5 && player.speed > 10) {
              beginCrash(player, Math.min(player.speed, closing + 4))
              beginCrash(state, Math.min(state.speed, closing * 0.7))
              contacts.push({ kind: 'wipeout', closing })
            } else if (closing > 1.5) {
              player.vx -= nx * closing * 0.45
              player.vz -= nz * closing * 0.45
              state.vx += nx * closing * 0.25
              state.vz += nz * closing * 0.25
              // Nudge the NPC off the collision line.
              npc.input.steer = Math.max(-1, Math.min(1, npc.input.steer + (Math.random() < 0.6 ? -0.6 : 0.6)))
              contacts.push({ kind: 'bump', closing })
            }
          } else if (
            nearMissCooldown <= 0 &&
            dist < 3.2 &&
            dist >= 1.4 &&
            player.speed > 8 &&
            state.speed > 4
          ) {
            const nx = dx / dist
            const nz = dz / dist
            const closing = (player.vx - state.vx) * nx + (player.vz - state.vz) * nz
            // Passing close with meaningful relative motion — whoosh, not a hit.
            if (closing > 2.5 && closing <= 8.5) {
              contacts.push({ kind: 'nearMiss', closing })
              nearMissCooldown = 0.85
            }
          }
        }
        const near = Math.hypot(state.x - camera.x, state.z - camera.z) < DRAW_DISTANCE
        npc.view.object.visible = near
        if (near) npc.view.update(state, npc.input, terrain(state.x, state.z), 'ski', dt)
      }
      return contacts
    },
    setVisible(on: boolean) {
      group.visible = on
    },
    get count() {
      return npcs.length
    },
    /** Live ski states, for tests and the map. */
    states(): readonly SkiState[] {
      return npcs.map((npc) => npc.state)
    },
  }
}

export type Npcs = ReturnType<typeof createNpcs>
