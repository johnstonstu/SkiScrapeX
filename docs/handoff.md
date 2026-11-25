# Development notes

Practical notes for anyone (human or agent) picking up the code. Read them with [README.md](../README.md), [docs/status.md](status.md), [docs/roadmap.md](roadmap.md) and [AGENTS.md](../AGENTS.md).

## Workflow

- Feature work happens on branches. `main` only moves at milestones the maintainer has played; each merge bumps `game/package.json`, adds a `CHANGELOG.md` entry and gets a `vX.Y.Z` tag.
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
- To see a real GPU (headless Chrome only has SwiftShader), run Claude Code with `claude --chrome` and the Claude extension signed in, then read the console from the maintainer's Chrome.

## Rider lab

- `rider.html?pose=tuck,carve-left` shows only those poses; add `&anim` to play them.
- `rider.html?sim` runs the real sim through linked turns behind the follow camera (`pitch`, `period`, `cap` km/h, `fov`, `style=tight`); `window.__step(frames)` steps it frame by frame for review screenshots.
- Outfit URL keys: `jacketStyle` (shell, parkrat, racer, hoodie, puffer), `pantsStyle` (baggy, slim, race), `gloves` (mitt, glove, pipe), `headwear` (helmet, beanie, cap), colours as hex without `#`. `cx`, `cy`, `cz` and `ty` move the camera for close-ups. `default` ignores the saved outfit; `noskin` shows the old code-built rider.

## Rider model (Blender)

- The rider's body is `game/public/models/rider.glb`, built by `tools/blender/build_rider.py`. The script makes an armature on the game's bind pose, every garment style as one skinned mesh, bakes a normal map (from a displaced high-detail copy: folds, seams, zips, quilting, knit) and a mask (R accent, G trim, B ambient occlusion), and exports the GLB. It runs in its own scene and takes about a minute.
- Rebuild from the Blender MCP or Blender's Python console: `ns = {"REPO": r"<repo>"}; exec(open(r"<repo>/tools/blender/build_rider.py").read(), ns); ns["build_all"]()`. From a shell: `blender --background --python tools/blender/build_rider.py -- <repo>`.
- The joints come from `tools/blender/rig_rest.json`. If you move a joint or change the bind pose in `skierModel.ts`, regenerate it with `UPDATE_RIG_REST=1 npx vitest run tests/riderRest.test.ts` in `game/`, then rebuild the GLB. `tests/riderAsset.test.ts` fails if the GLB and the rig drift apart.
- In the game, `render/rider/riderSkin.ts` binds each garment to the rig's own bones (matched by name), so `skierView.ts` animates it unchanged. The code-built rider is the fallback while the GLB loads, if it fails, and in unit tests.
- To add a style: add an entry to `GARMENTS` (shape) and the `masks` and `fabric_detail` functions (colour regions and normal detail), rebuild, then add the style to the lists in `riderSkin.ts` and the rider panel.
- To review a change without a GPU, render an outfit in a skiing stance from four sides after `build_all` in the same namespace: `exec(open(r"<repo>/tools/blender/review_rider.py").read(), ns); ns["review"]({"jacket": "shell", "pants": "baggy", "gloves": "mitt", "headwear": "helmet"}, r"<out.png>", closeup=False)`. It shades garments the way the game does (mask colours, normal map, AO).
- Rider lab: `?snow` starts each rider snow-covered (crash patches and powder up the legs) so the snow shader can be checked; it fades as it would in game.

## Scenery models (Blender)

- Lifts: `tools/blender/build_lifts.py` exports `game/public/models/scenery/lifts.glb`. Each part is an empty named `qd_*`, `st_*` or `tb_*` (chair, tower, terminal_bottom, terminal_top) authored in the frames `liftView.ts` uses: chairs from the grip at the origin, towers on the ground with the rope at 11 m (7 m for the T-bar) and 2.6 m either side, terminals on the ground under the bullwheel with +Z down the line. Meshes named `hood_*` hide when the camera is inside the station. `tests/liftAssets.test.ts` checks those anchors.
- Hero buildings: `tools/blender/build_buildings.py` exports `buildings.glb`, modelled on the footprints in `tools/blender/footprints.json` (regenerate with `UPDATE_FOOTPRINTS=1 npx vitest run tests/heroFootprints.test.ts` in `game/` after the data changes). `buildingView.ts` swaps the shell for the model by OSM name (`MODELLED`), at the footprint centroid on the lowest ground. `tests/buildingAssets.test.ts` checks each model stays on its footprint.
- Shared geometry helpers are in `tools/blender/scenery_kit.py`. Run any build like the rider: `ns = {"REPO": r"<repo>"}; exec(open(r"<repo>/tools/blender/build_lifts.py").read(), ns); ns["build_lifts"]()`.
- Review renders: after a build, `exec(open(r"<repo>/tools/blender/review_scenery.py").read(), ns); ns["review_asset"]("gunbarrel", r"<out.png>", distance=58, height=14, target_height=4)`. They cull back faces like the game, so an inward-facing wall shows up as missing.
- Keep metalness low on scenery materials: the game has no environment reflections, so strongly metallic surfaces render black.

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
| `?test` | Smoke-test handles on `window.__game` (scene, skier, challenge, goals, NPCs, deformable snow) |
| `?quality=low\|medium\|high` | Try a graphics level for one load without saving it (the deep-snow patch needs Medium or High) |

Review links (`?dev`, `?park`, `?ride`, `?at`, `?perf`) skip the title screen.

## Where to tune

- Ski physics: `PHYSICS` in `src/sim/constants.ts`, surfaces in `src/sim/surface.ts`.
- Freestyle: `FREESTYLE` in `src/sim/freestyle.ts`, kicker and rail specs in `src/world/park.ts`.
- Medal targets: the pace bot in `src/world/challenges.ts` (times) and `parkTargets` (park scores).
- Apex facts the OSM data gets wrong: `src/world/corrections.ts`; traced runs: `src/world/runOverlay.ts`. Sources are in `docs/apex-sources.md` and `docs/run-names.md`.
- Visual gaps from comparing v0.8.0 with real Apex footage are listed in [docs/review/apex-visual-improvements.md](review/apex-visual-improvements.md), with the captures beside it. That list is a proposal for triage. It is not a scheduled milestone, and the items are not implemented, apart from the `features.json` pipeline fix described above.

For the snowboard animation pass, use `rider.html?sim&model=snowboard` for linked turns. Add `&action=tuck` to review the tuck in motion or `&action=ollie` for a repeating ollie with a grab. For held edge poses, open `rider.html?model=snowboard&pose=heel-side,toe-side`.
