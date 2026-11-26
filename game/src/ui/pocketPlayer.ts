import { lyricAt, type LyricState } from '../player/lyrics'
import { RADIO_MIXES, type LibraryEntry, type Music, type RadioMix } from '../player/music'
import './pocketPlayer.css'

/** What the game tells the player each frame. */
export interface PocketFrame {
  /** On a chair, T-bar or carpet: lyrics move beside the rider's head. */
  riding: boolean
  /** The rider's eye point on screen in CSS pixels, or null when behind the camera or in first person. */
  head: { x: number; y: number } | null
  /** Menus, the title, the tutorial: hide the lyrics. */
  hideLyrics: boolean
  lyricsOn: boolean
}

const PEEK_MS = 4200

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement, text?: string) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  parent?.appendChild(node)
  return node
}

/**
 * Chair 9 FM: a pocket MP3 player that slides up from the corner (P, the ♪
 * button, or R3), with previous, play/pause and next, a playlist switch
 * (shuffle all, sing-along, instrumental), a lyrics toggle, and the current
 * lyric line on its screen. It also draws the sing-along line
 * low on screen and, on lifts, a bubble beside the rider's head.
 */
export function createPocketPlayer(music: Music, options: { onMix: (mix: RadioMix) => void; onLyrics: (on: boolean) => void; onPick: (song: LibraryEntry) => void }) {
  const root = el('aside', 'pocket')
  root.setAttribute('aria-label', 'Music player')
  root.setAttribute('aria-hidden', 'true')
  const body = el('div', 'pocket-body', root)
  el('span', 'pocket-grip', body)
  const screen = el('div', 'pocket-screen', body)
  const top = el('div', 'pocket-top', screen)
  el('span', 'pocket-station', top, 'CHAIR 9 FM')
  const count = el('span', 'pocket-count', top)
  const title = el('strong', 'pocket-title', screen)
  const artist = el('span', 'pocket-artist', screen)
  const bar = el('div', 'pocket-bar', screen)
  const barFill = el('i', '', bar)
  const times = el('div', 'pocket-times', screen)
  const elapsed = el('span', '', times)
  const total = el('span', '', times)
  const screenLyric = el('p', 'pocket-lyric', screen)
  // The song list takes the screen's place while it is open.
  const listView = el('ol', 'pocket-list', body)
  listView.hidden = true

  const modes = el('div', 'pocket-modes', body)
  // One button cycles the playlist; picking one also switches the music to the radio.
  const mixButton = el('button', 'pocket-src pocket-mix', modes)
  mixButton.type = 'button'
  mixButton.addEventListener('click', () => {
    const at = RADIO_MIXES.findIndex((m) => m.id === music.mix)
    options.onMix(music.source === 'radio' ? RADIO_MIXES[(at + 1) % RADIO_MIXES.length].id : music.mix)
  })
  const lyricsButton = el('button', 'pocket-src', modes)
  lyricsButton.type = 'button'
  let lyricsOn = true
  lyricsButton.addEventListener('click', () => options.onLyrics(!lyricsOn))
  const listButton = el('button', 'pocket-src', modes, '☰ Songs')
  listButton.type = 'button'
  listButton.setAttribute('aria-pressed', 'false')
  let listOpen = false
  let listShown = ''

  /** Every song as a row; the playing one is marked. Rebuilt only when the list or the song changes. */
  const renderList = () => {
    const songs = music.library()
    const np = music.nowPlaying()
    const current = np?.file ?? (np && np.source === 'procedural' ? `synth-title:${np.title}` : '')
    const key = `${songs?.length ?? 'loading'}|${current}`
    if (key === listShown) return
    listShown = key
    if (!songs) {
      listView.replaceChildren(el('li', 'pocket-list-note', undefined, 'Loading songs…'))
      return
    }
    listView.replaceChildren(
      ...songs.map((song) => {
        const row = el('li', '')
        const b = el('button', 'pocket-song', row)
        b.type = 'button'
        el('strong', '', b, song.title)
        el('small', '', b, `${song.artist}${song.lyrics ? ' · ♪ lyrics' : ''}`)
        const playing = song.id === current || `synth-title:${song.title}` === current
        b.setAttribute('aria-current', String(playing))
        b.addEventListener('click', () => {
          options.onPick(song)
          setList(false)
        })
        return row
      }),
    )
    ;(listView.querySelector('[aria-current="true"]') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' })
  }
  const setList = (value: boolean) => {
    listOpen = value
    listView.hidden = !listOpen
    screen.hidden = listOpen
    listButton.setAttribute('aria-pressed', String(listOpen))
    listButton.textContent = listOpen ? '✕ Close' : '☰ Songs'
    listShown = ''
    if (listOpen) renderList()
  }
  listButton.addEventListener('click', () => setList(!listOpen))
  const keys = el('div', 'pocket-keys', body)
  const key = (label: string, aria: string, fn: () => void) => {
    const b = el('button', 'pocket-key', keys, label)
    b.type = 'button'
    b.setAttribute('aria-label', aria)
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      fn()
    })
    return b
  }
  key('⏮', 'Previous song', () => music.prev())
  const play = key('⏯', 'Play or pause', () => music.togglePause())
  key('⏭', 'Next song', () => music.next())
  el('small', 'pocket-hint', body, 'P close · [ ] skip · ☰ pick a song')

  const peek = el('div', 'pocket-peek')
  const line = el('div', 'sing-line')
  const lineNow = el('p', 'sing-now', line)
  const lineNext = el('p', 'sing-next', line)
  const bubble = el('div', 'sing-bubble')
  const bubbleText = el('span', '', bubble)
  document.body.append(root, peek, line, bubble)

  let open = false
  let lastTitle = ''
  let peekTimer = 0
  let shownIndex = -2
  let shownLyricKey = ''

  const showPeek = (text: string) => {
    peek.textContent = `♪ ${text}`
    peek.classList.add('on')
    window.clearTimeout(peekTimer)
    peekTimer = window.setTimeout(() => peek.classList.remove('on'), PEEK_MS)
  }

  music.onChange(() => {
    const np = music.nowPlaying()
    if (!np) return
    if (np.title !== lastTitle) {
      if (lastTitle && !open) showPeek(`${np.title} · ${np.artist}`)
      lastTitle = np.title
    }
  })

  /** Render words with their fill, only rebuilding spans when the line changes. */
  const renderWords = (target: HTMLElement, state: LyricState, key: string) => {
    if (target.dataset.key !== key) {
      target.dataset.key = key
      target.replaceChildren(...state.words.map((w) => el('span', 'w', undefined, w.text)))
    }
    const spans = target.children
    state.words.forEach((w, i) => (spans[i] as HTMLElement | undefined)?.style.setProperty('--f', w.fill.toFixed(3)))
  }

  return {
    get open() {
      return open
    },
    toggle(value = !open) {
      open = value
      root.classList.toggle('on', open)
      root.setAttribute('aria-hidden', String(!open))
      if (open) peek.classList.remove('on')
      else setList(false)
    },
    /** Per frame: the screen, the progress bar and the lyrics. */
    update(frame: PocketFrame) {
      const np = music.nowPlaying()
      const source = music.source
      lyricsOn = frame.lyricsOn
      if (open) {
        const mixLabel = source === 'radio' ? RADIO_MIXES.find((m) => m.id === music.mix)?.label ?? '' : source === 'tracks' ? 'Adaptive' : 'Synth'
        if (mixButton.textContent !== `⇄ ${mixLabel}`) mixButton.textContent = `⇄ ${mixLabel}`
        mixButton.setAttribute('aria-pressed', String(source === 'radio'))
        lyricsButton.textContent = `Lyrics ${lyricsOn ? 'on' : 'off'}`
        lyricsButton.setAttribute('aria-pressed', String(lyricsOn))
        if (listOpen) renderList()
        title.textContent = np?.title ?? (source === 'procedural' ? 'Synth' : 'Loading…')
        artist.textContent = np?.artist ?? ''
        count.textContent = np && np.count > 1 ? `${np.number} / ${np.count}` : ''
        const p = np && np.duration > 0 ? np.time / np.duration : 0
        barFill.style.transform = `scaleX(${p.toFixed(4)})`
        elapsed.textContent = np?.duration ? fmt(np.time) : ''
        total.textContent = np?.duration ? `-${fmt(np.duration - np.time)}` : ''
        play.classList.toggle('paused', Boolean(np?.paused))
      }
      const state = np?.lyrics && !np.paused ? lyricAt(np.lyrics, np.time) : null
      const sing = Boolean(state?.line) && frame.lyricsOn && !frame.hideLyrics
      const key = `${np?.title}:${state?.index}`
      if (key !== shownLyricKey) {
        shownLyricKey = key
        screenLyric.textContent = state?.line?.text ?? (np?.lyrics ? '♪' : '')
      }
      const inBubble = sing && frame.riding && frame.head !== null
      line.classList.toggle('on', sing && !inBubble)
      bubble.classList.toggle('on', inBubble)
      if (!sing || !state) {
        shownIndex = -2
        return
      }
      if (inBubble) {
        renderWords(bubbleText, state, key)
        // Beside the ear, flipping to the other side (and clamping) when it would leave the screen.
        const w = bubbleText.offsetWidth
        const margin = 8
        let left = frame.head!.x + 20
        if (left + w > window.innerWidth - margin) left = frame.head!.x - 20 - w
        left = Math.max(margin, Math.min(window.innerWidth - margin - w, left))
        bubble.style.transform = `translate(${left.toFixed(1)}px, ${frame.head!.y.toFixed(1)}px)`
      } else {
        renderWords(lineNow, state, key)
        if (shownIndex !== state.index) lineNext.textContent = state.next?.text ?? ''
      }
      shownIndex = state.index
    },
  }
}
