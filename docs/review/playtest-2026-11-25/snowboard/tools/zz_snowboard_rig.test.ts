// Playtest 2026-11-25: measure the snowboard leg/body rig in board space. Not part of the game.
import { it } from 'vitest'
import * as THREE from 'three'
import fs from 'node:fs'
import { createSkiState, createSteadySlope, stepSkier, FIXED_DT, type SkiInput } from '../src/sim'
import { createSkierView } from '../src/render/rider/skierView'
import { ANKLE_IN_SKI, SHIN_LENGTH, THIGH_LENGTH } from '../src/render/rider/skierModel'
import { DEFAULT_OUTFIT, SKI_MODELS } from '../src/ui/riderPanel'
import { LAB_POSES, stepLabPose } from '../src/tools/riderPoses'

const OUT = '/workspace/apex-playtest/2026-11-25/snowboard'
const deg = (r: number) => (r * 180) / Math.PI
const r1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: number) => Math.round(v * 1000) / 1000

function measure(view: ReturnType<typeof createSkierView>) {
  view.object.updateMatrixWorld(true)
  const board = view.object.getObjectByName('snowboard')!
  const inv = new THREE.Matrix4().copy(board.matrixWorld).invert()
  const toBoard = (v: THREE.Vector3) => v.clone().applyMatrix4(inv)
  const toeWorld = new THREE.Vector3(0, 0, 1).applyQuaternion(view.skis[0].getWorldQuaternion(new THREE.Quaternion()))
  const toeBoard = toeWorld.clone().transformDirection(inv) // boot 0 toe in board frame
  const out: Record<string, number | string> = {}
  out.toe_dir_board = `${r3(toeBoard.x)},${r3(toeBoard.z)}`
  const legs = ['L', 'R'] as const
  const pts: THREE.Vector3[][] = []
  legs.forEach((s, i) => {
    const thigh = view.bones[`thigh_${s}`], shin = view.bones[`shin_${s}`]
    const H = toBoard(thigh.getWorldPosition(new THREE.Vector3()))
    const K = toBoard(shin.getWorldPosition(new THREE.Vector3()))
    const A = toBoard(shin.localToWorld(new THREE.Vector3(0, -SHIN_LENGTH, 0)))
    const boot = toBoard(view.skis[i].localToWorld(ANKLE_IN_SKI.clone()))
    const bootToe = new THREE.Vector3(0, 0, 1).applyQuaternion(view.skis[i].getWorldQuaternion(new THREE.Quaternion())).transformDirection(inv).setY(0).normalize()
    const ha = A.clone().sub(H)
    const t = K.clone().sub(H).dot(ha) / ha.lengthSq()
    const off = K.clone().sub(H.clone().addScaledVector(ha, t))
    const kneecap = new THREE.Vector3(0, 0, 1).applyQuaternion(thigh.getWorldQuaternion(new THREE.Quaternion())).transformDirection(inv)
    const flex = 180 - deg(K.clone().sub(H).angleTo(A.clone().sub(K)) === 0 ? Math.PI : Math.PI - K.clone().sub(H).angleTo(A.clone().sub(K)))
    const shinDir = K.clone().sub(A).normalize()
    // knee-bend direction relative to this boot's toe (0 = over the toes, 90 = toward nose/tail sideways, 180 = backwards over the heel)
    const offFlat = off.clone().setY(0)
    const kneeVsToe = offFlat.length() > 1e-4 ? deg(offFlat.angleTo(bootToe)) : 0
    const tag = i === 0 ? 'front' : 'back'
    Object.assign(out, {
      [`${tag}_foot_board_z`]: r3(A.z), [`${tag}_foot_board_x`]: r3(A.x), [`${tag}_ankle_gap_cm`]: r1(A.distanceTo(boot) * 100),
      [`${tag}_hip_board_z`]: r3(H.z), [`${tag}_hip_board_x`]: r3(H.x),
      [`${tag}_knee_flex_deg`]: r1(deg(K.clone().sub(H).angleTo(A.clone().sub(K)))),
      [`${tag}_knee_off_toe_cm`]: r1(off.dot(bootToe) * 100),
      [`${tag}_knee_off_noseaxis_cm`]: r1(off.z * 100),
      [`${tag}_knee_bend_vs_bootToe_deg`]: r1(kneeVsToe),
      [`${tag}_kneecap_toe`]: r3(kneecap.dot(bootToe)), [`${tag}_kneecap_nose`]: r3(kneecap.z), [`${tag}_kneecap_up`]: r3(kneecap.y),
      [`${tag}_shin_lean_toward_toe_deg`]: r1(deg(Math.asin(Math.max(-1, Math.min(1, shinDir.dot(bootToe)))))),
      [`${tag}_shin_lean_along_board_deg`]: r1(deg(Math.asin(Math.max(-1, Math.min(1, shinDir.z))))),
    })
    void flex
    const seg: THREE.Vector3[] = []
    for (let k = 0; k <= 10; k++) seg.push(H.clone().lerp(K, k / 10))
    for (let k = 0; k <= 10; k++) seg.push(K.clone().lerp(A, k / 10))
    pts.push(seg)
  })
  // Leg below deck (excluding the last 8 cm above the ankle) inside the board outline.
  let below = 0
  for (const seg of pts) for (const p of seg.slice(0, 19)) if (p.y < 0.03 && Math.abs(p.x) < 0.14 && Math.abs(p.z) < 0.78) below++
  out.leg_points_through_deck = below
  let minKnee = Infinity
  for (const a of pts[0]) for (const b of pts[1]) minKnee = Math.min(minKnee, a.distanceTo(b))
  out.min_leg_to_leg_cm = r1(minKnee * 100)
  // Body: chest facing and shoulder line vs the board.
  const chest = view.object.getObjectByName('chest') ?? view.bones.chest
  const cq = view.bones.chest.getWorldQuaternion(new THREE.Quaternion())
  const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(cq).transformDirection(inv).setY(0).normalize()
  const hq = view.bones.hips.getWorldQuaternion(new THREE.Quaternion())
  const hipFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(hq).transformDirection(inv).setY(0).normalize()
  const toeFlat = toeBoard.clone().setY(0).normalize()
  out.hips_open_toward_nose_deg = r1(deg(Math.atan2(hipFwd.z, hipFwd.dot(new THREE.Vector3(toeFlat.x, 0, 0).normalize()))))
  out.chest_open_toward_nose_deg = r1(deg(Math.atan2(chestFwd.z, chestFwd.dot(new THREE.Vector3(toeFlat.x, 0, 0).normalize()))))
  void chest
  const hipsW = toBoard(view.bones.hips.getWorldPosition(new THREE.Vector3()))
  out.hips_over_toe_cm = r1(hipsW.x * Math.sign(toeBoard.x) * 100)
  out.hips_height_cm = r1(hipsW.y * 100)
  // Board edge in world: which edge is down.
  const toeEdge = new THREE.Vector3(Math.sign(toeBoard.x) * 0.125, 0, 0).applyMatrix4(board.matrixWorld)
  const heelEdge = new THREE.Vector3(-Math.sign(toeBoard.x) * 0.125, 0, 0).applyMatrix4(board.matrixWorld)
  out.board_roll_deg = r1(deg(board.rotation.z))
  out.edge_down = Math.abs(toeEdge.y - heelEdge.y) < 0.01 ? 'flat' : toeEdge.y < heelEdge.y ? 'toe' : 'heel'
  const head = view.bones.head.getWorldPosition(new THREE.Vector3())
  const ctr = new THREE.Vector3(0, 0, 0).applyMatrix4(board.matrixWorld)
  const toeW = toeEdge.clone().sub(heelEdge).setY(0).normalize()
  out.head_over_toe_cm = r1(head.clone().sub(ctr).dot(toeW) * 100)
  return out
}

