import { createSkiState, SURFACES, type SkiState, type SurfaceKind } from '../sim'
import type { SfxEngine, UiSound } from '../player/sfx/engine'
import type { SfxRide, SfxScene } from '../player/sfx/mix'

/**
 * Scripted moments for the sound lab: each gives the sim state (and lift ride,
 * place and one-off events) at a time, so a sound can be heard, and rendered
 * to a file, without playing the game to reach it.
 */
export interface SoundFrame {
  skier: SkiState
  ride: SfxRide | null
  scene: SfxScene
}

export interface SoundScenario {
  id: string
  title: string
  note: string
  seconds: number
  /** The state at `t` seconds. `fire` runs a one-off the first time its key comes up. */
  frame(t: number, engine: SfxEngine, fire: (key: string, action: () => void) => void): SoundFrame
}

const QUIET: SfxScene = { village: 0, forest: 0, alpine: 0, station: 0, wind: 0.05 }
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function skier(over: Partial<SkiState> & { on?: SurfaceKind }): SkiState {
  const { on, ...rest } = over
  const base = createSkiState()
  return { ...base, grounded: true, mode: 'carving', surface: SURFACES[on ?? 'groomed'], ...rest }
}

/** Linked turns: the edge swings side to side every `period` seconds. */
function turns(t: number, on: SurfaceKind, speed: number, period: number, edge: number, skid: number, extra: Partial<SkiState> = {}): SkiState {
  const swing = Math.sin((t / period) * Math.PI * 2)
  const press = Math.abs(swing)
  return skier({ on, speed, edgeAngle: swing * edge, carveLoad: 1 + press * 1.6 * (1 - skid), skid: skid * press, mode: skid > 0.4 ? 'skidding' : 'carving', ...extra })
}

let trickSeq = 1000

function trick(grade: 'perfect' | 'clean' | 'sketchy', efh: number): NonNullable<SkiState['trick']> {
  return { seq: ++trickSeq, kind: 'air', name: 'Air', points: 100, grade, efh, airTime: 1, spinDeg: 0, flips: 0, grab: null, grabTime: 0, switchLanding: false, railMetres: 0 }
}

const UI_ORDER: [UiSound, string][] = [
  ['open', 'menu opens'], ['move', 'focus moves'], ['move', ''], ['move', ''], ['toggle', 'slider'], ['select', 'choice'], ['back', 'back'], ['close', 'menu closes'],
  ['count', '3'], ['count', '2'], ['count', '1'], ['go', 'GO'], ['gate', 'gate'], ['gate', ''], ['fail', 'missed gate'],
  ['sketchy', 'sketchy landing'], ['clean', 'clean landing'], ['perfect', 'perfect landing'], ['bank', 'points banked'], ['found', 'unlock'], ['finish', 'finish'], ['best', 'new best'],
]

