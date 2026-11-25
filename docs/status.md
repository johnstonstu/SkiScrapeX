# Status

Updated 2026-11-24 for v0.9.16. Older measurement sections below stay dated. Open work is tracked as GitHub issues with phase labels. Release history is in `CHANGELOG.md`, the plan in `docs/roadmap.md`.

## How the pieces fit

1. `.github/workflows/data.yml` (runs when `scripts/` or `tools/osm/` change, or by hand) installs GDAL, runs `scripts/build-terrain.py` and `tools/osm/export.py`, and force-pushes the outputs to the orphan `data` branch (builds dispatched from another branch go to `data-<branch>` instead): `terrain.json`, `heights.f32`, `heights-2m.u16`, `canopy-cover.u8`, `canopy-height.u8`, `hillshade.png`, `references.json`, `features.json`. The OSM export retries public Overpass mirrors, then the main OSM map API. The job does not push a data branch whose `features.json` is missing, lacks buildings or does not have four lifts, so a failed export leaves the last good build in place. The Pages workflow fails the deploy unless the built `data/features.json` passes the same check.
2. `.github/workflows/site.yml` runs the game and OSM tests on every push to `main`, copies the `data` branch into `game/public/data` and builds. The Pages deploy only runs when the repository variable `PAGES_ENABLED` is `true`.
3. The game loads those files at start (`game/src/world/loadWorld.ts`). If they are missing it shows the synthetic test slopes.

## Game layout

| Path | Role |
| --- | --- |
| `src/sim/surface.ts`, `freestyle.ts`, `rails.ts` | Snow presets (groomed, park, ice, powder, forest) blended under the skis; pop, air rotation with landing snap assist, six grabs, landing grades from equivalent fall height, rail and box sliding with a balance pendulum, trick names and points. Values from `game/research/ski-physics-and-freestyle.md`. |
| `src/sim/` | Fixed 120 Hz ski model. Steering slews toward a heading measured from the local fall line (up to 100°, so traverses and turn-to-stop work on real terrain). Tuck below 5 m/s is a skate push. |
| `src/world/terrainGrid.ts`, `detailChunks.ts` | Grid sampler. `withDetail` adds a 2 m grid on the same origin that the samplers read first (physics, trees, lifts, buildings), falling back to 5 m; `detailChunks.ts` cuts it into 160 m tiles. Height is on the rendered triangle (NE to SW split), normals are bilinear vertex normals so facets do not kick the skier. NaN cells are holes (`null`). |
| `src/world/resort.ts` | Runs and lifts from `features.json` (or `references.json`). Lift ends are ordered by height. Spawn is 40 m down the run nearest the top of Quickdraw, preferring Grandfather's. |
| `src/world/surface.ts` | 2.5 m surface mask: groomed runs with grooming heading, ungroomed runs (mogul, backcountry) as powder, under-canopy snow. |
| `src/world/buildings.ts` | OSM footprints to shells: storeys from tags or building type, stacked from the high side of the lot, gable roof for box-like footprints, flat snowy roof otherwise. Footprint index for collisions. |
| `src/world/forest.ts` | Trees from canopy cover and height per 5 m cell (procedural scatter if canopy is missing). Off runs, 9 m clear of lift lines, under 40°. Trunk index for collisions. |
| `src/world/park.ts` | Park feature library (four tabletop sizes, step-down, rollers, box, flat, down and flat-down rails) as analytic height overlays and rail polylines; six swappable layouts placed along the OSM park lines. Lip and landing angles are absolute and adjusted for the slope. |
| `src/world/cliffs.ts`, `snowDeform.ts`, `runEdges.ts` | Rock drops on West Bank and The Pit (physics and placement); the deformable snow field and the delayed ski stamper; run corridors fitted to the LiDAR clearing. |
| `src/world/snow.ts` | Surface sampler for the sim: groomed runs, parks, open powder (0.35 m) off-piste, heavier shallower snow under canopy, wind crust and rock from `world/exposure.ts`. |
| `src/world/exposure.ts` | Wind exposure per 5 m sample (ridges, windward faces, elevation, tree cover); thresholds shared by the snow shader and the sim. |
| `src/world/apron.ts` | Procedural land around the crop: matches the crop edge, blends into rolling ridges over 1.6 km, extends 5 km. Trees out to 1.8 km. Purely visual; the skier still stops at the crop edge. |
| `src/render/terrain/`, `scenery/`, `rider/` | Terrain mesh with the snow shader (5 m for the whole crop; 2 m tiles within 220 m of the camera, exact inside 140 m and morphing to the 5 m surface beyond, with the 5 m mesh cut out under them; 90/150 m on touch devices), instanced trees with distance LOD (dissolve near the camera), lifts with moving chairs and ride paths, buildings with a shader window grid, trail-head and building signs, sky with clouds, the rider (`rider/skierView.ts`, see the rider notes below). Sun shadows from trees, buildings, lifts and the skier in a 220 m box that follows the skier (snow shader reads the shadow map; `?noshadows` turns them off). |
| `src/fx/` | Snow shader, spray, snowfall and ski tracks (moved from the former `labs/snow-fx`). |
| `src/main.ts`, `src/app/` | Entry and frame loop; `app/apexStage.ts` assembles the Apex scene and collision indices; menus, trick feed, storage, version and the `?perf` probe. |
| `src/player/` | Keyboard and touch input, follow, first-person and orbit camera, procedural audio, snow effects glue. |
| `src/ui/` | Minimap and the rider panel (outfit, ski model). |
| `src/tools/` | Rider lab (`rider.html`). |

