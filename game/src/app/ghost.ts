/**
 * Ghost of your best run in an event: positions sampled every 0.1 s of race
 * clock, kept in localStorage per event and replayed against the clock on the
 * next attempt. No rendering here (eventView draws the figure).
 */
import { readJson, writeJson } from './storage'

export interface GhostTrack {
  /** Seconds between samples. */
  step: number
  /** x, y, z, heading per sample, flat, rounded to centimetres. */
  samples: number[]
}

export interface GhostPose {
  x: number
  y: number
  z: number
  heading: number
}

const STEP = 0.1
const key = (id: string) => `skiscrapex.ghost.${id}`

export function createGhostRecorder(step = STEP) {
  const samples: number[] = []
  let next = 0
  return {
    /** Record the racer at race clock `time` (call every frame; samples are taken every `step`). */
    add(time: number, pose: GhostPose) {
      while (time >= next) {
        samples.push(Math.round(pose.x * 100) / 100, Math.round(pose.y * 100) / 100, Math.round(pose.z * 100) / 100, Math.round(pose.heading * 1000) / 1000)
        next += step
      }
    },
    track(): GhostTrack {
      return { step, samples: [...samples] }
    },
  }
}

/** The ghost's pose at race clock `time`, interpolated; null before the start or after the finish. */
export function ghostAt(track: GhostTrack, time: number): GhostPose | null {
  const count = track.samples.length / 4
  if (count < 2 || time < 0) return null
  const f = time / track.step
  const i = Math.floor(f)
  if (i >= count - 1) return null
  const t = f - i
  const a = i * 4
  const b = a + 4
  const s = track.samples
  const dh = Math.atan2(Math.sin(s[b + 3] - s[a + 3]), Math.cos(s[b + 3] - s[a + 3]))
  return { x: s[a] + (s[b] - s[a]) * t, y: s[a + 1] + (s[b + 1] - s[a + 1]) * t, z: s[a + 2] + (s[b + 2] - s[a + 2]) * t, heading: s[a + 3] + dh * t }
}

export function readGhost(id: string): GhostTrack | null {
  const track = readJson<GhostTrack | { step: 0; samples: [] }>(key(id), { step: 0, samples: [] })
  return track.step > 0 && track.samples.length >= 8 ? track : null
}

export function writeGhost(id: string, track: GhostTrack): void {
  writeJson(key(id), track)
}
