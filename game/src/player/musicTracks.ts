import { parseLyrics, type LyricLine } from './lyrics'
import type { MusicMood } from './musicState'
import { createPlaylist, type Playlist } from './radio'

/** One entry of `public/audio/music/tracks.json`. */
export interface MusicTrack {
  file: string
  title: string
  artist: string
  author: string
  licence: string
  url: string
  /** `score` plays in the adaptive Tracks source, `radio` on the radio. */
  kind: 'score' | 'radio'
  /** Moods a score track suits; the next score track prefers the current mood. */
  moods?: MusicMood[]
  /** Timed lyrics beside the file, for example `radio/yard-sale.lyrics.json`. */
  lyrics?: string
}

export interface NowPlaying {
  /** The bundled file, or null for the synth. */
  file: string | null
  title: string
  artist: string
  /** 1-based position in the list, and the list length. */
  number: number
  count: number
  time: number
  duration: number
  paused: boolean
  lyrics: LyricLine[] | null
}

const BASE = 'audio/music/'

/** Read the manifest; bad entries are dropped with a warning naming them. */
export function readManifest(json: unknown): MusicTrack[] {
  const list = (json as { tracks?: unknown[] } | null)?.tracks
  if (!Array.isArray(list)) return []
  return list.filter((t): t is MusicTrack => {
    const ok = !!t && typeof (t as MusicTrack).file === 'string' && typeof (t as MusicTrack).title === 'string'
    if (!ok) console.warn('Music: skipping a track entry without file and title.', t)
    return ok
  }).map((t) => ({ ...t, kind: t.kind === 'radio' ? 'radio' : 'score', artist: t.artist || t.author || '' }))
}

/**
 * Plays a list of bundled tracks through one `<audio>` element wired into the
 * music bus. Radio lists shuffle; score lists play in order but prefer a track
 * that suits the current mood. Lyrics load lazily per track.
 */
export function createTrackPlayer(ctx: AudioContext, bus: AudioNode, onChange: () => void) {
  const audio = new Audio()
  audio.preload = 'none'
  ctx.createMediaElementSource(audio).connect(bus)
  let list: MusicTrack[] = []
  let playlist: Playlist | null = null
  let active = false
  let paused = false
  let mood: MusicMood = 'ambient'
  const lyricCache = new Map<string, LyricLine[] | null>()

  const current = (): MusicTrack | null => (playlist ? list[playlist.current] : null)

  const loadLyrics = (track: MusicTrack) => {
    if (!track.lyrics || lyricCache.has(track.lyrics)) return
    const path = track.lyrics
    lyricCache.set(path, null)
    void fetch(BASE + path)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => lyricCache.set(path, parseLyrics(json, path)))
      .catch((error: unknown) => console.warn(`Music: no lyrics for ${track.title} (${path}).`, error))
  }

  const start = (restart: boolean) => {
    const track = current()
    if (!track || !active) return
    const url = BASE + track.file
    if (!audio.src.endsWith(url)) audio.src = url
    else if (restart) audio.currentTime = 0
    loadLyrics(track)
    onChange()
    if (paused) return
    void audio.play().catch((error: unknown) => console.warn(`Music: playback of ${track.title} was refused.`, error))
  }

  /** On a score list, skip ahead to a track that suits the mood, if any does. */
  const nextForMood = () => {
    if (!playlist) return
    const kind = list[0]?.kind
    for (let i = 0; i < list.length; i++) {
      const index = playlist.next()
      if (kind === 'radio' || !list[index].moods || list[index].moods!.includes(mood)) return
    }
  }

  audio.addEventListener('ended', () => {
    nextForMood()
    start(true)
  })
  audio.addEventListener('error', () => console.warn(`Music: could not play ${audio.src}`))

  return {
    /** Swap the list (radio or score). Keeps playing if the list is the same. */
    setList(tracks: MusicTrack[]) {
      const same = tracks.length === list.length && tracks.every((t, i) => t.file === list[i]?.file)
      if (same && playlist) return
      list = tracks
      playlist = tracks.length ? createPlaylist(tracks.length, { shuffle: tracks[0].kind === 'radio' }) : null
      if (active) start(true)
    },
    get hasTracks() {
      return list.length > 0
    },
    /** Start or stop output (switching sources stops it). */
    setActive(value: boolean) {
      active = value
      if (active) start(false)
      else audio.pause()
    },
    setMood(value: MusicMood) {
      mood = value
    },
    setPaused(value: boolean) {
      paused = value
      if (paused) audio.pause()
      else if (active) start(false)
      onChange()
    },
    /** Play a file in the current list (from the song list). */
    select(file: string) {
      const index = list.findIndex((t) => t.file === file)
      if (!playlist || index < 0) {
        console.warn(`Music: ${file} is not in the playing list.`)
        return
      }
      playlist.select(index)
      start(true)
    },
    next() {
      if (!playlist) return
      playlist.next()
      start(true)
    },
    prev() {
      if (!playlist) return
      const { restart } = playlist.prev(audio.currentTime)
      if (restart) audio.currentTime = 0
      start(true)
    },
    /** Pause while the tab is hidden without changing the user's pause. */
    suspend() {
      audio.pause()
    },
    nowPlaying(): NowPlaying | null {
      const track = current()
      if (!track || !playlist) return null
      return {
        file: track.file,
        title: track.title,
        artist: track.artist,
        number: playlist.current + 1,
        count: list.length,
        time: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        paused: paused || audio.paused,
        lyrics: track.lyrics ? lyricCache.get(track.lyrics) ?? null : null,
      }
    },
  }
}

export type TrackPlayer = ReturnType<typeof createTrackPlayer>
