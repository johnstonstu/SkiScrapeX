/**
 * Fixes to the OpenStreetMap data from Apex's own sources, so the game matches
 * the resort. Every entry says where it came from; see docs/run-names.md and
 * docs/apex-sources.md for the research.
 */
import type { Peak, Resort, Run } from './resort'

/**
 * Official difficulty where OSM disagrees. Source: Apex trail maps (2023 and
 * 2026/27) and the Wikipedia run list by lift, read 2026-11-22.
 */
export const DIFFICULTY_FIXES: Record<string, string> = {
  // Blue square on both trail maps; Wikipedia lists "Wishbone" as intermediate.
  Wishbone: 'intermediate',
  // OSM has no piste:difficulty; the official run list and both maps say blue.
  "Grandmother's Trail": 'intermediate',
}

/**
 * Official spellings for OSM run names. Source: the 2026/27 trail map labels,
 * the grooming report and Wikipedia's run list (visual review item 6).
 */
export const RUN_NAMES: Record<string, string> = {
  'Dude ney Trail': 'Dude-Ney Trail',
  Grommit: 'Gromit',
  Dawdler1: 'Dawdler 1',
  Dawdler2: 'Dawdler 2',
  '97': 'Highway 97',
  'Pea Shooter': 'Peashooter',
  Westbank: 'West Bank',
  "Kristi's": "Kristi's Run",
  "Greenhorn's Traverse": 'Greenhorn Traverse',
  // One blue Wishbone on the official list and both maps; OSM splits it in two (merged below).
  'Upper Wishbone': 'Wishbone',
  'Lower Wishbone': 'Wishbone',
  "Hang'em High": "Hang 'em High",
}

/**
 * Names given to the LiDAR-traced runs over time, so saved medals and bests
 * follow them (apex research handoff, 2026-11-24).
 */
export const TRACE_NAMES: Record<string, string> = {
  'Wildside cut 1': 'Any Which Way Glades',
  'Wildside cut 2': 'Any Which Way Glades',
  'Wildside cut 3': 'Jackpot',
  'Wildside cut 4': 'Gun Slinger',
  'Wildside cut 5': 'ShootOut',
  'Wildside cut 6': 'Showdown',
  'Unmapped run L1': 'Unnamed cut L1',
  'Unmapped run L4': 'Unnamed cut L4',
  'Unmapped run L5': 'Unnamed cut L5',
  'Unmapped run L6': 'Unnamed cut L6',
  'Unmapped run L7': 'Unnamed cut L7',
  'Unmapped run L9': 'Unnamed cut L9',
  'Unmapped run L10': 'Unnamed cut L10',
  'Unmapped run L11': 'Unnamed cut L11',
  'Unmapped run L13': 'Unnamed cut L13',
  'Unmapped run L14': 'Unnamed cut L14',
  'Unmapped run L3': 'Chaser',
  'Unmapped run L2': 'Prospector',
}

/** Saved progress renames: spellings, traces, and split runs (old whole-run results go to the upper part). */
export const PROGRESS_RENAMES: Record<string, string> = {
  ...RUN_NAMES,
  ...TRACE_NAMES,
  Gambit: 'Upper Gambit',
  'Spruce Hollow': 'Upper Spruce Hollow',
  "Hang 'em High": "Upper Hang 'em High",
}

/** Runs OSM splits in two that are one run on the hill: merged after renaming. */
export const MERGED_RUNS = new Set(['Wishbone'])

/**
 * Runs the grooming report names as Upper and Lower but OSM maps as one line,
 * cut at the junction the research handoff found (docs/review/apex-terrain).
 */
export const RUN_SPLITS: { name: string; at: [number, number]; upper: string; lower: string }[] = [
  // Where Greenhorn's Traverse crosses, 582 m from the top.
  { name: 'Gambit', at: [2740.3, 1254.9], upper: 'Upper Gambit', lower: 'Lower Gambit' },
  // Where Greenhorn's Traverse crosses, 244 m from the top.
  { name: 'Spruce Hollow', at: [2649.3, 891.1], upper: 'Upper Spruce Hollow', lower: 'Lower Spruce Hollow' },
  // The Bob's Run junction: a gentle ridge traverse above, the steep descent below.
  { name: "Hang 'em High", at: [2623, 2138.1], upper: "Upper Hang 'em High", lower: "Lower Hang 'em High" },
]

/**
 * How runs are kept where OSM says otherwise. Source: Stu (2026-11-24): West Bank
 * is "a really fun kind of mogul run right underneath the chairlift", The Pit a
 * big-mountain run with a cliff at the top and a rock band in the middle.
 */
export const RUN_STYLE: Record<string, { groomed?: boolean; moguls?: boolean; halfWidth?: number }> = {
  // Mogul lanes need room; the LiDAR clearing under Quickdraw is wide.
  'West Bank': { groomed: false, moguls: true, halfWidth: 15 },
  // A wide big-mountain face, room to ski around the drops.
  'The Pit': { groomed: false, halfWidth: 22 },
}