it('snowboard rig: lab poses', () => {
  const rows: Record<string, number | string>[] = []
  for (const pose of LAB_POSES) {
    if (['Snowplough', 'Pushing', 'Skating'].includes(pose.label)) continue
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'snowboard', skiGraphic: 'solid' })
    const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
    let t = 0
    for (let i = 0; i < 120; i++) stepLabPose(pose, state, view, (t += 1 / 60), 1 / 60)
    rows.push({ pose: pose.label, ...measure(view) })
  }
  // Same for skis, for a reference of how the shared rig behaves.
  for (const label of ['Standing', 'Carve left']) {
    const pose = LAB_POSES.find((p) => p.label === label)!
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'allMountain', skiGraphic: 'solid' })
    const state = createSkiState({ x: 0, y: 0, z: 0, heading: 0 })
    let t = 0
    for (let i = 0; i < 120; i++) stepLabPose(pose, state, view, (t += 1 / 60), 1 / 60)
    view.object.updateMatrixWorld(true)
    const K = view.bones.shin_L.getWorldPosition(new THREE.Vector3()), H = view.bones.thigh_L.getWorldPosition(new THREE.Vector3())
    rows.push({ pose: `SKI ${label}`, ski_knee_minus_hip_fwd_cm: r1((K.z - H.z) * 100) })
  }
  fs.writeFileSync(`${OUT}/rig_lab_poses.json`, JSON.stringify(rows, null, 1))
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  fs.writeFileSync(`${OUT}/rig_lab_poses.csv`, [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n'))
})

