import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lyricAt, parseLyrics, syllables, wordFills } from '../src/player/lyrics'
import { libraryOf, songsFor, SYNTH_SONGS } from '../src/player/musicLibrary'
import { readManifest } from '../src/player/musicTracks'

const MUSIC = new URL('../public/audio/music/', import.meta.url)

describe('bundled tracks and lyrics', () => {
  const tracks = readManifest(JSON.parse(readFileSync(new URL('tracks.json', MUSIC), 'utf8')))

  it('every manifest entry points at a file that exists', () => {
    expect(tracks.length).toBeGreaterThan(0)
    for (const t of tracks) expect(existsSync(new URL(t.file, MUSIC)), t.file).toBe(true)
  })

  it('radio playlists split the songs by lyrics', () => {
    const all = songsFor(tracks, 'radio', 'all')
    const vocal = songsFor(tracks, 'radio', 'vocal')
    const instrumental = songsFor(tracks, 'radio', 'instrumental')
    expect(all.length).toBe(tracks.length)
    expect(vocal.every((t) => t.lyrics)).toBe(true)
    expect(instrumental.every((t) => !t.lyrics)).toBe(true)
    expect(vocal.length + instrumental.length).toBe(all.length)
    expect(instrumental.map((t) => t.title)).toEqual(['First Chair', 'Cold Smoke', 'Black Diamond', 'Happy Synths', 'Funked Up'])
    // The adaptive Tracks source keeps only the score.
    expect(songsFor(tracks, 'tracks', 'all').every((t) => t.kind === 'score')).toBe(true)
    expect(songsFor(tracks, 'procedural', 'all')).toEqual([])
  })

  it('the song list has every bundled file and four distinct synth songs', () => {
    const library = libraryOf(tracks)
    expect(library.filter((s) => !s.id.startsWith('synth:')).map((s) => s.id)).toEqual(tracks.map((t) => t.file))
    const synths = library.filter((s) => s.id.startsWith('synth:'))
    expect(synths.map((s) => s.title)).toEqual(SYNTH_SONGS.map((s) => s.title))
    // Each named synth song is a different key, mode or tempo.
    expect(new Set(synths.map((s) => s.artist)).size).toBe(synths.length)
  })

  it('every bundled CC0 song names its source page and licence', () => {
    for (const t of tracks.filter((t) => t.file.startsWith('cc0/'))) {
      expect(t.licence, t.title).toBe('CC0 1.0')
      expect(t.url, t.title).toMatch(/^https:\/\/opengameart\.org\/content\//)
    }
  })

  it('every song with lyrics has lyrics that parse, start after 0 and do not overlap', () => {
    const radio = tracks.filter((t) => t.lyrics)
    expect(radio.length).toBe(6)
    for (const t of radio) {
      const lines = parseLyrics(JSON.parse(readFileSync(new URL(t.lyrics!, MUSIC), 'utf8')), t.lyrics)
      expect(lines.length, t.title).toBeGreaterThan(0)
      // Songs are 75 s long; a line past that would never show.
      for (const line of lines) expect(line.end, `${t.title}: ${line.text}`).toBeLessThanOrEqual(76)
      for (let i = 1; i < lines.length; i++) expect(lines[i].t, `${t.title} line ${i}`).toBeGreaterThanOrEqual(lines[i - 1].end - 1e-6)
    }
  })
})

const lines = parseLyrics({
  lines: [
    { t: 2, end: 5, text: 'Oh I caught an edge' },
    { t: 5, end: 8, text: 'on the top of the hill' },
    { t: 10, end: 14, text: 'Yard sale haul away' },
  ],
})

describe('lyricAt', () => {
  it('finds the line being sung', () => {
    expect(lyricAt(lines, 3).index).toBe(0)
    expect(lyricAt(lines, 5).index).toBe(1)
    expect(lyricAt(lines, 12).line?.text).toBe('Yard sale haul away')
  })

  it('shows nothing in a gap but names the next line', () => {
    const gap = lyricAt(lines, 9)
    expect(gap.index).toBe(-1)
    expect(gap.line).toBeNull()
    expect(gap.next?.text).toBe('Yard sale haul away')
    expect(lyricAt(lines, 0).next?.t).toBe(2)
  })

  it('shows nothing after the last line', () => {
    const after = lyricAt(lines, 20)
    expect(after.index).toBe(-1)
    expect(after.next).toBeNull()
  })

  it('fills words from 0 at the start to 1 near the end, never going backwards', () => {
    const start = lyricAt(lines, 10).words
    expect(start.every((w) => w.fill === 0)).toBe(true)
    const end = lyricAt(lines, 13.9).words
    expect(end.every((w) => w.fill === 1)).toBe(true)
    let prev = -1
    for (let t = 10; t < 14; t += 0.1) {
      const total = lyricAt(lines, t).words.reduce((a, w) => a + w.fill, 0)
      expect(total).toBeGreaterThanOrEqual(prev)
      prev = total
    }
  })
})

describe('wordFills and syllables', () => {
  it('weights longer words more', () => {
    expect(syllables('mountain')).toBe(2)
    expect(syllables('snow')).toBe(1)
    // Halfway through "snow mountain" (3 syllables), "snow" is full and "mountain" a quarter.
    const fills = wordFills('snow mountain', 0.5)
    expect(fills[0].fill).toBe(1)
    expect(fills[1].fill).toBeCloseTo(0.25)
  })
})

describe('parseLyrics', () => {
  it('rejects bad timing and empty text with the line number', () => {
    expect(() => parseLyrics({ lines: [{ t: 3, end: 2, text: 'x' }] })).toThrow(/line 0/)
    expect(() => parseLyrics({ lines: [{ t: 1, end: 2, text: ' ' }] })).toThrow(/no text/)
    expect(() => parseLyrics({})).toThrow(/expected/)
  })

  it('sorts lines by start time', () => {
    const sorted = parseLyrics({ lines: [{ t: 5, end: 6, text: 'b' }, { t: 1, end: 2, text: 'a' }] })
    expect(sorted.map((l) => l.text)).toEqual(['a', 'b'])
  })
})
