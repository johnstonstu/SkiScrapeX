#!/usr/bin/env node
/**
 * Smoke run through the game modes on a built game: title, free ski from the
 * chair arrival to the top of the lift, the pause menu, a lift ride, an event,
 * a park, the test slopes and the tutorial. Prints the skier and HUD state at
 * each point and exits 1 on any page error. Run it on two builds and diff the
 * output to check that a refactor changes nothing.
 *
 *   npm run build
 *   node scripts/smoke-modes.mjs dist > after.json
 *
 * Needs Playwright's Chromium (`playwright` or `playwright-core`). The frame
 * clock is held at 6 Hz so a slow software GPU still covers game time.
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = await import('playwright-core').catch(() => require('playwright'))
const dist = resolve(process.argv[2] ?? 'dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' }
const server = createServer((req, res) => { const path = join(dist, decodeURIComponent(new URL(req.url, 'http://x').pathname)); const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path; if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end(); res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file)) })
await new Promise((d) => server.listen(0, d))
const base = `http://localhost:${server.address().port}/`
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const out = {}
async function open(q) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()) })
  await page.addInitScript(() => { localStorage.setItem('skiscrapex.settings', JSON.stringify({ quality: 'low', npcs: false, shadows: 'off' })); const raf = window.requestAnimationFrame.bind(window); let t = 0; window.requestAnimationFrame = (cb) => raf(() => { t += 1000 / 6; cb(t) }) })
  await page.goto(base + '?test' + q)
  await page.waitForFunction(() => window.__game?.skier && document.querySelector('#status')?.textContent === '', null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(3000)
  return page
}
const st = (page) => page.evaluate(() => { const g = window.__game, s = g.skier; return { mode: s.mode, x: Math.round(s.x), z: Math.round(s.z), speed: +s.speed.toFixed(1), challenge: g.challenge.kind, title: document.querySelector('#run-name')?.textContent, ride: !document.querySelector('#ride')?.hidden, menu: !document.querySelector('#pause-menu')?.hidden, titleScreen: !document.querySelector('#title-screen')?.hidden } })
// 1. Title -> Free ski: chair arrival, then off the lift.
{
  const p = await open('')
  out.title = await st(p)
  await p.locator('.title-buttons button').filter({ hasText: /Free ski|Continue/ }).first().click()
  await p.waitForTimeout(500)
  out.boarding = await st(p)
  await p.waitForTimeout(12000)
  out.offLift = await st(p)
  await p.keyboard.down('ArrowLeft'); await p.waitForTimeout(3000); await p.keyboard.up('ArrowLeft')
  out.skiing = await st(p)
  await p.waitForTimeout(30000)
  out.topOfLift = await st(p)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  out.paused = await st(p)
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  out.resumed = await st(p)
  out.errors1 = p.errors
  await p.close()
}
// 2. Ride a lift and skip.
{
  const p = await open('&ride=quickdraw')
  out.ride = await st(p)
  await p.keyboard.press('Enter'); await p.waitForTimeout(300); await p.keyboard.press('Enter'); await p.waitForTimeout(4000)
  out.rideSkipped = await st(p)
  out.errors2 = p.errors
  await p.close()
}
// 3. Event and park.
{
  const p = await open('&at=1124,955,180')
  out.event = await p.evaluate(() => window.__game.startEvent('apex-slalom'))
  await p.waitForTimeout(2000)
  out.inEvent = await st(p)
  await p.keyboard.down('ArrowUp'); await p.waitForTimeout(4000); await p.keyboard.up('ArrowUp')
  out.eventRun = await st(p)
  out.errors3 = p.errors
  await p.close()
}
{
  const p = await open('&park=claim')
  await p.waitForTimeout(3000)
  out.park = await st(p)
  out.errors4 = p.errors
  await p.close()
}
// 4. Dev slope and tutorial.
{
  const p = await open('&dev')
  out.dev = await st(p)
  await p.keyboard.press('Digit2'); await p.waitForTimeout(2000)
  out.dev2 = await st(p)
  out.errors5 = p.errors
  await p.close()
}
{
  const p = await open('')
  const learn = p.locator('.title-buttons button').filter({ hasText: /Learn|lesson|Tutorial/i }).first()
  if (await learn.count()) { await learn.click(); await p.waitForTimeout(3000); out.tutorial = await st(p) } else out.tutorial = 'no button'
  out.errors6 = p.errors
  await p.close()
}
console.log(JSON.stringify(out, null, 1))
await browser.close(); server.close()
const errors = Object.entries(out).filter(([k, v]) => k.startsWith('errors') && v.length)
if (errors.length) {
  console.error('Page errors:', JSON.stringify(Object.fromEntries(errors)))
  process.exit(1)
}
