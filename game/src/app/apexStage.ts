import { createSummitFlags } from '../render/scenery/summitFlags'
import { createBoundaryView } from '../render/scenery/boundaryView'
import * as THREE from 'three'
import type { Slope } from '../sim'
import type { World } from '../world/loadWorld'
import { buildSurface, type SurfaceField } from '../world/surface'
import { buildExposure } from '../world/exposure'
import { EXTRA_PEAKS, SUMMIT_HUT_FOOTPRINT } from '../world/corrections'
import { apexMountainTowers, beaconsfieldTowers } from '../world/telecom'
import { createTelecomView } from '../render/scenery/telecomView'
import { buildMoguls } from '../world/moguls'
import { buildCliffs, nearOutcrop, placeRunDrops, placeTowerDrop, TOWER_DROP } from '../world/cliffs'
import { createSnowDeform, createStamper } from '../world/snowDeform'
import { createSnowPatchView } from '../render/terrain/snowPatchView'
import { createCliffView } from '../render/terrain/cliffView'
import { buildApron } from '../world/apron'
import { indexTrunks, plantApronForest, plantForest } from '../world/forest'
import { buildBuildings, indexBuildings, type Building } from '../world/buildings'
import { buildVillage } from '../world/village'
import { buildParkOverlay, LAYOUTS, parkOnRun, parkSitesFromLines, placeFeatures, type ParkOverlay, type ParkSite } from '../world/park'
import { pointAlong } from '../world/resort'
import { createSurfaceSampler } from '../world/snow'
import { createTerrainView } from '../render/terrain/terrainView'
import { createMogulView } from '../render/terrain/mogulView'
import { createApronView } from '../render/terrain/apronView'
import { createForestView } from '../render/scenery/forestView'
import { createLiftView } from '../render/scenery/liftView'
import { createBuildingView } from '../render/scenery/buildingView'
import { createVillageView } from '../render/scenery/villageView'
import { createRoadView } from '../render/scenery/roadView'
import { createSignView } from '../render/scenery/signView'
import { createParkView } from '../render/scenery/parkView'
import { mergeStatic } from '../render/mergeStatic'
import type { SceneryAssets } from '../render/scenery/sceneryAssets'
import type { Lighting } from '../render/lighting'
import type { SkiModelSpec } from '../ui/riderPanel'
import { KEYS, readJson, writeJson } from './storage'
import { scaledForest, type QualityProfile } from './settings'
import type { Stage } from './stage'

export interface ApexStage {
  stage: Stage
  surface: SurfaceField
  parkSites: ParkSite[]
  /** Swap a park's layout, remember it and rebuild the features. */
  setLayout(site: ParkSite, layout: string): void
  /** 0.6 to 1.4: tree reach from the settings. */
  setViewDistance(scale: number): void
}

/**
 * Assemble the Apex scene from the loaded world: terrain, forest, lifts,
 * village, roads, signs and parks, plus the collision indices the frame loop
 * needs. `phase` marks load timing for `?perf`.
 */
