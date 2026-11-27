/**
 * Idle moves: little things a rider does while stopped (or riding a chair).
 * A small timeline player picks one now and then and returns pose offsets
 * that skierView blends on top of the standing or sitting pose. No Three.js
 * scene work here, only numbers, so the timelines are easy to test.
 *
 * Hand targets are in chest space (the shoulders sit at about ±0.215, 0.21, 0;
 * the head bone at 0, 0.36, 0; +X is the rider's left, +Z forward). Arm 0 is
 * the left arm, arm 1 the right.
 */

export type IdleKind =
  | 'look'
  | 'shiver'
  | 'goggles'
  | 'stretch'
  | 'stomp'
  | 'poleLean'
  | 'fidget'
  | 'watch'
  | 'beer'
  | 'smoke'
  | 'hop'
  | 'legSwing'

export type IdleProp = 'can' | 'cigarette' | null

export interface HandTarget {
  x: number
  y: number
  z: number
  /** 0 keeps the normal hand, 1 is fully on the target. */
  w: number
}

export interface IdlePose {
  kind: IdleKind | null
  /** Seconds into the current move. */
  time: number
  hands: [HandTarget | null, HandTarget | null]
  /** Head offsets, radians (x: negative tips the chin up). */
  headX: number
  headY: number
  headZ: number
  /** Back offsets, radians (x: positive folds forward). */
  spineX: number
  spineZ: number
  /** Whole-body roll (weight shift), radians. */
  sway: number
  /** Ski lift off the snow, left and right, metres. */
  skiLift: [number, number]
  /** Both feet (or the board) off the snow, metres: a little hop. */
  hop: number
  /** Extra knee bend, crouch units (dips before and after a hop). */
  crouch: number
  /** Chair: how far the legs swing (on top of the chair's own swing), metres. */
  legSwing: number
  /** Prop in the right hand, and whether a can has been cracked. */
  prop: IdleProp
  canOpen: boolean
  /** 0 to 1: how far a can is tipped up to drink. */
  sip: number
  /** True for the frames a smoker breathes out (for a puff of smoke). */
  exhale: boolean
}

export const MOUTH: Readonly<{ x: number; y: number; z: number }> = { x: -0.02, y: 0.33, z: 0.2 }
/** A jacket's chest pocket (right hand), where the can and smokes live. */
const POCKET = { x: -0.1, y: 0.02, z: 0.15 }
const HOLD = { x: -0.1, y: 0.12, z: 0.32 }

/** 0 to 1 over [a, b], smoothed. */
const ramp = (t: number, a: number, b: number) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return u * u * (3 - 2 * u)
}
/** Up over [a, a + f], held, down over [b - f, b]. */
const hold = (t: number, a: number, b: number, f = 0.35) => Math.min(ramp(t, a, a + f), 1 - ramp(t, b - f, b))
const lerp3 = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }, u: number) => ({
  x: p.x + (q.x - p.x) * u,
  y: p.y + (q.y - p.y) * u,
  z: p.z + (q.z - p.z) * u,
})
const target = (p: { x: number; y: number; z: number }, w: number): HandTarget | null => (w > 1e-3 ? { ...p, w } : null)

export interface IdleMove {
  kind: IdleKind
  duration: number
  /** Where it can play. */
  standing: boolean
  sitting: boolean
  skisOnly?: boolean
  boardOnly?: boolean
  /** How often it is picked, relative to the others. Beer and smokes are rare. */
  weight: number
  /** Fill `pose` for time `t` into the move (pose starts neutral). */
  apply: (t: number, pose: IdlePose, sitting: boolean) => void
}

/** Pull something from the pocket, then hold it in front. */
const fromPocket = (t: number, start: number) => lerp3(POCKET, HOLD, ramp(t, start, start + 0.7))
/** Hand from `from` to the mouth and back for one sip or drag over [a, b]. */
const toMouth = (from: { x: number; y: number; z: number }, t: number, a: number, b: number) => lerp3(from, MOUTH, hold(t, a, b, 0.45))

