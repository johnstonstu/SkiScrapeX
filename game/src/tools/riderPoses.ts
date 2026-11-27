/**
 * The rider lab's held poses (`rider.html`), shared with the clipping check
 * (tests/riderClipping.test.ts) so both look at the same bodies. No DOM.
 */
import { newPressState, type Rail, type RailPress, type SkiInput, type SkiState, type SurfaceSample } from '../sim'
import type { SkierPose } from '../render/rider/skierView'

export interface LabPose {
  label: string
  setup: (s: SkiState, t: number) => SkiInput
  /** Chair or surface lift instead of the sim's ski pose. */
  pose?: SkierPose
  /** Moves over time (turns, rail balance), so a check should sample a cycle, not one frame. */
  animated?: boolean
}

export const idle: SkiInput = { steer: 0, brake: 0, tuck: false }

export const LAB_POSES: LabPose[] = [
  { label: 'Standing', setup: (s) => ((s.speed = 0), idle) },
  { label: 'Cruising', setup: (s) => ((s.speed = 10), idle) },
  { label: 'Carve left', setup: (s) => ((s.speed = 14), (s.edgeAngle = -0.75), (s.carveRadius = 10), (s.carveLoad = 2.2), { ...idle, steer: -1 }) },
  { label: 'Carve right', setup: (s) => ((s.speed = 14), (s.edgeAngle = 0.75), (s.carveRadius = 10), (s.carveLoad = 2.2), { ...idle, steer: 1 }) },
  {
    label: 'Linked turns',
    animated: true,
    setup: (s, t) => {
      s.speed = 12
      s.edgeAngle = Math.sin(t * 2.6) * 0.75
      s.carveRadius = 11
      s.carveLoad = 1 + 0.9 * Math.abs(Math.sin(t * 2.6))
      return { ...idle, steer: Math.sign(s.edgeAngle) }
    },
  },
  { label: 'Tuck', setup: (s) => ((s.speed = 20), { ...idle, tuck: true }) },
  { label: 'Snowplough', setup: (s) => ((s.speed = 3), { ...idle, brake: 1 }) },
  { label: 'Pushing', animated: true, setup: (s) => ((s.speed = 0.8), { ...idle, tuck: true }) },
  { label: 'Skating', animated: true, setup: (s) => ((s.speed = 2.5), { ...idle, tuck: true }) },
  { label: 'Hockey stop', setup: (s) => ((s.speed = 8), (s.edgeAngle = 0.7), { ...idle, brake: 1 }) },
  {
    label: 'Mute grab',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'mute', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return { ...idle, grab: true }
    },
  },
  {
    label: 'Japan',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'japan', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return { ...idle, grab: true }
    },
  },
  {
    label: 'Truck driver',
    setup: (s) => {
      s.grounded = false
      s.speed = 10
      s.air = { time: 0.5, spin: 0, spinRate: 0, flip: 0, flipRate: 0, grab: 'truck', grabTime: 0.4, timeToLand: 1, predictedFrom: 0, cork: 0, corkTime: 0 }
      return { ...idle, grab: true }
    },
  },
  {
    label: 'Rail slide',
    animated: true,
    setup: (s, t) => {
      s.speed = 5
      const rail = { kind: 'rail', points: [[0, 0, 0], [0, 0, 5]] } as unknown as Rail
      s.rail = { rail, s: 1, vs: 5, balance: Math.sin(t * 1.7) * 0.6, balanceRate: 0, style: 'slide', headingOffset: Math.PI / 2, entrySpeed: 5, metres: 1, ...newPressState(true) }
      return idle
    },
  },
  ...(['nose', 'tail'] as RailPress[]).map((press) => ({
    label: press === 'nose' ? 'Nose press' : 'Tail press',
    animated: true,
    setup: (s: SkiState, t: number) => {
      s.speed = 5
      const rail = { kind: 'rail', points: [[0, 0, 0], [0, 0, 5]] } as unknown as Rail
      s.rail = { rail, s: 1, vs: 5, balance: Math.sin(t * 1.7) * 0.4, balanceRate: 0, style: '5050', headingOffset: 0, entrySpeed: 5, metres: 1, ...newPressState(true), press, pressTime: 1 }
      return idle
    },
  })),
  {
    label: 'Crash',
    setup: (s) => {
      s.speed = 0
      s.crashed = 1.5
      s.crashSpeed = 10
      s.crashAge = 1.6
      return idle
    },
  },
  {
    label: 'Crash tumble',
    animated: true,
    setup: (s, t) => {
      // A hard crash's first second, sliding: the tumble before the body settles.
      s.speed = 0
      s.vx = 7
      s.vz = 0
      s.crashed = 1.5
      s.crashSpeed = 18
      s.crashAge = t % 1.15
      return idle
    },
  },
  {
    label: 'Getting up',
    setup: (s) => {
      // The end of a crash: the rider is up on the gear, about to stand.
      s.speed = 0
      s.crashed = 0.12
      s.crashSpeed = 10
      s.crashAge = 2
      return idle
    },
  },
  { label: 'Lift sit', pose: 'sit', setup: (s) => ((s.speed = 0), idle) },
  { label: 'Lift stand', pose: 'stand', setup: (s) => ((s.speed = 0), idle) },
]

const FLAT: SurfaceSample = { height: 0, normal: { x: 0, y: 1, z: 0 } } as SurfaceSample

/** Pose one rider on flat snow at lab time `time`, the way the lab steps it. */
export function stepLabPose(
  pose: LabPose,
  state: SkiState,
  view: { update: (state: SkiState, input: SkiInput, ground: SurfaceSample | null, pose?: SkierPose, dt?: number) => void },
  time: number,
  dt: number,
): void {
  state.time = time
  const input = pose.setup(state, time)
  state.mode = state.grounded ? 'carving' : 'air'
  state.y = state.rail ? 0.5 : state.grounded ? 0 : 0.7
  view.update(state, input, state.grounded ? FLAT : null, pose.pose ?? 'ski', dt)
}
