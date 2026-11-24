import type { SkiState } from '../sim'

/** Procedural ski contact, airflow and lift sounds, unlocked by the first user gesture. */
export function createSkiAudio(button: HTMLButtonElement) {
  let ctx: AudioContext | undefined
  let master: GainNode, contact: GainNode, wind: GainNode, lift: GainNode, hit: GainNode, rail: GainNode, latch: GainNode
  let snowFilter: BiquadFilterNode, hitFilter: BiquadFilterNode, railFilter: BiquadFilterNode, latchFilter: BiquadFilterNode
  let muted = false
  let paused = false
  let airborne = false, crashed = false
  let descent = 0
  let onRail = false
  let lastTrick = 0
  let level = 0.8
  try { muted = localStorage.getItem('apex.soundMuted') === 'true' } catch { /* Private storage. */ }
  const label = () => {
    button.textContent = muted ? 'Sound · Off' : 'Sound · On'
    button.setAttribute('aria-pressed', String(!muted))
  }
  const volume = () => {
    if (ctx) master.gain.setTargetAtTime(muted || paused || document.hidden ? 0 : 0.575 * level, ctx.currentTime, 0.025)
  }
  const unlock = () => {
    if (muted || !window.AudioContext) return
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = 0
      master.connect(ctx.destination)
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
      const samples = buffer.getChannelData(0)
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1
      const noise = ctx.createBufferSource()
      noise.buffer = buffer
      noise.loop = true
      const voice = (source: AudioNode) => {
        const gain = ctx!.createGain()
        gain.gain.value = 0
        source.connect(gain).connect(master)
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
      contact = voice(snowFilter)
      wind = voice(filter('lowpass', 540))
      hitFilter = filter('lowpass', 370)
      hit = voice(hitFilter)
      railFilter = filter('bandpass', 2150)
      railFilter.Q.value = 2.2
      rail = voice(railFilter)
      latchFilter = filter('bandpass', 3400)
      latchFilter.Q.value = 3
      latch = voice(latchFilter)
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
    reset() { airborne = crashed = onRail = false; descent = lastTrick = 0 },
    update(s: SkiState, riding: boolean) {
      if (!ctx) return
      const t = ctx.currentTime
      const speed = Math.min(1, s.speed / 22)
      const loose = Math.min(1, s.surface.depth / 0.45)
      const edge = Math.min(1, Math.abs(s.edgeAngle) + s.skid)
      const railState = !riding && s.rail
      const sliding = !riding && s.grounded && !railState && s.crashed <= 0
      const freshEvent = s.trick && s.trick.seq !== lastTrick ? s.trick : null
      if (freshEvent) lastTrick = freshEvent.seq
      const box = railState && railState.rail.kind === 'box'
      snowFilter.frequency.setTargetAtTime(700 + 2300 * (1 - loose) + edge * 1250, t, 0.08)
      contact.gain.setTargetAtTime(sliding ? speed * (0.19 + edge * 0.49 + s.sink * 0.45) : 0, t, 0.05)
      wind.gain.setTargetAtTime(0.015 + speed * speed * 0.46, t, 0.2)
      lift.gain.setTargetAtTime(riding ? 0.035 : 0, t, 0.15)
      railFilter.frequency.setTargetAtTime((box ? 1180 : 2050) + speed * 940, t, 0.055)
      rail.gain.setTargetAtTime(railState ? 0.10 + speed * 0.24 + Math.abs(railState.balance) * 0.075 : 0, t, 0.035)
      if (railState && !onRail) {
        latchFilter.frequency.setValueAtTime(box ? 1600 : 3900, t)
        transient(latch, t, box ? 0.22 : 0.36, 0.038)
      } else if (!riding && ((airborne && s.grounded && !railState) || (!crashed && s.crashed > 0) || freshEvent?.kind === 'air')) {
        const bail = s.crashed > 0 || freshEvent?.grade === 'crash'
        const sketchy = freshEvent?.grade === 'sketchy'
        const speedImpact = freshEvent?.kind === 'air' ? Math.sqrt(Math.max(0, freshEvent.efh) * 19.6) : descent
        hitFilter.frequency.setValueAtTime(bail ? 520 : (sketchy ? 1380 : 840) * (1 - loose * 0.52), t)
        transient(hit, t, bail ? 0.82 : Math.min(0.74, 0.14 + speedImpact * 0.045 + (sketchy ? 0.17 : 0)), bail ? 0.13 : sketchy ? 0.096 : 0.062)
      }
      onRail = Boolean(railState)
      airborne = !riding && !s.grounded
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