export function buildApexStage(
  world: World,
  scene: THREE.Object3D,
  lighting: Lighting,
  options: { quality: QualityProfile; viewDistance: number; ski: SkiModelSpec; phase?: (name: string) => void; scenery?: SceneryAssets },
): ApexStage {
  const { grid, resort, canopy } = world
  const { quality } = options
  const parkSites = parkSitesFromLines(resort.parks)
  // Prospector is the blue run beside Claim Jumper (trace L2), with its own park.
  const prospectorRun = resort.runs.find((run) => run.name === 'Prospector' && run.kind === 'line')
  if (prospectorRun) parkSites.push(parkOnRun('Prospector', prospectorRun.parts[0], grid.heightAt))
  const defaultLayouts = new Map(parkSites.map((site) => [site.name, site.layout]))
  const savedLayouts = readJson<Record<string, string>>(KEYS.parkLayouts, {})
  for (const site of parkSites) if (savedLayouts[site.name]) site.layout = savedLayouts[site.name]
  const surface = buildSurface(
    grid,
    resort,
    2.5,
    parkSites.map((site) => ({
      name: site.name,
      line: site.line,
      // Multi-lane parks need room for side-by-side features.
      halfWidth: ['Claim Jumper', 'Okanagan Park', 'Prospector', 'Aerial Site'].includes(site.name) ? 28 : 18,
    })),
    { exposure: buildExposure(grid, { originElevation: world.manifest.originElevation, cover: canopy?.cover }), canopyCover: canopy?.cover },
  )
  options.phase?.('apex: surface')
  const terrain = createTerrainView(grid, surface, canopy, lighting, quality.terrain)
  options.phase?.('apex: terrain view')
  // Rock drops on West Bank (beside a Quickdraw tower) and The Pit; moguls stay off the rocks.
  const quickdraw = resort.lifts.find((l) => TOWER_DROP.lift.test(l.name))
  const towerDrop = placeTowerDrop(grid, resort.runs, quickdraw?.towers ?? [])
  const outcrops = [...placeRunDrops(grid, resort.runs), ...(towerDrop ? [towerDrop] : [])]
  const nearRock = (x: number, z: number) => outcrops.some((o) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.width / 2 + 4) ** 2 + (o.depth + 4) ** 2)
  const moguls = buildMoguls(grid, resort.runs, surface, nearRock)
  const cliffs = buildCliffs(outcrops, moguls.sampleTerrain)
  scene.add(terrain.mesh, createMogulView(moguls, terrain.material), createCliffView(outcrops, grid.heightAt))
  options.phase?.('apex: moguls')
  const apron = buildApron(grid, world.horizon)
  scene.add(createApronView(apron, lighting).mesh)

  options.phase?.('apex: apron')
  // Trunk positions are terrain, not a graphics setting.
  const forest = plantForest(grid, resort, surface, canopy, {
    density: quality.forestDensity,
    originElevation: world.manifest.originElevation,
  })
  // Clean run-ins and landings around the rock drops.
  for (const chunk of forest.chunks) chunk.trees = chunk.trees.filter((t) => !nearOutcrop(outcrops, t.x, t.z))
  forest.count = forest.chunks.reduce((n, c) => n + c.trees.length, 0)
  const trunks = indexTrunks(forest)
  options.phase?.('apex: forest')
  const apronForest = plantApronForest(apron, grid, { density: quality.apronForestDensity, reach: quality.apronForestReach })
  forest.chunks.push(...apronForest.chunks)
  forest.count += apronForest.count
  // The detail object is live: the view distance setting rewrites it in place.
  options.phase?.('apex: apron forest')
  const forestDetail = scaledForest(quality.forest, options.viewDistance)
  const forestView = createForestView(forest, forestDetail)
  scene.add(forestView.object)

  options.phase?.('apex: forest view')
  const lifts = createLiftView(resort.lifts, grid.heightAt, options.scenery?.lifts ?? null)
  lifts.object.traverse((child) => (child.castShadow = true))
  mergeStatic(lifts.object, (object) => Boolean(object.userData.hood))
  scene.add(lifts.object)
  // The Billy Goat Hut is modelled by hand on its OSM footprint, so that shell is not drawn.
  const shells = buildBuildings(resort.buildings, grid.heightAt, canopy ? { grid, canopy } : undefined)
  const hutFootprint = shells.find((b) => b.id === SUMMIT_HUT_FOOTPRINT)?.ring ?? null
  const buildings = shells.filter((b) => b.id !== SUMMIT_HUT_FOOTPRINT)
  const buildingView = createBuildingView(buildings, options.scenery?.buildings ?? null)
  scene.add(buildingView.object)
  options.phase?.('apex: terrain, forest, lifts, buildings')

  const village = buildVillage(grid, canopy, resort.roads, resort.runs, buildings, resort.lifts, undefined, hutFootprint)
  const villageView = createVillageView(village, grid.heightAt, { detail: quality.villageDetail })
  scene.add(villageView.object)
  options.phase?.('apex: village')
  const solid: Building[] = [...buildings]
  if (village.hut) {
    const { x, z, heading } = village.hut
    const c = Math.cos(heading), s = Math.sin(heading)
    const ring = [[-2.7, -2.2], [2.7, -2.2], [2.7, 2.2], [-2.7, 2.2]].map(([px, pz]) => [x + px * c + pz * s, z - px * s + pz * c] as [number, number])
    solid.push({ id: 'hut', name: 'Billy Goat Hut', kind: 'hut', ring, base: 0, eaves: 0, roof: null, palette: 0 })
  }

  const centres = buildings.map((b) => centroid(b.ring))
  const nearVillage = (x: number, z: number) => centres.some(([cx, cz]) => (cx - x) ** 2 + (cz - z) ** 2 < 90 * 90)
  const anyHeight = (x: number, z: number) => {
    const h = grid.heightAt(x, z)
    return Number.isFinite(h) ? h : apron.heightAt(x, z)
  }
  scene.add(createRoadView(resort.roads, anyHeight, nearVillage).object)
  const places = buildings.filter((b) => b.name).map((b) => {
    const [x, z] = centroid(b.ring)
    return { name: b.name!, x, z, y: b.eaves + (b.roof?.rise ?? 0) + 3 }
  })
  if (village.hut) {
    places.push({
      name: 'Billy Goat Hut',
      x: village.hut.x,
      z: village.hut.z,
      y: anyHeight(village.hut.x, village.hut.z) + 5,
    })
  }
  // OSM's Beaconsfield node carries Apex Mountain's 2247 m; label peaks from the LiDAR instead.
  const peaks = resort.peaks.map((peak) => {
    const ground = grid.heightAt(peak.x, peak.z)
    return { ...peak, ele: Number.isFinite(ground) ? ground + world.manifest.originElevation : peak.ele }
  })
  options.phase?.('apex: solids')
  const signs = createSignView(resort.runs, peaks, anyHeight, places)
  scene.add(signs.object)
  scene.add(createBoundaryView(resort.boundary, grid.heightAt, resort.roads).object)
  const summitFlags = createSummitFlags(resort.lifts, grid.heightAt)
  scene.add(summitFlags.object)
  // Telecom towers on Beaconsfield (in the crop, solid) and on Apex Mountain (horizon only).
  const apexPeak = EXTRA_PEAKS.find((p) => p.name === 'Apex Mountain')
  const localTowers = beaconsfieldTowers(grid.heightAt)
  scene.add(createTelecomView([...localTowers, ...(apexPeak ? apexMountainTowers(anyHeight, apexPeak) : [])]).object)
  for (const tower of localTowers) {
    const r = tower.kind === 'cabinet' ? 1.7 : tower.kind === 'lattice' ? 1.9 : 0.8
    const ring: [number, number][] = [[tower.x - r, tower.z - r], [tower.x + r, tower.z - r], [tower.x + r, tower.z + r], [tower.x - r, tower.z + r]]
    solid.push({ id: `telecom-${solid.length}`, name: 'Telecom tower', kind: 'hut', ring, base: 0, eaves: 0, roof: null, palette: 0 })
  }
  let lastFlagTime = performance.now()

  // Park features sit on top of the LiDAR ground; rebuilt when a layout changes.
  let overlay!: ParkOverlay
  /** An event's own terrain (the mogul comp), laid over everything while it runs. */
  let eventLayer: Parameters<NonNullable<Stage['setEventTerrain']>>[0] = null
  let parkView: ReturnType<typeof createParkView> | null = null
  let stage: Stage | null = null
  const rebuildParks = () => {
    const features = parkSites.flatMap((site) => placeFeatures(site, site.layout))
    overlay = buildParkOverlay(features, cliffs.sampleTerrain, grid.heightAt)
    if (parkView) {
      scene.remove(parkView.object)
      parkView.dispose()
    }
    const parkSigns = parkSites.map((site) => {
      const [x, z] = pointAlong(site.line, 8)
      const [ax, az] = pointAlong(site.line, 14)
      const yaw = Math.atan2(x - ax, z - az)
      return {
        name: site.name, layout: LAYOUTS.find((l) => l.id === site.layout)?.label ?? site.layout,
        x: x + Math.cos(yaw) * 5, z: z - Math.sin(yaw) * 5, yaw,
      }
    })
    parkView = createParkView(overlay, grid.heightAt, lighting, parkSigns, quality.level === 'low' ? 0.55 : 0.4)
    scene.add(parkView.object)
    if (stage) stage.env.rails = overlay.rails
  }
  options.phase?.('apex: signs')
  rebuildParks()
  options.phase?.('apex: parks')
  // Deep snow: the skis cut trenches the sim reads back; Medium and up also draw them.
  const stamper = createStamper(createSnowDeform())
  const snowPatch = quality.snowPatch ? createSnowPatchView(grid, stamper.field, terrain.material, quality.snowPatch) : null
  if (snowPatch) scene.add(snowPatch.mesh)
  const sampleSurface = createSurfaceSampler(grid, surface, canopy, { inPark: (x, z) => overlay.inside(x, z), onMogul: moguls.onMogul, deform: stamper.packed })

  const slope: Slope = {
    id: 'apex',
    label: 'Apex',
    width: grid.width,
    depth: grid.depth,
    originX: 0,
    originZ: 0,
    visualStep: grid.step,
    spawn: world.course.spawn,
    sampleTerrain: (x, z) => {
      const base = overlay.sampleTerrain(x, z)
      return base && eventLayer ? eventLayer(base, x, z) : base
    },
    sampleSurface,
  }
  stage = {
    slope,
    world,
    trunks,
    buildings: indexBuildings(solid),
    snow: terrain.material,
    advanceLifts: lifts.update,
    ride: (lift) => lifts.ride(lift.id),
    alignChair: (lift, s) => lifts.alignChair(lift.id, s),
    features: () => overlay.features,
    env: { sampleSurface, rails: overlay.rails, assist: true, ski: options.ski },
    snowDeform: { stamper, patch: snowPatch },
    setEventTerrain(layer) {
      eventLayer = layer
    },
    eventLayout(siteName, layout) {
      const site = parkSites.find((s) => s.name === siteName)
      if (!site) return
      const next = layout ?? savedLayouts[siteName] ?? defaultLayouts.get(siteName) ?? site.layout
      if (next === site.layout) return
      site.layout = next
      rebuildParks()
    },
    update(camera) {
      terrain.update(camera.x, camera.z)
      forestView.update(camera)
      buildingView.update(camera)
      villageView.update(camera)
      signs.update(camera)
      parkView?.update(camera)
      lifts.clearView(camera)
      const now = performance.now()
      summitFlags.update(Math.min(0.1, (now - lastFlagTime) / 1000))
      lastFlagTime = now
    },
    describe: () =>
      `${forestView.drawn.toLocaleString()} / ${forest.count.toLocaleString()} trees (${forest.source}) · ${buildings.length} buildings · ` +
      `${village.cars.length} cars in ${village.lots.length} lots · ${village.decks.length} decks` +
      (grid.detail ? ` · ${terrain.detailTiles} 2 m tiles` : ''),
  }
  return {
    stage,
    surface,
    parkSites,
    setLayout(site, layout) {
      site.layout = layout
      savedLayouts[site.name] = layout
      writeJson(KEYS.parkLayouts, savedLayouts)
      rebuildParks()
    },
    setViewDistance(scale) {
      Object.assign(forestDetail, scaledForest(quality.forest, scale))
    },
  }
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0, z = 0
  for (const [px, pz] of ring) ((x += px), (z += pz))
  return [x / ring.length, z / ring.length]
}