it('snowboard rig + physics: real sim turns', () => {
  const slope = createSteadySlope(18, { width: 6000, depth: 12000 })
  const env = { ski: SKI_MODELS.snowboard }
  const envSki = { ski: SKI_MODELS.allMountain }
  const runs: Record<string, unknown>[] = []
  const series: string[] = ['run,t,kmh,steer,brake,edge_deg,skid,mode,heading_deg,travel_deg,latG_path,carveRadius,switch,edge_down,board_roll,toe_turn_side,hips_over_toe_cm,head_over_toe_cm,front_knee_bend_vs_toe,back_knee_bend_vs_toe,front_knee_flex,back_knee_flex,front_ankle_gap_cm,back_ankle_gap_cm,leg_through_deck,min_leg_to_leg_cm']
  const scen: [string, (t: number) => SkiInput, number, typeof env][] = [
    ['straight', () => ({ steer: 0, brake: 0, tuck: false }), 8, env],
    ['hold_right', (t) => ({ steer: t > 2 ? 1 : 0, brake: 0, tuck: false }), 5, env],
    ['hold_left', (t) => ({ steer: t > 2 ? -1 : 0, brake: 0, tuck: false }), 5, env],
    ['linked_1.2s', (t) => ({ steer: t > 1 ? (Math.floor((t - 1) / 1.2) % 2 ? -1 : 1) : 0, brake: 0, tuck: false }), 10, env],
    ['stop_brake', (t) => ({ steer: 0, brake: t > 4 ? 1 : 0, tuck: false }), 7, env],
    ['ski_hold_right', (t) => ({ steer: t > 2 ? 1 : 0, brake: 0, tuck: false }), 5, envSki],
  ]
  for (const [name, inp, dur, e] of scen) {
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: e === env ? 'snowboard' : 'allMountain', skiGraphic: 'solid' })
    const s = createSkiState({ x: 2000, y: slope.sampleTerrain(2000, 100)!.height, z: 100, heading: 0 })
    s.vz = 6; s.speed = 6
    let lastTrav: number | null = null
    const vPrev = new THREE.Vector3(0, 0, 6)
    const acc = new THREE.Vector3()
    let maxK = 0, brakeStart = -1, brakeV = 0, stopT = -1, stopD = 0, sx = 0, sz = 0
    let n = 0
    const sum: Record<string, number> = {}
    const add = (k: string, v: number) => (sum[k] = (sum[k] ?? 0) + v)
    for (let i = 0; i * FIXED_DT < dur; i++) {
      const t = i * FIXED_DT
      const input = inp(t)
      stepSkier(s, input, slope.sampleTerrain, FIXED_DT, e as never)
      if (i % 2 === 0) view.update(s, input, s.grounded ? slope.sampleTerrain(s.x, s.z) as never : null, 'ski', FIXED_DT * 2)
      const trav = Math.atan2(-s.vx, s.vz)
      let latG = 0
      if (lastTrav !== null) latG = (Math.atan2(Math.sin(trav - lastTrav), Math.cos(trav - lastTrav)) / FIXED_DT) * Math.hypot(s.vx, s.vz) / 9.81
      lastTrav = trav
      acc.set(s.vx, 0, s.vz).sub(vPrev).divideScalar(FIXED_DT).lerp(acc, 0.9); vPrev.set(s.vx, 0, s.vz)
      maxK = Math.max(maxK, s.speed * 3.6)
      if (input.brake > 0 && brakeStart < 0) { brakeStart = t; brakeV = s.speed * 3.6; sx = s.x; sz = s.z }
      if (brakeStart >= 0 && stopT < 0 && s.speed < 0.5) { stopT = t - brakeStart; stopD = Math.hypot(s.x - sx, s.z - sz) }
      if (i % 12 === 0 && i > 0) {
        const m = measure(view)
        // which side is the turn centre on, relative to the toe direction (world)
        view.object.updateMatrixWorld(true)
        const board = view.object.getObjectByName('snowboard')!
        const toe = new THREE.Vector3(0, 0, 1).applyQuaternion(view.skis[0].getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize()
        const vel = new THREE.Vector3(s.vx, 0, s.vz).normalize()
        const centre = acc.clone().addScaledVector(vel, -acc.dot(vel))
        const toeTurn = Math.abs(latG) < 0.15 ? 'straight' : centre.dot(toe) > 0 ? 'toe' : 'heel'
        void board
        series.push([name, r3(t), r1(s.speed * 3.6), input.steer, input.brake, r1(deg(s.edgeAngle)), r3(s.skid ?? 0), s.mode, r1(deg(s.heading)), r1(deg(trav)), r3(latG), r1(s.carveRadius ?? -1), s.ridingSwitch ? 1 : 0,
          m.edge_down, m.board_roll_deg, toeTurn, m.hips_over_toe_cm, m.head_over_toe_cm, m.front_knee_bend_vs_bootToe_deg, m.back_knee_bend_vs_bootToe_deg, m.front_knee_flex_deg, m.back_knee_flex_deg, m.front_ankle_gap_cm, m.back_ankle_gap_cm, m.leg_points_through_deck, m.min_leg_to_leg_cm].join(','))
        if (Math.abs(latG) > 0.3) {
          n++
          add(`mismatch_${toeTurn}_${m.edge_down}`, 1)
          add('hips_over_toe', Number(m.hips_over_toe_cm) * (toeTurn === 'toe' ? 1 : -1))
        }
      }
    }
    runs.push({ name, maxKmh: r1(maxK), brakeFromKmh: r1(brakeV), stopTime: r3(stopT), stopDist: r1(stopD), turningSamples: n, ...sum })
  }
  fs.writeFileSync(`${OUT}/sim_turns.csv`, series.join('\n'))
  fs.writeFileSync(`${OUT}/sim_summary.json`, JSON.stringify(runs, null, 1))
})

