import { createMusicSession } from './musicScore'
import type { MusicTrack } from './musicTracks'

/** What the player can play from: the procedural synth, the adaptive score, or the radio. */
export type MusicSource = 'procedural' | 'tracks' | 'radio'

/** Which songs the radio plays: everything, the sing-along songs, or the instrumentals. */
export type RadioMix = 'all' | 'vocal' | 'instrumental'

export const RADIO_MIXES: { id: RadioMix; label: string }[] = [
  { id: 'all', label: 'Shuffle all' },
  { id: 'vocal', label: 'Sing-along' },
  { id: 'instrumental', label: 'Instrumental' },
]

/** Named procedural songs: fixed seeds for the synth, so they can be picked from the list. */
export const SYNTH_SONGS: { title: string; seed: number }[] = [
  { title: 'Corduroy', seed: 12 },
  { title: 'Tree Well', seed: 7 },
  { title: 'Bluebird', seed: 10 },
  { title: 'Night Groom', seed: 30 },
]

/** One entry of the player's song list. */
export interface LibraryEntry {
  /** A bundled file, or `synth:<seed>`. */
  id: string
  title: string
  artist: string
  lyrics: boolean
}

/** Every song the game has: the bundled files, then the named synth songs. */
export function libraryOf(tracks: MusicTrack[]): LibraryEntry[] {
  return [
    ...tracks.map((t) => ({ id: t.file, title: t.title, artist: t.artist, lyrics: Boolean(t.lyrics) })),
    ...SYNTH_SONGS.map((s) => ({ id: `synth:${s.seed}`, title: s.title, artist: `Synth · ${createMusicSession(s.seed).name}`, lyrics: false })),
  ]
}

/** The songs one source plays from the manifest. */
export function songsFor(tracks: MusicTrack[], source: MusicSource, mix: RadioMix): MusicTrack[] {
  if (source === 'tracks') return tracks.filter((t) => t.kind === 'score')
  if (source !== 'radio') return []
  if (mix === 'vocal') return tracks.filter((t) => t.lyrics)
  if (mix === 'instrumental') return tracks.filter((t) => !t.lyrics)
  return tracks
}

