import { PHYSICS, fallLineHeading, type SampleTerrain, type SkiState } from '../sim'

/**
 * `steady` holds the view down the hill and lets the skier swing across it,
 * like a follow-cam filmer; `tight` turns with the skis.
 */
export type CameraStyle = 'steady' | 'tight'

/**
 * The follow camera's framing, with no rendering: where the camera sits and
 * what it looks at, one frame at a time. Plain numbers in and out, so the
 * framing can be run and measured against a simulated run (tests/cameraFraming.test.ts).
 *
 * Three things shape it beyond "behind and above the rider":
 *
 * - Height is kept over the slope, not just over the rider. Behind is uphill,
 *   so on a steep run a camera at a fixed height above the rider's boots ends
 *   up skimming the snow, looking along the slope instead of down onto it.
 * - On moguls and chop it rides the smooth ground under the bumps, not the
 *   rider's boots or the crests under the camera, and it sits higher and looks
 *   further down the hill, so the next bumps are in view and the picture is still.
 * - Into a jump it lifts before the lip and keeps looking past it; in the air
 *   it draws back, lifts and tips toward where the rider will come down.
 */
export const FOLLOW = {
  /** Metres behind the rider: base, and the share of speed added (capped). */
  back: 7.2,
  backPerSpeed: 0.08,
  backSpeedMax: 4,
  /** Metres above the rider's boots: base, and the share of speed added (capped). */
  height: 2.6,
  heightPerSpeed: 0.03,
  heightSpeedMax: 1.5,
  /** Share of that height the camera keeps above the smooth slope under itself. */
  slopeClearance: 0.9,
  /** Never closer than this to the snow under the camera, bumps included. */
  minClearance: 1.4,
  /** Extra metres up and back at full bumps, and how much further ahead it looks. */
  bumpLift: 1.2,
  bumpBack: 0.8,
  bumpAhead: 3,
  /** Bump height (m) that counts as full bumps: chop is about 0.3, moguls 0.5 to 0.94. */
  bumpFull: 0.5,
  /** Share of the slope ahead the view tips down by: on smooth snow, and on bumps. */
  gradeLook: 0.55,
  gradeLookBumps: 0.8,
  /** Metres ahead of the rider the view is centred on. */
  ahead: 8,
  /** Extra metres up on the run-in to a jump, and up and back at full air: high enough to look onto the landing over the deck. */
  approachLift: 1.2,
  airLift: 2.8,
  airBack: 0,
  /** Metres of air (over the ground, or down to the landing) that count as full air. */
  airFull: 3.5,
  /** Share of the way the view moves from ahead of the rider to the landing at full air. */
  landingLook: 0.6,
  /** Seconds off the snow before a hop over bumps counts as air. */
  hopSeconds: 0.22,
  /** How fast the camera closes on its spot, 1/s. */
  rate: 6,
} as const

export interface FollowOptions {
  style: CameraStyle
  /** A tree or wall at a candidate camera spot: the camera pulls in toward the rider until it is clear. */
  blocked?: (x: number, z: number) => boolean
  /** The next park feature or rail ahead: pulls the look toward it, and a jump lifts the camera on the run-in. */
  aim?: { x: number; z: number; strength?: number; distance?: number; jump?: boolean } | null
  /** False with reduced motion or camera shake off: no aim pull. */
  motion?: boolean
  /** Metres added to the camera height (the Camera height setting). */
  lift?: number
  /** Metres the camera dips for a landing, already decaying. */
  dip?: number
  /** Position follow rate override, 1/s (a hand-over from a held shot is slower). */
  rate?: number
  /** Be there this frame. */
  snap?: boolean
  /** Snap the heading only (the first frame out of a held shot). */
  snapHeading?: boolean
}

export interface FollowFrame {
  x: number
  y: number
  z: number
  lookX: number
  lookY: number
  lookZ: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mix = (a: number, b: number, t: number) => a + (b - a) * t
const toward = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)
const smooth = (t: number) => {
  const k = clamp(t, 0, 1)
  return k * k * (3 - 2 * k)
}

