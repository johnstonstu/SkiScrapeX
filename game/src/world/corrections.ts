/**
 * Fixes to the OpenStreetMap data from Apex's own sources, so the game matches
 * the resort. Every entry says where it came from; see docs/run-names.md and
 * docs/apex-sources.md for the research.
 */
import type { Peak, Point2, Resort, Run } from './resort'

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
  // OSM's unnamed-looking "Glades" way is the line through Any Which Way Glades (research handoff).
  Glades: 'Any Which Way Glades',
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
  // L3 was named Chaser until the bowl pass (2026-11-27) put Chaser in the Quickdraw bowl.
  'Unmapped run L3': 'Unnamed cut L3',
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
 * big-mountain run with a cliff at the top and a rock band in the middle. The
 * rest are from the frames in the Apex research handoff (run-profiles.json,
 * `surfaceObserved` and `mogulsObserved`), which are snapshots of single days:
 * grooming at Apex changes day to day, so these are the usual state, not a rule.
 */
export const RUN_STYLE: Record<string, { groomed?: boolean; moguls?: boolean; chop?: boolean; packed?: boolean; halfWidth?: number }> = {
  // Mogul lanes need room; the LiDAR clearing under Quickdraw is wide (49 m median), and
  // powderhounds.com describes "wide-open bumps such as those under the quad chair".
  'West Bank': { groomed: false, moguls: true, halfWidth: 20 },
  // A wide big-mountain face, room to ski around the drops.
  'The Pit': { groomed: false, halfWidth: 22 },
  // Moguls seen in frames. Half widths are the LiDAR median open width halved,
  // less a little for the summer-to-winter edge, so the mogul lanes fit.
  // Sunbowl: "wide open bowl, ungroomed with moguls throughout" (66 m open).
  Sunbowl: { groomed: false, moguls: true, halfWidth: 26 },
  // Make My Day: "ungroomed steep slope with soft moguls", one run wide (33 m open).
  'Make My Day': { groomed: false, moguls: true, halfWidth: 14 },
  // Old Mill: ungroomed with moguls in both clips (70 m open).
  'Old Mill': { groomed: false, moguls: true, halfWidth: 22 },
  // Gunbarrel: already a mogul run in OSM; a narrow corridor (22 m open).
  Gunbarrel: { groomed: false, moguls: true },
  // K2: "narrow ungroomed line" with moguls (61 m open, tight at the top).
  K2: { groomed: false, moguls: true, halfWidth: 18 },
  // Ungroomed in the Romagnoli powder-day clips: soft bumps and chop, no corduroy.
  Crusher: { groomed: false, chop: true },
  Hanks: { groomed: false, chop: true },
  // "Packed/skier-tracked rather than freshly groomed" (Oviatt).
  "Grandmother's Trail": { packed: true },
  // A narrow cut (23 m open in the LiDAR); the blue-run default of 40 m cut into its trees.
  'Dawdler 1': { halfWidth: 11.5 },
  // Accuracy pass (2026-11-28): the wide groomers. The default blue is about 40 m of corduroy,
  // but these are groomed across clearings 60 to 150 m wide (LiDAR median open width in
  // run-profiles.json, in brackets) and the footage calls each of them wide: Juniper "wide
  // groomed open upper slope", Ridge Run "wide groomed slope", Okanagan Run "wide groomed slope
  // above the village", Golden Eagle "wide groomed corduroy", Village Traverse "wide gentle
  // traverse", Wild Bill "groomed, wide", Sluice Box "wide groomed run". The groomed width is at most 85% of
  // the clearing, so the corduroy stays inside the trees with powder left at the edges.
  // Blacks are left alone: the footage shows Chute and Gunbarrel skied as 15 to 20 m hallways
  // inside wider clearings. Stock's Traverse (85 m open) stays cat-track width, as filmed.
  'Okanagan Run': { halfWidth: 38 }, // 108 m
  Juniper: { halfWidth: 32 }, // 90 to 97 m
  'Ridge Run': { halfWidth: 32 }, // 93 m
  'Golden Eagle': { halfWidth: 26 }, // 90 m
  'Village Traverse': { halfWidth: 28 }, // 79 m
  'Wild Bill': { halfWidth: 25 }, // 63 m
  'Sluice Box': { halfWidth: 23 }, // 58 m
  // No footage; LiDAR only. The Magic Carpet learning slope (151 m open) and the T-Bar face (112 m).
  'Easy Rider': { halfWidth: 40 },
  "Adrian's Alley": { halfWidth: 32 },
}

