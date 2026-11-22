import type { SkiState } from '../sim'

/** Procedural ski contact, airflow and lift sounds, unlocked by the first user gesture. */
export function createSkiAudio(button: HTMLButtonElement) {
  let ctx: AudioContext | undefined
  let master: GainNode, contact: GainNode, wind: GainNode, lift: GainNode, hit: GainNode
  let snowFilter: BiquadFilterNode
  let muted = false
  let paused = false
  let airborne = false, crashed = false
  let descent = 0
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
      hit = voice(filter('lowpass', 370))
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
    reset() { airborne = crashed = false; descent = 0 },
    update(s: SkiState, riding: boolean) {
      if (!ctx) return
      const t = ctx.currentTime
      const speed = Math.min(1, s.speed / 22)
      const loose = Math.min(1, s.surface.depth / 0.45)
      const edge = Math.min(1, Math.abs(s.edgeAngle) + s.skid)
      const sliding = !riding && s.grounded && !s.rail && s.crashed <= 0
      snowFilter.frequency.setTargetAtTime(s.rail ? 3200 : 800 + 2200 * (1 - loose) + edge * 1100, t, 0.08)
      contact.gain.setTargetAtTime(sliding ? speed * (0.14 + edge * 0.55) : s.rail && !riding ? 0.28 : 0, t, 0.05)
      wind.gain.setTargetAtTime(0.015 + speed * speed * 0.46, t, 0.2)
      lift.gain.setTargetAtTime(riding ? 0.035 : 0, t, 0.15)
      if (!riding && ((airborne && s.grounded) || (!crashed && s.crashed > 0))) {
        hit.gain.cancelScheduledValues(t)
        hit.gain.setValueAtTime(s.crashed > 0 ? 0.94 : 0.2 + Math.min(0.7, descent / 15), t)
        hit.gain.setTargetAtTime(0, t + 0.015, 0.075)
      }
      airborne = !riding && !s.grounded
      crashed = s.crashed > 0
      descent = Math.max(0, -s.vy)
    },
  }
}
