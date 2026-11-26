/**
 * Runs the race system for main.ts during an event: the start gate countdown
 * (holding the racer until GO), the fast-start kick, gate grades with their
 * speed kick, the racing line assist on the player's steering, and the ghost
 * of the best run (recorded now, replayed next time).
 */
import type { SkiInput, SkiState } from '../sim'
import type { Challenge, Session, SessionEvent } from './session'
import { FAST_START_KICK, TIGHT_KICK, aimGate, assistSteer, createStartGate, gateAim, gradeGate, kick, steerToward, type GateGrade } from './race'
import { createGhostRecorder, ghostAt, readGhost, writeGhost, type GhostPose, type GhostTrack } from './ghost'
import { progressAlong } from '../world/challenges'
import { PHYSICS } from '../sim/constants'

/** Seconds after GO the racer skates out of the gate on their own if they have not pushed off. */
export const AUTO_PUSH_SECONDS = 1.5
import type { RaceHud } from '../ui/raceHud'

type EventChallenge = Extract<Challenge, { kind: 'event' }>

export function createRaceDirector(options: {
  hud: RaceHud
  show: (title: string, detail: string, kind: string) => void
  assistOn: () => boolean
}) {
  const { hud, show } = options
  let event: EventChallenge | null = null
  let session: Session | null = null
  let gate: ReturnType<typeof createStartGate> | null = null
  let recorder: ReturnType<typeof createGhostRecorder> | null = null
  let ghost: GhostTrack | null = null
  let sinceGo = Infinity
  const grades: Record<GateGrade, number> = { tight: 0, clean: 0, skid: 0 }

  const offset = () => (event && event.course.def.gates.kind !== 'none' ? event.course.def.gates.offset : 0)
  /** Single-run races keep a ghost; two-run and judged formats do not. */
  const ghosted = () => event?.course.def.format === 'race'

  return {
    /** A new attempt has spawned. */
    begin(challenge: Challenge, next: Session) {
      session = next
      grades.tight = grades.clean = grades.skid = 0
      if (challenge.kind !== 'event' || challenge.course.def.format === 'aerials') {
        event = null
        gate = null
        recorder = null
        ghost = null
        hud.hideAll()
        return
      }
      event = challenge
      sinceGo = Infinity
      gate = createStartGate()
      recorder = ghosted() ? createGhostRecorder() : null
      ghost = ghosted() ? readGhost(challenge.id) : null
      hud.setCount(String(gate.count))
    },
    end() {
      event = null
      gate = null
      recorder = null
      ghost = null
      hud.hideAll()
    },
    /** Hold the racer still in the start gate. */
    get holding() {
      return Boolean(gate && !gate.open)
    },
    get grades() {
      return { ...grades }
    },
    /** Per frame, before physics: run the start gate and the steering assist (changes `input`). */
    input(input: SkiInput, skier: SkiState, dt: number) {
      if (!event || !session) return
      if (gate) {
        const { event: start } = gate.step(dt, input.tuck || Boolean(input.jump))
        if (start === 'falseStart') hud.setCount('False start', 'warn')
        else if (start === 'go') {
          session.startClock()
          sinceGo = 0
          hud.setCount('GO!', 'go')
        } else if (start === 'fastStart') {
          kick(skier, FAST_START_KICK)
          show('Fast start', `+${Math.round(FAST_START_KICK * 3.6)} km/h`, 'perfect')
        } else if (!gate.open && !gate.warning) hud.setCount(String(gate.count))
        if (!gate.open) {
          // Held in the start: no steering or jumping until GO.
          input.steer = 0
          input.jump = false
          return
        }
      }
      // Out of the gate: skate the first strides so a start that faces a flat cat track still gets going.
      if (sinceGo < AUTO_PUSH_SECONDS) {
        sinceGo += dt
        if (skier.speed < PHYSICS.skateMaxSpeed && input.brake < PHYSICS.brakeEngage) input.tuck = true
      }
      if (!options.assistOn() || !event.gates.length || !skier.grounded) return
      const along = progressAlong(skier.x, skier.z, event.line).s
      const target = aimGate(event.gates, session.nextGate, along)
      if (!target) return
      const [ax, az] = gateAim(target, offset())
      input.steer = assistSteer(input.steer, steerToward(skier, ax, az))
    },
    /** A gate was passed or missed: grade a pass, kick a tight one. */
    onGate(e: Extract<SessionEvent, { type: 'gate' }>, skier: SkiState) {
      if (!event || e.result !== 'pass' || e.lateral === null) return
      const { grade } = gradeGate(event.gates[e.index], e.lateral, e.skid, offset())
      grades[grade]++
      if (grade === 'tight') {
        kick(skier, TIGHT_KICK)
        show('Tight', `gate ${e.index + 1}`, 'perfect')
      } else if (grade === 'skid') show('Skidded', `gate ${e.index + 1}`, 'sketchy')
    },
    /** Per frame, after physics: record the ghost. */
    record(skier: SkiState) {
      if (!recorder || !session?.timing || session.finished) return
      recorder.add(session.stats.time, skier)
    },
    /** The ghost's pose now, if there is a best run to race. */
    ghost(): GhostPose | null {
      if (!ghost || !session?.timing) return null
      return ghostAt(ghost, session.stats.time)
    },
    /** The attempt finished; keep its ghost if it was a new best. */
    finished(improved: boolean) {
      if (event && recorder && improved) writeGhost(event.id, recorder.track())
    },
  }
}

export type RaceDirector = ReturnType<typeof createRaceDirector>
