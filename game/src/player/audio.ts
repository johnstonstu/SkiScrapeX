import type { SkiState } from '../sim'

type SampleKind = 'plant' | 'landing' | 'latch'

/** Optional one-shot WAVs under `public/audio/` layered on procedural ticks (missing files = procedural only). */
const SAMPLE_URLS: Record<SampleKind, string> = {
  plant: 'audio/plant.wav',
  landing: 'audio/landing.wav',
  latch: 'audio/latch.wav',
}

/** Procedural ski contact, airflow and lift sounds, unlocked by the first user gesture. */
export function createSkiAudio(button: HTMLButtonElement) {
  let ctx: AudioContext | undefined
  let master: GainNode, contact: GainNode, wind: GainNode, lift: GainNode, hit: GainNode, rail: GainNode, latch: GainNode
  let ambience: GainNode, plant: GainNode
  let snowFilter: BiquadFilterNode, hitFilter: BiquadFilterNode, railFilter: BiquadFilterNode, latchFilter: BiquadFilterNode
  let plantFilter: BiquadFilterNode, windFilter: BiquadFilterNode
  let contactPan: StereoPannerNode, plantPan: StereoPannerNode
  let muted = false
  let paused = false
  let airborne = false, crashed = false
  let descent = 0
  let onRail = false
  let lastTrick = 0
  let lastEdgeSign = 0
  let nextLiftClunk = 0
  let nextFaceShot = 0
  let lastPress: 'none' | 'nose' | 'tail' = 'none'
  let level = 0.8
  const samples: Partial<Record<SampleKind, AudioBuffer>> = {}
  let samplesTried = false
  try { muted = localStorage.getItem('apex.soundMuted') === 'true' } catch { /* Private storage. */ }
  const label = () => {
    button.textContent = muted ? 'Sound · Off' : 'Sound · On'
    button.setAttribute('aria-pressed', String(!muted))
  }
  const volume = () => {
    if (ctx) master.gain.setTargetAtTime(muted || paused || document.hidden ? 0 : 0.575 * level, ctx.currentTime, 0.025)
  }
  const loadSamples = () => {
    if (!ctx || samplesTried) return
    samplesTried = true
    for (const [kind, url] of Object.entries(SAMPLE_URLS) as [SampleKind, string][]) {
      void fetch(url)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject()))
        .then((raw) => ctx!.decodeAudioData(raw))
        .then((buf) => {
          samples[kind] = buf
        })
        .catch(() => {
          /* Procedural-only when the file is missing. */
        })
    }
  }
  const playSample = (kind: SampleKind, time: number, gainLevel: number) => {
    const buf = samples[kind]
    if (!ctx || !buf || !master) return false
    const src = ctx.createBufferSource()
    const g = ctx.createGain()
    g.gain.value = gainLevel
    src.buffer = buf
    src.connect(g).connect(master)
    src.start(time)
    return true
  }
  const unlock = () => {
    if (muted || !window.AudioContext) return
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)
      loadSamples()
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const samples = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      noise.loop = true
      const voice = (source: AudioNode, pan?: StereoPannerNode) => {
        const gain = ctx!.createGain()
        gain.gain.value = 0
        if (pan) source.connect(gain).connect(pan).connect(master)
        else source.connect(gain).connect(master)
        return gain
      }
      const filter = (type: BiquadFilterType, hz: number) => {
        const node = ctx!.createBiquadFilter()
        node.type = type
        node.frequency.value = hz
        noise.connect(node)
        return node
      }
      snowFilter = filter('bandpass', 1450)
      contactPan = ctx.createStereoPanner()
      contact = voice(snowFilter, contactPan)
      windFilter = filter('lowpass', 540)
      wind = voice(windFilter)
      ambience = voice(filter('lowpass', 280))
      hitFilter = filter('lowpass', 370)
      hit = voice(hitFilter)
      railFilter = filter('bandpass', 2150)
      railFilter.Q.value = 2.2
      rail = voice(railFilter)
      latchFilter = filter('bandpass', 3400)
      latchFilter.Q.value = 3
      latch = voice(latchFilter)
      plantFilter = filter('bandpass', 4200)
      plantFilter.Q.value = 4
      plantPan = ctx.createStereoPanner()
      plant = voice(plantFilter, plantPan)
      const motor = ctx.createOscillator()
      motor.type = 'triangle'
      motor.frequency.value = 76
      lift = voice(motor)
      motor.start()
      noise.start()
      volume()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  }
  window.addEventListener('keydown', unlock)
  window.addEventListener('pointerdown', unlock)
  document.addEventListener('visibilitychange', volume)
  button.addEventListener('click', () => {
    muted = !muted
    try { localStorage.setItem('apex.soundMuted', String(muted)) } catch { /* Private storage. */ }
    unlock()
    volume()
    label()
  })
  label()
  return {
    pause(value: boolean) { paused = value; volume() },
    /** 0 to 1, from settings. */
    setVolume(value: number) { level = Math.max(0, Math.min(1, value)); volume() },
    reset() { airborne = crashed = onRail = false; descent = lastTrick = lastEdgeSign = nextLiftClunk = nextFaceShot = 0; lastPress = 'none' },
    /** Soft whoosh when another skier passes close without contact. */
    nearMiss(closing: number) {
      if (!ctx || muted || paused) return
      const t = ctx.currentTime
      const gain = Math.min(1, closing / 8)
      windFilter.frequency.setValueAtTime(880 + gain * 720, t)
      transient(wind, t, 0.12 + gain * 0.22, 0.08)
      transient(hit, t, 0.05 + gain * 0.08, 0.045)
    },
    update(s: SkiState, riding: boolean) {
      if (!ctx) return
      const t = ctx.currentTime
      // Keep rising through tuck top speed (~33 m/s) instead of flattening at 22.
      const speed = Math.min(1, s.speed / 33)
      const loose = Math.min(1, s.surface.depth / 0.45)
      const edge = Math.min(1, Math.abs(s.edgeAngle) + s.skid)
      const railState = !riding && s.rail
      const sliding = !riding && s.grounded && !railState && s.crashed <= 0
      const freshEvent = s.trick && s.trick.seq !== lastTrick ? s.trick : null
      if (freshEvent) lastTrick = freshEvent.seq
      const box = railState && railState.rail.kind === 'box'
      const air = !riding && !s.grounded && !railState
      const pan = Math.max(-0.65, Math.min(0.65, s.edgeAngle * 1.1))
      contactPan.pan.setTargetAtTime(pan, t, 0.08)
      plantPan.pan.setTargetAtTime(pan * 0.85, t, 0.05)
      // Powder sits lower and thicker; packed snow stays brighter.
      snowFilter.frequency.setTargetAtTime(520 + 2480 * (1 - loose) + edge * 1100 - s.sink * 900, t, 0.08)
      contact.gain.setTargetAtTime(
        sliding ? speed * (0.17 + edge * 0.42 + s.sink * 0.72 + loose * 0.12) : 0,
        t,
        0.05,
      )
      // Face-shot whoosh when deep snow is thrown at speed.
      const faceShot = sliding && s.sink > 0.12 && s.speed > 6 ? Math.min(1, s.sink * 2.2 + s.skid * 0.8) * speed : 0
      if (faceShot > 0.35 && t >= nextFaceShot) {
        windFilter.frequency.setValueAtTime(380 + faceShot * 420, t)
        transient(wind, t, 0.22 + faceShot * 0.28, 0.11)
        nextFaceShot = t + 0.28 + Math.random() * 0.35
      }
      // Wind brightens in the air and tightens in a tuck.
      windFilter.frequency.setTargetAtTime(air ? 920 : s.tuck ? 720 : 540, t, 0.18)
      const windGain = 0.015 + speed * speed * (air ? 0.58 : 0.46) + (s.tuck && !air ? 0.04 : 0)
      wind.gain.setTargetAtTime(windGain, t, 0.2)
      ambience.gain.setTargetAtTime(0.018 + speed * 0.04 + (air ? 0.03 : 0), t, 0.35)
      lift.gain.setTargetAtTime(riding ? 0.035 : 0, t, 0.15)
      if (riding && t >= nextLiftClunk) {
        latchFilter.frequency.setValueAtTime(2100 + Math.random() * 900, t)
        transient(latch, t, 0.14 + Math.random() * 0.1, 0.045)
        nextLiftClunk = t + 2.4 + Math.random() * 3.2
      }
      railFilter.frequency.setTargetAtTime((box ? 1180 : 2050) + speed * 940, t, 0.055)
      rail.gain.setTargetAtTime(railState ? 0.10 + speed * 0.24 + Math.abs(railState.balance) * 0.075 : 0, t, 0.035)
      // Same edge-flip rule as the rider plant: a tick when the edge changes side at speed.
      const edgeSign = sliding && Math.abs(s.edgeAngle) > 0.12 ? Math.sign(s.edgeAngle) : 0
      if (edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign && s.speed > 3) {
        plantFilter.frequency.setValueAtTime(3400 + speed * 1100 - loose * 900, t)
        const plantLevel = 0.16 + speed * 0.14
        if (!playSample('plant', t, plantLevel * 0.85)) transient(plant, t, plantLevel, 0.026)
        hitFilter.frequency.setValueAtTime((1500 + edge * 900) * (1 - loose * 0.6), t)
        transient(hit, t, 0.11 + speed * 0.18 + (1 - loose) * 0.12, 0.048)
      }
      if (edgeSign !== 0) lastEdgeSign = edgeSign
      if (railState && !onRail) {
        latchFilter.frequency.setValueAtTime(box ? 1600 : 3900, t)
        const latchLevel = box ? 0.22 : 0.36
        if (!playSample('latch', t, latchLevel * 0.9)) transient(latch, t, latchLevel, 0.038)
      }
      const press = railState ? railState.press : 'none'
      if (railState && press !== 'none' && press !== lastPress) {
        latchFilter.frequency.setValueAtTime(press === 'nose' ? 2800 : 1900, t)
        transient(latch, t, 0.2, 0.04)
        transient(hit, t, 0.1, 0.05)
      }
      lastPress = press
      if (!riding && ((airborne && s.grounded && !railState) || (!crashed && s.crashed > 0) || freshEvent?.kind === 'air')) {
        const bail = s.crashed > 0 || freshEvent?.grade === 'crash'
        const sketchy = freshEvent?.grade === 'sketchy'
        const speedImpact = freshEvent?.kind === 'air' ? Math.sqrt(Math.max(0, freshEvent.efh) * 19.6) : descent
        hitFilter.frequency.setValueAtTime(bail ? 520 : (sketchy ? 1380 : 840) * (1 - loose * 0.52), t)
        const landLevel = bail ? 0.82 : Math.min(0.74, 0.14 + speedImpact * 0.045 + (sketchy ? 0.17 : 0))
        if (bail || !playSample('landing', t, landLevel * 0.8)) {
          transient(hit, t, landLevel, bail ? 0.13 : sketchy ? 0.096 : 0.062)
        }
      }
      onRail = Boolean(railState)
      airborne = air
      crashed = s.crashed > 0
      descent = Math.max(0, -s.vy)
    },
  }
}

function transient(voice: GainNode, time: number, level: number, tail: number) {
  voice.gain.cancelScheduledValues(time)
  voice.gain.setValueAtTime(level, time)
  voice.gain.setTargetAtTime(0, time + 0.012, tail)
}
