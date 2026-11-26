import { lyricAt, parseLyrics, type LyricLine } from '../player/lyrics'
import { readManifest, type MusicTrack } from '../player/musicTracks'

/**
 * Lyrics lab (`lyrics.html`, dev server only): play a radio song with its
 * timed lyrics, preview the karaoke fill, and fix timings by tapping Space at
 * the start of each line or nudging lines by 0.1 s. Copy JSON writes nothing;
 * paste it over the song's `.lyrics.json`.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const audio = $<HTMLAudioElement>('audio')
const songSelect = $<HTMLSelectElement>('song')
const list = $<HTMLOListElement>('lines')
const preview = $('preview')
const out = $<HTMLTextAreaElement>('out')
const tapButton = $<HTMLButtonElement>('tapmode')

let tracks: MusicTrack[] = []
let lines: LyricLine[] = []
let selected = 0
let tapAt = 0
let tapping = false
const undo: { index: number; line: LyricLine; prevEnd: number | null }[] = []

const round = (t: number) => Math.round(t * 100) / 100
const json = () => `${JSON.stringify({ lines: lines.map((l) => ({ t: round(l.t), end: round(l.end), text: l.text })) }, null, 2)}\n`

function renderList() {
  list.replaceChildren(
    ...lines.map((line, i) => {
      const li = document.createElement('li')
      li.innerHTML = `<span>${line.t.toFixed(2)}</span><span>${line.end.toFixed(2)}</span><span></span>`
      li.lastElementChild!.textContent = line.text
      li.classList.toggle('sel', i === selected)
      li.classList.toggle('next-tap', tapping && i === tapAt)
      li.addEventListener('click', () => {
        selected = i
        renderList()
      })
      return li
    }),
  )
  out.value = json()
}

async function load(track: MusicTrack) {
  audio.src = `audio/music/${track.file}`
  lines = []
  if (track.lyrics) {
    try {
      const res = await fetch(`audio/music/${track.lyrics}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      lines = parseLyrics(await res.json(), track.lyrics)
    } catch (error) {
      console.error(`Lyrics lab: could not load ${track.lyrics}`, error)
    }
  }
  selected = tapAt = 0
  undo.length = 0
  renderList()
}

function tick() {
  const state = lyricAt(lines, audio.currentTime)
  const key = String(state.index)
  if (preview.dataset.key !== key) {
    preview.dataset.key = key
    preview.replaceChildren(...state.words.map((w) => Object.assign(document.createElement('span'), { className: 'w', textContent: w.text })))
    list.querySelectorAll('li').forEach((li, i) => li.classList.toggle('now', i === state.index))
  }
  state.words.forEach((w, i) => (preview.children[i] as HTMLElement | undefined)?.style.setProperty('--f', String(w.fill)))
  requestAnimationFrame(tick)
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLTextAreaElement) return
  const line = lines[selected]
  if (e.code === 'Space' && tapping) {
    e.preventDefault()
    if (tapAt >= lines.length) return
    const now = audio.currentTime
    const prev = lines[tapAt - 1]
    undo.push({ index: tapAt, line: { ...lines[tapAt] }, prevEnd: prev ? prev.end : null })
    if (prev && (prev.end > now || prev.end <= prev.t)) prev.end = Math.max(prev.t + 0.1, now)
    const cur = lines[tapAt]
    const length = cur.end > cur.t ? cur.end - cur.t : 3
    cur.t = now
    cur.end = now + length
    selected = tapAt
    tapAt++
    renderList()
  } else if (e.code === 'Backspace' && tapping && undo.length) {
    e.preventDefault()
    const last = undo.pop()!
    lines[last.index] = last.line
    if (last.prevEnd !== null) lines[last.index - 1].end = last.prevEnd
    tapAt = last.index
    renderList()
  } else if ((e.code === 'Comma' || e.code === 'Period') && line) {
    const d = e.code === 'Comma' ? -0.1 : 0.1
    if (e.shiftKey) line.end = Math.max(line.t + 0.1, line.end + d)
    else line.t = Math.max(0, Math.min(line.end - 0.1, line.t + d))
    renderList()
  } else if (e.code === 'Enter' && line) {
    audio.currentTime = Math.max(0, line.t - 1)
    void audio.play()
  }
})

tapButton.addEventListener('click', () => {
  tapping = !tapping
  tapAt = selected
  tapButton.textContent = `Tap mode: ${tapping ? 'on' : 'off'}`
  tapButton.setAttribute('aria-pressed', String(tapping))
  tapButton.blur()
  renderList()
})
$('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(json()).catch((error: unknown) => console.error('Lyrics lab: copy failed; select the JSON below instead.', error))
})
$('use-text').addEventListener('click', () => {
  const rows = $<HTMLTextAreaElement>('text').value.split('\n').map((r) => r.trim()).filter(Boolean)
  // Untimed placeholders, spread 3 s apart, to be tapped.
  lines = rows.map((text, i) => ({ t: i * 3, end: i * 3 + 2.9, text }))
  selected = tapAt = 0
  renderList()
})
songSelect.addEventListener('change', () => void load(tracks[Number(songSelect.value)]))

fetch('audio/music/tracks.json')
  .then((res) => res.json())
  .then((data: unknown) => {
    tracks = readManifest(data).filter((t) => t.kind === 'radio')
    songSelect.replaceChildren(...tracks.map((t, i) => new Option(t.title, String(i))))
    const wanted = new URLSearchParams(location.search).get('song')
    const index = Math.max(0, tracks.findIndex((t) => t.file.includes(`${wanted}.`)))
    songSelect.value = String(index)
    if (tracks[index]) void load(tracks[index])
  })
  .catch((error: unknown) => console.error('Lyrics lab: could not read tracks.json', error))
requestAnimationFrame(tick)
