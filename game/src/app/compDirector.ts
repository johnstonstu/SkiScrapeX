/**
 * Runs the judged competitions for main.ts: the mogul comp (taps to turns,
 * the autopilot that holds the line, the beat strip, airs) and aerials (each
 * jump judged; the best two count). Race timing and the start gate are the
 * race director's; this only handles what is judged.
 */
import type { SkiInput, SkiState, TrickEvent } from '../sim'
import type { Challenge } from './session'
import { GOOD, createMogulRun, createTapReader, holdSpeed, type MogulRun, type TurnGrade } from './moguls'
import { bestTwo, judgeJump, type JudgedJump } from './judging'
import { laneCoords } from '../world/mogulCourse'
import type { RaceHud } from '../ui/raceHud'

const GRADE_LABEL: Record<TurnGrade, string> = { perfect: 'Perfect', good: 'Good', off: 'Off the beat', miss: 'Missed' }
const GRADE_KIND: Record<TurnGrade, string> = { perfect: 'perfect', good: 'clean', off: 'sketchy', miss: 'crash' }

export function createCompDirector(options: {
  hud: RaceHud
  show: (title: string, detail: string, kind: string) => void
  /** Thrown out of the mogul line (three misses in a row). */
  onOut: () => void
}) {
  const { hud, show } = options
  let moguls: MogulRun | null = null
  let lane: Parameters<typeof laneCoords>[0] | null = null
  let tapOf = createTapReader()
  let aerials: JudgedJump[] | null = null

  const jumpLine = (jump: JudgedJump) => `DD ${jump.dd.toFixed(1)} × form ${jump.form.toFixed(1)} = ${jump.score.toFixed(1)}`

  return {
    begin(challenge: Challenge) {
      moguls = null
      lane = null
      aerials = null
      tapOf = createTapReader()
      if (challenge.kind !== 'event') return
      if (challenge.course.moguls) {
        moguls = createMogulRun(challenge.course.moguls)
        lane = challenge.course.moguls
      } else if (challenge.course.def.format === 'aerials') aerials = []
    },
    end() {
      moguls = null
      lane = null
      aerials = null
      hud.setBeats(null)
    },
    get active() {
      return Boolean(moguls || aerials)
    },
    /**
     * Per frame, after the start gate: in the mogul comp, turn the steering into
     * taps and drive the skier along the chosen line (changes `input`).
     */
    input(input: SkiInput, skier: SkiState, holding: boolean, dt = 1 / 60) {
      if (!moguls || !lane) return
      const { s } = laneCoords(lane, skier.x, skier.z)
      const tap = tapOf(input.steer)
      if (holding) {
        hud.setBeats(moguls.cues(s, 6), 0, 0, GOOD)
        return
      }
      const air = moguls.inAirZone(s)
      for (const event of moguls.step(s, skier.speed, air ? 0 : tap)) {
        if (event.type === 'turn') {
          const streak = event.streak > 2 ? ` · streak ${event.streak}` : ''
          show(GRADE_LABEL[event.grade], `${Math.round(moguls.targetSpeed * 3.6)} km/h${streak}`, GRADE_KIND[event.grade])
        } else if (event.type === 'out') {
          options.onOut()
          return
        }
      }
      hud.setBeats(air ? [] : moguls.cues(s, skier.speed), moguls.streak, skier.speed * 3.6, GOOD)
      const drive = moguls.drive(skier, s, dt)
      // The legs and the skid hold the speed through the bumps (no hockey stop).
      holdSpeed(skier, moguls.goalAt(s), dt)
      // On the snow the autopilot steers and sets the speed; in the air the player spins, flips and grabs.
      if (skier.grounded) {
        input.steer = drive.steer
        input.directionalSteering = false
      }
      input.tuck = drive.tuck
      input.brake = drive.brake
      if (!air) input.jump = false
    },
    /** An air trick landed (or crashed). */
    onTrick(trick: TrickEvent) {
      if (trick.kind !== 'air') return
      if (moguls) {
        const event = moguls.addAir(trick)
        if (event.type === 'air') show(event.jump.name, jumpLine(event.jump), trick.grade)
      } else if (aerials) {
        const jump = judgeJump(trick)
        aerials.push(jump)
        show(`${jump.name}`, jumpLine(jump), trick.grade)
      }
    },
    /** The judged score for the results, or null outside a judged comp. */
    score(time: number): { total: number; lines: [string, string][] } | null {
      if (moguls) {
        const s = moguls.score(time)
        const count = (g: TurnGrade) => moguls!.grades.filter((x) => x === g).length
        const lines: [string, string][] = [
          ['Turns (60)', `${s.turns.toFixed(1)}  ·  ${count('perfect')} perfect, ${count('good')} good, ${count('off')} off beat, ${count('miss')} missed`],
          ['Air (20)', `${s.air.toFixed(1)}${moguls.jumps.length ? `  ·  ${moguls.jumps.map((j) => j.name).join(', ')}` : ''}`],
          ['Speed (20)', `${s.speed.toFixed(1)}`],
          ['Best streak', `${moguls.bestStreak}`],
        ]
        return { total: s.total, lines }
      }
      if (aerials) {
        const best = bestTwo(aerials)
        const total = Math.round(best.reduce((sum, j) => sum + j.score, 0) * 100) / 100
        const lines = best.map((j, i): [string, string] => [`Jump ${i + 1}: ${j.name}`, jumpLine(j)])
        if (!best.length) lines.push(['Jumps', 'none landed'])
        return { total, lines }
      }
      return null
    },
  }
}

export type CompDirector = ReturnType<typeof createCompDirector>
