// Snowboard on the live build: select it through the real Rider menu, then ride the Chute course with real keys:
// straight, toe-side (D), heel-side (A), stop (S), pop (Space), recording telemetry and screenshots.
import { open, note, closeBrowser, save, csv, releaseAll } from './p25_lib.mjs'
const OUTD = '/workspace/apex-playtest/2026-11-25/snowboard/live'
const { page } = await open('?test', { viewport: { width: 1100, height: 650 }, settings: { quality: 'low', shadows: 'off', viewDistance: 0.6, npcs: false, music: false, volume: 0 } })
const S = (f, a) => page.evaluate(f, a)
const snap = async (n) => { await page.screenshot({ path: `${OUTD}/${n}.jpg`, type: 'jpeg', quality: 80, timeout: 120000 }); note('sb shot ' + n) }
note(`sb: version ${await S(() => document.querySelector('#hud-version')?.textContent || document.querySelector('#version')?.textContent)} load ${page.loadMs} ms`)
const titleButtons = await S(() => [...document.querySelectorAll('#title-screen button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()))
note('sb: title buttons ' + JSON.stringify(titleButtons))
const r1 = await S(() => { const b = [...document.querySelectorAll('button')].find((b) => /Outfit, skis or snowboard/.test(b.textContent)); b?.click(); return !!b })
await page.waitForTimeout(1500)
await snap('01_rider_panel')
const models = await S(() => [...document.querySelectorAll('button.model')].map((b) => b.textContent.replace(/\s+/g, ' ').trim() + ' pressed=' + b.getAttribute('aria-pressed')))
note(`sb: rider button clicked=${r1}; models ${JSON.stringify(models)}`)
await S(() => [...document.querySelectorAll('button.model')].find((b) => /Snowboard/.test(b.textContent))?.click())
await page.waitForTimeout(2500)
await snap('02_snowboard_selected_preview')
const stance = await S(() => [...document.querySelectorAll('button, label, span')].map((e) => e.textContent.trim()).filter((t) => /goofy|regular|stance|switch/i.test(t)).slice(0, 10))
note(`sb: outfit stored ${await S(() => localStorage.getItem('skiscrapex.outfit'))}; stance/goofy options in DOM: ${JSON.stringify(stance)}`)
await page.keyboard.press('Escape'); await page.waitForTimeout(800); await page.keyboard.press('Escape'); await page.waitForTimeout(800)
// Start the Chute and ride it by hand-timed keys.
await S(() => window.__game.startEvent('shoot-the-chute'))
await page.waitForTimeout(500)
await S(() => { window.__rec = []; window.__recOn = true; const tick = () => { if (!window.__recOn) return; const s = window.__game.skier; window.__rec.push({ t: +performance.now().toFixed(0), st: +s.time.toFixed(2), kmh: +(s.speed * 3.6).toFixed(1), hdg: +(s.heading * 57.3).toFixed(1), trav: +(Math.atan2(-s.vx, s.vz) * 57.3).toFixed(1), edge: +(s.edgeAngle * 57.3).toFixed(1), skid: +(s.skid ?? 0).toFixed(3), mode: s.mode, gnd: s.grounded ? 1 : 0, sw: s.ridingSwitch ? 1 : 0, rad: +(s.carveRadius ?? -1).toFixed(1), air: s.air ? +s.air.time.toFixed(2) : 0, crash: s.crashed > 0 ? 1 : 0, x: +s.x.toFixed(1), z: +s.z.toFixed(1) }); requestAnimationFrame(tick) }; tick() })
const st = () => S(() => ({ kmh: +(window.__game.skier.speed * 3.6).toFixed(1), mode: window.__game.skier.mode, count: document.querySelector('#race-count')?.textContent, time: document.querySelector('#time')?.textContent, res: !document.querySelector('#results')?.hidden }))
for (let i = 0; i < 60; i++) { const s = await st(); if (s.count === 'GO!' || (s.count === '' && s.time !== '0:00.0')) break; await page.waitForTimeout(300) }
await snap('03_start_gate')
const phase = async (name, keysDown, ms, shotAt = []) => {
  await releaseAll(page); for (const k of keysDown) await page.keyboard.down(k)
  const t0 = Date.now(); let k = 0
  while (Date.now() - t0 < ms) { if (shotAt[k] !== undefined && Date.now() - t0 >= shotAt[k]) { await snap(`${name}_${k}`); k++ } await page.waitForTimeout(150) }
  note(`sb phase ${name}: ${JSON.stringify(await st())}`)
}
await phase('04_push', ['KeyW'], 30000, [12000])
await phase('05_straight', ['KeyW'], 12000, [4000, 9000])
await phase('06_toeside_D', ['KeyD'], 2500, [600, 1500])
await phase('07_heelside_A', ['KeyA'], 2500, [600, 1500])
await phase('08_toeside_D', ['KeyD'], 1800, [700])
await phase('09_heelside_A', ['KeyA'], 1800, [700])
await phase('10_straight', ['KeyW'], 6000, [3000])
await phase('11_pop', ['Space'], 400, [])
await phase('11b_air', [], 900, [100, 500])
await phase('12_stop_S', ['KeyS'], 4000, [500, 1500, 3500])
await phase('13_still', [], 2000, [1000])
await releaseAll(page)
const rec = await S(() => { window.__recOn = false; return window.__rec })
csv('../snowboard/live/live_chute_board', rec)
save('../snowboard/live/live_chute_board', { rec: rec.length })
note(`sb: recorded ${rec.length} samples; fps ~ ${(rec.length / ((rec.at(-1).t - rec[0].t) / 1000)).toFixed(1)}`)
await closeBrowser()