it('snowboard rig: joint dumps from the real sim for stick-figure plots', () => {
  const slope = createSteadySlope(18, { width: 6000, depth: 12000 })
  const bonesWanted = ['hips', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R', 'spine', 'chest', 'head', 'upperarm_L', 'forearm_L', 'hand_L', 'upperarm_R', 'forearm_R', 'hand_R']
  const dumps: Record<string, unknown>[] = []
  const scen: [string, string, (t: number) => SkiInput, number[]][] = [
    ['board', 'linked', (t) => ({ steer: t > 1 ? (Math.floor((t - 1) / 1.4) % 2 ? -1 : 1) : 0, brake: 0, tuck: false }), [0.9, 1.7, 2.1, 2.45, 3.1, 3.5, 3.85]],
    ['board', 'brake', (t) => ({ steer: 0, brake: t > 3 ? 1 : 0, tuck: false }), [3.3]],
    ['board', 'pop', (t) => ({ steer: 0, brake: 0, tuck: false, jump: t > 2 && t < 2.4 }), [2.3, 2.6, 2.8]],
    ['ski', 'linked', (t) => ({ steer: t > 1 ? (Math.floor((t - 1) / 1.4) % 2 ? -1 : 1) : 0, brake: 0, tuck: false }), [1.7, 3.1]],
  ]
  for (const [model, name, inp, at] of scen) {
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: model === 'board' ? 'snowboard' : 'allMountain', skiGraphic: 'solid' })
    const s = createSkiState({ x: 2000, y: slope.sampleTerrain(2000, 100)!.height, z: 100, heading: 0 })
    s.vz = 8; s.speed = 8
    const env = { ski: model === 'board' ? SKI_MODELS.snowboard : SKI_MODELS.allMountain }
    let k = 0
    for (let i = 0; i * FIXED_DT < at[at.length - 1] + 0.01; i++) {
      const t = i * FIXED_DT
      const input = inp(t)
      stepSkier(s, input, slope.sampleTerrain, FIXED_DT, env as never)
      view.update(s, input, s.grounded ? (slope.sampleTerrain(s.x, s.z) as never) : null, 'ski', FIXED_DT)
      if (k < at.length && t >= at[k]) {
        view.object.updateMatrixWorld(true)
        const P = (o: THREE.Object3D, local = new THREE.Vector3()) => o.localToWorld(local.clone()).toArray().map(r3)
        const j: Record<string, number[]> = {}
        for (const b of bonesWanted) j[b] = P(view.bones[b])
        j.ankle_L = P(view.bones.shin_L, new THREE.Vector3(0, -SHIN_LENGTH, 0))
        j.ankle_R = P(view.bones.shin_R, new THREE.Vector3(0, -SHIN_LENGTH, 0))
        j.headTop = P(view.bones.head, new THREE.Vector3(0, 0.2, 0))
        const eq: Record<string, number[][]> = {}
        if (model === 'board') {
          const b = view.object.getObjectByName('snowboard')!
          eq.board = [[0.13, 0, 0.78], [-0.13, 0, 0.78], [-0.13, 0, -0.78], [0.13, 0, -0.78], [0.13, 0, 0.78]].map((p) => P(b, new THREE.Vector3(...p)))
          eq.toe = [P(view.skis[0], new THREE.Vector3(0, 0, 0)), P(view.skis[0], new THREE.Vector3(0, 0, 0.3))]
        } else {
          view.skis.forEach((sk, i) => (eq[`ski${i}`] = [P(sk, new THREE.Vector3(0, 0, 0.9)), P(sk, new THREE.Vector3(0, 0, -0.8))]))
        }
        const m = model === 'board' ? measure(view) : {}
        dumps.push({ model, name, t: at[k], kmh: r1(s.speed * 3.6), edge_deg: r1(deg(s.edgeAngle)), steer: input.steer, brake: input.brake, air: !s.grounded, vx: s.vx, vz: s.vz, root: [s.x, s.y, s.z], joints: j, eq, m })
        k++
      }
    }
  }
  fs.writeFileSync(`${OUT}/rig_sim_joints.json`, JSON.stringify(dumps))
})