/**
 * Where a run's mapped line is wrong for the hill, by name. `head` replaces the
 * top of the line down to where `head` ends (the old top stays as a branch when
 * `keepOldHead`), `tail` carries a line that stops short on down to the run it
 * feeds. Lines are downhill, local metres.
 *
 * Whole-mountain pass (2026-11-28), checked against the 2023 trail map, which
 * draws Westbank from the top of Quickdraw down the chair's south side (left,
 * looking up) with Grouse Gulch on its north side, and against Stu (2026-11-24):
 * West Bank is "a really fun kind of mogul run right underneath the
 * chairlift". OSM starts West Bank on Ridge Run 270 m from the chair and leaves
 * the lift-line fall line unmapped. The new head is the LiDAR fall line from
 * the unload, 20 to 50 m south of the cable (open, no canopy), meeting OSM's
 * line where it crosses under the chair. The tails link runs OSM ends in the
 * open to the next run down (the open corridor below West Bank reaches Village
 * Traverse; Grouse Gulch and cut L11 end beside West Bank and Grouse Gulch).
 * The short heads join runs OSM starts a little below the run that feeds them.
 */
export const RUN_LINE_FIXES: Record<string, { head?: Point2[]; keepOldHead?: boolean; tail?: Point2[] }> = {
  'West Bank': {
    head: [[1566, 1557], [1585, 1561], [1603, 1561], [1648, 1540], [1696, 1527], [1743, 1511], [1786, 1485], [1828, 1457], [1868, 1428], [1891, 1408]],
    keepOldHead: true,
    tail: [[2267, 1073], [2290, 1064], [2313, 1056], [2336, 1045], [2358, 1033], [2380, 1022], [2407, 1009]],
  },
  'Grouse Gulch': {
    head: [[1575, 1540], [1600, 1522], [1630, 1498], [1662, 1480], [1693, 1470]],
    tail: [[2170, 1060], [2205, 1066], [2240, 1072], [2271, 1072]],
  },
  // Off the ridge and Chute: OSM starts these 40 to 75 m short of the run above (open snow between).
  'Unnamed cut L11': { head: [[1518, 1437], [1555, 1455]], tail: [[1798, 1320], [1815, 1341]] },
  Gromit: { head: [[1262, 1318], [1272, 1275]] },
  K: { head: [[1275, 1322], [1297, 1275]] },
  Magnum: { head: [[1404, 1036], [1372, 1020], [1339, 1002]] },
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
    const fix = RUN_LINE_FIXES[run.name]
    if (fix && run.kind === 'line') fixRunLine(run, fix)
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

/** Swap in a run's corrected top and carry its bottom on (see RUN_LINE_FIXES). */
export function fixRunLine(run: Run, fix: (typeof RUN_LINE_FIXES)[string]): void {
  let line = run.parts[0]
  if (!line || line.length < 2) return
  const extra: Point2[][] = []
  if (fix.head && fix.head.length > 1) {
    const join = fix.head[fix.head.length - 1]
    let cut = 0
    let best = Infinity
    line.forEach(([x, z], i) => {
      const d = Math.hypot(x - join[0], z - join[1])
      if (d < best) ((best = d), (cut = i))
    })
    if (fix.keepOldHead && cut > 0) extra.push([...line.slice(0, cut + 1)])
    line = [...fix.head, ...line.slice(cut + 1)]
  }
  if (fix.tail) line = [...line, ...fix.tail]
  run.parts = [line, ...run.parts.slice(1), ...extra]
}