export function createFollowCamera() {
  const frame: FollowFrame = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0 }
  let heading = 0
  let lookHeight = 0
  /** Highest bump seen lately (m), 0..1 bumps from it, and the mean bump height under the rider. */
  let bumpPeak = 0
  let bumps = 0
  let bumpMean = 0
  /** How far the rider sits off the ground sample when riding (powder sink), eased. */
  let seat = 0
  /** Which height the camera hangs from: the smooth ground under the rider, or the rider in the air. */
  let flying = false
  /** What is left of the step between those two when it switched; fades out. */
  let carry = 0
  let airTime = 0
  let air = 0
  let approach = 0
  let reach = 0
  let landX = 0, landY = 0, landZ = 0
  let leanX = 0, leanY = 0, leanZ = 0
  /** Metres the look is drawn sideways toward a park feature. */
  let side = 0

  /** Where a rider in the air comes down: a ballistic arc against the terrain, a few seconds out. */
  const predictLanding = (state: SkiState, sampleTerrain: SampleTerrain) => {
    const step = 0.06
    let x = state.x, y = state.y, z = state.z, vy = state.vy
    for (let t = 0; t < 4; t += step) {
      x += state.vx * step
      z += state.vz * step
      vy -= PHYSICS.gravity * step
      y += vy * step
      const ground = sampleTerrain(x, z)
      if (!ground) break
      if (y <= ground.height) {
        landX = x
        landY = ground.height
        landZ = z
        return true
      }
    }
    return false
  }

  return {
    frame,
    get heading() {
      return heading
    },
    /** 0..1: how much the camera has settled into its bumps framing. */
    get bumps() {
      return bumps
    },
    /** 0..1: how much it has settled into its air framing. */
    get air() {
      return air
    },
    /** Start the next step from here (a hand-over from a held shot). */
    place(x: number, y: number, z: number) {
      frame.x = x
      frame.y = y
      frame.z = z
    },
    step(state: SkiState, sampleTerrain: SampleTerrain, dt: number, options: FollowOptions): FollowFrame {
      const snap = Boolean(options.snap)
      const ground = sampleTerrain(state.x, state.z)
      const bump = ground?.mogulHeight ?? 0
      const base = ground ? ground.height - bump : state.y
      const clearance = ground ? state.y - ground.height : 0
      const planar = Math.hypot(state.vx, state.vz)

      // Bumps: the tallest one under or just ahead of the rider, held a moment so the gaps between rows do not count as smooth snow.
      let seen = bump
      if (planar > 2) {
        for (const reachAhead of [7, 14]) {
          seen = Math.max(seen, sampleTerrain(state.x + (state.vx / planar) * reachAhead, state.z + (state.vz / planar) * reachAhead)?.mogulHeight ?? 0)
        }
      }
      bumpPeak = snap ? seen : Math.max(bumpPeak * Math.exp(-dt / 1.4), seen)
      const wantBumps = clamp((bumpPeak - 0.08) / (FOLLOW.bumpFull - 0.08), 0, 1)
      bumps = snap ? wantBumps : mix(bumps, wantBumps, toward(wantBumps > bumps ? 1.8 : 0.7, dt))

      // Air: a hop off a mogul crest is still riding the bumps; a real air (or a rail, or a tumble) follows the rider.
      airTime = state.grounded ? 0 : airTime + dt
      const wasFlying = flying
      flying = Boolean(state.rail) || state.crashed > 0 || (!state.grounded && (bumps < 0.25 || airTime > FOLLOW.hopSeconds || clearance > 0.9))
      if (!flying && state.grounded) {
        bumpMean = snap ? bump : mix(bumpMean, bump, toward(1.2, dt))
        seat = snap ? clearance : mix(seat, clearance, toward(3, dt))
      }
      const riding = base + bumpMean * bumps + seat
      const anchor = flying ? state.y : riding
      if (snap) carry = 0
      else if (flying !== wasFlying) carry += (wasFlying ? state.y : riding) - anchor
      carry *= Math.exp(-3 * dt)
      const y = anchor + carry

      const real = flying && !state.rail && state.crashed <= 0
      heading = followHeading(options.style, state, sampleTerrain, heading, snap || options.snapHeading ? Infinity : dt, flying || state.ridingSwitch)

      // In the air: how big the air is, from the height over the ground and the drop to the landing.
      let wantAir = 0
      let landing = false
      if (real) {
        landing = predictLanding(state, sampleTerrain)
        wantAir = smooth(Math.max(clearance, landing ? state.y - landY : 0) / FOLLOW.airFull)
      }
      air = snap ? wantAir : mix(air, wantAir, toward(wantAir > air ? 3.2 : 3.4, dt))
      // Into a jump: lift over the last 30 m so the lip and what is past it read sooner.
      const aim = options.aim && options.motion !== false && state.grounded && !state.rail && state.crashed <= 0 ? options.aim : null
      const wantApproach = aim?.jump ? smooth(1 - (aim.distance ?? 30) / 30) : 0
      approach = snap ? wantApproach : mix(approach, wantApproach, toward(2.5, dt))

      let back = FOLLOW.back + Math.min(FOLLOW.backSpeedMax, state.speed * FOLLOW.backPerSpeed) + FOLLOW.bumpBack * bumps + FOLLOW.airBack * air
      const height =
        FOLLOW.height +
        Math.min(FOLLOW.heightSpeedMax, state.speed * FOLLOW.heightPerSpeed) +
        (options.lift ?? 0) +
        FOLLOW.bumpLift * bumps +
        Math.max(FOLLOW.approachLift * approach, FOLLOW.airLift * air) -
        (options.dip ?? 0)
      // Pull in past a tree or a wall at once; ease back out so the view does not pump between trunks.
      if (options.blocked) {
        let clear = back
        while (clear > 2.6 && options.blocked(state.x + Math.sin(heading) * clear, state.z - Math.cos(heading) * clear)) clear -= 0.8
        reach = snap || clear < reach ? clear : mix(reach, clear, toward(2.5, dt))
        back = Math.min(back, reach)
      } else {
        reach = back
      }
      const wantX = state.x + Math.sin(heading) * back
      const wantZ = state.z - Math.cos(heading) * back
      let wantY = y + height
      const under = sampleTerrain(wantX, wantZ)
      if (under) {
        const smoothUnder = under.height - (under.mogulHeight ?? 0)
        wantY = Math.max(wantY, smoothUnder + height * FOLLOW.slopeClearance, under.height + FOLLOW.minClearance)
      }
      const k = snap ? 1 : toward(options.rate ?? FOLLOW.rate, dt)
      frame.x = mix(frame.x, wantX, k)
      frame.y = mix(frame.y, wantY, k)
      frame.z = mix(frame.z, wantZ, k)

      // The look: a point ahead of the rider, tipped down the hill by a share of the slope ahead.
      const ahead = FOLLOW.ahead + FOLLOW.bumpAhead * bumps
      let lookX = state.x - Math.sin(heading) * ahead
      let lookZ = state.z + Math.cos(heading) * ahead
      const there = sampleTerrain(lookX, lookZ)
      const scale = ahead / FOLLOW.ahead
      let grade = there && ground ? clamp((there.height - (there.mogulHeight ?? 0) - base) * mix(FOLLOW.gradeLook, FOLLOW.gradeLookBumps, bumps), -3.2 * scale, 2 * scale) : 0
      // Up a kicker the view stays on what is past the lip instead of tipping up the ramp and back.
      if (grade > 0) grade *= 1 - approach
      lookHeight = snap ? grade : mix(lookHeight, grade, toward(4, dt))
      let lookY = y + 1.1 + lookHeight
      // A park feature ahead draws the view sideways toward it. Eased in and out, and never along
      // the view, so finding a feature, taking off and landing do not jolt or tip the picture.
      let wantSide = 0
      if (aim) {
        const pull = clamp(aim.strength ?? 0.16, 0, 0.35)
        wantSide = ((aim.x - lookX) * Math.cos(heading) + (aim.z - lookZ) * Math.sin(heading)) * pull
      }
      side = snap ? wantSide : mix(side, wantSide, toward(3, dt))
      lookX += Math.cos(heading) * side
      lookZ += Math.sin(heading) * side
      // In the air the view leans toward the landing; after touchdown that lean lets go over a moment, not in one frame.
      if (landing && air > 0) {
        const pull = FOLLOW.landingLook * air
        // Close to touchdown the landing is nearer than the usual look ahead: lean to the snow at that distance instead of pulling the view in.
        const near = Math.hypot(landX - state.x, landZ - state.z) < ahead
        const toX = near ? lookX : landX, toZ = near ? lookZ : landZ
        const toY = (near ? (there ? there.height : landY) : landY) + 1.1
        leanX = (toX - lookX) * pull
        leanY = Math.min(0, (toY - lookY) * pull)
        leanZ = (toZ - lookZ) * pull
      } else {
        const fade = snap ? 0 : Math.exp(-3 * dt)
        leanX *= fade
        leanY *= fade
        leanZ *= fade
      }
      lookX += leanX
      lookY += leanY
      lookZ += leanZ
      frame.lookX = lookX
      frame.lookY = lookY
      frame.lookZ = lookZ
      return frame
    },
  }
}

