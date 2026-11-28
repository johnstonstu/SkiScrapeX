import { createSkiState, SURFACES, type SurfaceKind } from '../sim'
import { createSfxEngine, type SfxEngine } from '../player/sfx/engine'
import { runScenario, SCENARIOS, type SoundScenario } from './soundScenarios'

/**
 * Sound lab (`sound.html`): hear each game sound on its own. Scripted moments
 * play through the same engine the game uses, and `renderScenario` renders one
 * offline (faster than real time, the same every run) for a recording.
 */
const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const MASTER = 0.6 * 0.8

let ctx: AudioContext | null = null
let engine: SfxEngine | null = null
let stop: (() => void) | null = null

function live(): SfxEngine {
  if (!ctx) {
    ctx = new AudioContext()
    const master = ctx.createGain()
    master.gain.value = MASTER
    master.connect(ctx.destination)
    engine = createSfxEngine(ctx, master)
  }
  void ctx.resume()
  return engine!
}

/** Run `step(seconds since start)` every frame until stopped or `seconds` pass. */
function play(step: (t: number) => void, seconds: number, done: () => void) {
  stop?.()
  const start = performance.now()
  let frame = 0
  const tick = () => {
    const t = (performance.now() - start) / 1000
    if (t > seconds) {
      stop?.()
      return
    }
    step(t)
    frame = requestAnimationFrame(tick)
  }
  stop = () => {
    cancelAnimationFrame(frame)
    stop = null
    // Leave the engine silent: a still skier, nowhere in particular.
    engine?.setScene({ village: 0, forest: 0, alpine: 0, station: 0, wind: 0 })
    engine?.update(createSkiState(), null)
    done()
  }
  tick()
}

const list = $('#scenarios')
for (const scenario of SCENARIOS) {
  const section = document.createElement('section')
  section.innerHTML = `<h2></h2><p></p><div class="row"><button type="button">Play</button><span></span></div>`
  section.querySelector('h2')!.textContent = scenario.title
  section.querySelector('p')!.textContent = scenario.note
  section.querySelector('span')!.textContent = `${Math.round(scenario.seconds)} s`
  const button = section.querySelector('button')!
  button.addEventListener('click', () => {
    if (button.classList.contains('on')) {
      stop?.()
      return
    }
    const step = runScenario(scenario, live())
    button.classList.add('on')
    button.textContent = 'Stop'
    play(step, scenario.seconds, () => {
      button.classList.remove('on')
      button.textContent = 'Play'
    })
  })
  list.append(section)
}

// By hand: sliders straight into the sim state.
const surface = $<HTMLSelectElement>('#hand-surface')
for (const kind of Object.keys(SURFACES) as SurfaceKind[]) surface.add(new Option(kind, kind))
const slider = (id: string, format: (v: number) => string) => {
  const input = $<HTMLInputElement>(id)
  const output = input.parentElement!.querySelector('output')!
  const show = () => (output.textContent = format(Number(input.value)))
  input.addEventListener('input', show)
  show()
  return () => Number(input.value)
}
const speed = slider('#hand-speed', (v) => `${v} km/h`)
const edge = slider('#hand-edge', (v) => `${v}°`)
const skid = slider('#hand-skid', (v) => `${v}%`)
const chatter = slider('#hand-chatter', (v) => `${v}%`)
const sink = slider('#hand-sink', (v) => `${v} cm`)
const toggle = (id: string) => {
  const button = $<HTMLButtonElement>(id)
  button.addEventListener('click', () => button.classList.toggle('on'))
  return () => button.classList.contains('on')
}
const air = toggle('#hand-air')
const tuck = toggle('#hand-tuck')
const handPlay = $<HTMLButtonElement>('#hand-play')
handPlay.addEventListener('click', () => {
  if (handPlay.classList.contains('on')) {
    stop?.()
    return
  }
  const target = live()
  target.reset()
  handPlay.classList.add('on')
  handPlay.textContent = 'Stop'
  play(
    () => {
      const state = createSkiState()
      const edgeRad = (edge() * Math.PI) / 180
      Object.assign(state, {
        speed: speed() / 3.6,
        grounded: !air(),
        tuck: tuck(),
        mode: air() ? 'air' : 'carving',
        surface: SURFACES[surface.value as SurfaceKind],
        edgeAngle: edgeRad,
        skid: skid() / 100,
        chatter: chatter() / 100,
        sink: sink() / 100,
        carveLoad: 1 + Math.abs(edgeRad) * 1.6,
      })
      target.update(state, null)
    },
    3600,
    () => {
      handPlay.classList.remove('on')
      handPlay.textContent = 'Play'
    },
  )
})

/** Render a scenario offline at the game's default volume. Returns both channels and the sample rate. */
async function renderScenario(id: string, sampleRate = 44100): Promise<{ sampleRate: number; left: Float32Array; right: Float32Array }> {
  const scenario: SoundScenario | undefined = SCENARIOS.find((s) => s.id === id)
  if (!scenario) throw new Error(`No scenario ${id}`)
  // Deterministic noise, so two renders of one scenario match.
  let seed = 0x2f6e2b1
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const offline = new OfflineAudioContext(2, Math.ceil(scenario.seconds * sampleRate), sampleRate)
  const master = offline.createGain()
  master.gain.value = MASTER
  master.connect(offline.destination)
  const step = runScenario(scenario, createSfxEngine(offline, master, { random }))
  const frames = Math.floor(scenario.seconds * 60)
  for (let i = 1; i < frames; i++) {
    void offline.suspend(i / 60).then(() => {
      step(i / 60)
      void offline.resume()
    })
  }
  step(0)
  const buffer = await offline.startRendering()
  return { sampleRate, left: buffer.getChannelData(0), right: buffer.getChannelData(1) }
}

Object.assign(window, { renderScenario, soundScenarios: SCENARIOS.map(({ id, title, seconds }) => ({ id, title, seconds })) })