export const IDLE_MOVES: IdleMove[] = [
  {
    kind: 'look',
    duration: 4.2,
    standing: true,
    sitting: true,
    weight: 3,
    apply: (t, pose) => {
      // Look one way, then across to the other side, then back.
      pose.headY = Math.sin((t / 4.2) * Math.PI * 2) * 0.85 * hold(t, 0, 4.2, 0.6)
      pose.headX = -0.12 * hold(t, 0.8, 3.4, 0.6)
    },
  },
  {
    kind: 'shiver',
    duration: 3.2,
    standing: true,
    sitting: true,
    weight: 2,
    apply: (t, pose) => {
      // Arms hug the chest, shoulders up, a fast shudder.
      const w = hold(t, 0, 3.2, 0.4)
      pose.hands = [target({ x: -0.13, y: 0.13, z: 0.17 }, w), target({ x: 0.13, y: 0.1, z: 0.19 }, w)]
      const shake = Math.sin(t * 41) * 0.5 + Math.sin(t * 29 + 1) * 0.5
      pose.spineZ = shake * 0.03 * w
      pose.spineX = 0.08 * w
      pose.headZ = shake * 0.04 * w
      pose.headX = 0.12 * w
      pose.crouch = 0.05 * w + Math.abs(shake) * 0.03 * w
    },
  },
  {
    kind: 'goggles',
    duration: 2.4,
    standing: true,
    sitting: true,
    weight: 1.5,
    apply: (t, pose) => {
      // Left hand up to straighten the goggles, a wiggle, down.
      const w = hold(t, 0, 2.4, 0.5)
      const wiggle = Math.sin(t * 16) * 0.015 * hold(t, 0.7, 1.7, 0.2)
      pose.hands = [target({ x: 0.07 + wiggle, y: 0.47, z: 0.17 }, w), null]
      pose.headX = 0.08 * w
    },
  },
  {
    kind: 'stretch',
    duration: 3.6,
    standing: true,
    sitting: false,
    weight: 1.2,
    apply: (t, pose) => {
      // Arms overhead, lean back, then over to one side.
      const w = hold(t, 0, 3.6, 0.6)
      pose.hands = [target({ x: 0.16, y: 0.72, z: 0.08 }, w), target({ x: -0.16, y: 0.72, z: 0.08 }, w)]
      pose.spineX = -0.14 * w
      pose.spineZ = 0.22 * hold(t, 1.4, 3.2, 0.5)
      pose.headX = -0.2 * w
    },
  },
  {
    kind: 'stomp',
    duration: 2.6,
    standing: true,
    sitting: false,
    skisOnly: true,
    weight: 1.5,
    apply: (t, pose) => {
      // Knock the snow off: lift one ski, two taps, then the other.
      const tap = (u: number) => Math.max(0, Math.sin(u * Math.PI * 2)) * 0.09
      pose.skiLift = [t < 1.3 ? tap(t / 0.6) * hold(t, 0, 1.3, 0.2) : 0, t >= 1.3 ? tap((t - 1.3) / 0.6) * hold(t, 1.3, 2.6, 0.2) : 0]
      pose.sway = (t < 1.3 ? -1 : 1) * 0.05 * hold(t % 1.3, 0, 1.3, 0.3)
      pose.headX = 0.25 * hold(t, 0, 2.6, 0.4)
    },
  },
  {
    kind: 'poleLean',
    duration: 5.5,
    standing: true,
    sitting: false,
    skisOnly: true,
    weight: 1.5,
    apply: (t, pose) => {
      // Hands stacked on the pole grips in front, leaning on them.
      const w = hold(t, 0, 5.5, 0.7)
      pose.hands = [target({ x: 0.05, y: 0.0, z: 0.36 }, w), target({ x: -0.05, y: 0.02, z: 0.36 }, w)]
      pose.spineX = 0.22 * w
      pose.headX = -0.1 * w
      pose.sway = Math.sin(t * 0.9) * 0.02 * w
    },
  },
  {
    kind: 'fidget',
    duration: 3.4,
    standing: true,
    sitting: false,
    weight: 2,
    apply: (t, pose) => {
      // Shift from foot to foot with a little knee bob.
      const w = hold(t, 0, 3.4, 0.5)
      pose.sway = Math.sin(t * Math.PI * 1.2) * 0.05 * w
      pose.crouch = (0.06 + Math.sin(t * Math.PI * 2.4) * 0.05) * w
    },
  },
  {
    kind: 'watch',
    duration: 2.6,
    standing: true,
    sitting: true,
    weight: 1,
    apply: (t, pose) => {
      // Left wrist up, a glance down at it.
      const w = hold(t, 0, 2.6, 0.5)
      pose.hands = [target({ x: 0.02, y: 0.14, z: 0.33 }, w), null]
      pose.headX = 0.42 * hold(t, 0.3, 2.3, 0.4)
      pose.headY = 0.25 * hold(t, 0.3, 2.3, 0.4)
    },
  },
  {
    kind: 'hop',
    duration: 2.2,
    standing: true,
    sitting: false,
    boardOnly: true,
    weight: 2,
    apply: (t, pose) => {
      // Strapped in: two little hops to shuffle the board round.
      const hopAt = (a: number) => {
        const u = (t - a) / 0.42
        return u > 0 && u < 1 ? Math.sin(u * Math.PI) * 0.13 : 0
      }
      pose.hop = hopAt(0.5) + hopAt(1.35)
      // Dip before each hop and on each landing.
      const dip = (a: number) => Math.max(0, 1 - Math.abs(t - a) / 0.2)
      pose.crouch = (dip(0.4) + dip(0.95) + dip(1.25) + dip(1.8)) * 0.22
      pose.hands = [target({ x: 0.4, y: 0.05, z: 0.32 }, hold(t, 0, 2.2, 0.3) * 0.5), null]
    },
  },
  {
    kind: 'legSwing',
    duration: 4,
    standing: false,
    sitting: true,
    weight: 2,
    apply: (t, pose) => {
      pose.legSwing = Math.sin(t * 3.4) * 0.09 * hold(t, 0, 4, 0.6)
    },
  },
  {
    kind: 'beer',
    duration: 9.2,
    standing: true,
    sitting: true,
    weight: 0.35,
    apply: (t, pose) => {
      // Reach in the pocket, out comes a can, crack it with the other hand,
      // two long sips with the head back, then it goes away again.
      const w = hold(t, 0, 9.2, 0.6)
      let right = lerp3(POCKET, fromPocket(t, 0.9), ramp(t, 0.9, 1.0))
      right = toMouth(right, t, 2.8, 4.6)
      right = toMouth(right, t, 5.3, 6.9)
      right = lerp3(right, POCKET, ramp(t, 7.4, 8.3))
      pose.hands = [
        target({ x: -0.05, y: 0.2 + (t > 1.9 && t < 2.1 ? -0.02 : 0), z: 0.34 }, hold(t, 1.5, 2.5, 0.3)),
        target(right, w),
      ]
      pose.sip = hold(t, 3.0, 4.6, 0.45) + hold(t, 5.5, 6.9, 0.45)
      pose.headX = -0.6 * pose.sip + 0.15 * hold(t, 1.4, 2.5, 0.3)
      pose.spineX = -0.06 * (hold(t, 3.0, 4.6, 0.45) + hold(t, 5.5, 6.9, 0.45))
      pose.prop = t > 0.85 && t < 8.2 ? 'can' : null
      pose.canOpen = t > 2.0
    },
  },
  {
    kind: 'smoke',
    duration: 10.5,
    standing: true,
    sitting: true,
    weight: 0.3,
    apply: (t, pose) => {
      // Light up, three drags, breathe out after each, put it out.
      const w = hold(t, 0, 10.5, 0.6)
      const aside = { x: -0.24, y: 0.04, z: 0.26 }
      let right = lerp3(POCKET, MOUTH, hold(t, 0.8, 2.6, 0.5))
      right = lerp3(right, aside, ramp(t, 2.6, 3.0) * (1 - ramp(t, 9.4, 10.0)))
      for (const at of [3.3, 5.6, 7.9]) right = toMouth(right, t, at, at + 1.1)
      pose.hands = [target({ x: 0.0, y: 0.3, z: 0.24 }, hold(t, 1.0, 2.2, 0.3)), target(right, w)]
      pose.headX = -0.14 * ([4.5, 6.8, 9.1].reduce((s, at) => s + hold(t, at, at + 0.9, 0.3), 0))
      pose.prop = t > 0.8 && t < 9.8 ? 'cigarette' : null
      pose.exhale = [4.5, 6.8, 9.1].some((at) => t > at + 0.1 && t < at + 0.8)
    },
  },
]

