// Snowboard rider-lab close-ups: each pose from several camera angles (static pose row, real model).
import { getBrowser, note, closeBrowser } from './p25_lib.mjs'
const OUT = '/workspace/apex-playtest/2026-11-25/snowboard/lab'
const BASE = 'https://johnstonstu.github.io/SkiScrapeX/rider.html'
const poses = JSON.parse(process.argv[2] || '["standing"]')
const views = JSON.parse(process.argv[3] || '{"a":[0,1.2,4]}')
const extra = process.argv[4] || ''
const b = await getBrowser()
for (const p of poses) {
  for (const [vname, [cx, cy, cz]] of Object.entries(views)) {
    const ctx = await b.newContext({ viewport: { width: 900, height: 900 } })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => note(`boardlab ${p} pageerror ${e.message}`))
    await page.goto(`${BASE}?model=snowboard&pose=${p}&cx=${cx}&cy=${cy}&cz=${cz}&ty=0.7${extra}`)
    await page.waitForTimeout(6000)
    const label = await page.evaluate(() => document.querySelector('#labels')?.textContent)
    await page.screenshot({ path: `${OUT}/${p}_${vname}.jpg`, type: 'jpeg', quality: 80 })
    note(`boardlab ${p} ${vname} label=${label}`)
    await ctx.close()
  }
}
await closeBrowser()