## Numbers from the current data

- Crop E 286880 to 290100, N 5472800 to 5475440, 644 × 528 samples at 5 m, 1599 to 2176 m.
- Detail: 1608 × 1318 samples at 2 m (uint16 centimetres, 4.2 MB), Gaussian sigma 1.5 m at 1 m before averaging, so boulders and stumps under the snowpack are smoothed out. It agrees with the 5 m grid to 3 cm at shared points and adds about 9 cm RMS of relief (99.9th percentile 0.7 m): cat tracks, banks and gullies. Bot runs on it match the 5 m results within noise.
- Canopy: mean cover 45%. The game plants about 137,000 trees and draws a distance-thinned subset.
- OSM: 67 runs, 4 lifts (Quickdraw, Stock's, T-Bar, Magic Carpet), 31 towers.
- Grandfather's Trail is 4.5 km and ends at the T-Bar base. The Apex test's steering bot gets from the top of Quickdraw to the T-Bar base in about 6.5 minutes at up to about 50 km/h.

## Research

- `game/research/apex-references.md`: videos, webcams, lift specs, terrain parks, village and landmark references for making places recognizable.
- `game/research/ski-physics-and-freestyle.md`: carving, powder and terrain-park models with sources, control mapping for desktop and mobile, and a proposed model for the physics pass.

## Decisions

- The run ends at the bottom terminal of any lift, not only chairs, because Grandfather's ends at the T-Bar base. Every lift returns you to the top of Quickdraw for now.
- Trees come from LidarBC canopy rather than OSM woods. Positions inside a 5 m cell are random, so treat collisions as approximate.
- The old standalone terrain viewer and `labs/snow-fx` demo were folded into the game (orbit camera with <kbd>C</kbd>).

## Physics pass (2026-11-21)

- Carving: edge rolls on at 260°/s, grip capped per surface, chatter near the grip limit (camera shake, vibration on Android), short washout well past it.
- Powder: sink from the Lind and Sanders compaction law (0.30 m standing, about 0.10 m at 10 m/s), compaction drag (worse when skidding) and plow drag, slower yaw in deep snow, a tap of Jump is a bounce, skating is weak when bogged down. Powder skis float more.
- Freestyle: lips launch from a look-ahead normal check; landings graded perfect, clean, sketchy or crash by equivalent fall height (0.8, 1.5, 3 m) and rotation error; switch landings ride away switch. Combos bank after 3 s on the ground; repeats score half.
- Tuned with `npm run tune` (bots on eight real runs, open powder and every park layout). Results on 2026-11-21: blues and blacks average 40 to 56 km/h with a 65 km/h cap and no washouts at moderate speed; open powder stalls below about 5° (realistic) but a bounce or skate gets you out; kickers land clean or sketchy inside their sign speeds and crash well above them. Changes from the first pass: washout only past a grip ratio of 2.5 with more than 40° of edge, chatter needs 30° of edge, compaction drag fades at walking pace, skate in deep snow 60%, clean landing up to 1.8 m EFH and sketchy to 3.5 m, rail capture reach 0.6 m with a 0.5 s re-catch cooldown (fixed a capture loop), gentler balance, big roller 3 m.
- An approach hint shows the next jump's speed window and turns green, blue (slow) or red (fast).
- Not tuned by a human yet. Kicker design speeds are on the feature signs; overshooting a jump lands flat and crashes, which is realistic but harsh.

## Controls and feel pass (2026-11-21, third pass)

- Steering: heading is a map bearing solved onto the slope, so crossing a steep fall line no longer twists the skis. Keyboard steering turns relative to the current heading; committed edges at speed get extra turn support on steep faces. Key ramp is quicker (rise 8, release 10).
- Switch: landing backwards rides away switch until you stop.
- Flats: forward pushes with poles and skates below 18 km/h and tucks above it. Tuck drag only applies when actually tucking at speed.
- Powder: deeper than 0.35 m is softer (more sink, less drag per unit sink).
- Moguls: staggered bumps on OSM runs tagged as moguls (`world/moguls.ts`, `render/mogulView.ts`) with an open shoulder each side.
- Audio: procedural ski contact, wind and lift sounds (`game/audio.ts`), unlocked by the first gesture, mute remembered.
- Esc pauses. Input clears on blur so keys cannot stick. Lift fast-forward keeps the rider on the same chair (`tests/lifts.test.ts`).

## Steeps, rider and freestyle pass (2026-11-21, fifth pass)

- Physics: see `game/research/controls-physics-review.md`. Ski yaw is the faster of the sidecut rate and a leg pivot (not capped by grip); grip is the edge's holding capacity in g; the cutting force turns the path by cos(attack) and brakes by sin(attack); a released traverse keeps a 22° uphill edge. `tuning/steep.test.ts` probes 20° to 45° planar slopes. Speed on steeps now follows how far across the hill turns finish (about 30 km/h on 45° when finishing near 85°).
- Rider (`render/rider/skierView.ts`): rebuilt from lathe-turned parts, baggy or slim fit, helmet or beanie, gaiter. Body inclination from the carve load (scaled 0.72, capped 41°), angulation, counter-rotation toward the fall line, pole plant on each edge change, real tuck, landing absorb, switch look-back, rail pose with balance sway, two-bone IK for legs and arms so grabs reach the skis. `rider.html` is a pose lab.
- Freestyle: truck driver (K+S) and nose (K+W) grabs with style multipliers on grab points; landing ring from `landingSpot` in `sim/freestyle.ts`, green when the rotation lines up.

## Runs, trees, village, creator and corks (2026-11-21, sixth pass)

- Runs: `scripts/detect-runs.py` traces cleared corridors in canopy-cover inside the resort boundary that OSM does not map. The reviewed 21 (W1 to W6 on the south side below Hang'em High, likely Wildside; L1 to L15 elsewhere) live in `world/runOverlay.ts` with provisional names and are loaded with the OSM runs. Key map: `docs/runs-overlay.png`. Stu to supply real names.
- Trees: `pickSpecies` in `world/forest.ts` (elevation and canopy height) and six shapes in `render/treeShapes.ts`. Near chunks feed one instanced pool per species; far chunks keep a tinted stand-in.
- Village: `world/village.ts` (lots from flat treeless ground by plowed roads, cars at 60%, decks on the downhill wall, Billy Goat Hut beside the Quickdraw top) and `render/villageView.ts`.
- Creator: ski top-sheet graphics (canvas textures on UV'd skis), jacket accent, backpack.
- Freestyle: pitch during a spin over 3 rad/s tilts the spin axis (`air.cork`); 540+ held 0.25 s is a Cork, 1080+ held 0.7 s a Double Cork (points x1.35 and x1.7); landing corked adds up to 70° of flip error. Rail entry is a 0.2 s visual pop and swing.

## Performance (0.8.8 work, 2026-11-23, headless SwiftShader, 1280 × 720)

Draw calls and triangles (with the shadow pass) at the five standard spots, from `game/scripts/perf-spots.mjs`. Frame times are not meaningful headless; counts are. "0.8.8 wip" is `graphics-auto` after merging the sign meshes; its High and Medium rows and the park spot on Low are still to measure.

| Spot | 0.8.6 Low | 0.8.7 Low | 0.8.8 wip Low | 0.8.6 High | 0.8.7 High |
|---|---|---|---|---|---|
| Start | 240 · 760k | 369 · 893k | 264 · 910k | 271 · 1.40M | 401 · 1.53M |
| Village | 533 · 950k | 799 · 1.09M | 523 · 1.11M | 573 · 1.76M | 840 · 1.90M |
| Forest | 168 · 856k | 217 · 1.08M | 204 · 985k | 198 · 1.74M | 241 · 1.90M |
| Summit | 236 · 585k | 327 · 703k | 261 · 734k | 270 · 1.27M | 363 · 1.39M |
| Park | 185 · 779k | 257 · 921k | | 212 · 1.73M | 282 · 1.85M |

- 0.8.7 added about 90 to 270 draw calls per spot. Most came from the new trail-head boards (four meshes each) and the boundary signs (three each); merging their static parts per material brought Low back near 0.8.6.
- Load time on High roughly doubled in 0.8.7 (village 10.5 s to 22 s headless); not yet investigated.
- Still over the Low budget in `docs/workplan.md` (250 calls, 0.9 M triangles): the village (523 calls; buildings, cars and decks) and the triangle count at most spots. Next candidates: other skiers' riders (about 25 meshes each), village props, and the 0.8.7 terrain and tree changes.

## Performance (v0.5.0, headless Chrome with a software GPU, 1280 × 720)

Measured with `?perf` at five spots (start, village, forest, summit, park). Software rendering makes frame times meaningless; compare counts.

| | Desktop | Touch (`?touch`) |
| --- | --- | --- |
| Draw calls | 170 to 430 | 145 to 400 |
| Triangles (incl. shadow pass) | 1.4 to 1.7 M | 0.73 to 0.87 M |
| JS heap | 190 to 205 MB | 140 to 160 MB |
| Load (data plus scene build) | about 2.3 s | about 2.0 s |

Largest remaining costs: the full-crop 5 m terrain mesh (680k triangles in one call on desktop), far forest batches (one draw per chunk), and the rider (about 50 small meshes, drawn twice with shadows).

## Open issues

- Playtested by Stu through 0.8.x; still wanted: other Apex regulars. Landmarks are from OSM and the LidarBC terrain only.
- Run widths are guessed from difficulty (11 to 16 m half-width). OSM run areas are not mapped at Apex, so edges are approximate.
- The 2 m detail is smoothed for snowpack with one fixed sigma. Real snow fills gullies more than it rounds ridges; a fill pass (raise concave cells) could follow a playtest.
- Trees, lifts and buildings sit on the 2 m ground; far away the 5 m mesh can be up to about 0.5 m off, which is not visible at that distance.
- Park names for the two unnamed OSM park ways (Prospector, Okanagan Park) and "Park" (Little Nuggets) are guesses.
- Rails: hop-friendlier capture (0.8.13), crouch→extend entry and soft step-off (0.8.15). Approach camera/HUD assist and wider multi-lane spacing in 0.8.16.
- Map: hover tip + click trip on trail map and HUD minimap (0.8.15).
- Crashes: tumble + yard-sale (0.8.11), directional tumble and gear re-attach on get-up (0.8.17); buildings/signs on `beginCrash`. Washout tip-in removed in 0.8.12. World-space gear pickups still open (#61). Landing EFH leeway 0.8.13; powder 0.8.14.
- Feel depth (0.9.0): optional plant/landing/latch WAV layers, idle/cruise hand sway, weather gusts; Low quality skips village cars/decks.
- Graphics budgets (0.9.1): Medium village mid + prop distance cull; quality anisotropy and forest density; High wider terrain detail ring.
- Feel leftovers (0.9.2): bundled sample WAVs, flat-light HUD cue, NPC near-miss audio/rumble, rail press arm poses.
- World gear pickups (0.9.3): hard crashes drop skis/poles/board to collect; soft crashes stay visual-only gather (#61 largely closed).
- Building LOD + cheaper findLots + High shadow reach 160 m (0.9.4); 0.9.1 village/forest budgets unchanged.
- Structure (0.9.5): autoCap / graphicsFail modules; rider Spring, double-pole, crash and sit poses extracted. Full ski-pose / tick split still deferred.
- Wider groomers + lift clearings (0.9.6): easy/mid/adv half-widths 22/20/15; lift cut 14 m half, terminals 20 m.
- Tree snow / summit ghosts (0.9.7): heavier branch snow + far frost tint; more rime pillars above 2080 m.
- Stock's green terminals + seat fallbacks; Quickdraw Uni polish (0.9.8).
- Thicker village roof snow + near chimneys; timber place boards (0.9.9). Sky presets already shipped earlier — left alone.
- T-bar drive/return split, portal towers, Magic Carpet rails, Quickdraw maze hint (0.9.10).
- Ragged run edges + deeper mogul crests with cast shadows (0.9.11).
- Modest Saloon + Inn hero massing (gable/snow/porch/board) without a photo rebuild (0.9.12).
- Edge saplings inside clear corridors + summit wind-scour ice/rock above ~2100 m ASL (0.9.13).
- Terrain blending (0.9.14): wind-exposure field drives summit crust and rock (shader and sim), organic patch edges, outcrop slope rock, corduroy cross-fade at run seams. Not yet seen on a real GPU by Stu; steep cliff outcrops not screenshot-checked.
- Summit, towers and windows (0.9.15): windows on all building LODs, Billy Goat Hut on its OSM footprint (other summit shells dropped in `world/corrections.ts`), telecom towers on Beaconsfield and Apex Mountain (`world/telecom.ts`).
- Deep snow, drops and fitted runs (0.9.16): deformable trenches and berms around the player (drawn on Medium and High, read by the sim everywhere), West Bank moguls and tower drop, The Pit cliff and rock band, LiDAR-fitted run corridors, edge saplings only at real edges, fall-line corduroy, window detail, upload and streaming performance fixes. Not yet profiled on a real GPU.
- Tuck drag raised in 0.8.11 (0.42 m²); re-check equilibrium on Gunbarrel / Grandfather's after a playtest.
- Buildings are shells from OSM footprints with guessed heights. Only 10 of 147 have tagged storeys. No interiors, decks or props yet.
- Roads are stamped as packed snow; there are no cars, parking lots or village props.
- Mobile performance is untested on real devices. Touch devices get fewer trees, lower pixel ratio, fewer particles and the Low profile, which from 0.8.7 turns shadows off unless Settings → Shadows is On.
- The horizon is real NRCan MRDEM 30 m terrain and canopy out to about 12 km (`scripts/build-horizon.py`, run by the data workflow). Without it the game falls back to procedural hills.
- About 20 runs the resort grooms were missing from OSM. 21 cleared corridors are now traced from LiDAR with provisional names; matching them to real names (Wildside: Gauntlet, Glade-iator, Granny's Glades, Gun Slinger, Jackpot, Panhandler, ShootOut, Showdown and others) needs Stu or the trail map. Gladed runs with sparse trees are not detected.
- OSM tags Beaconsfield Mountain with 2247 m, which is Apex Mountain's height. The game labels peaks from the LiDAR instead (about 2176 m).
- `npm audit` is clean since vitest 5 (0.8.x).
