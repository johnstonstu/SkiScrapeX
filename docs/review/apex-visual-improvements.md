# SkiScrapeX: improvements from comparing v0.8.0 with real Apex footage

Tested: v0.8.0 (commit `991aa58`), live page plus a local build with full OSM data, headless Chrome with software rendering (no GPU).
Real-world references: 5 YouTube videos (Rise & Alpine, Lifelong Trail x2, Adventure with Renee, SnowSeekers Gunbarrel Saloon), official Apex drone and village aerials, Lift Blog photos of the lifts, Quickdraw summit webcam (22 Nov 2026).
Capture numbers below link to the screenshot with that filename prefix in [shots/](shots/). Frames 21, 29 and 32 were not in the uploaded set. Video marks (V3, V5, and the "video NN" times) have no still in this folder.

Checked against the source at `991aa58`. Where a claim disagreed with the code, the paragraph cites the file and says what the code does. The missing `features.json` pipeline (item 1) is fixed in the data workflow. Every other item is a proposal for triage and is not implemented.

## P0: broken or missing on the live page
1. **The live page is missing most of the resort.** `data/features.json` returns 404 on GitHub Pages, so the game falls back to `references.json`: Grandfather's plus the Quickdraw line only. That means 0 buildings, 0 cars, no Stock's, no T-bar, no magic carpet, and 22 runs instead of 84. Cause: the "Export OpenStreetMap features" step in `.github/workflows/data.yml` had `continue-on-error: true`, and Overpass (the OSM download service) timed out, so the data branch was published without `features.json`. The step now retries several Overpass mirrors inside `tools/osm`, then calls `api.openstreetmap.org/api/0.6/map` with the bbox from the terrain manifest. If that export is not usable, the job fails and the data branch keeps its last good build. The Pages build fails unless the built `data/features.json` has buildings > 0 and lifts == 4.
2. **Trees dissolve into dotted "ghost" shapes near the camera.** The dither fade near the camera draws floating dotted cones, trunks and crowns ([24](shots/24_glades-closeup.jpg), [30](shots/30_quickdraw-bottom-terminal.jpg), [36](shots/36_stocks-bottom-terminal.jpg)), and it looks worst in orbit and aerial views. The fade is the screen-door discard in `game/src/render/scenery/forestView.ts` (`smoothstep(3.0, 8.5, vCamDist)`). Fade only when the tree would block the skier from the camera, or shrink the fade radius in orbit and aerial modes.
3. **T-bar base:** there's a large flat dark-brown triangle and thick black strips across the snow ([38](shots/38_tbar-bottom.jpg)). It's most likely a building gable seen edge-on and the rope drawn flat. Find the source and fix it.
4. **Wrong run name on the HUD with `?at=`:** it still says "Grandfather's Trail · from Quickdraw" after spawning on Gunbarrel. `spawnOverride` in `game/src/main.ts` (lines 789-794) only replaces `spawn`. The title is set from `course.startRun` and `course.startLift` (around line 361), which that override leaves alone.
5. **First person:** the green landing ring fills the lower view on steep runs while airborne (V5). It is already hidden on the snow: `game/src/main.ts` updates `landingMarker` only when `skier.air` is set. Hide it in first person as well.
6. **OSM name typo still showing:** "Dude ney Trail" is not renamed. Add it to `game/src/world/corrections.ts`. "Stock's Chiar" does not show in game: `resortFromFeatures` in `game/src/world/resort.ts` rewrites it to "Stock's Chair" when the lift is built. The raw OSM name is still in `features.json`. The saloon typo, "The Gunbarell Saloon", is already corrected in `corrections.ts`.

