#!/usr/bin/env node
/**
 * Time a song's known lyrics from a Whisper transcript.
 *
 *   node tools/lyrics/align.mjs <transcript.srt> <lyrics.txt> <out.lyrics.json>
 *
 * Make the transcript with ffmpeg's whisper filter (whisper.cpp), for example
 * from the folder that holds ggml-base.en.bin:
 *
 *   ffmpeg -i song.mp3 -vn -af "whisper=model=ggml-base.en.bin:language=en:queue=3:destination=song.srt:format=srt" -f null -
 *
 * Whisper only times ~3 s segments, so each recognised word gets a time spread
 * across its segment by character position. The lyric words are then matched to
 * the recognised words with a global alignment (fuzzy word similarity), and each
 * lyric line starts at its first word's time. Words Whisper missed are
 * interpolated from their neighbours. One line of `lyrics.txt` is one shown line.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [srtPath, textPath, outPath] = process.argv.slice(2)
if (!srtPath || !textPath || !outPath) {
  console.error('Usage: node tools/lyrics/align.mjs <transcript.srt> <lyrics.txt> <out.lyrics.json>')
  process.exit(1)
}

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')
const toSeconds = (s) => {
  const [h, m, rest] = s.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(rest.replace(',', '.'))
}

/** Recognised words with an estimated time each. */
function readTranscript(path) {
  const words = []
  for (const block of readFileSync(path, 'utf8').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n')
    const timing = lines.find((l) => l.includes('-->'))
    if (!timing) continue
    const [a, b] = timing.split('-->').map((s) => toSeconds(s.trim()))
    // Drop sound tags like [MUSIC] and (upbeat music); keep sung text.
    const text = lines.slice(lines.indexOf(timing) + 1).join(' ').replace(/\[[^\]]*\]|\([^)]*\)|♪/g, ' ').trim()
    if (!text) continue
    const raw = text.split(/\s+/)
    const total = raw.reduce((n, w) => n + w.length + 1, 0)
    let at = 0
    for (const w of raw) {
      const key = norm(w)
      if (key) words.push({ key, t: a + ((b - a) * at) / total })
      at += w.length + 1
    }
  }
  // Segments overlap slightly; keep times non-decreasing.
  for (let i = 1; i < words.length; i++) words[i].t = Math.max(words[i].t, words[i - 1].t)
  return words
}

/** Similarity 0..1 from edit distance. */
function similar(a, b) {
  if (a === b) return 1
  const m = a.length, n = b.length
  if (!m || !n) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const row = [i]
    for (let j = 1; j <= n; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = row
  }
  return 1 - prev[n] / Math.max(m, n)
}

/** Global alignment of lyric words to heard words; returns heard index per lyric word or -1. */
function align(lyric, heard) {
  const GAP = -0.5
  const n = lyric.length, m = heard.length
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  for (let i = 1; i <= n; i++) { score[i][0] = i * GAP; move[i][0] = 1 }
  // Skipping heard words (mishears, ad-libs) costs little.
  for (let j = 1; j <= m; j++) { score[0][j] = j * GAP * 0.4; move[0][j] = 2 }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similar(lyric[i - 1].key, heard[j - 1].key)
      const diag = score[i - 1][j - 1] + (s >= 0.5 ? 2 * s : -1)
      const up = score[i - 1][j] + GAP
      const left = score[i][j - 1] + GAP * 0.4
      if (diag >= up && diag >= left) { score[i][j] = diag; move[i][j] = 0 }
      else if (up >= left) { score[i][j] = up; move[i][j] = 1 }
      else { score[i][j] = left; move[i][j] = 2 }
    }
  }
  const match = new Array(n).fill(-1)
  let i = n, j = m
  while (i > 0 || j > 0) {
    const mv = move[i][j]
    if (i > 0 && j > 0 && mv === 0) {
      if (similar(lyric[i - 1].key, heard[j - 1].key) >= 0.5) match[i - 1] = j - 1
      i--; j--
    } else if (i > 0 && (j === 0 || mv === 1)) i--
    else j--
  }
  return match
}

const heard = readTranscript(srtPath)
const textLines = readFileSync(textPath, 'utf8').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
const lyric = []
textLines.forEach((line, li) => {
  for (const w of line.split(/\s+/)) {
    const key = norm(w)
    if (key) lyric.push({ key, line: li })
  }
})

const match = align(lyric, heard)
const times = match.map((j) => (j >= 0 ? heard[j].t : null))
const matched = times.filter((t) => t !== null).length
if (matched < lyric.length * 0.3) {
  console.error(`${textPath}: only ${matched} of ${lyric.length} words matched; time this song by hand.`)
  process.exit(2)
}
// Fill gaps by interpolating between matched neighbours (or extrapolating at ~0.3 s per word).
for (let k = 0; k < times.length; k++) {
  if (times[k] !== null) continue
  let a = k - 1
  while (a >= 0 && times[a] === null) a--
  let b = k + 1
  while (b < times.length && times[b] === null) b++
  const ta = a >= 0 ? times[a] : null
  const tb = b < times.length ? times[b] : null
  if (ta !== null && tb !== null) times[k] = ta + ((tb - ta) * (k - a)) / (b - a)
  else if (ta !== null) times[k] = ta + 0.3 * (k - a)
  else times[k] = tb - 0.3 * (b - k)
}
for (let k = 1; k < times.length; k++) times[k] = Math.max(times[k], times[k - 1])

const round = (t) => Math.round(t * 100) / 100
const lines = textLines.map((text, li) => {
  const idx = lyric.map((w, k) => (w.line === li ? k : -1)).filter((k) => k >= 0)
  const first = times[idx[0]], last = times[idx[idx.length - 1]]
  return { t: Math.max(0, first - 0.15), lastWord: last, text, words: idx.length, heard: idx.filter((k) => match[k] >= 0).length }
})
const out = lines.map((line, li) => {
  const next = lines[li + 1]
  // Hold the line through its last word, then up to 1.2 s more, never past the next line.
  let end = Math.max(line.t + 0.8, line.lastWord + 0.5 + Math.min(1.2, (line.lastWord - line.t) * 0.3))
  if (next) end = Math.min(end, next.t)
  if (end <= line.t) end = line.t + 0.3
  return { t: round(line.t), end: round(end), text: line.text }
})
writeFileSync(outPath, `${JSON.stringify({ lines: out }, null, 2)}\n`)
console.log(`${outPath}: ${out.length} lines, ${matched}/${lyric.length} words heard`)
for (const [li, line] of lines.entries()) if (line.heard < line.words / 2) console.log(`  check line ${li + 1} (${line.heard}/${line.words} heard): ${line.text}`)
