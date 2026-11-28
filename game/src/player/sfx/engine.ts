import { chimeHz, crashImpact, DEFAULT_KEY, landingImpact, sceneMix, snowCharacter, snowMix, windMix, type ChimeKey, type Impact, type SfxRide, type SfxScene, type SfxSkier } from './mix'

/**
 * Every game sound, synthesized in Web Audio: no audio files are downloaded.
 * Continuous layers (snow, wind, lift, ambience) are filtered noise whose
 * levels and colours follow `mix.ts`; one-shots (landings, crashes, trees,
 * lift towers, birds, interface chimes) are built from short noise bursts
 * and tones when they happen.
 *
 * Works on any `BaseAudioContext`, so the sound lab can render the same
 * engine offline into a file.
 */

export type UiSound =
  | 'move' | 'select' | 'back' | 'open' | 'close' | 'toggle'
  | 'count' | 'go' | 'gate' | 'fail'
  | 'perfect' | 'clean' | 'sketchy' | 'bank' | 'found' | 'finish' | 'best'

export type SampleKind = 'plant' | 'landing' | 'latch'

export interface SfxOptions {
  /** A crash or hard landing just sounded; `level` 0..1. The music ducks under it. */
  onImpact?(level: number): void
  /** Optional recorded one-shots layered on the synthesized ones. May fill in later. */
  samples?: Partial<Record<SampleKind, AudioBuffer>>
  random?: () => number
}

export type SfxEngine = ReturnType<typeof createSfxEngine>

interface BurstSpec {
  type?: BiquadFilterType
  freq: number
  /** Glide the filter to this frequency over the burst. */
  sweepTo?: number
  q?: number
  level: number
  attack?: number
  /** Seconds for the tail to fall to silence. */
  decay: number
  pan?: number
  out?: AudioNode
}

interface ToneSpec {
  freq: number
  to?: number
  type?: OscillatorType
  level: number
  attack?: number
  decay: number
  out?: AudioNode
  /** Add bell partials above the fundamental. */
  bell?: boolean
  pan?: number
}

