#!/usr/bin/env node
/**
 * Capture README stills and short clips from a built game (or a live URL).
 *
 *   npm i --no-save playwright-core
 *   npm run build
 *   node scripts/readme-media.mjs --dist dist --out ../docs/media
 *
 * Options: --dist <dir>, --url <base>, --out <dir>, --level high|medium|low
 * CHROME_PATH overrides the browser binary. Prefer a real GPU when available;
 * falls back to SwiftShader if WebGL is unavailable.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const STILLS = {
  // Summit ridge / Billy Goat area on Beaconsfield.
  summit: { query: '&at=1540,1540,90', waitMs: 9000 },
  // Stock's Traverse overlooking the base village.
  village: { query: '&at=2700,760,105', waitMs: 9000 },
  // Claim Jumper park start, then a short ski into features.
  park: { query: '&park=claim', waitMs: 8000, skiMs: 3500 },
  // Tree skiing off Gunbarrel.
  forest: { query: '&at=1124,955,200', waitMs: 8000 },
  // Grandfather's Trail from Quickdraw top.
  groomer: { query: '', waitMs: 8000 },
  // Trail map panel (T).
  map: { query: '', waitMs: 6000, press: 'KeyT' },
}

const CLIPS = {
  carve: {
    query: '',
    seconds: 3.2,
    async play(page) {
      await page.keyboard.down('KeyD')
      await page.waitForTimeout(900)
      await page.keyboard.up('KeyD')
      await page.keyboard.down('KeyA')
      await page.waitForTimeout(1100)
      await page.keyboard.up('KeyA')
      await page.keyboard.down('KeyD')
      await page.waitForTimeout(900)
      await page.keyboard.up('KeyD')
    },
  },
  powder: {
    query: '&at=1124,955,200',
    seconds: 3.2,
    async play(page) {
      await page.keyboard.down('KeyW')
      await page.waitForTimeout(500)
      await page.keyboard.down('KeyA')
      await page.waitForTimeout(900)
      await page.keyboard.up('KeyA')
      await page.keyboard.down('KeyD')
      await page.waitForTimeout(1100)
      await page.keyboard.up('KeyD')
      await page.keyboard.up('KeyW')
    },
  },
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
)
const level = args.level ?? 'high'
const outDir = resolve(args.out ?? '../docs/media')
mkdirSync(outDir, { recursive: true })
mkdirSync(join(outDir, 'raw'), { recursive: true })

let base = args.url
let server
if (!base) {
  const dist = resolve(args.dist ?? 'dist')
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`No build at ${dist}; run npm run build first`)
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.bin': 'application/octet-stream',
    '.u8': 'application/octet-stream',
    '.u16': 'application/octet-stream',
    '.f32': 'application/octet-stream',
    '.delta.bin': 'application/octet-stream',
  }
  server = createServer((req, res) => {
    const path = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path
    if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end()
    const type = types[extname(file)] ?? 'application/octet-stream'
    res.writeHead(200, { 'content-type': type }).end(readFileSync(file))
  })
  await new Promise((done) => server.listen(0, done))
  base = `http://127.0.0.1:${server.address().port}/`
}
console.log('base', base)

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const launchArgs = existsSync(chromePath)
  ? { executablePath: chromePath, args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=angle'] }
  : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }

async function openGame(browser, query, { record } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    recordVideo: record ? { dir: join(outDir, 'raw'), size: { width: 1280, height: 720 } } : undefined,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript((l) => {
    localStorage.setItem('skiscrapex.settings', JSON.stringify({ quality: l, shadows: true }))
  }, level)
  await page.goto(`${base}?test&perf${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  // Wait for the world to stream in.
  let report = null
  let last = -1
  let steady = 0
  for (const started = Date.now(); Date.now() - started < 90000; ) {
    await page.waitForTimeout(2000)
    report = await page.evaluate(() => (window.__perf ? JSON.parse(JSON.stringify(window.__perf)) : null))
    const calls = report?.renderer?.calls ?? 0
    steady = calls > 0 && calls === last ? steady + 1 : 0
    last = calls
    if (steady >= 2) break
  }
  if (!report?.renderer?.calls) {
    console.warn('no renderer calls yet', errors.slice(0, 3))
  }
  return { context, page, errors, report }
}

function ffmpeg(...argv) {
  const r = spawnSync('ffmpeg', ['-y', ...argv], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(r.stderr)
    throw new Error(`ffmpeg failed: ${argv.join(' ')}`)
  }
}

function shrinkStill(src, destWebp, destPng) {
  // README-friendly: ~1280 wide, compressed.
  ffmpeg('-i', src, '-vf', 'scale=1280:-2', '-q:v', '2', destPng)
  ffmpeg('-i', src, '-vf', 'scale=1280:-2', '-quality', '78', destWebp)
}

const browser = await chromium.launch({
  headless: true,
  ...launchArgs,
})

const manifest = { version: '0.9.13', level, stills: {}, clips: {}, base }

const only = args.only ? new Set(String(args.only).split(',')) : null

for (const [name, spot] of Object.entries(STILLS)) {
  if (only && !only.has(name) && !only.has('stills')) continue
  console.log('still', name)
  const { context, page, report } = await openGame(browser, spot.query)
  await page.waitForTimeout(spot.waitMs)
  if (spot.skiMs) {
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(spot.skiMs)
    await page.keyboard.up('KeyW')
    await page.waitForTimeout(400)
  }
  if (spot.press) {
    await page.keyboard.press(spot.press)
    await page.waitForTimeout(900)
  }
  const raw = join(outDir, 'raw', `${name}.png`)
  await page.screenshot({ path: raw, type: 'png' })
  shrinkStill(raw, join(outDir, `${name}.webp`), join(outDir, `${name}.png`))
  manifest.stills[name] = { calls: report?.renderer?.calls, triangles: report?.renderer?.triangles }
  await context.close()
}

for (const [name, clip] of Object.entries(CLIPS)) {
  if (only && !only.has(name) && !only.has('clips')) continue
  console.log('clip', name)
  const { context, page } = await openGame(browser, clip.query, { record: true })
  await page.waitForTimeout(6000)
  await clip.play(page)
  await page.waitForTimeout(400)
  const videoPath = await page.video().path()
  await context.close()
  const webm = join(outDir, 'raw', `${name}.webm`)
  renameSync(videoPath, webm)
  // Seek near the end so the clip is the action, not the load wait.
  const duration = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', webm], { encoding: 'utf8' }).stdout)
  const seek = Math.max(0, duration - clip.seconds - 0.4)
  const mp4 = join(outDir, `${name}.mp4`)
  ffmpeg('-ss', String(seek), '-i', webm, '-t', String(clip.seconds), '-an', '-vf', 'fps=12,scale=720:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4)
  ffmpeg(
    '-ss', String(seek), '-i', webm, '-t', String(clip.seconds),
    '-vf', 'fps=8,scale=480:-2:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5',
    '-loop', '0', join(outDir, `${name}.gif`),
  )
  manifest.clips[name] = { seconds: clip.seconds, seek }
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
await browser.close()
server?.close()
console.log('wrote', outDir)
