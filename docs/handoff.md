# Development notes

Practical notes for anyone (human or agent) picking up the code. Read them with [README.md](../README.md), [docs/status.md](status.md), [docs/roadmap.md](roadmap.md) and [AGENTS.md](../AGENTS.md).

## Workflow

- Feature work happens on branches. `main` only moves at milestones the maintainer has played; each merge bumps `game/package.json`, adds a `CHANGELOG.md` entry and gets a `vX.Y.Z` tag. The `Tag release` workflow creates the tag on the merge commit when the version changes, with the changelog heading as its message.
- Run `npm test` and `npm run build` in `game/` before pushing.
- Generated terrain is never on `main`. The **Build Apex data** workflow builds LidarBC terrain and canopy, the NRCan MRDEM horizon and the OSM export, and force-pushes them to the orphan `data` branch. The OSM step retries public Overpass mirrors, then the main OSM map API. If that export is not usable the job fails and the data branch keeps its last good build. The Pages build will not deploy unless the built `features.json` has buildings and four lifts. Fetch the data branch for local work:

  ```
  git fetch origin data && git --work-tree=game/public/data checkout FETCH_HEAD -- . && git reset -q
  ```

- **Test and deploy** runs the tests on every push to `main`. It then deploys to GitHub Pages (https://johnstonstu.github.io/SkiScrapeX/). The deploy is gated on the repository variable `PAGES_ENABLED=true`, which is set, with Pages using GitHub Actions as its source.

- **Pull request checks** tests and builds pull requests to `main` with Apex data and runs the OSM tests.

## Testing without a GPU

- Headless Chrome with SwiftShader renders at a few frames per second, so input-timing scripts are imprecise. Rely on the unit tests and `npm run tune` (the tuning bots) for physics, and use screenshots for looks.
- `?test` exposes the scene, skier, challenge, goals and other skiers on `window.__game` for scripted smoke tests.

## Graphics levels and old hardware

- Auto picks Low, Medium or High from the graphics chip the browser reports (`src/app/hardware.ts`, unit tested against real renderer strings). The choice and its reason are logged to the console at start-up ("SkiScrapex graphics: ...") and shown in Settings next to Auto.
- Auto never goes above a per-machine limit in `localStorage` (`skiscrapex.autoCap`). A GPU reset (WebGL context lost) or a median frame rate under 24 fps while skiing lowers it; picking a level by hand clears it.
- Chrome switches WebGL off for the whole browser after repeated GPU resets. The game then shows "3D graphics are not available"; only quitting and reopening the browser clears it.
- Expensive shader work belongs behind a quality flag. The close-up snow detail is `SNOW_DETAIL` in `src/fx/snow/SnowMaterial.ts`, off on Low.
- Light and atmosphere (0.9.49) live in `src/render/atmosphere.ts` and `src/fx/atmosphere.ts`. `installAtmosphere()` replaces three's fog chunks once at start-up, so every built-in material and the snow shader share one aerial haze (thicker low down, warmer toward the sun) and drifting cloud shadows. The colour grade is `CustomToneMapping` (Khronos Neutral plus a small contrast, saturation and split-tone curve), so it costs no extra pass. The shared uniforms are Float32Arrays because three copies them by reference when it clones a material's uniforms; a custom `ShaderMaterial` that includes the fog chunks without them falls back to plain exp fog.
- Graphics passes add no draw calls unless they say so. Compare draw calls and triangles with `scripts/perf-spots.mjs` before and after.
- To see a real GPU (headless Chrome only has SwiftShader), run Claude Code with `claude --chrome` and the Claude extension signed in, then read the console from the maintainer's Chrome.

## Rider lab

- `rider.html?pose=tuck,carve-left` shows only those poses; add `&anim` to play them.
- `rider.html?sim` runs the real sim through linked turns behind the follow camera (`pitch`, `period`, `cap` km/h, `fov`, `style=tight`); `window.__step(frames)` steps it frame by frame for review screenshots.
- Outfit URL keys: `jacketStyle` (shell, parkrat, racer, hoodie, puffer), `pantsStyle` (baggy, slim, race), `gloves` (mitt, glove, pipe), `headwear` (helmet, beanie, cap), colours as hex without `#`. `cx`, `cy`, `cz` and `ty` move the camera for close-ups. `default` ignores the saved outfit; `noskin` shows the old code-built rider.

## Rider model (Blender)

- The rider's body is `game/public/models/rider.glb`, built by `tools/blender/build_rider.py`. The script makes an armature on the game's bind pose, every garment style as one skinned mesh, bakes a normal map (from a displaced high-detail copy: folds, seams, zips, quilting, knit) and a mask (R accent, G trim, B ambient occlusion), and exports the GLB. It runs in its own scene and takes about a minute. Then run `npm run pack:rider` in `game/`: `scripts/pack-rider.mjs` moves the maps out to `public/models/rider/*.jpg`, quantizes normals, tangents, UVs and weights, and meshopt-compresses the geometry (3.3 MB to about 0.57 MB). The game fetches a garment's maps the first time a rider wears it; the Rider & gear menu fetches the whole wardrobe when it opens.
- Rebuild from the Blender MCP or Blender's Python console: `ns = {"REPO": r"<repo>"}; exec(open(r"<repo>/tools/blender/build_rider.py").read(), ns); ns["build_all"]()`. From a shell: `blender --background --python tools/blender/build_rider.py -- <repo>`.
- The joints come from `tools/blender/rig_rest.json`. If you move a joint or change the bind pose in `skierModel.ts`, regenerate it with `UPDATE_RIG_REST=1 npx vitest run tests/riderRest.test.ts` in `game/`, then rebuild the GLB. `tests/riderAsset.test.ts` fails if the GLB and the rig drift apart.
- In the game, `render/rider/riderSkin.ts` binds each garment to the rig's own bones (matched by name), so `skierView.ts` animates it unchanged. The code-built rider is the fallback while the GLB loads, if it fails, and in unit tests.
- To add a style: add an entry to `GARMENTS` (shape) and the `masks` and `fabric_detail` functions (colour regions and normal detail), rebuild, then add the style to the lists in `riderSkin.ts` and the rider panel.
- To review a change without a GPU, render an outfit in a skiing stance from four sides after `build_all` in the same namespace: `exec(open(r"<repo>/tools/blender/review_rider.py").read(), ns); ns["review"]({"jacket": "shell", "pants": "baggy", "gloves": "mitt", "headwear": "helmet"}, r"<out.png>", closeup=False)`. It shades garments the way the game does (mask colours, normal map, AO).
- Grabs: `foldForGrab` in `skierView.ts` searches the back (pitch, roll, twist) and the gear (lift, tilt, edge roll) for the cheapest pose where the hand reaches its grab point (`grabSpecsFor`) and the knees stay off the chest. Costs and limits are `GRAB_COST` and `GRAB_LIMITS`; `tests/riderGrabs.test.ts` checks every grab reaches.
- Rider lab: `?snow` starts each rider snow-covered (crash patches and powder up the legs) so the snow shader can be checked; it fades as it would in game.

## Rider clipping check

- `tests/riderClipping.test.ts` poses the real skinned garments from `rider.glb` in every rider lab pose (`src/tools/riderPoses.ts`) and measures how deep one body part's cloth cuts into another, or into the snow. The measure is in `src/render/rider/riderClipping.ts`: each body part has a core capsule sized from the slimmest garment, a garment vertex belongs to its heaviest joint, and depth counts only past what the bind pose already had. Neighbouring parts (and the waist over the hip sockets) are not checked against each other.
- Today's clipping is recorded per pose and pair in `tests/riderClipping.json`. The test fails when a pair clips more than 0.5 cm deeper than its budget, or a new pair clips more than 1 cm.
- Print the table: `RIDER_CLIP_REPORT=1 npx vitest run tests/riderClipping.test.ts` in `game/`. After a deliberate fix or a pose change, record new budgets with `UPDATE_RIDER_CLIP=1` and check the diff of the JSON: fixed pairs should drop out.
- To see where: `rider.html?clip` draws red points on the offending vertices of the worn outfit and puts the worst depth under each label. Add `&pose=mute-grab` for one pose, `&anim` to watch it move.
- Not covered: the small cloth sway in the garment shader (`loose`) and boots, skis and poles, which are not skinned.
- `tests/riderBoots.test.ts` checks the other way a pose breaks: every shin must end at its boot (within 2 cm) in every lab pose, on skis and on a snowboard. In crashes, `keepSkisInReach` in `skierCrashPose.ts` pulls a thrown ski back toward its hip when the leg cannot reach it.

## Scenery models (Blender)

- Lifts: `tools/blender/build_lifts.py` exports `game/public/models/scenery/lifts.glb`. Each part is an empty named `qd_*`, `st_*` or `tb_*` (chair, tower, terminal_bottom, terminal_top) authored in the frames `liftView.ts` uses: chairs from the grip at the origin, towers on the ground with the rope at 11 m (7 m for the T-bar) and 2.6 m either side, terminals on the ground under the bullwheel with +Z down the line. Meshes named `hood_*` hide when the camera is inside the station. `tests/liftAssets.test.ts` checks those anchors.
- Hero buildings: `tools/blender/build_buildings.py` exports `buildings.glb`, modelled on the footprints in `tools/blender/footprints.json` (regenerate with `UPDATE_FOOTPRINTS=1 npx vitest run tests/heroFootprints.test.ts` in `game/` after the data changes). `buildingView.ts` swaps the shell for the model by OSM name (`MODELLED`), at the footprint centroid on the lowest ground. `tests/buildingAssets.test.ts` checks each model stays on its footprint.
- Shared geometry helpers are in `tools/blender/scenery_kit.py`. Run any build like the rider: `ns = {"REPO": r"<repo>"}; exec(open(r"<repo>/tools/blender/build_lifts.py").read(), ns); ns["build_lifts"]()`.
- Review renders: after a build, `exec(open(r"<repo>/tools/blender/review_scenery.py").read(), ns); ns["review_asset"]("gunbarrel", r"<out.png>", distance=58, height=14, target_height=4)`. They cull back faces like the game, so an inward-facing wall shows up as missing.
- Keep metalness low on scenery materials: the game has no environment reflections, so strongly metallic surfaces render black.

## Apex events

- Events are defined as data in `game/src/world/events.ts` (`EVENTS`). Each one has:
  - course legs stitched from run lines, by their names after `applyCorrections` (Kristi's is "Kristi's Run"), or a park with `park: true`;
  - gates: `downhill` on the line, or `gs` and `slalom` alternating either side;
  - the radar trap and split clocks;
  - a crash rule, the pace bot's speed cap, and what stands at the finish.
- History and sources are in `docs/review/apex-events/game-event-ideas.md`.
- Formats:
  - `race`: one run.
  - `twoRun`: combined time.
  - `match`: the gap between two runs.
  - `moguls` and `aerials`: judged, on points.
- An event is a `kind: 'event'` challenge (`app/session.ts`). A missed gate disqualifies; there is no time penalty. Race events start the clock at GO (`session.startClock`).
- The race system lives in three places:
  - `app/race.ts`: the start gate, gate grades, the line assist and speed kicks. Pure.
  - `app/raceDirector.ts`: drives them from the frame loop.
  - `app/ghost.ts`: best-run ghosts, stored in localStorage as `skiscrapex.ghost.<id>`.
- The line assist only pulls a turn the player already commits to. `aimGate` switches to the next gate 4 m early.
- Moguls:
  - `world/mogulCourse.ts` builds the lane, the zipper bumps, the turns (one per bump) and two air ramps.
  - `app/moguls.ts` is the rhythm state machine and autopilot.
  - `app/compDirector.ts` turns steering into taps and overrides the skier's steer, tuck and brake on the snow, leaving the air to the player.
  - The bumps go into the terrain through `stage.setEventTerrain` (a `bumpField` from `world/moguls.ts`) and come out when the event ends.
- Aerials use `stage.eventLayout('Aerial Site', 'aerial')`, which is not saved. `app/judging.ts` has the DD and form maths.
- The props (`render/scenery/eventView.ts`) are built in `goals.activate` only when that event starts, and removed when it ends:
  - start house and wand, gates, split and radar boards, nets;
  - finish arch and fencing, the crowd, parked cars, the timing hut;
  - the ghost and the mogul mesh.
  - Free ski never has them.
- Tests: `tests/events.test.ts` races every gated event on the real map with a key-tapping racer plus the assist. `tests/moguls.test.ts` runs the comp with perfect taps (no crash, top speed, air off both ramps) and the Aerial Site kickers.
- With `?test`, `window.__game.startEvent('kristis-moguls')` starts an event directly (dismiss the title screen first).

## URL parameters

| Parameter | Effect |
|---|---|
| `?dev` | Test slopes instead of Apex |
| `?touch` | Force touch controls |
| `?noshadows` | Shadows off |
| `?at=x,z,headingDeg` | Start somewhere else on the crop |
| `?ride=quickdraw` | Start on a lift |
| `?park=claim` | Start at a terrain park |
| `?perf` | Load-phase and frame timing on `window.__perf` |
| `?test` | Smoke-test handles on `window.__game` (scene, skier, challenge, goals, NPCs, deformable snow, `startEvent(id)`) |
| `?quality=low\|medium\|high` | Try a graphics level for one load without saving it (the deep-snow patch needs Medium or High) |

Review links (`?dev`, `?park`, `?ride`, `?at`, `?perf`) skip the title screen.

### Menu to skiing (0.9.56)

- Free ski from the title goes through `ui/dropIn.ts` (skis or snowboard and one of the starter riders in `app/riders.ts`) once per page load, then `lifts.arriveByChair()`.
- The opening film is a lift ride with `ride.opening` set (`app/game/liftRide.ts`). `arrivalShot` holds two camera shots through `rig.holdShot(position, look, cut, fov)`: `chairShot` rides with the chair until `OPENING_CUT` metres from the top, then `groundShotPosition` waits low behind the ready spot with `groundLens` opening as the rider approaches. The maths is in `app/game/arrival.ts` and has no Three.js. `ui/cinematic.ts` owns the bars, the place card, Skip and hiding the HUD (`body.cinematic`, then `body.hud-enter`).
- Chairs unload along `unloadPath`: straight down the ramp, then one round turn to the facing `chooseExit` picked. The ready spot is the end of that turn (`exit.stop`), not `exit.spot`. If buildings or trees block every radius it falls back to the old straight glide and pivot.
- `app/hints.ts` owns the `#help` line: free-ski prompts, saved under `skiscrapex.hints`. Clear that key to see them again.
- Capturing the film headless needs frame-stepped time: override `requestAnimationFrame` and `performance.now`, and step `document.getAnimations()` by hand, or the CSS card and bars run on wall-clock time while SwiftShader renders at about one frame a second.

## Music

- `src/player/musicState.ts` picks the mood (pure, thresholds in `MUSIC_TUNING`); `musicClock.ts` is the bar scheduler; `musicScore.ts` the key, progression, patterns and the per-mood stem mix (`MOOD_MIX`); `musicVoices.ts` the synths; `music.ts` the Web Audio graph, track player and settings glue.
- `window.skiMusic()` returns the current source, mood, wanted mood, the mood of the last scheduled bar, intensity, key and tempo, track and AudioContext state. Use it with `?at=` and `?park=` to check the mood changes (ambient when standing, drive at about `?at=1906,1512,233` held in a tuck, freestyle on `?park=p`). The in-app browser runs at about one frame a second, so moods change slower there than in play.
- To add tracks, see `game/public/audio/music/README.md`. Credit each in `game/THIRD_PARTY_NOTICES.md`.

## Where to tune

- Ski physics: `PHYSICS` in `src/sim/constants.ts`, surfaces in `src/sim/surface.ts`.
- Provisional feel numbers from 0.9.40 (Stu accepted them for now on 2026-11-27, open to change if the feel is not right in play). Each is marked "guess" in the code:
  - Steering: `maxTraverseDeg` 86, `turnAroundSpeed` 1.5 m/s, `maxLeadDeg` 16, `carveAssist` 1.3 fading over `carveAssistKmh` 45 to 85, in `PHYSICS`.
  - Snow: `washoutRatio` per surface (groomed 4.5, park 4, ice 2.2, rock 2.4, powder and forest 99, so they never wash out), ice `latMax` 1.2, `powderTurnDepth` 0.2.
  - Trees: `HARD_HIT` 8 m/s, `BRUSH_LOSS` and `CLEAR_LINE` in `src/world/treeSkiing.ts`, and `crashGraceTime` 2.5 s.
  - Controls and camera: `STICK_VERTICAL_SHARE` 0.7 in `src/player/input.ts`, and the steady camera rate (1.0) and fall-line pull in `src/player/camera.ts`.
  - Before changing any of them, compare with `npm run tune`: `tuning/inputs.test.ts` (keys, pad and touch, each snow, camera) and `tuning/trees.test.ts`.
- Rider carry (0.9.51, all in `src/render/rider/skierView.ts`): `CARRY_REACH` (elbow bend), `CARRY_LIFT` and `PITCH_HAND_LIFT` (hand height), `POLE_CARRY_BACK` and `POLE_CARRY_OUT` (pole hang), `HAND_HZ` and `HAND_ZETA` (hand follow-through), `TURN_HOLD_DECAY` (crouch held through the crossover), `SKI_HINGE` and `SKI_HINGE_FLEX` (forward hinge). `tests/riderCarry.test.ts` and `tests/riderTurns.test.ts` guard them; `rider.html?sim&cam=back|front|side` shows them.
- Freestyle: `FREESTYLE` in `src/sim/freestyle.ts`, kicker and rail specs in `src/world/park.ts`.
- Music: `MUSIC_TUNING` in `src/player/musicState.ts` (when moods change), `MOOD_MIX` and the patterns in `src/player/musicScore.ts` (how they sound).
- Medal targets: the pace bot in `src/world/challenges.ts` (times) and `parkTargets` (park scores).
- Apex facts the OSM data gets wrong: `src/world/corrections.ts` (including `RUN_STYLE`: moguls, chop, packed and widths per run); traced runs: `src/world/runOverlay.ts`.
- Look: haze visibility, sun glow and cloud shadow per weather in `src/render/weather.ts`; haze height falloff (`ATMOSPHERE.params`) in `src/fx/atmosphere.ts`; the colour grade (`GRADE_GLSL`) and the sky light strength for the rider and metal (`scene.environmentIntensity` in `main.ts`, 0.55) in `src/render/atmosphere.ts`; snow shade colour (`shadeTint`) and the forest shade past the shadow map in `src/fx/snow/SnowMaterial.ts`.
- Glades: polygons and lane spacing in `src/world/glades.ts`. Mogul and chop shapes: `BUMPS` in `src/world/moguls.ts`; how far and how finely they are drawn per level: `MOGUL_DETAIL` in `src/render/terrain/mogulView.ts`. Summit fence and Tooth/Tusk signpost: `src/world/landmarks.ts`.
- `tests/runProfiles.test.ts` compares every run with the research handoff's LiDAR profiles; if a run's line or width changes, it says which run and by how much. Sources are in `docs/apex-sources.md` and `docs/run-names.md`.
- Visual gaps from comparing v0.8.0 with real Apex footage are listed in [docs/review/apex-visual-improvements.md](review/apex-visual-improvements.md), with the captures beside it. That list is a proposal for triage. It is not a scheduled milestone, and the items are not implemented, apart from the `features.json` pipeline fix described above.

For the snowboard animation pass, use `rider.html?sim&model=snowboard` for linked turns. Add `&action=tuck` to review the tuck in motion or `&action=ollie` for a repeating ollie with a grab. For held edge poses, open `rider.html?model=snowboard&pose=heel-side,toe-side`.
