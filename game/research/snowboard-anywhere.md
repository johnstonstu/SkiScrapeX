# SnowboardAnywhere deep-dive (for Apex / SkiScrapex)

Researched 2026-11-21 by reading the actual files through the GitHub API and raw.githubusercontent.com. Nothing was cloned.

> **Licence: none.** Neither [SnowboardAnywhere](https://github.com/drewkeriazes-personal/SnowboardAnywhere) nor its pipeline repo [MapPacker-SnowboardAnywhere](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere) has a licence file (the API returns `license: null` for both). Default copyright applies, so this is **reference only**. We can learn the approach, the data sources and the format ideas, but we must not copy code, shaders or constants tables. Everything below is a description in our own words with links to their files.

## TL;DR

- **It's two repos.** The game (Three.js r172 + TS + Vite) only *plays* "resort packs". A Python pipeline in **MapPacker-SnowboardAnywhere** builds the packs and publishes them as GitHub release zips (50–290 MB each). There are 19 resorts in the catalog, including **two in Canada: Whistler Blackcomb (Bronze tier, "playable") and Mont-Tremblant (Bronze, "preview")**. Apex is not in the catalog.
- **The terrain is a multi-ring heightfield.** It has 1 m `fine` tiles over the resort, a 4 m `coarse` set, 16 m `mid` tiles (40 km square) and 128 m `far` tiles (262 km square). Every ring is 512×512 Terrarium-RGB PNG tiles in local UTM metres. In the US the source is USGS 3DEP. Everywhere else it is **Mapterhorn** tiles. At Apex, Mapterhorn only goes to **z15 (about 1.6 m), from NRCan "Canada DTM 2018-2024" (HRDEM, 2 m)**. I checked this: the z15 tile over Apex returns 200 and z16 returns 404.
- **The renderer is a CPU-built chunked quadtree** with 32×32-quad chunks and skirts. It runs from 1 m chunks near the rider out to the 262 km far ring. A per-vertex RGBA surface mask (rock, scree, groomed, canopy) drives a procedural snow shader, with corduroy aligned to a baked piste-direction map. Trees are lidar-detected crowns plus density "stands", drawn with 4 LODs and impostors out to about 4.5 km. Lifts come from OSM aerialways and their pylons.
- **Physics reads the height data, not the mesh.** `Pack.terrainHeight()` does a bilinear sample of the finest loaded set and adds moguls and trenches. `groundNormal()` uses central differences. The sim steps at a **fixed 1/120 s**, the same rate we picked.
- **SkiScrapex is already ahead on terrain data for Apex.** LidarBC 2025 is native 1 m bare earth, against Mapterhorn's resampled 2 m HRDEM. Our crop (E 286880–290100, N 5472800–5475440) **already covers almost the whole OSM ski-area polygon**. The polygon (way 1138569632) runs E 286884–290346 / N 5472859–5475494, so we're short about 250 m on the east side and about 55 m on the north. "The whole resort" is a small expansion plus a buffer, not a rebuild.
- **The biggest wins to borrow (as ideas):**
  1. 1 m tiled heights with coarser rings for the horizon.
  2. A `features.json` built from OSM: runs, lifts with pylons, buildings and trees.
  3. A 2 m surface mask (rock, scree, groomed, canopy) plus a piste-direction map driving the snow shader.
  4. Physics that samples the data, independent of render LOD.
  5. A small versioned "pack" manifest.
- **The licence ask is worth sending.** The author is very active (both repos were pushed today) and the stack is identical. A permissive licence would let us reuse real code, especially `HeightSet`/`Terrain` chunking and the pipeline's OSM and mask stages.

---

## 1. Elevation data, OSM import and the pack format

### Elevation sources and tiling
The pipeline header in [`pipeline/build_pack.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/build_pack.py) lists the stages:

1. **Fine DEM:** mosaic of 1 m USGS 3DEP chunks (Float32 GeoTIFF in UTM). These come from the 3DEP ImageServer `exportImage` endpoint, per [`pipeline/gen_manifest.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/gen_manifest.py).
2. **Mid ring:** 10 m 3DEP export, resampled to 16 m.
3. **Far ring:** Mapterhorn z11 Terrarium WebP tiles (Web Mercator), reprojected to a 128 m UTM grid.
4. **Lidar:** EPT LAZ nodes from AWS `usgs-lidar-public` become a DSM (max per 2 m cell), and the canopy height model is DSM − DEM, used for the trees. The node lists are pre-selected per resort: `resorts/<slug>/<slug>_ept_nodes.txt` and [`pipeline/ept_select.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/ept_select.py).
5. **NAIP 1 m imagery:** NDVI and brightness give canopy, aspen, rock and scree classes.
6. **OSM features** (below).
7. **2 m masks.**
8. **Trees, shrubs and rocks.**
9. **Write the pack.**

**Outside the US (FEAT-225)** they use **Mapterhorn** (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`) for both the fine box and the mid ring, at the zoom the planner picks. That is [`pipeline/tier_sources.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/tier_sources.py) `mapterhorn_grid`: bilinear onto the UTM grid, then a 1 m Gaussian to remove Mapterhorn's quantisation steps. With no lidar, trees come from ETH 10 m canopy height on ESA WorldCover. With no NAIP, the masks come from WorldCover 10 m. Each layer is then graded Gold, Silver or Bronze ([`pipeline/tiers.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/tiers.py)):

