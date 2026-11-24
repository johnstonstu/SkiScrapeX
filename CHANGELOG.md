# Changelog

SkiScrapex uses [semantic versioning](https://semver.org/). Until 1.0 the minor number marks a milestone and the patch number a fix release; anything may change between minors. Each milestone is a merge to `main` with a `vX.Y.Z` tag. The version lives in `game/package.json` and shows in the pause menu.

## 0.8.9 (2026-11-23): Terrain park and mountain polish

### Added

- Standard gamepad support for skiing, freestyle and menu navigation. The Escape menu now includes keyboard, controller and touch guides with explanations for jumps, grabs, presses and slides.
- Terrain parks have signs at entrances and features, a distance-to-lip and speed gauge on approach, and a balance meter on boxes and rails. Score attack results show landing grades, slide distance and best trick. Box contact, rail contact and landings have distinct sounds.

### Changed

- The title screen, HUD, pause menu, side panels and results share a new visual design. The compact HUD keeps readouts clear beside the minimap on narrow phones.
- Powder varies in depth across the mountain. Deep snow slows and sinks the rider more, throws more spray and leaves deeper tracks. Irregular moguls have distinct uphill and downhill faces and shallower snow on their crests.
- Trees leave more room between trunks. Glancing hits can slide past, and recovery after a hard hit looks for a clear downhill route. Graphics tiers share the same collision trunks, with simpler nearby trees on Low.
- Ski and snowboard boots and bindings have separate shapes. The rider's jacket has fabric texture, a reshaped hood and a hem that follows the body through jumps and grabs.
- Lower-angle sunlight helps define the snow surface, and the rider has a soft ground shadow when the shadow map is off.

## 0.8.8 (2026-11-23): Graphics that fit the machine

From 0.8.7 failing to draw on Stu's older Intel MacBook: Chrome lost the WebGL context and then switched WebGL off for the browser, leaving menus and sound over a blank screen.

### Added
- Auto graphics read the graphics chip and start at a level it can run: Low for older Intel graphics, software rendering and phones; Medium for Iris Xe, older dedicated laptop chips and anything unrecognised; High for Apple silicon and current NVIDIA, AMD and Intel Arc cards. Settings shows the reason next to Auto.
- If Auto still runs under 24 fps while skiing, it lowers the resolution and turns shadows off straight away, and starts a level lighter next time on that machine.
- A graphics chip reset (WebGL context lost) shows a message and a Reload button and steps Auto down a level. If the browser has switched WebGL off, the game says so and explains that restarting the browser clears it.
- `?turns=wide` offers wider turns at speed for playtesting. Classic steering remains the default.
- Pull requests to `main` now run the game tests with Apex data, build the game, and validate the OpenStreetMap export.

### Changed
- The close-up snow detail added in 0.8.7 (fine relief, worn groomer patches, wandering run edges, forest debris) is off on Low.
- Apex height grids support lossless packed downloads. The browser can also load the original grids.
- Snowboard poses now show distinct toe-side and heel-side turns, an updated tuck and ollie, and grabs that release with the input. The rider lab can replay these moves.

### Fixed
- The keyboard tip for skipping the Quickdraw lift ride now shows Enter.

## 0.8.7 (2026-11-23): Review fixes

From the visual review of 0.8.6 (`docs/review/apex-visual-improvements.md`).

### Fixed
- Trees no longer ghost in front of the camera. Trees fade only where they block the line from the camera to the skier, so the forest around you stays solid. The last 1.6 m in front of the lens still clears.
- The landing ring no longer floats in the first-person view.
- Official run spellings from the Apex trail map: Dude-Ney Trail, Gromit, Dawdler 1 and 2, Highway 97, Peashooter. Saved medals, bests and checklist progress carry over to the new names.

- The orbit view's minimap names the place the camera is looking at and draws a sight line from the camera to it (#48).

### Added
- Demo park: a 2.6 km, 12° practice run off the Apex map with 24 features in a progression line, from rollers and small tabletops through boxes, flat, down and flat-down rails and a step-down to two XL jumps. Open it from the runs menu (T) under Terrain parks, or with `?demo`. Picking any Apex run, park, challenge or the tutorial takes you back.

- Out-of-bounds line: orange bamboo poles and a sagging rope along the OSM ski-area boundary, open where roads cross, with "Area boundary / Closed beyond" signs every 220 m facing into the resort. Like the real rope, it does not stop you (#68).

- Trail-head signs are timber boards on two posts with a cap rail, painted with the run's difficulty symbol and name, facing skiers coming from above. The floating name label now only shows from 60 to 260 m away to help you find runs; up close you read the board (part of #36).

- Snow detail: fine wind-pressed relief within about 70 m of the camera (stronger in powder), run edges warped by noise so the border between groomed and powder wanders, worn patches on groomers where the corduroy fades and faint skier streaks show, needle and twig debris under the trees, and a broad brightness drift so far slopes are not one flat tone (part of #69).

- Summit windsock (red and white, as on the summit webcam) and three flag poles behind the Quickdraw top terminal, swinging in a slow gusting wind (#45).

### Quickdraw
- Chairlift hardware modelled on Quickdraw, a 1994 Doppelmayr-CTEC detachable quad. Towers are galvanized tapered tubes with a crossarm, a four-wheel sheave train under each rope, a ladder and a railed walkway. Chairs are galvanized quads with a hanger that bends back over the seat, four seat and back pads, and a lowered safety bar with a footrest. Terminals are long detach housings under a rounded light hood, open underneath, with an operator hut by the loading area, each facing down the line. The housing hides while the camera is inside it, so boarding and unloading stay clear (#26, #27). Stock's uses the same towers and chairs as a triple for now.

### Rider
- Head: an open-faced helmet with vents and a back shell that drops over the ears, cylindrical goggles at eye level wrapping the face, a goggle strap round the back in the jacket accent colour, and the gaiter pulled up to the nose so the nose and cheeks show. Before, the face was a grey cylinder with the goggles floating above it.
- Boots: a light shell with a toe box, an instep and a forward-leaning cuff, a dark spine and heel, four buckles with levers on the outside, and a power strap.
- Pants: a flat, shaped knee panel instead of a lump, and cargo pockets on the thighs.

### World
- Wider groomers: run width now depends on grooming as well as difficulty. Groomed greens are about 40 m across, groomed blues 36 m, and ungroomed runs and the steeps 18 to 22 m (#11).
- Lift lines are cut 24 m wide with a ragged edge, up from 18 m, and an 18 m circle round each terminal is clear of trees (#13, part of #24).
- Trees are capped at 35 m (LiDAR picks up towers and roofs as canopy), and trees above 2060 m at 11 m, which should remove the spire behind the summit hut (#25).

### Changed
- Shadows are now Auto, On or Off (Settings → Shadows). Auto turns them off on Low graphics, which phones use, because the shadow pass is the largest single cost there. Saved settings move over: On becomes Auto.
- README, status and roadmap brought up to date for 0.8.6, with the next five phases.

## 0.8.6 (2026-11-22): Turns that read right

From Stu's playtest of 0.8.5: turning still felt off, and the rider looked wrong both mid-turn and between turns.

### Fixed
- Steering from a full traverse: with the skis across the hill (100° off the fall line), steering the other way could do nothing. The sim measured the shortest way round to the opposite traverse, which goes uphill, and refused to turn against the stick. It now works in angles from the fall line, so the skis come back down through it. A regression test covers this.

### Changed
- The body leans for the turn you are really making: the path's curvature times speed is the sideways acceleration to balance. The carve model's load missed pivoted and skidded turns, so at 34 km/h on a 50° edge the rider stood nearly upright over tilted skis. Lean is capped at 49° and tracks the turn about twice as fast as before, but the edge change still takes about 0.3 s, not a flick.
- Less counter-tilt at the hips and back (about half), so the upper body leans into the turn instead of staying level over the legs.
- The ski tilt is the body lean plus a little knee angulation. Skis no longer sit at 45° under an upright body.
- In a turn the inside hand reaches forward and down toward the next plant, and the outside hand stays wide.
- Rider lab: `rider.html?sim` runs the real ski sim through linked turns behind the follow camera, with `pitch`, `period`, `cap`, `fov` and `style` options and `window.__step(frames)` for frame-by-frame review.

## 0.8.5 (2026-11-22): Steady camera, poles and lift unloading

From Stu's playtest of 0.8.4: turns still felt laggy with the camera swinging, the arms and poles and the flat push needed work, and skipping a lift should show you getting off at the top.

### Added
- Camera follow setting (Settings → Camera follow). **Steady** is the new default: it looks down the hill and lets the skier swing across the view, like a follow-cam filmer, and only turns quickly when you traverse well away from the fall line. **Tight** is the previous camera, which turns with the skis. In simulated linked turns on a 15° slope the steady view swings 24° while your path swings 77° (the tight camera swings the full 77°).
- Getting off the lift: at the top you stand up off the chair (or let go of the T-bar) and glide down the unload ramp, then you have control at a standstill, facing on from the lift, with the HUD reading "Top of Quickdraw". Skip now jumps to about two seconds before the top so you see the arrival; press it again to step straight off.
- Double-pole push: below about 8 km/h with forward held, the rider reaches both poles forward, plants them, drives the hands down past the hips with a crunch of the back, and swings through. Skating takes over as speed builds.

### Changed
- Pole plants: the tip reaches ahead of the boots at the edge change, stays where it struck the snow while you ski past it, and lets go once it is behind you.
- Arms carry a little higher and wider, and the pole tips ride just off the snow behind the boots instead of up in the air.
- Poles shorten slightly when planted close in, so the tips no longer push through the snow.
- Chairlift terminals are a slim column with the bull-wheel housing above the rope, so arriving riders and the camera pass underneath instead of into a low roof.
- Skipping keeps you on a chair: the jump is a whole number of chair spacings.

## 0.8.4 (2026-11-22): Rider model and animation pass

### Added
- The version number shows in the corner of the in-game HUD, so a tester can see which build is live.
- Skating: below 18 km/h with forward held, the rider skates in a V. The pushing ski angles out on its inside edge and recovers, the weight moves over the gliding ski, and the arms and poles swing in time.
- Snowplough: braking below about 22 km/h brings the tips together and the tails out on their inside edges. Faster braking is still a hockey stop.
- Idle: standing still, the rider shifts their weight, breathes and looks around.
- Rider lab: `rider.html?pose=tuck,carve-left` shows only those poses, for close-ups. Snowplough and Skating poses were added.

### Changed
- The rider is split into `skierModel.ts` (meshes and rig) and `skierView.ts` (animation), as the roadmap's engineering track asked.
- Two-part back: the spine and chest bend separately. A deep crouch or a tuck rounds the back, and the racing tuck now has a near-flat back, hips back, fists in front of the chin and poles under the arms.
- Turns: the hips, spine and chest angle back against the inclination, so the legs lean into the turn while the shoulders stay near level. The head turns toward where you steer. At each edge change the legs extend to release the old edges, then flex into the new turn.
- Motion uses damped springs instead of plain easing. A landing sinks past the absorb and comes back up, a takeoff extends, and turn transitions swing through and settle.
- Crashing, getting up, rail entry and getting on or off a lift crossfade from the previous pose instead of snapping. Going down takes 0.16 s and getting up 0.55 s.
- Model:
  - Rounded shoulders, elbows and knees, so the joints don't show gaps.
  - A cinched jacket hem, where it was a flat bell.
  - A collar, a chest pocket and glove gauntlets.
  - A pole strap and a second boot buckle.

## 0.8.3 (2026-11-22): Fixes from the 0.8.2 playtest

From the headless playtest in PR #3 (`docs/review/playtest-0.8.2.md`).

### Fixed
- Braking over moguls no longer backflips you. Leaving the snow without a pop (a mogul, a lip, a drop) with pitch already held, usually Down as the brake, does nothing in the air until you let go and press it again. This is the same rule as rails. Popping with pitch held still flips as before (B1).
- Combo farming: only a trick that is new to the combo and scores at least 100 points raises the multiplier. A string of small ollies or the same trick again adds its points but no extra multiplier. The playtest's ×5 for flat ollies is now ×1 (B2).
- `?at=` spawns title the HUD with the run underfoot instead of "Grandfather's Trail · from Quickdraw" (B3).
- T-bar: the base terminal is now a post with the bull wheel and a small hut to one side, so the follow camera no longer starts inside a box and under a roof. Moving hangers pull the rider, who stands under the up rope beside a hanger. Towers are 7 m (were 11 m, like the chairs). While riding, the HUD reads "Riding T-Bar" (B4, B5).
- Running into a building moves you back outside the wall, so getting up is no longer another crash. Below 15 km/h into the wall you slide along it instead of crashing (B6).
- A rail you come off early reads "(slipped off)" instead of "(fell)", since you are still on your feet (B8).

## 0.8.2 (2026-11-22): Smaller jumps, quicker turns

From Stu's first playtest of 0.8.1: jumps launched far too big and turning felt laggy. Measured with `tuning/feel.test.ts` (now part of `npm run tune`) before changing anything.

### Changed
- Pop: 1.0 to 2.4 m/s (was 1.2 to 3.0), and popping while a kicker is already lifting you adds less (scaled by 1 − rise / 5 m/s, at least 0.35). A timed pop on the medium kicker at its sign speed used to quadruple the height above the lip (0.35 to 1.39 m); with the new lips it now peaks at about 0.55 m. A full pop on the flat is about a 0.3 m ollie.
- Kickers: lips 6° lower (small 10°, medium 16°, large 20°, XL 23°) and landings 2° gentler. With a pop at the sign speeds, flights peak 0.4 to 1.1 m above the lip (were 1.4 to 2.1 m), and the speeds you can land cleanly are wider. The signs now read small 20 to 30, medium 20 to 35, large 20 to 40 and XL 25 to 50 km/h. Coming in well above those still overshoots the landing.
- Follow camera turns with the skis instead of the path: it aims 30 percent toward the travel direction (was 60) and catches up about twice as fast. In a held turn it now trails the skis by 0.13 to 0.19 s at 30° (was 0.27 to 0.39 s).
- Keyboard steering ramps to full edge in 0.09 s (was 0.125 s).

## 0.8.1 (2026-11-22): Rail presses and the missing resort on the live page

### Added
- Rail presses: on a rail or box, hold forward (<kbd>W</kbd>, Up, or the stick up) for a nose press or back for a tail press. A press shows in the rider pose, is harder to balance (the balance pendulum's unstable term is 1.3 times stronger on rails, 1.15 on boxes) and scores 40 points per metre pressed. The trick name takes the press held longest, such as "Nose Press 50-50 Rail". Pitch already held when you land on the rail (Down is also the brake) does nothing until you let go, and holding a press off the end does not start a flip. Values are provisional until playtested.

### Fixed
- The live page was missing most of the resort (no buildings, no Stock's, T-Bar or Magic Carpet) because the data build published without `features.json` when Overpass timed out. The OSM export now tries four Overpass mirrors and then the main OSM map API; if all fail, the data job stops and the last good build stays published. The Pages build refuses a `features.json` without buildings and four lifts.

### Changed
- The first-rail tip explains presses and slides. It used to say grab gives a slide bonus, which the sim never did.
- `docs/review/apex-visual-improvements.md`: visual gaps from comparing 0.8.0 with real Apex footage, for triage.
- `game/research/ski-physics-and-freestyle.md`: Jibbin freestyle and park audit (static analysis only) and the rail press design.

## 0.8.0 (2026-11-22): Tutorial, tips, snowboarding and a public home

### Added
- Tutorial ("Learn to ski" on the title screen the first time, "Tutorial" after): six lessons on Easy Rider by the Magic Carpet. Get moving, turn both ways, stop, carve, jump, grab. Each lesson finishes when you do it. A Next button appears after 20 s, the carve lesson starts from the top, the bottom of the hill sends you back up, and the tutorial can be skipped. Wording follows keyboard, touch or gamepad.
- One-time tips the first time you crash, hit deep snow, ski the trees, find ice, ride a steep pitch, approach a park jump, get on a rail or ride a lift.
- Snowboarding: pick Snowboard under "Skis or board" in the Rider panel. 8 m sidecut, more float in powder, sideways stance, one board and one wide track, no poles. Board on the chairlift, toe and heel lean in turns.
- Other skiers on the hill (4, 7 or 10 by graphics quality; Settings to switch off). They ski named runs in S-turns at their own pace, about a quarter ride boards, they respawn near you, and they pass through you. They keep skiing behind the title screen.
- Title screen backdrop: a slow pan around the view from the top of Quickdraw.
- `docs/run-names.md`: the official Apex runs OpenStreetMap is missing and the candidates for each traced run.

### Changed
- Apex accuracy pass from the 2023 and 2026/27 trail maps, the grooming report, Wikipedia and an aerial photo (`docs/apex-sources.md`):
  - Traced runs named: Highway 97C (blue), Mini-Colorado (double black), Crusher. Upper Wishbone is blue.
  - Apex Mountain (2247 m) labelled on the horizon; the summit label uses the LiDAR height.
  - Building names cleaned up; village wall colours from the photo, with the Apex Mountain Inn yellow.
  - T-Bar and Magic Carpet run at their real speeds.
  - All fixes live in `world/corrections.ts`.
- Faster load: parking lot search 269 to 52 ms and forest planting 240 to 127 ms with the same output; about 30 percent off the build phase in the browser.
- The tutorial and tip card lets touches through and sits below the minimap on phones.
- Ready for a public repository: MIT `LICENSE`, data licences spelled out in the README, `SECURITY.md`, development notes in place of the internal handoff log, and `.gitignore` entries for local secrets.
- Moved to the public repository johnstonstu/SkiScrapeX; the game is live on GitHub Pages at https://johnstonstu.github.io/SkiScrapeX/.
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