export const SCENARIOS: SoundScenario[] = [
  {
    id: 'groomer-carve',
    title: 'Groomer: carved turns',
    note: '58 km/h, clean arcs. The edge tears a bright line through each turn and goes quiet between them.',
    seconds: 9,
    frame: (t) => ({ skier: turns(t, 'groomed', 16, 2.6, 0.8, 0.06), ride: null, scene: QUIET }),
  },
  {
    id: 'groomer-skid',
    title: 'Groomer: skidded turns and a hockey stop',
    note: 'The same speed with the skis sideways: a wide, rough scrape. Ends with a full stop.',
    seconds: 9,
    frame: (t) => {
      if (t > 6.5) {
        const speed = Math.max(0, 16 * (1 - (t - 6.5) / 1.6))
        return { skier: skier({ speed, edgeAngle: 0.6, skid: 0.9, mode: 'braking' }), ride: null, scene: QUIET }
      }
      return { skier: turns(t, 'groomed', 16, 2.2, 0.5, 0.75), ride: null, scene: QUIET }
    },
  },
  {
    id: 'ice',
    title: 'Ice: carve, chatter, then skid',
    note: 'Brighter and glassy. The edge chatters at the limit, and a skid rings.',
    seconds: 10,
    frame: (t) => {
      const swing = Math.abs(Math.sin((t / 2.6) * Math.PI * 2))
      const skid = t > 5 ? 0.7 : 0.08
      return { skier: turns(t, 'ice', 17, 2.6, 0.65, skid, { chatter: t > 2.5 && t < 5 ? swing * 0.8 : 0 }), ride: null, scene: QUIET }
    },
  },
  {
    id: 'powder',
    title: 'Powder: floating turns',
    note: 'Almost silent underfoot: a low rush as the snow moves aside, and a face shot on the deeper turns.',
    seconds: 10,
    frame: (t) => {
      const press = Math.abs(Math.sin((t / 3) * Math.PI * 2))
      return { skier: turns(t, 'powder', 13, 3, 0.5, 0.35, { sink: 0.1 + press * 0.22 }), ride: null, scene: QUIET }
    },
  },
  {
    id: 'rock',
    title: 'Thin cover over rock',
    note: 'Wind-stripped ground near the summit: a gritty grind under the hiss.',
    seconds: 6,
    frame: (t) => ({ skier: turns(t, 'rock', 10, 2.4, 0.4, 0.3), ride: null, scene: { ...QUIET, alpine: 0.6, wind: 0.3 } }),
  },
  {
    id: 'speed',
    title: 'Wind: 20 to 120 km/h in a tuck, then stand up',
    note: 'Wind rises with speed, a whistle joins above 60 km/h and the air starts to buffet near the top.',
    seconds: 12,
    frame: (t) => {
      const speed = t < 9 ? 5.5 + (27.5 * t) / 9 : 33 - (t - 9) * 5
      return { skier: skier({ speed, tuck: t < 9, mode: t < 9 ? 'tucked' : 'straight', carveLoad: 1 }), ride: null, scene: QUIET }
    },
  },
  {
    id: 'landings',
    title: 'Landings: groomer, powder, ice, then a sketchy one',
    note: 'Each is a 1.2 second air. Firm snow lands with a slap, powder with a soft whump.',
    seconds: 12,
    frame: (t) => {
      const kinds: SurfaceKind[] = ['groomed', 'powder', 'ice', 'groomed']
      const jump = Math.min(3, Math.floor(t / 3))
      const local = t - jump * 3
      const on = kinds[jump]
      const inAir = local > 0.6 && local < 1.8
      const landed = local >= 1.8
      const state = skier({ on, speed: 15, grounded: !inAir, mode: inAir ? 'air' : 'straight', vy: inAir ? -(local - 1.2) * 9.8 : 0, sink: on === 'powder' && !inAir ? 0.12 : 0 })
      if (landed) state.trick = { ...trick(jump === 3 ? 'sketchy' : 'clean', jump === 3 ? 2.6 : 1.8), seq: 2000 + jump }
      return { skier: state, ride: null, scene: QUIET }
    },
  },
  {
    id: 'crash',
    title: 'Crashes: a fall at 65 km/h, a tree, and a brush past a trunk',
    note: 'The fall thumps, tumbles and slides to a stop with the gear letting go. The tree is wood, branches and the snow coming off them.',
    seconds: 11,
    frame: (t, engine, fire) => {
      if (t < 1.5) return { skier: turns(t, 'groomed', 18, 2.6, 0.5, 0.1), ride: null, scene: QUIET }
      if (t < 5) {
        const speed = Math.max(0, 18 * (1 - (t - 1.5) / 2.6))
        return { skier: skier({ speed, crashed: 5 - t, crashSpeed: 18, mode: 'crashed' }), ride: null, scene: QUIET }
      }
      if (t >= 6.5 && t < 8.5) {
        fire('tree', () => engine.treeHit(12, true))
        return { skier: skier({ on: 'forest', speed: 0, crashed: 8.5 - t, crashSpeed: 12, mode: 'crashed' }), ride: null, scene: { ...QUIET, forest: 1 } }
      }
      if (t >= 9.5) fire('brush', () => engine.treeHit(6, false))
      return { skier: turns(t, 'forest', 9, 2.4, 0.4, 0.2, { sink: 0.1 }), ride: null, scene: { ...QUIET, forest: t > 5 ? 1 : 0 } }
    },
  },
  {
    id: 'rail',
    title: 'Park: a rail, then a box',
    note: 'The latch, the grind, a press, and the landing off the end.',
    seconds: 8,
    frame: (t) => {
      const second = t >= 4
      const local = second ? t - 4 : t
      const on = local > 0.8 && local < 2.6
      const state = skier({ on: 'park', speed: 11, grounded: !on && !(local >= 2.6 && local < 2.9), mode: on ? 'rail' : 'straight' })
      if (on) {
        state.rail = { rail: { id: 'lab', kind: second ? 'box' : 'rail', points: [], width: 0.1 }, s: 0, vs: 11, balance: Math.sin(local * 5) * 0.4, balanceRate: 0, style: '5050', headingOffset: 0, entrySpeed: 11, metres: 0, press: local > 1.7 ? 'nose' : 'none' } as unknown as SkiState['rail']
      }
      if (local >= 2.6 && local < 2.9) state.vy = -2.5
      return { skier: state, ride: null, scene: QUIET }
    },
  },
  {
    id: 'chairlift',
    title: 'Chairlift: load, two towers, unload',
    note: 'A low drive hum at the station, the grip rolling over each tower, the chair creaking, the bar and the ramp at the top.',
    seconds: 20,
    frame: (t) => {
      const s = t * 5
      const ride: SfxRide = { aerial: true, s: Math.min(s, 88), total: 88, speed: 5, towers: [30, 62], unloading: s >= 88 }
      return { skier: skier({ speed: 5, grounded: false, mode: 'still' }), ride, scene: { ...QUIET, forest: 0.6, station: clamp01(1 - Math.min(s, 88 - s) / 40) } }
    },
  },
  {
    id: 'tbar',
    title: 'T-bar: load, a tower, let go at the top',
    note: 'Skis sliding on the track, the rope running, and the spring reeling the T back in when you let go.',
    seconds: 16,
    frame: (t) => {
      const s = t * 2.4
      const ride: SfxRide = { aerial: false, s: Math.min(s, 31), total: 31, speed: 2.4, towers: [14], unloading: s >= 31 }
      return { skier: skier({ speed: 2.4, mode: 'still' }), ride, scene: { ...QUIET, alpine: 0.2, wind: 0.1 } }
    },
  },
  {
    id: 'places',
    title: 'Places: village, forest, then the summit in a storm',
    note: 'Standing still. People talking and a lift station at the base, chickadees and wind in the trees, a hollow howl up top.',
    seconds: 30,
    frame: (t) => {
      const scene: SfxScene =
        t < 10 ? { village: 1, forest: 0.1, alpine: 0, station: 0.7, wind: 0.08 }
        : t < 20 ? { village: 0, forest: 1, alpine: 0, station: 0, wind: 0.15 }
        : { village: 0, forest: 0, alpine: 1, station: 0, wind: 0.5 + 0.5 * Math.sin((t - 20) * 0.7) ** 2 }
      return { skier: skier({ speed: 0, mode: 'still' }), ride: null, scene }
    },
  },
  {
    id: 'ui',
    title: 'Interface: menus, race start, trick cards, results',
    note: UI_ORDER.map(([kind, label]) => label || kind).filter((label, i, all) => label !== all[i - 1]).join(' · '),
    seconds: UI_ORDER.length * 0.8 + 2,
    frame: (t, engine, fire) => {
      const index = Math.floor(t / 0.8)
      if (index < UI_ORDER.length) fire(`ui${index}`, () => engine.ui(UI_ORDER[index][0]))
      return { skier: skier({ speed: 0, mode: 'still' }), ride: null, scene: { ...QUIET, wind: 0 } }
    },
  },
]

/** Step a scenario from the start: returns `step(t)`, which feeds the engine the state at `t`. */
export function runScenario(scenario: SoundScenario, engine: SfxEngine) {
  const fired = new Set<string>()
  const fire = (key: string, action: () => void) => {
    if (fired.has(key)) return
    fired.add(key)
    action()
  }
  engine.reset()
  return (t: number) => {
    const frame = scenario.frame(t, engine, fire)
    engine.setScene(frame.scene)
    engine.update(frame.skier, frame.ride)
  }
}
