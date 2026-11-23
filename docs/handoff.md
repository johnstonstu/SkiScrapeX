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
| `?test` | Smoke-test handles on `window.__game` |

Review links (`?dev`, `?park`, `?ride`, `?at`, `?perf`) skip the title screen.

## Where to tune

- Ski physics: `PHYSICS` in `src/sim/constants.ts`, surfaces in `src/sim/surface.ts`.
- Freestyle: `FREESTYLE` in `src/sim/freestyle.ts`, kicker and rail specs in `src/world/park.ts`.
- Medal targets: the pace bot in `src/world/challenges.ts` (times) and `parkTargets` (park scores).
- Apex facts the OSM data gets wrong: `src/world/corrections.ts`; traced runs: `src/world/runOverlay.ts`. Sources are in `docs/apex-sources.md` and `docs/run-names.md`.
- Visual gaps from comparing v0.8.0 with real Apex footage are listed in [docs/review/apex-visual-improvements.md](review/apex-visual-improvements.md), with the captures beside it. That list is a proposal for triage. It is not a scheduled milestone, and the items are not implemented, apart from the `features.json` pipeline fix described above.
