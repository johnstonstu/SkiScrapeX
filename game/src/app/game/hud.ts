import type * as THREE from 'three'
import type { getUi } from '../dom'
import { formatTime } from '../format'
import type { createParkHud } from '../parkHud'
import type { createHudPeek } from '../../ui/hudPeek'
import { VERSION } from '../version'
import type { QualityProfile } from '../settings'
import type { GameState } from './state'

export interface HudDeps {
  ui: ReturnType<typeof getUi>
  renderer: THREE.WebGLRenderer
  parkHud: ReturnType<typeof createParkHud>
  hudPeek: ReturnType<typeof createHudPeek>
  quality: QualityProfile
  qualityReason: string
  hardware: { renderer: string } | null
}

/** The in-run readouts: speed, clock, park hints, the peek on change, and the info overlay. */
export function createHud(game: GameState, deps: HudDeps) {
  const { ui, renderer, parkHud, hudPeek, quality, qualityReason, hardware } = deps
  /** Last speed shown in the HUD, so the readout and bar only change when it does. */
  let shownKmh = -1

  function update(frameMs: number, steps: number) {
    const kmh = Math.round(game.skier.speed * 3.6)
    if (kmh !== shownKmh) {
      shownKmh = kmh
      ui.speed.textContent = `${kmh}`
      ui.speedo.style.setProperty('--speed', Math.min(1, kmh / 100).toFixed(2))
    }
    parkHud.update(game.skier, game.stage.features(), !game.ride && !game.pause, game.stage.env.rails ?? [])
    ui.time.textContent = formatTime(game.session.total)
    const now = performance.now()
    hudPeek.update(ui.title.textContent ?? '', now)
    // Timed runs, parks and events keep the clock up; free skiing shows it on a change.
    document.body.classList.toggle('hud-peek', hudPeek.visible(now, game.challenge.kind !== 'free' || !game.stage.world))
    document.body.classList.toggle('airborne', !game.skier.grounded || Boolean(game.skier.rail))
    if (!ui.debug.hidden) {
      const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`
      const world = game.stage.world
      const ground = world?.grid.heightAt(game.skier.x, game.skier.z)
      const elevation = world && ground !== undefined ? `${Math.round(ground + world.manifest.originElevation)} m` : '–'
      ui.debug.textContent = [
        `${game.skier.mode} · pitch ${deg(game.skier.pitch)} · edge ${deg(Math.abs(game.skier.edgeAngle))} · skid ${Math.round(game.skier.skid * 100)}%`,
        `elev ${elevation} · x ${game.skier.x.toFixed(0)} z ${game.skier.z.toFixed(0)}`,
        `${frameMs.toFixed(1)} ms · ${steps} steps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`,
        game.stage.describe(),
        `graphics ${quality.level} (${qualityReason}) · shadows ${renderer.shadowMap.enabled ? 'on' : 'off'} · pixel ratio ${renderer.getPixelRatio().toFixed(2)}`,
        hardware?.renderer ?? 'graphics chip unknown',
        `v${VERSION}`,
      ].join('\n')
    }
  }

  return { update }
}