it('snowboard: riding switch, which edge and which way for each steer key', () => {
  const slope = createSteadySlope(18, { width: 6000, depth: 12000 })
  const rows: unknown[] = []
  for (const sw of [false, true]) for (const steer of [1, -1]) {
    const view = createSkierView()
    view.setColours({ ...DEFAULT_OUTFIT, model: 'snowboard', skiGraphic: 'solid' })
    const s = createSkiState({ x: 2000, y: slope.sampleTerrain(2000, 100)!.height, z: 100, heading: sw ? Math.PI : 0 })
    s.vz = 8; s.speed = 8; s.ridingSwitch = sw
    const x0 = s.x
    let m: Record<string, unknown> = {}
    for (let i = 0; i * FIXED_DT < 1.6; i++) {
      const input = { steer: i * FIXED_DT > 0.8 ? steer : 0, brake: 0, tuck: false }
      stepSkier(s, input, slope.sampleTerrain, FIXED_DT, { ski: SKI_MODELS.snowboard } as never)
      view.update(s, input, slope.sampleTerrain(s.x, s.z) as never, 'ski', FIXED_DT)
      if (Math.abs(i * FIXED_DT - 1.3) < FIXED_DT / 2) {
        m = measure(view)
        view.object.updateMatrixWorld(true)
        const toe = new THREE.Vector3(0, 0, 1).applyQuaternion(view.skis[0].getWorldQuaternion(new THREE.Quaternion()))
        const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(view.object.getObjectByName('snowboard')!.getWorldQuaternion(new THREE.Quaternion()))
        m.toe_world_x = r3(toe.x); m.board_nose_dot_velocity = r3(nose.x * s.vx / s.speed + nose.z * s.vz / s.speed)
      }
    }
    rows.push({ switch: sw, steer, still_switch: s.ridingSwitch, dx_m: r1(s.x - x0), edge_deg: r1(deg(s.edgeAngle)), turned_toward: s.x - x0 > 0 ? '+x' : '-x', toe_world_x: m.toe_world_x, nose_leads: m.board_nose_dot_velocity, edge_down: m.edge_down, hips_over_toe_cm: m.hips_over_toe_cm, head_over_toe_cm: m.head_over_toe_cm, front_knee_vs_toe: m.front_knee_bend_vs_bootToe_deg, back_knee_vs_toe: m.back_knee_bend_vs_bootToe_deg })
  }
  fs.writeFileSync(`${OUT}/sim_switch.json`, JSON.stringify(rows, null, 1))
})