| Tier | Terrain | Trees | Surface masks |
|---|---|---|---|
| Gold | 1 m 3DEP | lidar crowns + LANDFIRE stands | NAIP 1 m |
| Silver | 1 m 3DEP or Mapterhorn z15+ | ETH 10 m canopy + WorldCover stands | NAIP |
| Bronze | best Mapterhorn zoom | ETH + WorldCover | WorldCover 10 m |

**Tools:** pure Python, with no GDAL and no PDAL. [`pipeline/requirements.txt`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/requirements.txt) lists numpy, scipy, pillow, tifffile, imagecodecs, pyproj, shapely and laspy[lazrs]. [`extract_osm.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/extract_osm.py) also uses `osmium`. Downloads are scripted in PowerShell (`pipeline/fetch.ps1`, run on Drew's Windows PC), or the whole thing runs in GitHub Actions (`.github/workflows/build-pack.yml`).

**Resort discovery:** `pipeline/resort.py search "<name>"` looks the resort up in **OpenSkiData** `ski_areas.geojson`. `resort.py plan` writes a data plan, for example [`resorts/whistler-blackcomb/whistler-blackcomb-plan.md`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/resorts/whistler-blackcomb/whistler-blackcomb-plan.md). For Whistler that plan uses EPSG:32610, an 11.8 × 11.4 km box with a 1 km buffer, "Mapterhorn z15 (Canada DTM 2018-2024) 1.5 m" for the resort, z13 (6 m) for the mid ring, and about 840 MB of raw data.

### LOD sets in the pack
From [`docs/pack-format.md`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/docs/pack-format.md):

| Set | Res | Extent |
|---|---|---|
| `fine/` | 1 m (0.8–1.6 m from Mapterhorn) | resort box only |
| `coarse/` | 4 m (mean of 4×4 fine samples, FEAT-229) | over the fine area, used by 4 m and 8 m chunks so they don't fetch fine tiles |
| `mid/` | 16 m | 40 km square |
| `far/` | 128 m | 262 km square |

- All sets use **512×512 PNG tiles, Terrarium-encoded**: `h = R*256 + G + B/256 − 32768`, which gives 1/256 m precision.
- Row 0 is north. Tiles abut with no overlap. Void is −32768.
- `meta.terrain.<set>` gives `res, tileSize, minX, minY, tilesX, tilesY`.
- Coordinates are **local metres from a UTM origin**: x east, y north, z up. The client never touches lat/lon.

### OSM pistes, lifts, trees and buildings
- **Source:** a Geofabrik `.osm.pbf` read with osmium (`extract_osm.py`), or Overpass. Whistler's plan says "Geofabrik extract: british-columbia".
- **Filter:** ski ways with `piste:type`, `aerialway` or `landuse=winter_sports`; built ways with building, highway, man_made and similar tags; natural ways; `natural=peak` nodes; places.
- **Private terrain:** [`pipeline/osm_filter.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/osm_filter.py) drops private or members-only runs and lifts. A run's name comes from `piste:name` first, then `name`.
- **Lift towers:** taken from OSM `aerialway=pylon` nodes. Where a lift has none, one is spaced every 140 m ([`pipeline/lift_towers.py`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/pipeline/lift_towers.py)).
- **Trees are not taken from OSM.** They come from lidar crown detection (local maxima of the canopy height model), or the ETH canopy height outside the US. Species are assigned by rules (LANDFIRE class, elevation, aspect). OSM woods are only used as land cover.
- **Grooming history:** scraped from the resort's terrain status page (`pipeline/fetch_grooming.py`).
- **Moguls:** each run gets a `mogulScore` (`pipeline/moguls.py`).