/**
 * One step of the follow camera's heading. `dt = Infinity` snaps to the target.
 * `spinning`: the skis are not a guide to where the rider is going (in the air,
 * on a rail, switch, crashed), so the view follows the line of travel.
 */
export function followHeading(
  style: CameraStyle,
  state: SkiState,
  sampleTerrain: SampleTerrain,
  heading: number,
  dt: number,
  spinning = state.ridingSwitch || !state.grounded || Boolean(state.rail) || state.crashed > 0,
): number {
  const moving = state.speed > 3
  const travel = moving ? Math.atan2(-state.vx, state.vz) : state.heading
  let targetHeading: number
  let rate: number
  if (style === 'steady') {
    const steady = steadyHeading(state, sampleTerrain, moving ? travel : state.heading, moving)
    targetHeading = spinning && moving ? travel : steady
    // Slow to swing, so linked turns move the skier across a still view;
    // quicker when the skier is heading well off the view (a long traverse).
    const off = Math.abs(Math.atan2(Math.sin(targetHeading - heading), Math.cos(targetHeading - heading)))
    // 0.9.40: looser (1.3 to 1.0) and the catch-up starts later (0.9 to 1.2 rad off), so
    // the view stays on the fall line through held turns. Guesses, tune in play.
    rate = (spinning ? 3 : 1.0) + 5 * clamp((off - 1.2) / 0.9, 0, 1)
  } else {
    // Mostly the ski heading, so the view turns when you steer rather than
    // when the path has caught up; travel keeps it steady through skids.
    targetHeading = spinning && moving ? travel : blendAngle(state.heading, travel, moving ? 0.3 : 0)
    rate = 7
  }
  return blendAngle(heading, targetHeading, 1 - Math.exp(-rate * dt))
}

