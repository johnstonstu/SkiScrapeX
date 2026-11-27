#!/usr/bin/env node
/**
 * Draw calls, triangles, programs and load time at the five standard spots,
 * for each graphics level, from a built game. Counts are valid in headless
 * Chromium with a software GPU; frame times are not.
 *
 *   npm i --no-save playwright-core      (once; uses Playwright's Chromium)
 *   npm run build
 *   node scripts/perf-spots.mjs --dist dist --levels low,medium,high --label current
 *
 * Options: --dist <dir> (served on a free port) or --url <base>, --levels,
 * --spots (names below), --label, --out <file.jsonl>, --budget (exit 1 when a
 * spot draws more triangles than TRIANGLE_BUDGET allows for its level). CHROME_PATH picks the
 * browser binary. Settings are seeded per load (quality only), so it also
 * works on builds from before `?quality` existed.
 */
import { createServer } from 'node:http'
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

/** The five standard spots: map coordinates (metres) and heading (degrees), or a park. */
export const SPOTS = {
  start: '',
  village: '&at=2700,760,90',
  forest: '&at=1124,955,180',
  summit: '&at=1540,1540,90',
  park: '&park=claim',
}

/**
 * Most triangles a frame any standard spot may draw, per level: about 15% over
 * 0.9.47 (Low 0.64M, Medium 1.11M, High 1.30M at the village), so growth shows
 * up in review rather than on a phone.
 */
export const TRIANGLE_BUDGET = { low: 750_000, medium: 1_250_000, high: 1_500_000 }

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const levels = (args.levels ?? 'low,medium,high').split(',')
const spots = (args.spots ?? Object.keys(SPOTS).join(',')).split(',')
const label = args.label ?? 'build'
const out = args.out

let base = args.url
let server
if (!base) {
  const dist = resolve(args.dist ?? 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`No build at ${dist}; run npm run build first`)
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }
  server = createServer((req, res) => {
    const path = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path
    if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise((done) => server.listen(0, done))
  base = `http://localhost:${server.address().port}/`
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const rows = []
for (const level of levels) {
  for (const spot of spots) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.addInitScript((l) => localStorage.setItem('skiscrapex.settings', JSON.stringify({ quality: l })), level)
    await page.goto(`${base}?perf${SPOTS[spot]}`)
    // Wait until the draw count settles (detail tiles and forest stream in).
    let report = null
    let last = -1
    let steady = 0
    for (const started = Date.now(); Date.now() - started < 120000; ) {
      await page.waitForTimeout(3000)
      report = await page.evaluate(() => (window.__perf ? JSON.parse(JSON.stringify(window.__perf)) : null))
      const calls = report?.renderer?.calls ?? 0
      steady = calls > 0 && calls === last ? steady + 1 : 0
      last = calls
      if (steady >= 2) break
    }
    const row = {
      label,
      level,
      spot,
      calls: report?.renderer?.calls,
      triangles: report?.renderer?.triangles,
      programs: report?.renderer?.programs,
      geometries: report?.renderer?.geometries,
      textures: report?.renderer?.textures,
      heapMB: report?.renderer?.heapMB,
      loadMs: report?.phases?.total,
      errors: errors.length,
    }
    rows.push(row)
    if (out) appendFileSync(out, JSON.stringify(row) + '\n')
    console.log(JSON.stringify(row))
    await page.close()
  }
}
await browser.close()
server?.close()
if ('budget' in args) {
  const over = rows.filter((row) => (row.triangles ?? 0) > TRIANGLE_BUDGET[row.level])
  for (const row of over) console.error(`Over budget: ${row.level} ${row.spot} draws ${row.triangles} triangles (budget ${TRIANGLE_BUDGET[row.level]})`)
  if (over.length) process.exit(1)
}