## P1: biggest gains in realism
### Runs and terrain
7. **Widen the groomers.** Grandfather's, Okanagan and the T-bar runs are 40–50 m or more wide in the footage, while steeps like Gunbarrel and Chute are about 15–20 m. Half-widths are already chosen by difficulty in `runHalfWidth` (`game/src/world/resort.ts`): 16 m easy, 14 m intermediate, 12 m advanced, 11 m otherwise. That is still a full width of about 22–32 m. Widen them, vary by run type as well as difficulty, and use the LiDAR canopy gap where it's clearer.
8. **Ragged, natural run edges.** Real edges have scattered saplings, snow banks and trees stepping into the run, not parallel lines. The groomed mask already wobbles the edge (`edgeNoise` in `game/src/world/surface.ts`): the distance is `half * (0.82 + 0.3 * noise)`, about 0.5 to 1.1 times the nominal half-width. It can still read as a ruled corridor. Use stronger noise, and place small trees and stumps 0–5 m inside the edge.
9. **Wider lift-line clearings.** The Quickdraw line is a 20–30 m straight cut, one of the most recognisable shapes in the drone shot ([33](shots/33_quickdraw-lift-line-clearing-aerial.jpg), V3). Stock's and the T-bar are similar. The game clears only 9 m (`LIFT_CLEARANCE` in `game/src/world/forest.ts`).
10. **Summit plateau character.** The top is broad and wind-scoured, with exposed rock (the "Scrapex" nickname), sastrugi wind ripples, and fences and windbreaks around the top terminal. The game's summit is a smooth white dome (frame 21 was not in the uploaded set, [22](shots/22_summit-snow-ghosts-closeup.jpg)). Add a wind-scour snow type with rock poking through above about 2100 m.
11. **Cat tracks and traverses.** Narrow, flattened traverses link the Quickdraw top to the steeps and run along the summit. Add terrain cuts along OSM `piste:type=downhill` tracks or traced paths, so skiers have a ledge to follow.
12. **Bigger, deeper moguls** on Gunbarrel and the runs under Quickdraw. They read as shaded bumps now ([28](shots/28_gunbarrel-low-angle-moguls.jpg)). Displace the actual mesh about 0.6–1.0 m with a 4–6 m spacing on the fall line, so the bumps also cast shadows.
13. **Glades with real gaps.** Glade runs and Wildside should have clumps of trees with skiable lanes running down the fall line, not evenly spread trees.
14. **Name the remaining LiDAR-traced runs** using the official trail map (`apex-winter-trail-map-2023.pdf`, 2025/26 map) and the grooming report (apexresort.com/weather). Three of the 21 already have names in `game/src/world/runOverlay.ts`: Highway 97C, Mini-Colorado and Crusher (see `docs/apex-sources.md`). The other 18 are still `Wildside cut` or `Unmapped run`. About 30 official names are missing from OSM, including the whole Wildside pod.

### Trees
15. **Snow ghosts at the summit.** In the footage, trees above about 2080 m are solid white, lumpy rime pillars with no green showing, stunted and wind-flagged (video 02 at 2:05, the webcam). The game already has a white lumpy mesh (`ghost()` in `game/src/render/scenery/treeShapes.ts`). `pickSpecies` in `game/src/world/forest.ts` assigns it above about 2080 m, but only to part of the stand: about 40% of the taller trees, with the rest fir or spruce, and short trees mostly krummholz. The summit still reads green ([22](shots/22_summit-snow-ghosts-closeup.jpg)). Push that mix toward short white rime pillars.
16. **Heavier snow on branches below the summit.** Branches carry thick white snow loads with dark green showing through, so the forest reads mostly white from a distance in the drone shot. Near meshes already carry some snow (`snowiness` on the spruce and fir whorls in `treeShapes.ts`). The distant stand-in is a dark green cone, so from the air the forest is too dark and too sparse ([49](shots/49_drone-view-NE-of-village-up-mountain.jpg)).
17. **Denser forest.** The drone shot shows a near-solid canopy between runs. Check the canopy-cover-to-tree-count mapping (70k drawn out of 232k), and add a cheap far-LOD "forest carpet" texture on the terrain under distant trees, so they don't look thin.
18. **Tree variety.** Near trees are already six shapes in `game/src/render/scenery/treeShapes.ts` (spruce, fir, pine with a bare lower trunk, snag, krummholz, snow ghost), not one cone. The distant stand-in is a shared cone, which is what an aerial view mostly shows ([25](shots/25_glades-from-above.jpg); frame 29 was not in the uploaded set). Add more silhouette variation up close (random scale and lean are only a girth tweak today) and a less cone-like far LOD.
19. **Clumping.** Use a clustering pattern so trees form groups and gaps, instead of a uniform random scatter inside each 5 m cell.
20. **Keep trees off lift terminals and buildings.** Trees grow right up to the Quickdraw and Stock's bottom terminals ([30](shots/30_quickdraw-bottom-terminal.jpg), [36](shots/36_stocks-bottom-terminal.jpg)) and in front of building walls ([43](shots/43_village-gunbarrel-saloon.jpg)). Clearance today is the run mask, a 9 m lift line, and 5 m around building lots (`game/src/world/forest.ts`, `game/src/world/surface.ts`).
21. **Fix the one oversized spire tree** behind the summit hut ([20](shots/20_summit-plateau-wide.jpg), frame 32 was not in the uploaded set, [54](shots/54_billy-goat-hut.jpg)).