/** Display names for OSM building names with typos or abbreviations. */
export const BUILDING_NAMES: [RegExp, string][] = [
  [/^the gunbarell saloon$/i, 'Gunbarrel Saloon'],
  [/^the gunbarrel saloon$/i, 'Gunbarrel Saloon'],
  [/^the edge bistro$/i, 'The Edge Bistro'],
  [/^apex mtn inn$/i, 'Apex Mountain Inn'],
  [/^apex ski club$/i, 'Apex Ski Club'],
  [/^top of the carpet lift shack$/i, 'Magic Carpet (top)'],
  [/^freestyle ski shack \(bottom\)$/i, 'Freestyle shack'],
  [/^freestyle ski shack \(top\)$/i, 'Freestyle shack (top)'],
]

/**
 * Wall colours for named buildings, from the 2023 aerial photo on apexresort.com:
 * the four-storey yellow lodge with dark trim beside the Gunbarrel is taken to be
 * the Apex Mountain Inn (OSM's only four-storey building there).
 */
export const BUILDING_WALLS: Record<string, string> = {
  'Apex Mountain Inn': '#d3a948',
  // Barn-red timber from the aerial; modest hero tint for the Saloon shell.
  'Gunbarrel Saloon': '#8c3b2b',
}

/** Named shells that get a modest hero massing pass in buildingView (not a rebuild). */
export const HERO_BUILDINGS = new Set(['Gunbarrel Saloon', 'Apex Mountain Inn'])

export function buildingName(name: string | null | undefined): string | null {
  if (!name) return null
  const fix = BUILDING_NAMES.find(([pattern]) => pattern.test(name.trim()))
  return fix ? fix[1] : name.trim()
}

/**
 * Peaks OSM does not have inside our crop. Apex Mountain (2247 m, trail map)
 * is the separate summit 2.4 km south of Beaconsfield, behind the Wildside;
 * located as the highest point of the NRCan horizon grid.
 */
export const EXTRA_PEAKS: Peak[] = [{ name: 'Apex Mountain', x: 1768, z: 3988, ele: 2247 }]

/**
 * The summit has one building: the Billy Goat Hut, a small cabin beside the
 * Quickdraw top (now a ski patrol cabin; sonnybou.ca trip report, see
 * game/research/apex-references.md). OSM has four untagged footprints there.
 * The one on the summit point becomes the hut; the others are dropped (Stu's
 * 0.9.13 playtest: "there just needs to be one"). The two south of the hut
 * are where world/telecom.ts puts the Beaconsfield cell towers instead.
 */
export const SUMMIT_HUT_FOOTPRINT = 'way/171556503'
export const DROPPED_BUILDINGS = new Set(['way/171556518', 'way/171556521', 'way/171556575'])

/** Apply the fixes in place. */
export function applyCorrections(resort: Resort): void {
  for (const run of resort.runs) {
    run.name = RUN_NAMES[run.name] ?? run.name
  }
  resort.runs = mergeRuns(resort.runs)
  resort.runs = resort.runs.flatMap((run) => {
    const split = RUN_SPLITS.find((s) => s.name === run.name && run.kind === 'line')
    return split ? splitRun(run, split) : [run]
  })
  for (const run of resort.runs) {
    const difficulty = DIFFICULTY_FIXES[run.name]
    if (difficulty) run.difficulty = difficulty
    const style = RUN_STYLE[run.name]
    if (style) Object.assign(run, style)
  }
  if (resort.buildings) resort.buildings = resort.buildings.filter((b) => !(b.id && DROPPED_BUILDINGS.has(b.id)))
  for (const peak of EXTRA_PEAKS) if (!resort.peaks.some((p) => p.name === peak.name)) resort.peaks.push({ ...peak })
}

/** Join runs that share a merged name into one run with all their lines. */
function mergeRuns(runs: Run[]): Run[] {
  const merged = new Map<string, Run>()
  const out: Run[] = []
  for (const run of runs) {
    if (!MERGED_RUNS.has(run.name)) {
      out.push(run)
      continue
    }
    const into = merged.get(run.name)
    if (into) into.parts.push(...run.parts)
    else {
      const copy = { ...run, parts: [...run.parts] }
      merged.set(run.name, copy)
      out.push(copy)
    }
  }
  return out
}

/**
 * Cut a run into its upper and lower parts at the point on its lines nearest
 * `at`. Lines run downhill, so the part before the cut is the upper run.
 */
export function splitRun(run: Run, split: { at: [number, number]; upper: string; lower: string }): Run[] {
  let best = { part: -1, segment: 0, t: 0, d: Infinity }
  run.parts.forEach((line, part) => {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1]
      const [bx, bz] = line[i]
      const dx = bx - ax
      const dz = bz - az
      const lengthSq = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((split.at[0] - ax) * dx + (split.at[1] - az) * dz) / lengthSq))
      const d = Math.hypot(ax + dx * t - split.at[0], az + dz * t - split.at[1])
      if (d < best.d) best = { part, segment: i, t, d }
    }
  })
  if (best.part < 0 || best.d > 60) return [run]
  const line = run.parts[best.part]
  const [ax, az] = line[best.segment - 1]
  const [bx, bz] = line[best.segment]
  const cut: [number, number] = [ax + (bx - ax) * best.t, az + (bz - az) * best.t]
  const above = [...line.slice(0, best.segment), cut]
  const below = [cut, ...line.slice(best.segment)]
  const others = run.parts.filter((_, i) => i !== best.part)
  return [
    { ...run, id: `${run.id}/upper`, name: split.upper, parts: [above, ...others] },
    { ...run, id: `${run.id}/lower`, name: split.lower, parts: [below] },
  ]
}