export function createSfxEngine(ctx: BaseAudioContext, destination: AudioNode, options: SfxOptions = {}) {
  const random = options.random ?? Math.random
  const samples = options.samples ?? {}
  const rate = ctx.sampleRate

  // --- Buses: world sounds stop under a menu, interface sounds do not. A limiter catches stacked impacts.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -9
  limiter.knee.value = 6
  limiter.ratio.value = 12
  limiter.attack.value = 0.003
  limiter.release.value = 0.18
  limiter.connect(destination)
  const world = ctx.createGain()
  // Pink noise carries a lot below hearing: cut it, or it eats headroom and rattles small speakers.
  const subCut = ctx.createBiquadFilter()
  subCut.type = 'highpass'
  subCut.frequency.value = 38
  world.connect(subCut).connect(limiter)
  const uiBus = ctx.createGain()
  uiBus.gain.value = 0.9
  uiBus.connect(limiter)

  // --- Noise sources.
  const whiteBuffer = ctx.createBuffer(1, Math.floor(rate * 3), rate)
  {
    const data = whiteBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
  }
  // Pink noise (Paul Kellet's filter): equal energy per octave, the colour of wind and rumble.
  const pinkBuffer = ctx.createBuffer(1, Math.floor(rate * 5), rate)
  {
    const data = pinkBuffer.getChannelData(0)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < data.length; i++) {
      const w = random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  }
  /** A slow random curve in 0..1 changing about `hz` times a second, for modulating levels. */
  const wander = (hz: number, seconds: number, sharpen = 1) => {
    const buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate)
    const data = buffer.getChannelData(0)
    const points = Math.max(2, Math.round(hz * seconds))
    const values = Array.from({ length: points }, () => random())
    for (let i = 0; i < data.length; i++) {
      const at = (i / data.length) * points
      const a = values[Math.floor(at) % points], b = values[(Math.floor(at) + 1) % points]
      const k = at - Math.floor(at)
      const smooth = k * k * (3 - 2 * k)
      data[i] = (a + (b - a) * smooth) ** sharpen
    }
    return buffer
  }
  const loop = (buffer: AudioBuffer, offset = 0, playbackRate = 1) => {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.playbackRate.value = playbackRate
    source.start(0, offset % buffer.duration)
    return source
  }
  const white = loop(whiteBuffer)
  const white2 = loop(whiteBuffer, 1.37)
  const pink = loop(pinkBuffer)
  const pink2 = loop(pinkBuffer, 2.3)
  const grit = loop(wander(70, 2, 2))
  const flutter = loop(wander(11, 3))
  const swell = loop(wander(0.35, 23))
  const babble = wander(4.5, 9, 1.6)

  const gain = (value = 0) => {
    const node = ctx.createGain()
    node.gain.value = value
    return node
  }
  const filter = (type: BiquadFilterType, freq: number, q = 0.707) => {
    const node = ctx.createBiquadFilter()
    node.type = type
    node.frequency.value = freq
    node.Q.value = q
    return node
  }
  const panner = (pan = 0) => {
    const node = ctx.createStereoPanner()
    node.pan.value = pan
    return node
  }
  /**
   * A level that a 0..1 modulator cuts into: `depth` 0 leaves it alone, 1 lets
   * the modulator take it all the way to silence.
   */
  const tremolo = (modulator: AudioNode, depth = 0) => {
    const node = gain(1 - depth)
    const amount = gain(depth)
    modulator.connect(amount).connect(node.gain)
    return {
      node,
      set(value: number, time: number, tc = 0.06) {
        node.gain.setTargetAtTime(1 - value, time, tc)
        amount.gain.setTargetAtTime(value, time, tc)
      },
    }
  }
  const chain = (...nodes: AudioNode[]) => {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    return nodes[nodes.length - 1]
  }
  const to = (param: AudioParam, value: number, time: number, tc = 0.06) => param.setTargetAtTime(value, time, tc)

  // --- Snow under the skis.
  const snowPan = panner()
  snowPan.connect(world)
  const glideHigh = filter('highpass', 900), glideLow = filter('lowpass', 5000), glideGain = gain()
  chain(white, glideHigh, glideLow, glideGain, snowPan)
  // Chatter: a triangle wave lifted into 0..1 that flutters the edge and the rumble.
  const chatterOsc = ctx.createOscillator()
  chatterOsc.type = 'triangle'
  chatterOsc.frequency.value = 24
  const chatterWave = gain(0.5)
  const chatterLift = ctx.createConstantSource()
  chatterLift.offset.value = 0.5
  chatterOsc.connect(chatterWave)
  const chatterMod = gain(1)
  chatterWave.connect(chatterMod)
  chatterLift.connect(chatterMod)
  chatterOsc.start()
  chatterLift.start()
  const edgeBand = filter('bandpass', 3000, 1.5), edgeChatter = tremolo(chatterMod), edgeGain = gain()
  chain(white2, edgeBand, edgeChatter.node, edgeGain, snowPan)
  const skidBand = filter('bandpass', 1800, 0.7), skidGrit = tremolo(grit), skidGain = gain()
  chain(white, skidBand, skidGrit.node, skidGain, snowPan)
  const scrapeA = filter('bandpass', 4200, 9), scrapeB = filter('bandpass', 6100, 7), scrapeGrit = tremolo(grit, 0.6), scrapeGain = gain()
  white2.connect(scrapeA).connect(scrapeGrit.node)
  white2.connect(scrapeB).connect(scrapeGrit.node)
  chain(scrapeGrit.node, scrapeGain, snowPan)
  const floatLow = filter('lowpass', 700), floatGain = gain()
  chain(pink, filter('highpass', 160), floatLow, floatGain, snowPan)
  const rumbleLow = filter('lowpass', 120), rumbleChatter = tremolo(chatterMod), rumbleGain = gain()
  chain(pink2, rumbleLow, rumbleChatter.node, rumbleGain, world)

  // --- Wind: two decorrelated pink streams, so it sits wide around the head.
  const windMerge = ctx.createChannelMerger(2)
  pink.connect(windMerge, 0, 0)
  pink2.connect(windMerge, 0, 1)
  const windLow = filter('lowpass', 400), windBuffet = tremolo(flutter), windGust = tremolo(swell, 0.3), windGain = gain()
  chain(windMerge, filter('highpass', 70), windLow, windBuffet.node, windGust.node, windGain, world)
  const whistleBand = filter('bandpass', 1200, 6), whistleGain = gain()
  chain(white2, whistleBand, gain(2.5), whistleGain, world)
  const whistleDrift = gain(70)
  swell.connect(whistleDrift).connect(whistleBand.frequency)

  // --- Rails and boxes.
  const railBand = filter('bandpass', 2150, 2.2), railRing = filter('bandpass', 3300, 22), railRingGain = gain(2.5), railGain = gain()
  white.connect(railBand).connect(railGain)
  white.connect(railRing).connect(railRingGain).connect(railGain)
  railGain.connect(snowPan)

  // --- Lift machinery: a low drive hum and the haul rope running over the sheaves.
  const motorLow = filter('lowpass', 170), motorGain = gain()
  for (const hz of [49, 49.7, 73.5]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = hz
    osc.connect(motorLow)
    osc.start()
  }
  chain(motorLow, motorGain, world)
  const ropeBand = filter('bandpass', 520, 3), ropeGain = gain()
  chain(white, ropeBand, tremolo(flutter, 0.25).node, ropeGain, world)

  // --- Ambience.
  // Village: a murmur of voices, as vowel bands of noise each coming and going at talking pace.
  const crowdGain = gain()
  const crowdLow = filter('lowpass', 2600)
  chain(crowdLow, crowdGain, world)
  ;[330, 520, 780, 1150, 1700, 2350].forEach((hz, i) => {
    const band = filter('bandpass', hz, 5)
    const talk = tremolo(loop(babble, i * 1.31, 0.8 + i * 0.09), 1)
    const level = gain(i < 3 ? 1 : 0.55)
    chain(pink, band, talk.node, level, panner(((i % 3) - 1) * 0.6), crowdLow)
  })
  // Trees: wind in the needles, slowly rising and falling.
  const pinesBand = filter('bandpass', 760, 0.5), pinesGain = gain()
  chain(pink2, pinesBand, tremolo(swell, 0.6).node, pinesGain, world)
  // Open alpine: a hollow howl over the ridge.
  const howlA = filter('bandpass', 410, 7), howlB = filter('bandpass', 640, 9), howlGain = gain()
  const howlDrift = gain(60)
  swell.connect(howlDrift)
  howlDrift.connect(howlA.frequency)
  howlDrift.connect(howlB.frequency)
  pink.connect(howlA).connect(howlGain)
  pink2.connect(howlB).connect(howlGain)
  chain(howlGain, tremolo(flutter, 0.2).node, world)

  // --- One-shots.
  const envelope = (node: GainNode, time: number, level: number, attack: number, decay: number) => {
    node.gain.setValueAtTime(0.0001, time)
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), time + Math.max(0.001, attack))
    node.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay)
  }
  const burst = (time: number, spec: BurstSpec) => {
    if (spec.level <= 0.0005) return
    const attack = spec.attack ?? 0.002
    const source = ctx.createBufferSource()
    source.buffer = whiteBuffer
    const band = filter(spec.type ?? 'bandpass', spec.freq, spec.q ?? 1)
    if (spec.sweepTo) band.frequency.exponentialRampToValueAtTime(spec.sweepTo, time + attack + spec.decay)
    // A narrow band passes little of the noise: make up for it so a ringing burst is as loud as a wide one.
    const narrow = (spec.type ?? 'bandpass') === 'bandpass' ? Math.max(1, Math.min(6, Math.sqrt(1500 / (spec.freq / (spec.q ?? 1))))) : 1
    const level = gain()
    envelope(level, time, spec.level * narrow, attack, spec.decay)
    source.connect(band).connect(level)
    if (spec.pan) level.connect(panner(spec.pan)).connect(spec.out ?? world)
    else level.connect(spec.out ?? world)
    source.start(time, random() * (whiteBuffer.duration - attack - spec.decay - 0.1))
    source.stop(time + attack + spec.decay + 0.02)
  }
  const tone = (time: number, spec: ToneSpec) => {
    if (spec.level <= 0.0005) return
    const attack = spec.attack ?? 0.004
    const level = gain()
    envelope(level, time, spec.level, attack, spec.decay)
    if (spec.pan) level.connect(panner(spec.pan)).connect(spec.out ?? world)
    else level.connect(spec.out ?? world)
    const partials: [number, number][] = spec.bell ? [[1, 1], [2, 0.28], [3.01, 0.12], [4.2, 0.05]] : [[1, 1]]
    for (const [ratio, share] of partials) {
      const osc = ctx.createOscillator()
      osc.type = spec.type ?? 'sine'
      osc.frequency.setValueAtTime(spec.freq * ratio, time)
      if (spec.to) osc.frequency.exponentialRampToValueAtTime(spec.to * ratio, time + attack + spec.decay)
      const part = gain(share)
      osc.connect(part).connect(level)
      osc.start(time)
      osc.stop(time + attack + spec.decay + 0.02)
    }
  }
  const playSample = (kind: SampleKind, time: number, level: number) => {
    const buffer = samples[kind]
    if (!buffer) return
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(gain(level)).connect(world)
    source.start(time)
  }
  /** Body or skis hitting snow: a low thump, the crunch of the snow and a slap on hard pack. */
  const impact = (time: number, hit: Impact, scale = 1) => {
    const level = hit.level * scale
    tone(time, { freq: hit.thump.from, to: hit.thump.to, level: level * 0.85, attack: 0.003, decay: hit.thump.seconds })
    burst(time, { type: 'lowpass', freq: hit.crunch.freq * 1.6, level: level * hit.crunch.gain * 0.5, attack: hit.crunch.attack, decay: hit.crunch.seconds })
    burst(time, { freq: hit.crunch.freq, q: 0.8, level: level * hit.crunch.gain * 0.6, attack: hit.crunch.attack, decay: hit.crunch.seconds * 0.7 })
    burst(time, { type: 'highpass', freq: 2800, level: level * hit.slap * 0.4, decay: 0.03 })
  }

  let key: ChimeKey = DEFAULT_KEY
  const chime = (time: number, step: number, level: number, decay: number, octave = 0) =>
    tone(time, { freq: chimeHz(key, step) * 2 ** octave, level, decay, bell: true, out: uiBus })
  const UI_GAP = 0.07
  let lastUi = -1
  let lastUiKind: UiSound | null = null

  function ui(kind: UiSound) {
    const t = ctx.currentTime
    // A held key or a burst of focus changes must not machine-gun the same blip.
    if (kind === lastUiKind && t - lastUi < 0.045) return
    lastUi = t
    lastUiKind = kind
    switch (kind) {
      case 'move':
        tone(t, { freq: chimeHz(key, 2) * 2, level: 0.035, decay: 0.035, out: uiBus })
        break
      case 'toggle':
        tone(t, { freq: chimeHz(key, 0) * 2, level: 0.05, decay: 0.05, out: uiBus })
        break
      case 'select':
        chime(t, 0, 0.07, 0.12)
        chime(t + 0.055, 2, 0.08, 0.2)
        break
      case 'back':
        chime(t, 2, 0.06, 0.12)
        chime(t + 0.055, 0, 0.07, 0.2)
        break
      case 'open':
        burst(t, { freq: 500, sweepTo: 1800, q: 1.2, level: 0.05, attack: 0.03, decay: 0.14, out: uiBus })
        chime(t + 0.02, 0, 0.05, 0.25)
        break
      case 'close':
        burst(t, { freq: 1800, sweepTo: 500, q: 1.2, level: 0.05, attack: 0.02, decay: 0.14, out: uiBus })
        break
      case 'count':
        tone(t, { freq: chimeHz(key, 0), type: 'triangle', level: 0.2, attack: 0.005, decay: 0.16, out: uiBus })
        break
      case 'go':
        tone(t, { freq: chimeHz(key, 3), type: 'triangle', level: 0.22, attack: 0.005, decay: 0.5, out: uiBus })
        tone(t, { freq: chimeHz(key, 0), type: 'triangle', level: 0.1, attack: 0.005, decay: 0.5, out: uiBus })
        break
      case 'gate':
        tone(t, { freq: chimeHz(key, 3) * 2, level: 0.05, decay: 0.06, out: uiBus })
        break
      case 'fail':
        tone(t, { freq: chimeHz(key, 0) / 2, to: chimeHz(key, 0) / 2.4, type: 'triangle', level: 0.14, decay: 0.16, out: uiBus })
        tone(t + 0.17, { freq: chimeHz(key, 0) / 2.67, to: chimeHz(key, 0) / 3.2, type: 'triangle', level: 0.14, decay: 0.28, out: uiBus })
        break
      case 'sketchy':
        tone(t, { freq: chimeHz(key, 0), type: 'triangle', level: 0.06, decay: 0.12, out: uiBus })
        break
      case 'clean':
        chime(t, 0, 0.07, 0.3)
        chime(t + UI_GAP, 2, 0.08, 0.45)
        break
      case 'perfect':
        for (let i = 0; i < 4; i++) chime(t + i * UI_GAP, i, 0.075 + i * 0.008, 0.35 + i * 0.1)
        break
      case 'bank':
        chime(t, 2, 0.07, 0.2)
        chime(t + UI_GAP, 3, 0.08, 0.3)
        chime(t + UI_GAP * 2, 4, 0.085, 0.5)
        break
      case 'found':
        for (let i = 0; i < 4; i++) chime(t + i * 0.06, 3 + i, 0.06, 0.45, 0)
        break
      case 'finish':
        chime(t, 0, 0.1, 0.5)
        chime(t + 0.14, 2, 0.1, 0.5)
        chime(t + 0.28, 3, 0.12, 1.1)
        break
      case 'best':
        for (let i = 0; i < 5; i++) chime(t + i * 0.1, i, 0.09 + i * 0.006, i === 4 ? 1.4 : 0.5)
        chime(t + 0.5, 6, 0.08, 1.4)
        break
    }
  }

  /** A mountain chickadee somewhere in the trees: two or three clear falling whistles. */
  function birdCall(time: number) {
    const far = 0.35 + random() * 0.65
    const pan = random() * 1.6 - 0.8
    const out = gain(1)
    // A faint echo off the far trees gives it distance.
    const echo = ctx.createDelay(0.5)
    echo.delayTime.value = 0.16 + random() * 0.12
    out.connect(world)
    out.connect(echo).connect(gain(0.22)).connect(world)
    const top = 3750 + random() * 500
    const notes = random() < 0.45 ? 3 : 2
    let at = time
    for (let i = 0; i < notes; i++) {
      const freq = i === 0 ? top : top * 0.845
      const length = i === 0 ? 0.3 : 0.24
      tone(at, { freq, to: freq * 0.975, level: 0.035 * far, attack: 0.035, decay: length, out, pan })
      at += length + (i === 0 ? 0.11 : 0.06)
    }
  }

  /** The chair grip (or T-bar hanger) rolling over a tower's sheaves. */
  function towerPass(time: number, aerial: boolean, speed: number) {
    const ticks = aerial ? 8 : 4
    const gap = Math.max(0.045, Math.min(0.28, (aerial ? 0.6 : 0.45) / Math.max(0.5, speed)))
    for (let i = 0; i < ticks; i++) {
      const window = Math.sin(((i + 0.5) / ticks) * Math.PI)
      const at = time + i * gap
      const hz = (aerial ? 150 : 240) * (0.94 + random() * 0.12)
      tone(at, { freq: hz, to: hz * 0.8, level: 0.16 * window, attack: 0.002, decay: 0.08 })
      burst(at, { freq: aerial ? 420 : 700, q: 3, level: 0.07 * window, decay: 0.05 })
      burst(at, { freq: aerial ? 1900 : 2600, q: 8, level: 0.03 * window, decay: 0.025 })
    }
    burst(time, { type: 'lowpass', freq: 190, level: aerial ? 0.22 : 0.12, attack: (ticks * gap) / 2, decay: (ticks * gap) / 2 + 0.2 })
  }

  let airborne = false, crashed = false, onRail = false
  let descent = 0
  let lastTrick = 0
  let lastEdgeSign = 0
  let lastPress: 'none' | 'nose' | 'tail' = 'none'
  let nextFaceShot = 0
  let lastTime = ctx.currentTime
  let riding = false, unloading = false
  let rideS = 0
  let nextCreak = 0, nextClunk = 0, nextBird = 0
  let lastBail = -10
  const scene: SfxScene = { village: 0, forest: 0, alpine: 0, station: 0, wind: 0 }

  function update(s: SfxSkier, ride: SfxRide | null) {
    const t = ctx.currentTime
    const dt = Math.max(0, Math.min(0.1, t - lastTime))
    lastTime = t
    const isRiding = Boolean(ride)
    const { loose } = snowCharacter(s.surface)

    // Snow.
    const snow = snowMix(s, isRiding)
    // On a T-bar the skis still slide on the track.
    const towGlide = ride && !ride.aerial && !ride.unloading ? Math.pow(Math.min(1, ride.speed / 33), 0.7) * 0.2 : 0
    to(glideGain.gain, snow.glide.gain + towGlide, t)
    to(glideHigh.frequency, snow.glide.highpass, t, 0.12)
    to(glideLow.frequency, snow.glide.lowpass, t, 0.12)
    to(edgeGain.gain, snow.edge.gain, t, 0.05)
    to(edgeBand.frequency, snow.edge.freq, t, 0.08)
    to(edgeBand.Q, snow.edge.q, t, 0.2)
    to(skidGain.gain, snow.skid.gain, t, 0.045)
    to(skidBand.frequency, snow.skid.freq, t, 0.08)
    skidGrit.set(snow.skid.grit, t)
    to(scrapeGain.gain, snow.scrape.gain, t, 0.05)
    to(scrapeA.frequency, snow.scrape.freq, t, 0.1)
    to(scrapeB.frequency, snow.scrape.freq * 1.46, t, 0.1)
    to(floatGain.gain, snow.float.gain, t, 0.09)
    to(floatLow.frequency, snow.float.lowpass, t, 0.12)
    to(rumbleGain.gain, snow.rumble, t, 0.1)
    to(chatterOsc.frequency, snow.chatter.rate, t, 0.1)
    edgeChatter.set(snow.chatter.depth, t)
    rumbleChatter.set(snow.chatter.depth * 0.8, t)
    to(snowPan.pan, snow.pan, t, 0.08)

    // Wind.
    // On a lift the wind is the breeze of the ride, capped so fast-forward does not roar.
    const wind = windMix(isRiding ? { ...s, speed: Math.min(9, ride?.speed ?? 0) + (ride?.aerial ? 4 : 0), tuck: false } : s, isRiding, scene.wind)
    to(windGain.gain, wind.gain, t, 0.2)
    to(windLow.frequency, wind.lowpass, t, 0.18)
    windBuffet.set(wind.buffet, t, 0.2)
    to(whistleGain.gain, wind.whistle.gain, t, 0.25)
    to(whistleBand.frequency, wind.whistle.freq, t, 0.3)

    // Ambience.
    const bed = sceneMix(scene, s.speed, isRiding)
    to(crowdGain.gain, bed.crowd, t, 0.6)
    to(pinesGain.gain, bed.pines, t, 0.6)
    to(howlGain.gain, bed.howl, t, 0.6)
    if (bed.birds > 0 && t >= nextBird && random() < bed.birds * dt * 4) {
      birdCall(t + 0.05)
      nextBird = t + 2.5 + random() * 5
    }

    // Lifts: the ride itself, or a station heard from the snow.
    const station = ride ? Math.max(0, 1 - Math.min(ride.s, ride.total - ride.s) / 40) : 0
    to(motorGain.gain, Math.max(bed.machinery * 0.012, ride ? 0.004 + station * 0.014 : 0), t, 0.3)
    to(ropeGain.gain, ride ? (ride.aerial ? 0.03 : 0.045) : bed.machinery * 0.03, t, 0.3)
    to(ropeBand.frequency, ride && !ride.aerial ? 880 : 520, t, 0.3)
    if (ride) {
      if (!riding) {
        // Loading, unless the ride starts part-way up (the arrival shot that opens a session).
        if (ride.s < ride.total - ride.speed * 8) {
          if (ride.aerial) {
            tone(t, { freq: 95, to: 60, level: 0.3, decay: 0.1 })
            burst(t, { type: 'lowpass', freq: 700, level: 0.2, decay: 0.12 })
            burst(t + 0.55, { freq: 1500, q: 6, level: 0.14, decay: 0.05 })
            burst(t + 0.6, { freq: 380, q: 4, level: 0.16, decay: 0.08 })
          } else {
            burst(t, { freq: 1100, q: 5, level: 0.18, decay: 0.05 })
            burst(t + 0.05, { freq: 700, sweepTo: 2400, q: 3, level: 0.1, attack: 0.05, decay: 0.3 })
          }
        }
        nextCreak = t + 3 + random() * 5
      } else {
        for (const tower of ride.towers) {
          if (tower > rideS && tower <= ride.s && ride.s - rideS < 30) towerPass(t, ride.aerial, ride.speed)
        }
      }
      if (ride.aerial && !ride.unloading && t >= nextCreak) {
        // The chair swinging on its hanger.
        const hz = 430 + random() * 260
        const bend = 0.92 + random() * 0.2
        const pan = random() - 0.5
        tone(t, { freq: hz, to: hz * bend, type: 'triangle', level: 0.018, attack: 0.09, decay: 0.28, pan })
        tone(t, { freq: hz * 1.51, to: hz * 1.51 * bend, level: 0.007, attack: 0.09, decay: 0.22, pan })
        burst(t, { freq: hz, sweepTo: hz * bend, q: 20, level: 0.02, attack: 0.09, decay: 0.28, pan })
        nextCreak = t + 4 + random() * 8
      }
      if (ride.unloading && !unloading) {
        if (ride.aerial) {
          burst(t, { freq: 1700, q: 6, level: 0.16, decay: 0.05 })
          burst(t + 0.04, { freq: 420, q: 4, level: 0.14, decay: 0.08 })
          // Skis onto the ramp.
          burst(t + 0.7, { type: 'lowpass', freq: 2600, level: 0.16, attack: 0.01, decay: 0.16 })
          tone(t + 0.7, { freq: 110, to: 55, level: 0.2, decay: 0.09 })
        } else {
          // The T lets go and the spring reels it in.
          burst(t, { freq: 1300, q: 5, level: 0.2, decay: 0.05 })
          burst(t + 0.06, { freq: 600, sweepTo: 3200, q: 4, level: 0.12, attack: 0.08, decay: 0.5 })
        }
      }
      rideS = ride.s
    } else if (bed.machinery > 0.05 && t >= nextClunk) {
      // Chairs coming round the bullwheel at a station nearby.
      tone(t, { freq: 170, to: 130, level: 0.1 * bed.machinery, attack: 0.002, decay: 0.1 })
      tone(t + 0.17, { freq: 200, to: 150, level: 0.07 * bed.machinery, attack: 0.002, decay: 0.09 })
      burst(t, { freq: 600, q: 3, level: 0.05 * bed.machinery, decay: 0.06 })
      burst(t, { freq: 2100, q: 8, level: 0.015 * bed.machinery, decay: 0.03 })
      nextClunk = t + 4.5 + random() * 3
    }
    riding = isRiding
    unloading = Boolean(ride?.unloading)

    // Rails and boxes.
    const rail = isRiding ? null : s.rail
    const box = rail?.rail.kind === 'box'
    const v = Math.min(1, s.speed / 33)
    to(railBand.frequency, (box ? 1180 : 2050) + v * 940, t, 0.055)
    to(railRing.frequency, (box ? 1500 : 3100) + v * 600, t, 0.055)
    to(railRingGain.gain, box ? 0.4 : 2.5, t, 0.05)
    to(railGain.gain, rail ? 0.1 + v * 0.24 + Math.abs(rail.balance) * 0.075 : 0, t, 0.035)
    if (rail && !onRail) {
      burst(t, { freq: box ? 1600 : 3900, q: 3, level: box ? 0.22 : 0.32, decay: 0.06 })
      if (box) tone(t, { freq: 140, to: 90, level: 0.2, decay: 0.08 })
      else {
        tone(t, { freq: 2450, level: 0.03, attack: 0.002, decay: 0.35 })
        tone(t, { freq: 3890, level: 0.015, attack: 0.002, decay: 0.2 })
      }
      playSample('latch', t, box ? 0.2 : 0.3)
    }
    const press = rail ? rail.press : 'none'
    if (rail && press !== 'none' && press !== lastPress) {
      burst(t, { freq: press === 'nose' ? 2800 : 1900, q: 3, level: 0.2, decay: 0.06 })
      burst(t, { type: 'lowpass', freq: 500, level: 0.1, decay: 0.08 })
    }
    lastPress = press

    const sliding = !isRiding && s.grounded && !rail && s.crashed <= 0
    const air = !isRiding && !s.grounded && !rail

    // Deep snow thrown up at speed.
    const faceShot = sliding && s.sink > 0.12 && s.speed > 6 ? Math.min(1, s.sink * 2.2 + s.skid * 0.8) * v : 0
    if (faceShot > 0.35 && t >= nextFaceShot) {
      burst(t, { type: 'lowpass', freq: 380 + faceShot * 420, level: 0.2 + faceShot * 0.26, attack: 0.05, decay: 0.34, pan: snow.pan })
      nextFaceShot = t + 0.28 + random() * 0.35
    }

    // The edge changing sides: a soft tick and the skis settling onto the new edge.
    const edgeSign = sliding && Math.abs(s.edgeAngle) > 0.12 ? Math.sign(s.edgeAngle) : 0
    if (edgeSign !== 0 && lastEdgeSign !== 0 && edgeSign !== lastEdgeSign && s.speed > 3) {
      const tick = (0.025 + v * 0.02) * (1 - loose * 0.7)
      burst(t, { freq: 2200 + v * 500 - loose * 700, q: 4, level: tick, decay: 0.03, pan: snow.pan })
      playSample('plant', t, tick * 0.85)
      burst(t, { type: 'lowpass', freq: (1200 + Math.abs(s.edgeAngle) * 600) * (1 - loose * 0.6), level: 0.04 + v * 0.06 + (1 - loose) * 0.03, decay: 0.09 })
    }
    if (edgeSign !== 0) lastEdgeSign = edgeSign

    // Landings and crashes.
    const fresh = s.trick && s.trick.seq !== lastTrick ? s.trick : null
    if (fresh) lastTrick = fresh.seq
    if (!isRiding) {
      const bail = (!crashed && s.crashed > 0) || fresh?.grade === 'crash'
      const landed = (airborne && s.grounded && !rail) || fresh?.kind === 'air'
      if (bail && t - lastBail < 0.8) {
        // The trick grade and the crash state can arrive a frame apart: one fall, one sound.
      } else if (bail) {
        lastBail = t
        const hit = crashImpact(Math.max(s.crashSpeed, s.speed), s.surface)
        impact(t, hit)
        for (let i = 1; i <= hit.tumbles; i++) {
          impact(t + i * 0.24 + random() * 0.1, { ...hit, thump: { ...hit.thump, seconds: 0.14 } }, 0.55 / i + 0.1)
        }
        // Skis and poles letting go in a hard fall.
        if (s.crashSpeed > 9) {
          for (let i = 0; i < 3; i++) burst(t + 0.05 + i * 0.13 + random() * 0.08, { freq: 2200 + random() * 1400, q: 7, level: 0.12, decay: 0.04, pan: random() - 0.5 })
        }
        options.onImpact?.(1)
      } else if (landed) {
        const fall = fresh?.kind === 'air' ? Math.sqrt(Math.max(0, fresh.efh) * 19.6) : descent
        const hit = landingImpact(fall, s.surface, fresh?.kind === 'air' ? fresh.grade : null)
        impact(t, hit)
        playSample('landing', t, hit.level * 0.4)
        if (hit.level > 0.4) options.onImpact?.(hit.level)
      }
    }
    onRail = Boolean(rail)
    airborne = air
    crashed = s.crashed > 0
    descent = Math.max(0, -s.vy)
  }

  return {
    update,
    ui,
    setScene(next: Partial<SfxScene>) {
      Object.assign(scene, next)
    },
    /** Tune the interface chimes to the music. */
    setKey(next: ChimeKey | null) {
      key = next ?? DEFAULT_KEY
    },
    /** Under a menu the world goes quiet; interface sounds keep playing. */
    setPaused(paused: boolean) {
      world.gain.setTargetAtTime(paused ? 0 : 1, ctx.currentTime, 0.03)
    },
    /** Soft whoosh when another skier passes close without contact. */
    nearMiss(closing: number) {
      const level = Math.min(1, closing / 8)
      const t = ctx.currentTime
      burst(t, { freq: 700 + level * 500, sweepTo: 1500 + level * 900, q: 1.2, level: 0.12 + level * 0.22, attack: 0.07, decay: 0.22 })
      burst(t, { type: 'lowpass', freq: 370, level: 0.05 + level * 0.08, decay: 0.12 })
    },
    /** Into a tree: wood, branches and the snow coming off them. A brush is the same, lighter. */
    treeHit(into: number, crash: boolean) {
      const t = ctx.currentTime
      const level = Math.min(1, 0.3 + into / 14) * (crash ? 1 : 0.5)
      const pan = random() * 0.8 - 0.4
      // A trunk is a damped ring at a couple of low pitches, with the crack of the hit on top.
      const wood = 170 + random() * 50
      tone(t, { freq: wood, to: wood * 0.9, level: level * 0.7, attack: 0.002, decay: 0.16, pan })
      tone(t, { freq: wood * 2.3, to: wood * 2.2, level: level * 0.22, attack: 0.002, decay: 0.07, pan })
      burst(t, { freq: 900, q: 1.5, level: level * 0.4, decay: 0.05, pan })
      if (crash) tone(t, { freq: 110, to: 60, level: level * 0.3, decay: 0.14 })
      for (let i = 0; i < (crash ? 8 : 4); i++) {
        burst(t + 0.02 + random() * 0.45, { freq: 2600 + random() * 2600, q: 0.9, level: level * (0.08 + random() * 0.12), attack: 0.004, decay: 0.05 + random() * 0.07, pan: pan + random() * 0.5 - 0.25 })
      }
      // Snow sliding off the branches.
      burst(t + 0.16, { type: 'lowpass', freq: 1100, level: level * 0.4, attack: 0.07, decay: 0.55, pan })
      if (crash) options.onImpact?.(1)
    },
    reset() {
      airborne = crashed = onRail = false
      descent = lastTrick = lastEdgeSign = nextFaceShot = 0
      lastPress = 'none'
    },
  }
}