### Lifts
22. **Quickdraw terminals:** grey Doppelmayr Uni-style stations with a curved hood over the bullwheel, a galvanized grey tower at the top, and a chair-storage rail. The bottom is an open steel return with an attendant hut. Reference: Lift Blog `liftblog-quickdraw-*`, webcam.
23. **Quickdraw chairs:** unpainted galvanized quads with pull-down safety bars and footrests. Towers are galvanized grey tubular steel with crossarm walkways and ladders.
24. **Stock's terminals:** open green steel frames (GMD Müller) at the bottom, with a small operator hut. The top drive is a grey-green A-frame cabin with windows (video 04 at 0:33, `liftblog-stocks-*`).
25. **T-bar:**
    - a blue drive house and counterweight column at the base
    - a yellow return bullwheel at the top, and a lookout
    - short-handled bars hanging from the cable
    - towers running up the middle of the run (OSM has none, so place 7 portal towers along the line by hand)
    - a packed track in the snow
    - the haul rope already sags between supports in `game/src/render/scenery/liftView.ts` (a parabolic dip, capped at 2.2 m, in the span loop around lines 106-118). With no T-bar towers that cap is one span for the whole line, so it can still read as straight. Portal towers would add real sag as well as the hardware.
26. **Magic carpet:** currently a dark 1.2 m box (`BoxGeometry(1.2, 0.3, ...)` in `game/src/render/scenery/liftView.ts`, [41](shots/41_magic-carpet.jpg)). Add side rails, an end ramp at each end, and the clear plastic tunnel cover seen in photos.
27. **Lift-maze details:** orange netting, a timber lift sign reading "Quick Draw" and "Stocks Chair", a loading ramp, an attendant hut, and a corral.

### Village and buildings
28. **Hero buildings modelled by hand,** replacing the procedural shells for the ones people recognise:
    - the ochre/yellow 4-storey lodge with staggered balconies
    - the red-brown chalet
    - the grey boxy lodge
    - the Edge Bistro, dark grey with a deck and red picnic tables
    - the Gunbarrel Saloon: heavy log timbers, a big deck with log railings, vintage Apex signs
    - Guest Services and the ticket office, the Pit Stop cafeteria, and the ski patrol building
29. **Roofs:** steep gables with thick, rounded snow (0.5 m or more), overhangs at the eaves and icicles. Avoid flat roofs, and add chimneys.
30. **Wall materials:** timber siding, log, board-and-batten and stone bases, instead of flat colours with a window grid ([43](shots/43_village-gunbarrel-saloon.jpg), [48](shots/48_village-base-area-skier-eye.jpg)). Add trim, window frames and balconies.
31. **Billy Goat Hut:** a log cabin with a "Ski Patrol / First Aid" sign, a deck and a snowmobile parked outside. Remove the two generic cabins next to it, and check how far it should sit from the Quickdraw top ([54](shots/54_billy-goat-hut.jpg)).
32. **On-building signs** instead of floating name labels ([38](shots/38_tbar-bottom.jpg), [48](shots/48_village-base-area-skier-eye.jpg)). Show labels only when the map is open, or on hover. Today they are sprites in `game/src/render/scenery/signView.ts`.
33. **Missing amenities:** the Tim Hortons tube park beside the magic carpet, the outdoor hockey rink, the roughly 1 km skating loop through the trees, and the children's terrain park.
34. **Village details:**
    - ski racks
    - wooden trail-map kiosk
    - orange "SLOW" banners and bamboo poles near the base
    - string lights on covered walkways
    - snow-covered cars in the parking lots
    - snowbanks along roads
    - a snowman and an igloo near the base (video 03 at 1:45)

