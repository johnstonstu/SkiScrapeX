import type * as THREE from 'three'
import type { SkiState } from '../../sim'
import type { RidePath } from '../../render/scenery/liftView'
import type { Course, Lift, Point2 } from '../../world/resort'
import type { ExitSpot } from '../liftExit'
import type { Goals } from '../goals'
import type { Npcs } from '../npcs'
import { createSession, type Challenge, type Session } from '../session'
import type { Stage } from '../stage'
import type { PaceCue } from '../parkPace'
import type { UnloadPath } from './arrival'

/** A lift ride in progress. */
export interface Ride {
  lift: Lift
  path: RidePath
  s: number
  /** Getting off at the top: stand up and glide down the unload ramp. */
  unload: { t: number; from: THREE.Vector3; to: THREE.Vector3; yaw: number; face: number; path?: UnloadPath; seconds?: number } | null
  /** The start of a free-ski session: the ride is a short film, with no HUD until the rider is off. `t` is seconds in. */
  opening?: { t: number; cut: boolean }
  /** Where the rider leaves the lift, which way they go and where they stop, worked out once per ride. */
  exit?: { from: THREE.Vector3; yaw: number; lineYaw: number; spot: ExitSpot; /** Chairs: the carved way off and where it ends. */ path?: UnloadPath; stop: { x: number; z: number } }
}

/** A short fade: physics waits until `until` (game seconds), then `then` runs. */
export interface Pause {
  until: number
  then: () => void
}

/**
 * The state of a play session, shared by the frame loop and the systems that
 * run in it (lift rides, challenges, the HUD). One object instead of loose
 * module variables, so a system can live in its own module and take this.
 */
export interface GameState {
  /** The Apex world, the demo park or a test slope. Set before the first frame. */
  stage: Stage
  stageReady: boolean
  skier: SkiState
  /** Where the next spawn starts and which run it times. */
  course: Course | null
  challenge: Challenge
  session: Session
  /** A fade in progress (physics paused). */
  pause: Pause | null
  /** On a lift (physics paused, the ride moves the rider). */
  ride: Ride | null
  /** The park assist's view of the next jump (predicted lip speed against its window), for the park cue. */
  paceCue: PaceCue | null
  /** Game seconds while not in a menu. */
  elapsed: number
  /** The bunny-hill line while the tutorial runs: reaching its end puts you back at the top. */
  tutorialLine: Point2[] | null
  goals: Goals | null
  npcs: Npcs | null
  /** Touch controls showing now: follows the input last used. */
  mobile: boolean
}

export function createGameState(mobile: boolean): GameState {
  const challenge: Challenge = { kind: 'free' }
  return {
    // Both are assigned when the first stage is built, before the frame loop starts.
    stage: undefined as unknown as Stage,
    skier: undefined as unknown as SkiState,
    stageReady: false,
    course: null,
    challenge,
    session: createSession(challenge),
    pause: null,
    ride: null,
    paceCue: null,
    elapsed: 0,
    tutorialLine: null,
    goals: null,
    npcs: null,
    mobile,
  }
}
