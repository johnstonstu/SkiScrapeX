import { describe, expect, it, vi } from 'vitest'
import { parkSpeedCue, railCue } from '../src/app/parkHud'
import { applyCorrections } from '../src/world/corrections'
import { emptyProgress, renameRuns } from '../src/app/progress'
import { DEFAULT_SETTINGS, QUALITY, shadowsOn } from '../src/app/settings'
import { createTrickFeed } from '../src/app/tricks'
import type { TrickEvent } from '../src/sim'
import { KICKERS, approachAim, featureAhead, type PlacedFeature } from '../src/world/park'
import type { Resort } from '../src/world/resort'

describe('official run spellings', () => {
  it('renames OSM spellings and still applies difficulty fixes', () => {
    const run = (name: string, difficulty = 'easy') => ({ id: name, name, difficulty, groomed: true, kind: 'line', parts: [] })
    const resort = { runs: [run('Dude ney Trail'), run('Grommit', 'expert'), run('97', 'advanced'), run('Upper Wishbone')], peaks: [] } as unknown as Resort
    applyCorrections(resort)
    expect(resort.runs.map((r) => r.name)).toEqual(['Dude-Ney Trail', 'Gromit', 'Highway 97', 'Wishbone'])
    expect(resort.runs[3].difficulty).toBe('intermediate')
  })

  it('carries saved medals, bests and coverage across a rename', () => {
    const progress = emptyProgress()
    progress.medals = { 'time:Grommit': 'gold', 'slalom:Little Joe': 'silver' }
    progress.bests = { 'time:Grommit': 41.5 }
    progress.covered = { 'Dude ney Trail': 900 }
    renameRuns(progress)
    expect(progress.medals).toEqual({ 'time:Gromit': 'gold', 'slalom:Little Joe': 'silver' })
    expect(progress.bests).toEqual({ 'time:Gromit': 41.5 })
    expect(progress.covered).toEqual({ 'Dude-Ney Trail': 900 })
  })
})

describe('shadows', () => {
  it('auto is off on Low and on elsewhere; on and off override', () => {
    const auto = { ...DEFAULT_SETTINGS }
    expect(shadowsOn(auto, QUALITY.low)).toBe(false)
    expect(shadowsOn(auto, QUALITY.medium)).toBe(true)
    expect(shadowsOn(auto, QUALITY.high)).toBe(true)
    expect(shadowsOn({ ...auto, shadows: 'on' }, QUALITY.low)).toBe(true)
    expect(shadowsOn({ ...auto, shadows: 'off' }, QUALITY.high)).toBe(false)
  })
})

describe('terrain park feedback', () => {
  it('keeps the distance cue through the ramp until the rider passes the lip', () => {
    const jump: PlacedFeature = { spec: KICKERS.S, x: 0, z: 100, dirX: 0, dirZ: 1, footprint: 30, halfWidth: 2.5 }
    const approach = featureAhead([jump], 0, 99, 0, 1)!
    const onRamp = featureAhead([jump], 0, 101, 0, 1)!
    expect(onRamp.feature).toBe(jump)
    expect(onRamp.distance).toBeCloseTo(approach.distance - 2)
    expect(featureAhead([jump], 0, 128, 0, 1)).toBeNull()
    expect(featureAhead([jump], 12, 101, 0, 1)).toBeNull()
    const aim = approachAim([jump], [], 0, 99, 0, 1, 40)
    expect(aim?.kind).toBe('jump')
    expect(aim!.distance).toBeGreaterThan(0)
    const rail: PlacedFeature = {
      spec: { kind: 'rail', label: 'Flat rail', height: 0.8, length: 7, width: 0.08 },
      x: 0,
      z: 120,
      dirX: 0,
      dirZ: 1,
      footprint: 7,
      halfWidth: 3,
    }
    expect(approachAim([rail], [], 0, 100, 0, 1, 40)?.kind).toBe('rail')
  })

  it('shows both speed limits as on pace and asks riders to steer against the lean', () => {
    expect([19, 20, 30, 31].map((speed) => parkSpeedCue(speed, 20, 30))).toEqual(['Build speed', 'On pace', 'On pace', 'Scrub speed'])
    expect(railCue(0)).toEqual({ position: 50, label: 'Centred', tone: 'ready' })
    expect(railCue(-2)).toEqual({ position: 0, label: 'Steer right', tone: 'danger' })
    expect(railCue(0.6)).toEqual({ position: 80, label: 'Steer left', tone: 'caution' })
  })

  it('counts each event once and accepts the same sequence number after a restart', () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() })
    vi.stubGlobal('navigator', {})
    try {
      const popup = { className: '', innerHTML: '' } as HTMLElement
      const feed = createTrickFeed(popup)
      const air: TrickEvent = {
        seq: 1, kind: 'air', name: '360', points: 280, grade: 'perfect', efh: 0.4, airTime: 1,
        spinDeg: 360, flips: 0, grab: null, grabTime: 0, switchLanding: false, railMetres: 0,
      }
      expect(feed.onTrick(air)).toBe(true)
      expect(feed.onTrick(air)).toBe(false)
      feed.onTrick({ ...air, seq: 2, kind: 'rail', name: '50/50', grade: 'clean', points: 110, railMetres: 6 })
      expect(feed.stats).toMatchObject({ perfect: 1, clean: 0, railMetres: 6, bestName: '360', bestPoints: 280 })
      feed.resetTotal()
      expect(feed.total).toBe(0)
      expect(popup.className).toBe('')
      expect(feed.onTrick({ ...air, grade: 'clean' })).toBe(true)
      expect(feed.stats).toMatchObject({ perfect: 0, clean: 1, railMetres: 0, bestName: '360', bestPoints: 280 })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
