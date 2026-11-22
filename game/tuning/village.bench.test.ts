import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import { loadDiskGrid } from '../tests/diskGrid'
import { resortFromFeatures } from '../src/world/resort'
import { buildBuildings } from '../src/world/buildings'
import { findLots } from '../src/world/village'

it.runIf(process.env.BENCH)('village lots', () => {
  const DATA = 'public/data/'
  const grid = loadDiskGrid(DATA)
  const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
  const cover = readFileSync(`${DATA}canopy-cover.u8`)
  const canopy = { cover: Float32Array.from(cover, (b) => b / 255), height: new Float32Array(cover.length) }
  const buildings = buildBuildings(resort.buildings, grid.heightAt)
  const t0 = performance.now()
  const lots = findLots(grid, canopy, resort.roads, resort.runs, buildings)
  const ms = performance.now() - t0
  const signature = lots.map((l) => `${l.cells.length}:${l.centre.map((v) => v.toFixed(1)).join(',')}`).join(' ')
  console.log(`lots ${lots.length} in ${ms.toFixed(0)} ms\n${signature}`)
}, 60000)

it.runIf(process.env.BENCH)('forest', async () => {
  const { plantForest } = await import('../src/world/forest')
  const { buildSurface } = await import('../src/world/surface')
  const DATA = 'public/data/'
  const grid = loadDiskGrid(DATA)
  const resort = resortFromFeatures(JSON.parse(readFileSync(`${DATA}features.json`, 'utf8')), grid.heightAt)
  const canopy = { cover: Float32Array.from(readFileSync(`${DATA}canopy-cover.u8`), (b) => b / 255), height: Float32Array.from(readFileSync(`${DATA}canopy-height.u8`), (b) => b / 4) }
  let t0 = performance.now()
  const surface = buildSurface(grid, resort, 2.5, [])
  console.log(`surface ${(performance.now() - t0).toFixed(0)} ms`)
  t0 = performance.now()
  const forest = plantForest(grid, resort, surface, canopy, { originElevation: 1600 })
  const sum = forest.chunks.reduce((a, c) => a + c.trees.reduce((b, t) => b + t.x + t.z * 3 + t.height, 0), 0)
  console.log(`forest ${forest.count} trees in ${(performance.now() - t0).toFixed(0)} ms, checksum ${sum.toFixed(2)}`)
}, 60000)