### The resort pack format (`formatVersion` 1)
A static folder served over HTTP ([spec](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/docs/pack-format.md); the game's [`docs/pack-format.md`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/docs/pack-format.md) only points to it):

- `meta.json`: slug, name, `formatVersion`, `build`, `crs`, `origin` (UTM), `lonlat`, `bounds`, `zRange`, the `terrain` sets, the descriptors for `mask/ao/dir/moguls/cover/canopy/stands/instances`, `start` (the default drop-in), `treeline`, `sun`, `tier`, `sources` and `attribution`.
- `fine|coarse|mid|far/<tx>_<ty>.png`: Terrarium heights (above).
- `mask/<tx>_<ty>.png`: **2 m RGBA. R = rock, G = scree, B = groomed piste corridor, A = canopy.** Snow is implicit: `1 − max(rock, scree)`.
- `ao/` is 2 m baked sky visibility. `dir/` is the 2 m groomed-run axis angle (corduroy direction). `moguls/` is 2 m mogul strength. All three are optional.
- `cover/<level>.png`: forest, canopy height, rock and built-up share for distant shading at the pack, mid and far levels.
- `canopy.png` (10 m), `treeLines.json` (pre-traced glade lines), `stands/` (stem density per 4 m).
- `trees/`, `farTrees/`, `rocks/`, `shrubs/<cx>_<cy>.bin`: **little-endian Float32 records of 6 floats per 1 km cell** (for trees: x, y, z, height, crownRadius, species).
- `features.json`:
  - `lifts`: name, type, stations[xyz], towers[x, y, zGround, height], cable, capacity
  - `runs`: name, difficulty, groomed, gladed, points[xyz], osmId, mogulScore and more
  - `buildings`: footprint, zBase, zMax, height
  - `roads`, `water`, `peaks`, `labels`
- `packs/index.json` lists the installed packs. `catalog.json` in MapPacker lists the published ones with URL, sha256, tier and status. A `contract.py` and test check that both repos agree on the shared constants and the format version.

## 2. Rendering, and how big the map is

- **Terrain mesh:** [`game/src/terrain/Terrain.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/terrain/Terrain.ts).
  - A chunked quadtree whose root covers the 262 km far set. Each chunk is an **N = 32 quads per side** grid built on the CPU from `pack.height(x, y, res)`, with a **skirt** to hide LOD cracks.
  - A chunk splits when the camera distance is under size × 2.6. At most about 10 chunk builds run per frame (with an optional ms budget). Unused chunks are evicted, and CPU arrays are freed after GPU upload.
  - The axes match ours: three.js x = east, y = up, z = south (pack y = −z).
  - Chunks go down to **1 m near the rider**. 4 m and 8 m chunks read the `coarse` set.
  - Their own research doc ([`docs/research/threejs-rendering-stack.md`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/docs/research/threejs-rendering-stack.md)) recommended GPU CDLOD with morphing, but the shipped code is CPU chunks with skirts.
- **Snow shading:** [`game/src/terrain/TerrainMaterial.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/terrain/TerrainMaterial.ts).
  - The mask's class weights arrive as per-vertex colour. Detail comes from **world-space procedural noise** (no texture seams across chunks), plus CC0 ambientCG rock and gravel textures.
  - **Groomed** snow gets corduroy (about 30 cm ridges) along the `dir` axis, or along the fall line where there is no `dir`. **Ungroomed** snow gets drift relief and wind ripples.
  - Lighting adds subsurface wrap, blue sky fill in shade, sparkle glints, baked AO, darkening under canopy and a flat-light mode.
  - Rock is added procedurally on faces over about 45°, on ridges and on talus.
  - Moguls are evaluated analytically per pixel (`terrain/Moguls.ts`) and baked into the geometry of the 1–2 m chunks.
- **Piste overlays:** [`world/RunsOverlay.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/world/RunsOverlay.ts) drapes run centre lines coloured by difficulty (toggle M). `ui/ResortMap.ts` draws the map view. In the world itself, the pistes show through the mask's B channel (smooth groomed corridors) and the trees cleared from runs.
- **Trees:** [`world/Vegetation.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/world/Vegetation.ts) streams 1 km cells. A procedural tree kit (`world/trees/`) has 10 species × 4 variants. LOD0 branch cards run to about 800 m, then cones, then crossed quads (400–1500 m), then impostors (1500–4500 m), plus far "clump" impostors to 9 km. Trunks near the rider go into a collider.
- **Lifts:** [`world/Lifts.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/world/Lifts.ts) builds towers, cables with catenary sag, terminals and moving chairs, gondolas, T-bars and carpets from OSM aerialways. Riding them is in `sim/LiftRide.ts`.
- **Map size:** the far ring is 262 km, the mid ring 40 km, and the fine resort box about 12 km across. Vail is 135.7 km² with 529 fine tiles (143 MB) and a 291 MB pack. The Whistler box is 11.8 × 11.4 km and its pack is 221 MB.

## 3. How physics queries the terrain
- The rider ([`game/src/sim/Rider.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/sim/Rider.ts)) steps at **fixed 1/120 s**, with catch-up capped at 0.1 s per frame.
- Ground height comes from `groundAt()` in [`sim/rider/Collision.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/sim/rider/Collision.ts). That calls `pack.groundHeight(x, y, z)`, which is the terrain or a bridge deck above it, plus a rock dome bump, then takes the max with the collider's floor (building tops).
- `Pack.terrainHeight()` ([`game/src/pack/Pack.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/pack/Pack.ts)) is the **bilinear sample of the finest loaded height set** ([`HeightSet.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/pack/HeightSet.ts), crossing tile edges) plus the tree-line trench plus mogul bumps. It is explicitly *"independent of render LOD"*.
- `groundNormal()` uses **central differences** at the finest loaded resolution, with a minimum spacing of 0.5 m.
- Trees, rocks and buildings are an 8 m spatial hash of vertical cylinders and footprints ([`sim/Collider.ts`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/game/src/sim/Collider.ts)).
- The carving model is built on Komissarov, *"Balanced carving turns in alpine skiing"* (arXiv 1812.02539), per [`docs/research/rider-physics.md`](https://github.com/drewkeriazes-personal/SnowboardAnywhere/blob/main/docs/research/rider-physics.md). The paper is public, so we can implement its equations independently.

## 4. Apex support, Canada data and a hosted demo
- **Resort list:** [`catalog.json`](https://github.com/drewkeriazes-personal/MapPacker-SnowboardAnywhere/blob/main/catalog.json) has 19 packs: 17 in the US, plus `whistler-blackcomb` (CA, Bronze, playable) and `mont-tremblant-resort-station-mont-tremblant` (CA, Bronze, preview). **There is no Apex.** The game hard-codes no resort list (`game/src/resorts.ts` reads `packs/index.json`).
- **Could it build Apex?** Probably, as a **Bronze or Silver pack** through its non-US path:
  - **Terrain:** Mapterhorn z15, about 1.6 m at 49.4° N, from NRCan HRDEM (`cahrdem2`, "Canada DTM 2018-2024", 2 m, OGL-Canada). I probed the tiles over Apex: z12–z15 return 200, z16 and z17 return 404.
  - **Trees and masks:** ETH 10 m canopy height and WorldCover 10 m.
  - **OSM:** good enough. The `landuse=winter_sports` polygon "Apex Mountain Resort" is way 1138569632. In the box I counted 76 downhill pistes (16 easy, 25 intermediate, 27 advanced, 7 expert, 1 novice; 6 tagged mogul), 5 snow-park ways, 41 nordic, and 4 lifts: Quickdraw chair (way 101303241, 16 mapped pylons), "Stock's Chiar" chair (101303234, a typo in OSM, 15 pylons), a T-Bar (101303229) and a Magic Carpet. There are also about 260 buildings and 247 wood/forest areas.
  - Anyone can request a resort with their **"Request a resort"** issue template (`.github/ISSUE_TEMPLATE/resort-request.yml`), which feeds `build-pack.yml`.
- **Nothing in either repo uses LidarBC** (I searched both). Their Canadian terrain is always Mapterhorn or HRDEM.
- **Hosted demo: none.** The repo homepage is empty and `snowboardanywhere.firebaseapp.com` only serves Firebase auth ("Site Not Found"). The game ships as Windows and Apple Silicon zips on [Releases](https://github.com/drewkeriazes-personal/SnowboardAnywhere/releases) (latest `0.0.10`, 2026-11-20 9:51 PM PT), or `npm run dev` / `npm run host` on a LAN.

## 5. What we can use for Apex (prioritised)

Everything here is an *idea to reimplement*, not code to copy.

1. **Expand the crop to the whole resort plus a buffer, at 1 m.** We're almost there. The OSM ski area is E 286884–290346 / N 5472859–5475494 (3.46 × 2.64 km), so the current crop only misses about 250 m east and 55 m north. Suggested rideable box: about E 286600–290700 / N 5472500–5475800, roughly 4.1 × 3.3 km with a 300 m margin. That's about 13.5 M samples at 1 m, around 54 MB raw Float32. This is for the terrain agent to decide.
2. **Tile it and add coarser rings**, following SA's fine/coarse/mid/far idea:
   - 1 m `fine` tiles (512² or 256²) over the box, built from our own LidarBC data.
   - A 4 m `coarse` set (mean of 4×4) for mid-distance chunks.
   - A ~16 m ring about 20–40 km wide from **HRDEM/Mapterhorn or CDEM**, so the Okanagan, Brent Mountain and the Apex peaks show on the horizon.
   - A coarse far ring for the skyline (Mapterhorn z11 is fine, credited per source).
   - Choose an encoding: keep Float32 or move to Terrarium PNG (smaller, with 1/256 m precision, which is ample).
3. **A chunked quadtree LOD renderer.** Our own design: fixed-size chunks (for example 32–64 quads), distance split factor, skirts or morphing, a per-frame build budget and LRU eviction. 1 m within about 300 m of the rider, then 2/4/8/16 m and beyond.
4. **Keep physics on the data, not the mesh.** SA's physics reads the finest height data regardless of render LOD, which is the right model once we have LOD. Our `sampleTerrain` already does this at full resolution, so keep it as the single physics query and extend it to tiles and rings. Our triangle-split sampling matching the 1 m mesh diagonal is *more* exact than SA's bilinear plus central-difference normals. Keep it for the finest level.
5. **An OSM `features.json` import** (OSM is ODbL, so we can use the data with attribution):
   - **Runs:** name, `piste:difficulty`, `piste:grooming`, polyline draped to xyz.
   - **Lifts:** stations and **pylons** (Quickdraw and Stock's both have 16 and 15 mapped pylons), capacity, duration.
   - **Buildings:** footprint plus base and top height.
   - Roads, water and peaks.
   - Filter out `piste:type=nordic|sled|hike` for the downhill game, and keep the snow-park ways.
6. **A 2 m surface mask built from runs and terrain:**
   - Groomed corridors (run half-widths around the OSM line).
   - Rock on steep faces, ridges and talus (from slope and curvature in our LidarBC DEM).
   - Canopy.
   - A **piste-direction map** so corduroy follows the run axis.
   - Drive a procedural world-space snow shader from it: groomed vs ungroomed, rock patches, darkening under trees, baked AO.
7. **Trees from LidarBC instead of ETH.** LidarBC also publishes point clouds and DSMs (to confirm for these tiles), so we can do what SA's Gold tier does: canopy height = DSM − DTM, local-maxima crown detection, instance records (x, y, z, height, radius, species) per 1 km cell, and cylinder colliders. That would put Apex above SA's own Bronze/Silver Whistler.
8. **A small versioned pack manifest.** One `meta.json` with crs (EPSG:2955), origin, bounds, zRange, per-set tile grids, layer descriptors, start pose, sun, attribution and a `formatVersion` bumped on breaking changes. This extends our existing manifest rather than replacing it.
9. **Default start and spawn points** from data: the top of Quickdraw's upper station, facing down a named run. Also consider SA's "pack report" idea (an automated scorecard: void %, runs without difficulty, start on snow and clear of trees).
10. **Later polish:** a mogul field from `piste:grooming=mogul` plus slope, baked glade tree lines, lift riding, and a far-forest cover texture.

**Where SkiScrapex is already ahead or different:**
- **Terrain source:** LidarBC 2025 native 1 m bare earth beats SA's Apex option (2 m HRDEM resampled to about 1.6 m, Silver at best).
- **Physics–mesh consistency:** our sampler splits each cell on the mesh diagonal, so the rider sits exactly on the rendered surface. SA uses bilinear heights against a CPU mesh.
- **Simplicity:** a single 5 m grid and one sampler is easy to reason about. SA's packs are 50–290 MB with a large contract to maintain, and we shouldn't take on that complexity before we need it.
- **Same axes** (+X east, +Y up, +Z south), so their notes map onto ours directly.

## 6. Should we contact the author for a licence?

**Yes, it's worth asking.** We're not contacting anyone now; this is just the recommendation.
- Drew (GitHub `drewkeriazes` / `drewkeriazes-personal`) started the repo on 2026-11-05 and both repos were pushed today. The stack (Three.js + TS + Vite), the axes and the problem are the same as ours, and the quality is high.
- The most valuable things to be allowed to reuse are `game/src/pack/HeightSet.ts` and `game/src/terrain/Terrain.ts` (tile streaming and LOD), the snow material ideas, and the pipeline's OSM and mask stages (`extract_osm.py`, `osm_filter.py`, `piste_dir.py`, `lift_towers.py`).
- Suggested ask: an MIT or Apache-2.0 licence on both repos, or written permission to adapt named files with credit. Note that even with a code licence, their **packs' data** stays under its source licences (ODbL for the OSM-derived `features.json` and masks, CC BY for WorldCover/ETH, OGL-Canada for HRDEM). That's fine for us, since we'd build our own Apex data from LidarBC and OSM anyway.
- Until a licence exists, keep a clean-room rule. Nobody writing SkiScrapex code should paste from these repos.

## Sources read
- SnowboardAnywhere: `README.md`, `docs/pack-format.md`, `docs/research/{licensing-and-attribution,rider-physics,threejs-rendering-stack}.md`, `docs/developer-guide.md`, `game/package.json`, `game/src/{resorts.ts, pack/{Pack,HeightSet,format}.ts, terrain/{Terrain,TerrainMaterial}.ts, sim/{Rider,Collider}.ts, sim/rider/Collision.ts, world/{Lifts,Vegetation,RunsOverlay}.ts}`.
- MapPacker-SnowboardAnywhere: `README.md`, `docs/pack-format.md`, `catalog.json`, `pipeline/{build_pack,gen_manifest,extract_osm,osm_filter,tiers,tier_sources}.py`, `pipeline/requirements.txt`, `resorts/whistler-blackcomb/*`, `reports/{whistler-blackcomb,vail}.md`.
- Live checks: Mapterhorn tile probes over Apex (z12–z17), Mapterhorn `attribution.json` (Canada source `cahrdem2`), OSM API (ways 1138569632, 101303241, 101303234, 101303229), and an Overpass mirror (piste, lift, building and wood counts in the Apex box). I converted the OSM coordinates to EPSG:2955 with pyproj.
