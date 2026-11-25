import { describe, expect, it } from 'vitest'
import { BufferAttribute, Vector3 } from 'three'
import { SkiTracks } from '../src/fx/tracks/SkiTracks'

/** Ski straight south from z = 2 to z = 8 at x = 0 on flat snow. */
function ski(tracks: SkiTracks, opts: { skid?: number; carving?: number; powder?: number } = {}) {
  for (let z = 2; z <= 8; z += 0.1) {
    tracks.update(1 / 60, {
      position: new Vector3(0, 0, z),
      direction: new Vector3(0, 0, 1),
      normal: new Vector3(0, 1, 0),
      skid: opts.skid ?? 0,
      carving: opts.carving ?? 1,
      powder: opts.powder ?? 0,
      grounded: true,
    })
  }
}

/** Stamp depth across the track (x from -0.6 to 0.6 m) halfway along it. */
function profile(tracks: SkiTracks) {
  const data = tracks.stampTexture.image.data as Uint8Array
  const texel = tracks.windowMetres / tracks.resolution
  const row = Math.round((5 - tracks.originZ) / texel)
  const out: { x: number; depth: number }[] = []
  for (let x = -0.6; x <= 0.6; x += texel) {
    const col = Math.round((x - tracks.originX) / texel)
    out.push({ x, depth: data[(row * tracks.resolution + col) * 4] })
  }
  return out
}

const fine = () => new SkiTracks({ windowMetres: 20, resolution: 256, stance: 0.28, skiWidth: 0.11 })

describe('ski tracks', () => {
  it('carving skis leave two grooves, one per ski, with snow standing between them', () => {
    const tracks = fine()
    ski(tracks)
    const p = profile(tracks)
    const peak = Math.max(...p.map((s) => s.depth))
    const centre = p.reduce((a, b) => (Math.abs(a.x) < Math.abs(b.x) ? a : b)).depth
    const left = p.filter((s) => s.x < -0.08).reduce((a, b) => (a.depth > b.depth ? a : b))
    const right = p.filter((s) => s.x > 0.08).reduce((a, b) => (a.depth > b.depth ? a : b))
    expect(Math.abs(left.x + 0.14)).toBeLessThan(0.06)
    expect(Math.abs(right.x - 0.14)).toBeLessThan(0.06)
    expect(centre).toBeLessThan(peak * 0.6)
  })

  it('a skid smears the two grooves into one wide scrape', () => {
    const tracks = fine()
    ski(tracks, { skid: 1, carving: 0 })
    const p = profile(tracks)
    const peak = Math.max(...p.map((s) => s.depth))
    const centre = p.reduce((a, b) => (Math.abs(a.x) < Math.abs(b.x) ? a : b)).depth
    expect(centre).toBeGreaterThan(peak * 0.85)
  })

  it('a snowboard leaves one groove down the middle', () => {
    const tracks = new SkiTracks({ windowMetres: 20, resolution: 256, stance: 0, skiWidth: 0.27 })
    ski(tracks)
    const p = profile(tracks)
    const deepest = p.reduce((a, b) => (a.depth > b.depth ? a : b))
    expect(Math.abs(deepest.x)).toBeLessThan(0.06)
  })

  it('with the deep-snow patch on, draws ribbons on firm snow and fades them in powder', () => {
    const maxFade = (tracks: SkiTracks) => {
      const profiles = tracks.object.geometry.getAttribute('aProfile') as BufferAttribute
      let max = 0
      for (let i = 0; i < tracks.object.geometry.drawRange.count; i++) max = Math.max(max, profiles.getY(i))
      return max
    }
    const firm = fine()
    firm.deepSnowPatch = true
    ski(firm)
    expect(firm.object.visible).toBe(true)
    expect(maxFade(firm)).toBeGreaterThan(0.5)
    const powder = fine()
    powder.deepSnowPatch = true
    ski(powder, { powder: 1 })
    expect(maxFade(powder)).toBeLessThan(0.05)
  })
})
