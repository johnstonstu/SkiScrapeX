/**
 * Timed lyrics. Each song has `radio/<name>.lyrics.json` with one entry per
 * sung line (start and end in seconds). Words are not timed: the fill across a
 * line is spread by syllable count, which reads close enough to the singing.
 */

export interface LyricLine {
  /** Seconds from the start of the song. */
  t: number
  /** Seconds when the line stops being shown. */
  end: number
  text: string
}

export interface LyricsFile {
  lines: LyricLine[]
}

export interface LyricState {
  /** Index of the line being sung, or -1 in a gap. */
  index: number
  line: LyricLine | null
  /** The line after the current one (or the next to come in a gap). */
  next: LyricLine | null
  /** 0..1 across each word of the active line; empty in a gap. */
  words: { text: string; fill: number }[]
}

/** Check and sort a parsed lyrics file. Throws with the reason on bad data. */
export function parseLyrics(json: unknown, source = 'lyrics'): LyricLine[] {
  const lines = (json as LyricsFile | null)?.lines
  if (!Array.isArray(lines)) throw new Error(`${source}: expected { lines: [...] }`)
  const out: LyricLine[] = []
  lines.forEach((raw, i) => {
    const { t, end, text } = raw ?? {}
    if (typeof t !== 'number' || typeof end !== 'number' || !Number.isFinite(t) || !Number.isFinite(end) || end <= t) {
      throw new Error(`${source}: line ${i} needs numeric t < end, got t=${t} end=${end}`)
    }
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${source}: line ${i} has no text`)
    out.push({ t, end, text: text.trim() })
  })
  return out.sort((a, b) => a.t - b.t)
}

/** Rough English syllable count, at least 1. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 1
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g)
  return Math.max(1, groups ? groups.length : 1)
}

/** Fill per word of `text` at fraction `p` (0..1) through the line. */
export function wordFills(text: string, p: number): { text: string; fill: number }[] {
  const words = text.split(/\s+/).filter(Boolean)
  const weights = words.map(syllables)
  const total = weights.reduce((a, b) => a + b, 0)
  const at = Math.max(0, Math.min(1, p)) * total
  let start = 0
  return words.map((word, i) => {
    const fill = Math.max(0, Math.min(1, (at - start) / weights[i]))
    start += weights[i]
    return { text: word, fill }
  })
}

/** What to show at `time` seconds into the song. */
export function lyricAt(lines: LyricLine[], time: number): LyricState {
  let index = -1
  let next: LyricLine | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (time >= line.t && time < line.end) {
      index = i
      next = lines[i + 1] ?? null
      break
    }
    if (line.t > time) {
      next = line
      break
    }
  }
  if (index < 0) return { index, line: null, next, words: [] }
  const line = lines[index]
  // The fill completes a little before the line ends, so the last word lands on the beat.
  const singing = Math.max(0.01, (line.end - line.t) * 0.92)
  return { index, line, next, words: wordFills(line.text, (time - line.t) / singing) }
}