/**
 * Where the steady camera points: the travel direction pulled toward the
 * fall line on a real slope, less so the further the skier is traversing
 * away from it, so the view looks down the hill through linked turns.
 */
export function steadyHeading(state: SkiState, sampleTerrain: SampleTerrain, aim: number, moving: boolean): number {
  if (!moving) return aim
  const ground = sampleTerrain(state.x, state.z)
  if (!ground) return aim
  // On bumps, the fall line of the smooth slope under them: each mogul's own face points somewhere else.
  const normal = ground.mogulHeight === undefined ? ground.normal : smoothNormal(sampleTerrain, state.x, state.z) ?? ground.normal
  const fall = fallLineHeading(normal)
  if (fall === null) return aim
  // Full pull from about 9° (was 12°), and it holds further into a traverse (0.6π to 0.75π).
  const steep = clamp(Math.hypot(normal.x, normal.z) / 0.15, 0, 1)
  const off = Math.abs(Math.atan2(Math.sin(fall - aim), Math.cos(fall - aim)))
  const pull = 0.85 * steep * Math.max(0, 1 - off / (Math.PI * 0.75))
  return blendAngle(aim, fall, pull)
}

/** The slope's normal with its bumps taken off, from the smooth heights 4 m either side. */
function smoothNormal(sampleTerrain: SampleTerrain, x: number, z: number) {
  const d = 4
  const h = (px: number, pz: number) => {
    const s = sampleTerrain(px, pz)
    return s ? s.height - (s.mogulHeight ?? 0) : null
  }
  const e = h(x + d, z), w = h(x - d, z), s = h(x, z + d), n = h(x, z - d)
  if (e === null || w === null || s === null || n === null) return null
  const gx = (e - w) / (2 * d), gz = (s - n) / (2 * d)
  const length = Math.hypot(gx, 1, gz)
  return { x: -gx / length, y: 1 / length, z: -gz / length }
}

function blendAngle(current: number, goal: number, amount: number): number {
  const delta = Math.atan2(Math.sin(goal - current), Math.cos(goal - current))
  return current + delta * amount
}
