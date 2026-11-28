/**
 * Playtest telemetry switch. The recorder is only built in when the build is
 * made with `VITE_TELEMETRY=1` (the private test build); the live game is
 * built without it, so `__TELEMETRY__` is false there, the import below is
 * dropped and nothing is recorded or sent anywhere.
 *
 *   VITE_TELEMETRY=1 npm run build
 *
 * See docs/telemetry.md.
 */
import type * as THREE from 'three'
import type { SkiInput } from '../sim'
import type { Controls } from '../player/input'
import type { GameState } from '../app/game/state'
import type { Ui } from '../app/dom'

declare const __TELEMETRY__: boolean

/** What the recorder reads each frame. Everything is read only, except that it wraps `controls.takeActions` to see the actions. */
export interface TelemetryContext {
  game: GameState
  controls: Controls
  camera: THREE.PerspectiveCamera
  rig: { readonly mode: string; readonly holding: boolean }
  ui: Ui
  version: string
  /** The menu, panel or card that is up, if any. */
  overlay(): HTMLElement | null
  /** The run or area at a spot ('' before the mountain loads). */
  runNameAt(x: number, z: number): string
  /** Facts for the session header (graphics level, settings, rider). Read once at the start and when a menu closes. */
  describe(): Record<string, unknown>
}

export interface Telemetry {
  /** Once per animation frame, after the game has drawn. `input` is what the sim got, or null in a menu. */
  frame(rawMs: number, input: SkiInput | null): void
}

export function loadTelemetry(context: TelemetryContext): Promise<Telemetry | null> {
  if (typeof __TELEMETRY__ === 'undefined' || !__TELEMETRY__) return Promise.resolve(null)
  return import('./recorder').then(
    (module) => module.createRecorder(context),
    (error) => {
      console.warn('Telemetry did not load', error)
      return null
    },
  )
}
