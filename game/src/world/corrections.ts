/**
 * Fixes to the OpenStreetMap data from Apex's own sources, so the game matches
 * the resort. Every entry says where it came from; see docs/run-names.md and
 * docs/apex-sources.md for the research.
 */
import type { Peak, Resort } from './resort'

/**
 * Official difficulty where OSM disagrees. Source: Apex trail maps (2023 and
 * 2026/27) and the Wikipedia run list by lift, read 2026-11-22.
 */
export const DIFFICULTY_FIXES: Record<string, string> = {
  // Blue square on both trail maps; Wikipedia lists "Wishbone" as intermediate.
  'Upper Wishbone': 'intermediate',
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

/** Apply the fixes in place. */
export function applyCorrections(resort: Resort): void {
  for (const run of resort.runs) {
    run.name = RUN_NAMES[run.name] ?? run.name
    const difficulty = DIFFICULTY_FIXES[run.name]
    if (difficulty) run.difficulty = difficulty
  }
  for (const peak of EXTRA_PEAKS) if (!resort.peaks.some((p) => p.name === peak.name)) resort.peaks.push({ ...peak })
}
