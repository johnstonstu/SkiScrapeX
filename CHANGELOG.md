# Changelog

SkiScrapex uses [semantic versioning](https://semver.org/). Until 1.0 the minor number marks a milestone and the patch number a fix release; anything may change between minors. Each milestone is a merge to `main` with a `vX.Y.Z` tag. The version lives in `game/package.json` and shows in the pause menu.

## Unreleased

### Changed
- Ready for a public repository: MIT `LICENSE`, data licences spelled out in the README, `SECURITY.md`, development notes in place of the internal handoff log, and `.gitignore` entries for local secrets.
- Vitest 3 to 5 (fixes dev-only advisories in tinypool and @vitest/mocker; `npm audit` is clean).

## 0.7.0 (2026-11-21): Settings, gamepad and a reason to ski

### Added
- Title screen with Free ski (Continue once you have runs), Challenges, Rider and Settings, plus a medal, run and nugget summary. The pause menu has a Main menu button. Review links (`?dev`, `?park`, `?ride`, `?at`, `?perf`) skip it.
- Challenges (pause menu, title screen or `H`):
  - Timed runs on every named run over 180 m. Gold, silver and bronze times come from a pace bot that skis each run on the real terrain (22 m/s cap). Silver is 20 percent slower than the bot and bronze 50 percent. Times are worked out in the background and cached per version; a run's times are computed on the spot if you start it first.
  - Three slalom courses on groomed greens and blues, with red and blue gates that turn green or grey as you pass or miss them. A missed gate adds 3 s.
  - Park score attack for each park and its current layout. Point targets come from the features in the layout and are provisional until playtested.
  - Courses start at the first clear spot past the top of the run (not inside the lift terminal), and an attempt ends after 4 s far off the course.
- Results card after each challenge: time or score, medal, best and next medal target, top speed, distance, vertical, gates and trick points. Retry (`R`), Keep skiing (`Esc`) or Challenges.
- Free-ski run card during the lift ride: time, best, top speed, distance, vertical and trick points.
- Ski every run: a run counts once half its length has been skied. The checklist is in the challenge list.
- 12 hidden gold nuggets just off the edges of runs, the same on every load. They glint and bob; ski into one to pick it up.
- Rewards in the rider panel, shown locked with their hint until earned: Gold colour (3 golds), Chrome colour (10 medals), Topo ski graphic (20 runs skied), Nugget ski graphic (6 nuggets).
- Local profile (`skiscrapex.progress`): medals, bests, runs covered, nuggets and lifetime totals.
- `npm run tune` with `MEDALS=1` prints the pace bot's times for every run at three speed caps.
- Settings panel (pause menu or `G`), saved in the browser:
  - Graphics quality: Auto, Low, Medium or High. Auto picks Low on touch devices and High elsewhere. Changing it asks for a reload.
  - Shadows on or off, view distance (60 to 140 percent tree reach), steering sensitivity, flipped up and down controls, camera field of view, camera shake, volume, landing marker and landing assist.
  - Everything except quality applies live.
- Gamepad support (standard mapping):
  - Left stick skis and spins, LT brakes, A jumps, X or RB grabs, Y does the second grab.
  - B skips the lift, LB changes camera, Start pauses, View/Back opens runs.
  - D-pad: down for the map, up for the rider, right to restart.
  - The help text switches to pad buttons once a pad is used.

### Changed
- Slalom gates are race-sized (2.3 m poles, 0.9 m banners) and fade as the follow camera passes through them. The HUD counts gates and misses.
- Gates and nuggets sit on the 2 m detail surface, not the 5 m grid.
- Medal-time cache keyed by course shape, so moved gates or retraced runs get new times.
- Quality profiles (`app/settings.ts`) replace the scattered touch checks for pixel ratio, antialiasing, shadow map size, terrain tiles, forest density and reach, and particle counts.

## 0.5.0 (2026-11-21): Housekeeping and performance

### Changed
- Source reorganized: `app/` (entry wiring, Apex stage assembly, menus, trick feed, storage), `player/` (input, camera, audio, effects), `ui/` (minimap, rider panel), `render/terrain`, `render/scenery`, `render/rider`, `tools/` (rider lab). `main.ts` went from 790 to 500 lines.
- Version shown in the pause menu and the info overlay.
- 2 m terrain tiles build about 2.5 times faster and run under a per-frame time budget, removing 10 to 35 ms hitches while skiing.
- Lift towers, terminals and the summit hut merge into a few meshes (lifts 93 to 10 meshes, village 47 to 8).
- Far forest past the mid range draws a 4-triangle stand-in (forest triangles 926k to 548k).
- Touch devices draw the coarse terrain at 10 m, about half the scene triangles.
- The info overlay text is only built while it is open.

### Added
- `?perf` probe for load phases, frame CPU split and renderer counts.
- CHANGELOG, version tags, roadmap (`docs/roadmap.md`).

### Fixed
- Test slopes (`?dev`) no longer leave "Loading…" on screen.

## 0.4.0 (2026-11-21): Runs, trees, village, creator, corks

### Added
- 21 runs that OpenStreetMap lacks, traced from LiDAR canopy gaps (`scripts/detect-runs.py`, `world/runOverlay.ts`); names provisional, key in `docs/runs-overlay.png`.
- Tree species by elevation: Engelmann spruce, subalpine fir, lodgepole pine, snags, krummholz and snow ghosts.
- Village props: parking lots found in the LiDAR with parked cars, decks with patio tables, the Billy Goat Hut by the Quickdraw top.
- Character creator: six ski top-sheet graphics with an accent colour, jacket accent colour, backpack.
- Corks and double corks (pitch during a spin), rail entry pop.

## 0.3.0 (2026-11-21): Steeps, rider and freestyle

### Changed
- Ski physics on steeps: sidecut-driven yaw, edge grip in g, attack-angle skid split so skids scrub speed, uphill traverse edge. See `game/research/controls-physics-review.md`.
- New rider model (baggy or slim kit, helmet or beanie, gaiter) and riding style: carve lean from physics, angulation, counter-rotation, pole plants, tuck, landing absorb, grab IK, grind pose.

### Added
- Landing marker, truck driver and nose grabs, rider lab page (`rider.html`), steep-slope tuning probe.

## 0.2.0 (2026-11-21): 2 m terrain

### Added
- 2 m detail terrain from the 1 m LiDAR near the camera, morphing to the 5 m surface; physics and object placement use it.
- Branch data builds publish to `data-<branch>`; the Pages deploy is skipped unless `PAGES_ENABLED=true`.

### Changed
- Controls and feel pass recovered from the first handoff: steadier steering on steep faces, switch riding, pole push on flats, softer deep powder, mogul bumps, procedural audio, Esc pause.

## 0.1.0 (2026-11-21): First playable

### Added
- Apex terrain (LidarBC 5 m), canopy forest, OSM runs, lifts and buildings, horizon from NRCan MRDEM.
- Ski model with carving, powder and freestyle; terrain parks with swappable layouts; lift rides; run picker; first-person camera.
