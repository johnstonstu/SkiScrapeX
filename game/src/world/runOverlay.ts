import type { Run } from './resort'

/**
 * Runs OpenStreetMap does not map at Apex, found as cleared corridors in the
 * LidarBC canopy by scripts/detect-runs.py and reviewed by hand. Local metres
 * (+X east, +Z south), downhill order. Names are provisional until checked
 * against the trail map: `W` refs are the south-facing Wildside cuts below
 * Hang'em High, `L` refs are cut lines elsewhere. Rename here; the refs match
 * docs/runs-overlay.png. docs/run-names.md has the evidence for each name: L8
 * Highway 97C and L12 Mini-Colorado match the trail map; L15 Crusher is the
 * likeliest of its neighbours. The rest are cuts the trail maps do not name.
 */
export interface OverlayRun {
  ref: string
  name: string
  difficulty: string
  groomed: boolean
  /** Mean pitch along the line, degrees, and length and drop in metres (for review). */
  pitch: number
  length: number
  drop: number
  points: [number, number][]
}

export const OVERLAY_RUNS: OverlayRun[] = [
  { ref: 'W1', name: 'Wildside cut 1', difficulty: 'advanced', groomed: false, pitch: 23.5, length: 394, drop: 127, points: [[1610, 2095], [1610, 2110], [1625, 2120], [1630, 2135], [1660, 2165], [1680, 2160], [1695, 2165], [1700, 2175], [1695, 2210], [1735, 2275], [1745, 2275], [1765, 2295], [1805, 2290], [1815, 2300], [1825, 2295], [1845, 2305]] },
  { ref: 'W2', name: 'Wildside cut 2', difficulty: 'expert', groomed: false, pitch: 30.7, length: 144, drop: 79, points: [[1770, 2120], [1815, 2160], [1815, 2175], [1830, 2195], [1830, 2215], [1845, 2230]] },
  { ref: 'W3', name: 'Wildside cut 3', difficulty: 'advanced', groomed: false, pitch: 26.0, length: 301, drop: 116, points: [[1865, 2170], [1885, 2175], [1890, 2190], [1915, 2205], [1920, 2245], [1945, 2265], [1945, 2280], [1960, 2295], [1960, 2320], [1955, 2325], [1980, 2330], [1990, 2340], [1985, 2360], [2005, 2370]] },
  { ref: 'W4', name: 'Wildside cut 4', difficulty: 'advanced', groomed: false, pitch: 22.6, length: 233, drop: 89, points: [[2185, 2225], [2185, 2240], [2195, 2250], [2200, 2310], [2210, 2345], [2260, 2405], [2280, 2410]] },
  { ref: 'W5', name: 'Wildside cut 5', difficulty: 'advanced', groomed: false, pitch: 25.8, length: 208, drop: 95, points: [[2305, 2205], [2335, 2265], [2365, 2305], [2425, 2360]] },
  { ref: 'W6', name: 'Wildside cut 6', difficulty: 'advanced', groomed: false, pitch: 23.7, length: 218, drop: 89, points: [[2395, 2185], [2410, 2190], [2440, 2220], [2465, 2275], [2465, 2310], [2475, 2325], [2475, 2340], [2490, 2355]] },
  { ref: 'L1', name: 'Unmapped run L1', difficulty: 'intermediate', groomed: true, pitch: 16.6, length: 198, drop: 53, points: [[2060, 560], [2065, 555], [2125, 555], [2145, 545], [2230, 545], [2250, 550]] },
  { ref: 'L2', name: 'Unmapped run L2', difficulty: 'intermediate', groomed: true, pitch: 16.5, length: 447, drop: 61, points: [[1700, 610], [1730, 610], [1735, 605], [1750, 610], [1775, 610], [1780, 605], [1790, 610], [1795, 635], [1815, 655], [1815, 680], [1840, 695], [1880, 690], [1980, 610], [2000, 605], [2035, 610]] },
  { ref: 'L3', name: 'Unmapped run L3', difficulty: 'advanced', groomed: false, pitch: 23.6, length: 156, drop: 51, points: [[1475, 715], [1475, 700], [1490, 685], [1490, 660], [1480, 650], [1485, 630], [1475, 620], [1485, 600], [1485, 580]] },
  { ref: 'L4', name: 'Unmapped run L4', difficulty: 'intermediate', groomed: false, pitch: 19.1, length: 558, drop: 170, points: [[1925, 860], [2030, 790], [2105, 755], [2190, 690], [2255, 650], [2355, 600], [2375, 600]] },
  { ref: 'L5', name: 'Unmapped run L5', difficulty: 'intermediate', groomed: true, pitch: 17.8, length: 471, drop: 135, points: [[2030, 860], [2065, 840], [2080, 840], [2115, 810], [2140, 810], [2205, 780], [2225, 780], [2260, 765], [2315, 720], [2345, 715], [2400, 645]] },
  { ref: 'L6', name: 'Unmapped run L6', difficulty: 'easy', groomed: false, pitch: 15.6, length: 213, drop: 54, points: [[2225, 875], [2300, 840], [2365, 775], [2375, 775], [2385, 760]] },
  { ref: 'L7', name: 'Unmapped run L7', difficulty: 'advanced', groomed: true, pitch: 24.0, length: 185, drop: 66, points: [[1760, 910], [1785, 915], [1870, 980], [1910, 995]] },
  { ref: 'L8', name: 'Highway 97C', difficulty: 'intermediate', groomed: false, pitch: 24.5, length: 155, drop: 61, points: [[1545, 1060], [1570, 1035], [1585, 1030], [1610, 995], [1635, 975], [1640, 965], [1635, 955]] },
  { ref: 'L9', name: 'Unmapped run L9', difficulty: 'advanced', groomed: false, pitch: 28.0, length: 239, drop: 120, points: [[1535, 1315], [1550, 1290], [1600, 1240], [1620, 1210], [1675, 1165], [1700, 1165]] },
  { ref: 'L10', name: 'Unmapped run L10', difficulty: 'expert', groomed: false, pitch: 36.8, length: 151, drop: 97, points: [[1925, 1450], [1945, 1425], [1970, 1415], [1990, 1390], [2010, 1380], [2025, 1355]] },
  { ref: 'L11', name: 'Unmapped run L11', difficulty: 'advanced', groomed: false, pitch: 27.3, length: 353, drop: 139, points: [[1555, 1455], [1560, 1460], [1590, 1460], [1605, 1440], [1640, 1445], [1680, 1435], [1715, 1400], [1720, 1380], [1715, 1370], [1725, 1360], [1725, 1340], [1745, 1325], [1770, 1330], [1780, 1300]] },
  { ref: 'L12', name: 'Mini-Colorado', difficulty: 'expert', groomed: false, pitch: 34.6, length: 277, drop: 164, points: [[1955, 1500], [1990, 1495], [2030, 1465], [2035, 1450], [2075, 1400], [2080, 1365], [2125, 1320]] },
  { ref: 'L13', name: 'Unmapped run L13', difficulty: 'expert', groomed: false, pitch: 33.4, length: 270, drop: 56, points: [[1635, 1590], [1665, 1600], [1675, 1610], [1720, 1605], [1735, 1630], [1760, 1630], [1765, 1635], [1770, 1665], [1760, 1690], [1740, 1710], [1720, 1715]] },
  { ref: 'L14', name: 'Unmapped run L14', difficulty: 'expert', groomed: false, pitch: 32.5, length: 158, drop: 68, points: [[1835, 1590], [1845, 1600], [1865, 1605], [1880, 1620], [1905, 1610], [1915, 1615], [1920, 1620], [1925, 1670]] },
  { ref: 'L15', name: 'Crusher', difficulty: 'advanced', groomed: true, pitch: 24.7, length: 507, drop: 196, points: [[1610, 1730], [1635, 1775], [1635, 1785], [1665, 1810], [1675, 1830], [1670, 1845], [1685, 1870], [1705, 1865], [1820, 1865], [1855, 1885], [1860, 1880], [1900, 1880], [1915, 1890], [1945, 1895], [1975, 1930]] },
]

/** Overlay runs as resort runs. `downhill` orders each line by the height grid. */
export function overlayRuns(downhill: (part: [number, number][]) => [number, number][]): Run[] {
  return OVERLAY_RUNS.map((run) => ({
    id: `lidar/${run.ref}`,
    name: run.name,
    difficulty: run.difficulty,
    groomed: run.groomed,
    wooded: false,
    moguls: false,
    kind: 'line' as const,
    parts: [downhill(run.points)],
  }))
}