const NEUTRAL: IdlePose = {
  kind: null,
  time: 0,
  hands: [null, null],
  headX: 0,
  headY: 0,
  headZ: 0,
  spineX: 0,
  spineZ: 0,
  sway: 0,
  skiLift: [0, 0],
  hop: 0,
  crouch: 0,
  legSwing: 0,
  prop: null,
  canOpen: false,
  sip: 0,
  exhale: false,
}

export function neutralIdle(): IdlePose {
  return { ...NEUTRAL, hands: [null, null], skiLift: [0, 0] }
}

/**
 * Plays idle moves while `active`. The first one waits `settle` seconds after
 * the rider stops; then a pause of a few seconds between moves. Any move
 * fades out fast when the rider sets off. `random` is injectable for tests.
 */
export function createIdlePlayer(random: () => number = Math.random) {
  let wait = 2
  let current: IdleMove | null = null
  let time = 0
  let last: IdleKind | null = null
  /** Fade of the whole move, so leaving mid-sip puts the can away quickly. */
  let fade = 0
  const pose = neutralIdle()

  const pick = (sitting: boolean, boarding: boolean): IdleMove | null => {
    const options = IDLE_MOVES.filter((m) =>
      (sitting ? m.sitting : m.standing) &&
      !(m.skisOnly && boarding) &&
      !(m.boardOnly && !boarding) &&
      m.kind !== last)
    const total = options.reduce((s, m) => s + m.weight, 0)
    let r = random() * total
    for (const m of options) {
      r -= m.weight
      if (r <= 0) return m
    }
    return options[options.length - 1] ?? null
  }

  return {
    /** Force a move (rider lab, tests). */
    play(kind: IdleKind) {
      current = IDLE_MOVES.find((m) => m.kind === kind) ?? null
      time = 0
      fade = 1
    },
    get current() {
      return current?.kind ?? null
    },
    step(dt: number, ctx: { active: boolean; sitting: boolean; boarding: boolean }): IdlePose {
      Object.assign(pose, NEUTRAL, { hands: [null, null], skiLift: [0, 0] })
      if (!ctx.active) {
        // Set off: the move fades out over a quarter second, then the timer restarts.
        fade = Math.max(0, fade - dt / 0.25)
        if (fade === 0) {
          current = null
          wait = ctx.sitting ? 3 : 2
        }
      } else if (!current) {
        wait -= dt
        if (wait <= 0) {
          current = pick(ctx.sitting, ctx.boarding)
          time = 0
          fade = 1
        }
      } else fade = 1
      if (!current) return pose
      time += ctx.active ? dt : 0
      if (time >= current.duration) {
        last = current.kind
        current = null
        wait = 1.5 + random() * 3.5
        return pose
      }
      current.apply(time, pose, ctx.sitting)
      pose.kind = current.kind
      pose.time = time
      if (fade < 1) {
        for (const h of pose.hands) if (h) h.w *= fade
        pose.headX *= fade
        pose.headY *= fade
        pose.headZ *= fade
        pose.spineX *= fade
        pose.spineZ *= fade
        pose.sway *= fade
        pose.skiLift = [pose.skiLift[0] * fade, pose.skiLift[1] * fade]
        pose.hop *= fade
        pose.crouch *= fade
        pose.legSwing *= fade
      }
      return pose
    },
  }
}