### Snow and lighting
35. **Time-of-day and weather presets.** Lighting is fixed to "Clear late-morning winter light" in `game/src/render/lighting.ts` (`createLighting`). Add at least these three:
    - clear bluebird day with long, sharp tree shadows across the corduroy (video 03)
    - flat overcast light where the snow looks matte, with lower visibility (videos 01 and 04)
    - snowing, with fog
36. **Longer shadow range.** The shadow camera is ±110 m around the skier (`game/src/render/lighting.ts`, `sun.shadow.camera` left/right/top/bottom). Add cascaded shadows, or bake tree shadows onto the terrain for the distance, so the whole slope shows tree shadows on sunny days.
37. **Snow surfaces:**
    - skied-off chop and tracks across groomers later in the day
    - deep untracked powder in the trees
    - icy, shiny patches on the steeps
    - a wind-crust look at the summit
38. **Corduroy:** good already ([22](shots/22_summit-snow-ghosts-closeup.jpg)). Fade it out with distance and wear it off along the most-skied line.

### People and life
39. **Other skiers:** a scatter of riders on named runs is already in `game/src/app/npcs.ts` (4, 7 or 10 by graphics quality, bright outfits, about a quarter on boards). They pass through the player. Still to add: riders on the chairs, lift attendants in blue, and patrol in red with a white cross.
40. **Snowcats and snowmobiles,** parked or moving along the cat tracks.
41. **Flags and windsock** at the summit (the webcam shows a red windsock).

## P2: polish and performance
42. **Load size:** about 7 MB is downloaded before the title screen. The 5 m grid is Float32 (`heights.f32`); the 2 m grid is uint16 centimetres (`heights-2m.u16`, `docs/terrain.md`). Compress both (the roadmap already notes a delta encoding), lazy-load the horizon, and show a progress bar.
43. **Performance on low-end machines:** about 1.4M triangles and 250–750 draw calls in the village. Merge more static village props into instances and reduce far-tree triangles. Low, medium and high presets already exist in `game/src/app/settings.ts`. Low cuts forest density to 0.7 and the shadow map to 1024, but shadows stay on unless the separate Shadows setting is off. A low preset that turns shadows off is still open.
44. **Minimap in orbit view:** the label follows the skier rather than the camera (`draw` in `game/src/ui/minimap.ts` uses the skier position).
45. **Peak label:** "Beaconsfield Mountain · 2173 m" is the LiDAR height at the OSM node. The code already ignores the 2247 m tag and labels peaks from the grid (`game/src/app/apexStage.ts`). `docs/apex-sources.md` records about 2173 m. The crop maximum is about 2176 m (`docs/status.md`), which is a different number from the label. Keep the LiDAR label.
46. **Docs:** README is still at 0.5.0, and `docs/status.md` has stale open issues.
47. **CI:** add a Pages smoke test that loads the built site, checks `data/features.json` returns 200, and checks that the building count is above 0. The Pages workflow now checks the built `game/dist/data/features.json` before upload: the file must exist, buildings must be > 0, and lifts must be 4 (`tools/osm/check_features.py`).

## Reference set
- Videos: https://www.youtube.com/watch?v=An8kSTvZv_k, https://www.youtube.com/watch?v=JQN6lDrrf-4, https://www.youtube.com/watch?v=pVY38aSUTjg, https://www.youtube.com/watch?v=4--L7-5Ks7w, https://www.youtube.com/watch?v=55Spwst3_18
- Lifts: https://liftblog.com/quickdraw-apex-bc/, https://liftblog.com/stocks-apex-bc/, https://liftblog.com/t-bar-apex-bc/
- Trail map: https://apexresort.com/wp-content/uploads/2023/12/Apex-Mountain-Winter-Trail-Map-2023-PDF.pdf
- Village map: https://apexresort.com/wp-content/uploads/2023/05/Apex-Map-v2-1024x1024.png
- Third-party stills (the official drone frame and Lift Blog photos) are not kept in this public repository; see the links above.
