/**
 * Demo park: a long, wide 12° groomer away from the Apex map with one
 * progression line of every park feature, for practising and testing tricks.
 * It is its own stage; main.ts hides the Apex scenery while you are here.
 */
import * as THREE from 'three'
import { createSteadySlope, SURFACES, type Slope } from '../sim'
import { buildParkOverlay, DEMO_LINEUP, placeLineup } from '../world/park'
import type { Point2 } from '../world/resort'
import { createSlopeView } from '../render/terrain/slopeView'
import { createParkView } from '../render/scenery/parkView'
import type { Lighting } from '../render/lighting'
import type { Stage } from './stage'
import type { SkiEnv } from '../sim'

/** Far west of the Apex crop, so no Apex lift, gate or nugget can trigger here. */
const ORIGIN_X = -9000
const WIDTH = 600
const DEPTH = 2600
const PITCH = 12

export function buildDemoPark(lighting: Lighting, ski: SkiEnv['ski'], assist: boolean, meshStep = 0.4) {
  const base = createSteadySlope(PITCH, { width: WIDTH, depth: DEPTH, originX: ORIGIN_X, originZ: 0, visualStep: 6 })
  const centre = ORIGIN_X + WIDTH / 2
  const line: Point2[] = [[centre, 40], [centre, DEPTH - 40]]
  const baseHeight = (x: number, z: number) => base.sampleTerrain(x, z)?.height ?? 0
  const overlay = buildParkOverlay(placeLineup(line, DEMO_LINEUP, 30), base.sampleTerrain, baseHeight)
  const slope: Slope = {
    ...base,
    id: 'demo-park',
    label: 'Demo park',
    spawn: { x: centre, z: 20, heading: 0 },
    sampleTerrain: (x, z) => overlay.sampleTerrain(x, z),
  }
  const root = new THREE.Group()
  root.visible = false
  const ground = createSlopeView(base, { markers: false })
  // Two belts of conifers frame the run, for depth and speed cues; open snow beyond.
  const trees = forestBelts(base, centre)
  const parkView = createParkView(overlay, baseHeight, lighting, [{ name: 'Demo park', layout: `${overlay.features.length} features`, x: centre + 14, z: 26, yaw: Math.PI }], meshStep)
  root.add(ground.object, parkView.object, trees)
  const sampleSurface = (x: number, z: number) => (overlay.inside(x, z) ? SURFACES.park : SURFACES.groomed)
  const stage: Stage = {
    slope,
    world: null,
    trunks: null,
    buildings: null,
    snow: null,
    ride: null,
    features: () => overlay.features,
    env: { ski, assist, rails: overlay.rails, sampleSurface },
    update(camera) {
      parkView.update(camera)
    },
    describe: () => `Demo park · ${overlay.features.length} features over ${(DEPTH / 1000).toFixed(1)} km at ${PITCH}°`,
  }
  return { stage, root, spawn: slope.spawn, featureCount: overlay.features.length }
}

/** Instanced cone-and-trunk conifers in two belts 70 to 140 m either side of the line. */
function forestBelts(slope: Slope, centre: number): THREE.Group {
  const group = new THREE.Group()
  const spots: [number, number, number][] = []
  let seed = 7
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (let z = 0; z < DEPTH; z += 7) {
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x = centre + side * (70 + random() * 70)
        const zz = z + random() * 7
        const ground = slope.sampleTerrain(x, zz)
        if (ground) spots.push([x, ground.height, zz])
      }
    }
  }
  const crown = new THREE.ConeGeometry(2.2, 9, 7)
  crown.translate(0, 6.5, 0)
  const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 5)
  trunk.translate(0, 1.2, 0)
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f4a3e, roughness: 0.9, flatShading: true }), spots.length)
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 0.9 }), spots.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const sc = new THREE.Vector3()
  spots.forEach(([x, y, z], i) => {
    const s = 0.7 + random() * 0.7
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2)
    m.compose(p.set(x, y - 0.2, z), q, sc.set(s, s, s))
    crowns.setMatrixAt(i, m)
    trunks.setMatrixAt(i, m)
  })
  crowns.castShadow = true
  group.add(crowns, trunks)
  return group
}
